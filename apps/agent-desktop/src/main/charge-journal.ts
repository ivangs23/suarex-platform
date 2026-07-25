import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * EL DIARIO DE COBROS: lo único que sobrevive a que el totem se apague a mitad de un pago.
 *
 * El reintento de `chargeOrder` cubre un corte de red de unos segundos: el cobro ya está aprobado
 * y solo falla registrarlo, así que se reintenta el registro. Lo que NO cubre es que el proceso
 * MUERA -- un tirón del enchufe, un cierre de Windows, un cuelgue -- entre que el datáfono
 * aprueba y el pedido queda marcado. En ese hueco no queda rastro en ninguna parte: el cliente ha
 * pagado, el pedido sigue `pending`, y nadie lo sabe. En un totem desatendido eso es un cliente
 * cobrado sin comida y sin nadie a quien reclamar.
 *
 * El diario se escribe ANTES de cobrar, no después. Tiene que ser así: si solo se apuntara lo
 * aprobado, morir DURANTE el cobro dejaría el mismo agujero una capa más abajo.
 *
 * ---
 *
 * Formato: JSON Lines, append-only, con `fsync` en cada evento.
 *
 * Append-only y no un objeto JSON reescrito entero porque un fichero que se reescribe puede
 * quedar a medias justo en el corte que este diario existe para sobrevivir -- y entonces se
 * pierde TODO lo anterior, no solo lo último. Añadiendo, un corte a mitad de línea solo corrompe
 * esa línea: al leer se descarta y el resto sigue en pie.
 *
 * `fsync` (no basta con que `write` vuelva) porque lo que hay que garantizar es que esté EN EL
 * DISCO antes de mandar la orden al datáfono. Sin él, los bytes viven en la caché del sistema y
 * un corte de corriente se los lleva exactamente en el momento que importa.
 */

/** Un evento del diario. El estado de un cobro es el pliegue de sus eventos, en orden. */
export type ChargeEvent =
  /** Antes de hablar con el datáfono. A partir de aquí puede haber dinero en juego. */
  | { t: "started"; ref: string; orderId: string; amountCents: number; at: number }
  /** El datáfono aceptó la orden y devolvió sesión. Con esto se puede volver a preguntar. */
  | { t: "session"; ref: string; sessionId: string; at: number }
  /** Aprobado. El cliente YA HA PAGADO. */
  | { t: "approved"; ref: string; authCode: string; at: number }
  /** Denegado/cancelado: no se ha movido un céntimo y el asunto está cerrado. */
  | { t: "declined"; ref: string; reason: string; at: number }
  /** Registrado en el servidor. El cobro está cerrado del todo. */
  | { t: "settled"; ref: string; at: number };

/** Un cobro que quedó a medias, con todo lo que se sabe de él. */
export type PendingCharge = {
  ref: string;
  orderId: string;
  amountCents: number;
  startedAt: number;
  /** Presente en cuanto el datáfono aceptó la orden: permite volver a preguntar por el resultado. */
  sessionId?: string;
  /** Presente si se llegó a saber que aprobó. El cliente ha pagado. */
  authCode?: string;
};

export type ChargeJournal = {
  append(event: ChargeEvent): Promise<void>;
  /** Los cobros SIN cerrar, en el orden en que empezaron. Los cerrados no vuelven. */
  pending(): Promise<PendingCharge[]>;
  /** Reescribe el fichero dejando solo lo que sigue vivo. Se llama al arrancar, tras recuperar. */
  compact(): Promise<void>;
};

/**
 * Pliega los eventos al estado actual. PURO, y exportado para poder probarlo sin tocar disco:
 * es la parte que decide qué se considera "a medias", y equivocarse aquí es o perder un cobro o
 * inventarse uno.
 *
 * Un evento sin su `started` se ignora: describe un cobro del que no sabemos ni el pedido ni el
 * importe, así que no hay nada que se pueda hacer con él.
 */
export function foldEvents(events: ChargeEvent[]): PendingCharge[] {
  const vivos = new Map<string, PendingCharge>();
  for (const event of events) {
    if (event.t === "started") {
      vivos.set(event.ref, {
        ref: event.ref,
        orderId: event.orderId,
        amountCents: event.amountCents,
        startedAt: event.at,
      });
      continue;
    }
    const cobro = vivos.get(event.ref);
    if (!cobro) continue;
    if (event.t === "session") cobro.sessionId = event.sessionId;
    else if (event.t === "approved") cobro.authCode = event.authCode;
    // Un cobro denegado está tan cerrado como uno registrado: no se ha movido dinero.
    else if (event.t === "declined" || event.t === "settled") vivos.delete(event.ref);
  }
  return [...vivos.values()];
}

/**
 * Convierte el contenido crudo del fichero en eventos, descartando lo ilegible.
 *
 * Una línea rota es EXACTAMENTE lo que deja un corte de corriente a mitad de escritura, y es
 * siempre la última: descartarla y seguir es la razón de ser del formato. Tirar el fichero entero
 * por una línea mala sería tirar justo los cobros que hay que recuperar.
 */
export function parseEvents(raw: string): ChargeEvent[] {
  const events: ChargeEvent[] = [];
  for (const line of raw.split("\n")) {
    const texto = line.trim();
    if (!texto) continue;
    try {
      const event = JSON.parse(texto) as ChargeEvent;
      if (typeof event?.t === "string" && typeof event?.ref === "string") events.push(event);
    } catch {
      // Línea a medias o basura: se descarta, el resto del diario sigue valiendo.
    }
  }
  return events;
}

/** Escribe y hace `fsync`: sin lo segundo, "escrito" solo significa "en la caché del sistema". */
async function appendDurable(path: string, texto: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, texto, "utf8");
  const fh = await open(path, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * El diario sobre un fichero concreto. El llamante decide dónde vive (en Electron,
 * `app.getPath("userData")`), para que este módulo no dependa de Electron y se pueda probar
 * contra un directorio temporal de verdad -- con ficheros reales, que es donde este código puede
 * fallar de formas que un `fs` de mentira nunca reproduce.
 */
export function createChargeJournal(dir: string, fileName = "cobros.jsonl"): ChargeJournal {
  const path = join(dir, fileName);

  async function leeEventos(): Promise<ChargeEvent[]> {
    try {
      return parseEvents(await readFile(path, "utf8"));
    } catch {
      // Sin fichero todavía: no hay nada a medias, que es distinto de un error.
      return [];
    }
  }

  return {
    async append(event) {
      await appendDurable(path, `${JSON.stringify(event)}\n`);
    },

    async pending() {
      return foldEvents(await leeEventos());
    },

    /* Sin esto el fichero crece para siempre: un totem con cien pedidos al día acumula cientos de
       líneas cerradas que hay que releer en cada arranque. Se reescribe por un temporal y se
       renombra encima -- `rename` es atómico en el mismo volumen -- para que un corte durante la
       compactación deje el diario viejo intacto, nunca uno a medias. */
    async compact() {
      const vivos = await this.pending();
      const lineas = vivos.map((cobro) => {
        const eventos: ChargeEvent[] = [
          {
            t: "started",
            ref: cobro.ref,
            orderId: cobro.orderId,
            amountCents: cobro.amountCents,
            at: cobro.startedAt,
          },
        ];
        if (cobro.sessionId) {
          eventos.push({
            t: "session",
            ref: cobro.ref,
            sessionId: cobro.sessionId,
            at: cobro.startedAt,
          });
        }
        if (cobro.authCode) {
          eventos.push({
            t: "approved",
            ref: cobro.ref,
            authCode: cobro.authCode,
            at: cobro.startedAt,
          });
        }
        return eventos.map((e) => JSON.stringify(e)).join("\n");
      });
      const contenido = lineas.length > 0 ? `${lineas.join("\n")}\n` : "";

      await mkdir(dir, { recursive: true });
      const temporal = `${path}.tmp`;
      await writeFile(temporal, contenido, "utf8");
      const fh = await open(temporal, "r+");
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(temporal, path);
    },
  };
}
