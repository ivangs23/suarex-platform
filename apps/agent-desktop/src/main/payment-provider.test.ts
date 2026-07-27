import { describe, expect, it, vi } from "vitest";
import type { PaymentProvider, ResolvedPaymentConfig } from "./payment-provider.js";
import { createProviderRegistry, missingFields, textValue } from "./payment-provider.js";
import { paytefProvider } from "./paytef-provider.js";

const config = (
  values: Record<string, string | boolean | null> = {},
  mock = false,
): ResolvedPaymentConfig => ({ provider: "paytef", values, mock });

const LLENA = {
  accessKey: "AK",
  secretKey: "SK",
  companyId: "1",
  pinpad: "PIN-1",
};

describe("textValue", () => {
  it("devuelve el texto, y null cuando no hay nada útil", () => {
    expect(textValue(config({ a: "hola" }), "a")).toBe("hola");
    expect(textValue(config({ a: "  " }), "a")).toBeNull();
    expect(textValue(config({}), "a")).toBeNull();
    // Un booleano no es un texto: devolverlo como "true" sería peor que decir que no hay.
    expect(textValue(config({ a: true }), "a")).toBeNull();
  });
});

describe("missingFields", () => {
  it("nombra los obligatorios que faltan, con la etiqueta que ve el dueño", () => {
    expect(missingFields(paytefProvider, config({ accessKey: "AK" }))).toEqual([
      "Clave secreta",
      "Datáfono de este totem",
    ]);
  });

  it("con todo puesto, no falta nada", () => {
    expect(missingFields(paytefProvider, config(LLENA))).toEqual([]);
  });

  it("los campos opcionales no cuentan como falta", () => {
    const sinComercio = { accessKey: "AK", secretKey: "SK", pinpad: "PIN-1" };
    expect(missingFields(paytefProvider, config(sinComercio))).toEqual([]);
  });

  it("en simulación no exige nada: sirve para probar ANTES de tener credenciales", () => {
    expect(missingFields(paytefProvider, config({}, true))).toEqual([]);
  });
});

describe("createProviderRegistry", () => {
  const otro: PaymentProvider = {
    id: "otro",
    label: "Otro",
    configFields: [],
    canPollSession: false,
    charge: async () => ({ approved: false, reason: "no" }),
  };

  it("resuelve por id y enumera los disponibles", () => {
    const registro = createProviderRegistry([paytefProvider, otro]);
    expect(registro.get("paytef")?.label).toContain("Paytef");
    expect(registro.list().map((p) => p.id)).toEqual(["paytef", "otro"]);
  });

  it("un proveedor desconocido devuelve null en vez de reventar", () => {
    // Una fila guardada por una versión más nueva del panel no puede tumbar el totem.
    expect(createProviderRegistry([paytefProvider]).get("de-marte")).toBeNull();
  });
});

describe("paytefProvider", () => {
  it("declara que sabe volver a preguntar por una operación", () => {
    // De esto depende que un cobro interrumpido se recupere solo en vez de acabar en un aviso.
    expect(paytefProvider.canPollSession).toBe(true);
    expect(typeof paytefProvider.pollSession).toBe("function");
  });

  it("la clave secreta va declarada como secreto, no como texto", () => {
    // Es lo que hace que el panel no la devuelva nunca una vez guardada.
    const campo = paytefProvider.configFields.find((f) => f.name === "secretKey");
    expect(campo?.type).toBe("secret");
  });

  it("el datáfono va declarado como TERMINAL: vive en el dispositivo, no en el tenant", () => {
    // Un comercio con dos totems tiene dos datáfonos y una sola cuenta de Paytef.
    const campo = paytefProvider.configFields.find((f) => f.name === "pinpad");
    expect(campo?.type).toBe("terminal");
  });

  it("en simulación cobra sin red y aprueba", async () => {
    const onStatus = vi.fn();
    const resultado = await paytefProvider.charge(config(LLENA, true), 1250, "ORD-1", { onStatus });

    expect(resultado).toEqual({ approved: true, authCode: "MOCK-000000" });
    // Y va contando el proceso: la pantalla del totem se apoya en esto.
    expect(onStatus.mock.calls.map((c) => c[0])).toContain("waiting_card");
  });

  it("en simulación se puede cancelar, y entonces no aprueba", async () => {
    const resultado = await paytefProvider.charge(config(LLENA, true), 1250, "ORD-1", {
      isCancelled: () => true,
    });
    expect(resultado.approved).toBe(false);
  });

  it("consultar una sesión en simulación dice 'no se sabe', nunca inventa un aprobado", async () => {
    // Sin red que consultar, la única respuesta honesta es que no consta.
    expect(await paytefProvider.pollSession?.(config(LLENA, true), "S-1")).toEqual({
      kind: "unknown",
    });
  });
});
