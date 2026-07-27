import { describe, expect, it } from "vitest";
import { PAYTEF_INFO } from "./paytef.js";
import type { PaymentProviderInfo } from "./provider-info.js";
import { accountFields, missingFields, splitByStorage, terminalField } from "./provider-info.js";
import { findProvider, PAYMENT_PROVIDERS } from "./registry.js";

const LLENO = { accessKey: "AK", secretKey: "SK", companyId: "C", pinpad: "PIN-1" };

describe("declaración de Paytef", () => {
  it("la clave secreta va como secreto: es lo que hace que el panel no la devuelva", () => {
    expect(PAYTEF_INFO.configFields.find((f) => f.name === "secretKey")?.type).toBe("secret");
  });

  it("el datáfono va como terminal: vive en el dispositivo, no en la cuenta", () => {
    // Un comercio con dos totems tiene dos datáfonos y una sola cuenta de Paytef.
    expect(terminalField(PAYTEF_INFO)?.name).toBe("pinpad");
  });

  it("declara que sabe volver a preguntar por una operación interrumpida", () => {
    expect(PAYTEF_INFO.canPollSession).toBe(true);
  });
});

describe("accountFields", () => {
  it("deja fuera el terminal: el panel de pagos no lo pinta, lo pinta la ficha del dispositivo", () => {
    expect(accountFields(PAYTEF_INFO).map((f) => f.name)).toEqual([
      "accessKey",
      "secretKey",
      "companyId",
    ]);
  });
});

describe("missingFields", () => {
  it("nombra lo obligatorio que falta, con la etiqueta que ve el dueño", () => {
    expect(missingFields(PAYTEF_INFO, { accessKey: "AK" }, false)).toEqual([
      "Clave secreta",
      "Datáfono de este totem",
    ]);
  });

  it("con todo puesto no falta nada, y lo opcional no cuenta", () => {
    expect(missingFields(PAYTEF_INFO, LLENO, false)).toEqual([]);
    const { companyId, ...sinComercio } = LLENO;
    expect(missingFields(PAYTEF_INFO, sinComercio, false)).toEqual([]);
  });

  it("en simulación no exige nada: sirve para probar ANTES de tener credenciales", () => {
    expect(missingFields(PAYTEF_INFO, {}, true)).toEqual([]);
  });
});

describe("splitByStorage", () => {
  it("reparte cada valor a su sitio según lo que declaró el proveedor", () => {
    expect(splitByStorage(PAYTEF_INFO, LLENO)).toEqual({
      config: { accessKey: "AK", companyId: "C" },
      secrets: { secretKey: "SK" },
      terminal: "PIN-1",
    });
  });

  it("un secreto en blanco NO se incluye: en una edición significa 'no lo cambies'", () => {
    /* El valor guardado no baja al navegador, así que no se puede reenviar. Tratar el blanco como
       un borrado dejaría la cuenta sin clave cada vez que alguien corrigiera una errata en otro
       campo -- y el totem sin poder cobrar hasta que alguien se diera cuenta. */
    const { secrets } = splitByStorage(PAYTEF_INFO, { ...LLENO, secretKey: "   " });
    expect(secrets).toEqual({});
  });

  it("un texto en blanco tampoco se guarda: ausencia y cadena vacía no son lo mismo", () => {
    const { config } = splitByStorage(PAYTEF_INFO, { ...LLENO, companyId: "" });
    expect(config).toEqual({ accessKey: "AK" });
  });

  it("un terminal en blanco sí es un borrado explícito", () => {
    // Aquí no hay ambigüedad: el terminal SÍ se puede releer, así que un blanco es una decisión.
    expect(splitByStorage(PAYTEF_INFO, { ...LLENO, pinpad: "" }).terminal).toBeNull();
  });

  it("ignora lo que el proveedor no ha declarado", () => {
    // Un campo de más en el formulario -- de otro proveedor, o inventado -- no se guarda.
    const { config } = splitByStorage(PAYTEF_INFO, { ...LLENO, colado: "x" });
    expect(config.colado).toBeUndefined();
  });

  it("un booleano declarado se guarda como texto en la config", () => {
    const info: PaymentProviderInfo = {
      id: "x",
      label: "X",
      canPollSession: false,
      configFields: [{ name: "activo", label: "Activo", type: "boolean", required: false }],
    };
    expect(splitByStorage(info, { activo: true }).config).toEqual({ activo: "true" });
  });
});

describe("registro", () => {
  it("resuelve por id", () => {
    expect(findProvider("paytef")).toBe(PAYTEF_INFO);
  });

  it("un id desconocido devuelve null en vez de reventar", () => {
    // Una fila guardada por una versión más nueva -- o con una errata -- no puede tumbar el totem
    // ni la pantalla de ajustes.
    expect(findProvider("de-marte")).toBeNull();
  });

  it("todos los proveedores tienen id único", () => {
    const ids = PAYMENT_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
