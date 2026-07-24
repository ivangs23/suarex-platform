import { describe, expect, it } from "vitest";
import { type ConfigBackend, loadCredentials, saveCredentials } from "./config-store.js";

/** Backend falso en memoria. `encrypt` marca el texto para poder comprobar el descifrado del
 * formato viejo (migración). */
function fakeBackend(): ConfigBackend & { stored: string | null } {
  const state = { stored: null as string | null };
  return {
    get stored() {
      return state.stored;
    },
    read: () => state.stored,
    write: (raw) => {
      state.stored = raw;
    },
    encrypt: (plain) => `ENC(${plain})`,
    decrypt: (enc) => enc.replace(/^ENC\((.*)\)$/, "$1"),
  } as ConfigBackend & { stored: string | null };
}

describe("config-store", () => {
  it("guarda y lee los metadatos del device, SIN contraseña en disco (#11)", () => {
    const b = fakeBackend();
    saveCredentials(b, { deviceId: "d1", email: "e@x", tenantId: "t1" });

    // Lo escrito no lleva ninguna forma de la contraseña: ni `password` ni `passwordEnc`.
    const raw = b.read() as string;
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("ENC(");

    const loaded = loadCredentials(b);
    expect(loaded).toEqual({ deviceId: "d1", email: "e@x", tenantId: "t1" });
    // Sin formato viejo, no hay `legacyPassword`: nada que migrar.
    expect(loaded?.legacyPassword).toBeUndefined();
  });

  it("lee el formato VIEJO (con passwordEnc) y expone la contraseña como legacyPassword", () => {
    const b = fakeBackend();
    // Simula un fichero escrito por una versión anterior: metadata + contraseña cifrada.
    b.write(
      JSON.stringify({
        deviceId: "d1",
        email: "e@x",
        tenantId: "t1",
        passwordEnc: b.encrypt("secreta"),
      }),
    );

    const loaded = loadCredentials(b);
    expect(loaded).toEqual({
      deviceId: "d1",
      email: "e@x",
      tenantId: "t1",
      legacyPassword: "secreta",
    });
  });

  it("loadCredentials devuelve null si no hay fichero (no emparejado)", () => {
    const b = fakeBackend();
    expect(loadCredentials(b)).toBeNull();
  });
});
