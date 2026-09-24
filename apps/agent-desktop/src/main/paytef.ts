import https from "node:https";

// Puente de cobro con Paytef Cloud (datáfono) para el modo totem. Portado del flujo del
// kiosko-manuela legacy (`electron/paytef-cloud-service.cjs`), pero con la config INYECTADA
// (nunca horneada) y con las partes deterministas (payloads, interpretación del poll) separadas
// como funciones puras y testeables. La API es cloud: auth -> start -> poll -> result.
const PAYTEF_HOST = "cloud.api.paytef.es";

/** Config resuelta de un totem: credenciales de cuenta del tenant + pinpad de ESTE device.
 *  Llega de `getPaymentConfigForDevice` (RPC acotada), nunca del renderer ni del build. */
export type PaytefBridgeConfig = {
  accessKey: string;
  secretKey: string;
  companyId: string | null;
  pinpad: string;
  mock: boolean;
};

export type PaytefResult =
  | { approved: true; authCode: string }
  | { approved: false; reason: string };

export type PaytefStatus = "initializing" | "waiting_card" | "processing" | "success" | "error";

/** Cuerpo (parcial) de las respuestas de Paytef; cubre auth (`result.token`), start
 *  (`info.sessionID`) y poll (`result.approved` / `info`). */
type PaytefBody =
  | {
      result?: {
        token?: string;
        approved?: boolean;
        authorisationCode?: string;
        resultText?: string;
      };
      info?: { sessionID?: string; transactionStatus?: string; cardStatus?: string };
    }
  | null
  | undefined;

/** Transporte HTTP inyectable: en producción golpea Paytef por HTTPS; en tests, un fake. */
export type PaytefTransport = (
  path: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
) => Promise<{ status: number; body: PaytefBody }>;

/** Payload de `/transaction/start`. Puro: `transactionReference` (con el orderId) entra hecho. */
export function buildStartPayload(
  amountCents: number,
  pinpad: string,
  transactionReference: string,
) {
  return {
    language: "es",
    pinpad,
    executeOptions: { method: "polling" },
    opType: "sale",
    requestedAmount: amountCents,
    createReceipt: false,
    showResultSeconds: 5,
    transactionReference,
  };
}

export type PollInterpretation =
  | { kind: "final"; approved: true; authCode: string }
  | { kind: "final"; approved: false; reason: string }
  | { kind: "progress"; status: PaytefStatus }
  | { kind: "none" };

/** Interpreta un cuerpo de `/transaction/poll`: resultado final (aprobado/denegado), progreso, o
 *  nada aún. Puro. */
export function interpretPollBody(body: PaytefBody): PollInterpretation {
  if (!body) return { kind: "none" };
  if (body.result) {
    if (body.result.approved) {
      return {
        kind: "final",
        approved: true,
        authCode: String(body.result.authorisationCode ?? ""),
      };
    }
    return {
      kind: "final",
      approved: false,
      reason: body.result.resultText ?? "Operación denegada",
    };
  }
  if (body.info) {
    if (body.info.cardStatus === "readingCard" || body.info.transactionStatus === "processing") {
      return { kind: "progress", status: "processing" };
    }
  }
  return { kind: "none" };
}

const CANCELLED: PaytefResult = { approved: false, reason: "Operación cancelada por el usuario" };

/**
 * Cobra `amountCents` por Paytef y devuelve aprobado/denegado. Con `mock` (por defecto en config
 * hasta tener datáfono real) simula un cobro aprobado. Emite estados por `onStatus` para la UI.
 * `transport`/`sleep` son inyectables para probar sin red ni relojes reales; `isCancelled` deja
 * abortar (el totem tiene botón "Cancelar").
 */
export async function chargePaytef(
  config: PaytefBridgeConfig,
  amountCents: number,
  transactionReference: string,
  opts: {
    transport?: PaytefTransport;
    onStatus?: (status: PaytefStatus, message: string) => void;
    isCancelled?: () => boolean;
    sleep?: (ms: number) => Promise<void>;
    pollIntervalMs?: number;
    maxPolls?: number;
  } = {},
): Promise<PaytefResult> {
  const onStatus = opts.onStatus ?? (() => {});
  const isCancelled = opts.isCancelled ?? (() => false);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  onStatus("initializing", "Conectando con el terminal…");

  if (config.mock) {
    if (isCancelled()) return CANCELLED;
    onStatus("waiting_card", "Acerque su tarjeta o dispositivo");
    await sleep(opts.pollIntervalMs ?? 0);
    if (isCancelled()) return CANCELLED;
    onStatus("processing", "Procesando la operación…");
    await sleep(opts.pollIntervalMs ?? 0);
    if (isCancelled()) return CANCELLED;
    onStatus("success", "Pago simulado aceptado");
    return { approved: true, authCode: "MOCK-000000" };
  }

  const transport = opts.transport ?? realTransport;

  const auth = await transport(
    "/authorize/",
    "POST",
    {},
    {
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    },
  );
  const token = auth.body?.result?.token;
  if (auth.status !== 200 || !token) {
    onStatus("error", "Error de autenticación con el terminal");
    return { approved: false, reason: "Error de autenticación con Paytef" };
  }

  const auth2: Record<string, string> = { Authorization: `Bearer ${token}` };
  const start = await transport(
    "/transaction/start",
    "POST",
    auth2,
    buildStartPayload(amountCents, config.pinpad, transactionReference),
  );
  const sessionID = start.body?.info?.sessionID;
  if (!sessionID) {
    onStatus("error", "No se pudo iniciar la operación");
    return { approved: false, reason: "No se pudo iniciar la transacción" };
  }

  onStatus("waiting_card", "Siga las instrucciones del terminal");

  const maxPolls = opts.maxPolls ?? 120;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  for (let i = 0; i < maxPolls; i++) {
    if (isCancelled()) {
      await cancelPinpad(transport, token, config.pinpad);
      return CANCELLED;
    }
    await sleep(pollIntervalMs);
    if (isCancelled()) {
      await cancelPinpad(transport, token, config.pinpad);
      return CANCELLED;
    }
    const poll = await transport("/transaction/poll", "POST", auth2, {
      sessionID,
      pinpad: config.pinpad,
    });
    const interp = interpretPollBody(poll.body);
    if (interp.kind === "final") {
      if (interp.approved) {
        onStatus("success", "Pago aprobado");
        return { approved: true, authCode: interp.authCode };
      }
      onStatus("error", interp.reason);
      return { approved: false, reason: interp.reason };
    }
    if (interp.kind === "progress") onStatus(interp.status, "Procesando tarjeta…");
  }

  onStatus("error", "Tiempo de espera agotado");
  return { approved: false, reason: "Tiempo de espera agotado" };
}

async function cancelPinpad(
  transport: PaytefTransport,
  token: string,
  pinpad: string,
): Promise<void> {
  try {
    await transport("/pinpad/cancel", "POST", { Authorization: `Bearer ${token}` }, { pinpad });
  } catch {
    // Un fallo al cancelar en el terminal no debe romper el flujo: ya devolvemos "cancelado".
  }
}

/** Transporte real por HTTPS contra Paytef Cloud (mismo patrón que el legacy). */
const realTransport: PaytefTransport = (path, method, headers, body) =>
  new Promise((resolve) => {
    const req = https.request(
      {
        hostname: PAYTEF_HOST,
        path,
        method,
        headers: { "Content-Type": "application/json", ...headers },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as PaytefBody });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: null });
          }
        });
      },
    );
    req.on("error", () => resolve({ status: 0, body: null }));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
