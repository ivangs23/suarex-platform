import { describe, expect, it } from "vitest";
import { type ConfigBackend, loadCredentials, saveCredentials } from "./config-store.js";

/** Backend falso en memoria: `encrypt` marca el texto para verificar que la contraseña
 * NUNCA se escribe en claro. */
function fakeBackend(): ConfigBackend & { stored: string | null } {
  const state = { stored: null as string | null };
  return {
    stored: state.stored,
    read: () => state.stored,
    write: (raw) => {
      state.stored = raw;
    },
    encrypt: (plain) => `ENC(${plain})`,
    decrypt: (enc) => enc.replace(/^ENC\((.*)\)$/, "$1"),
    get storedRef() {
      return state.stored;
    },
  } as ConfigBackend & { stored: string | null };
}

describe("config-store", () => {
  it("guarda y lee credenciales (round-trip), con la contraseña cifrada", () => {
    const b = fakeBackend();
    saveCredentials(b, { deviceId: "d1", email: "e@x", password: "secreta", tenantId: "t1" });

    // La contraseña NO aparece en claro en el JSON guardado: no hay campo "password" (solo
    // "passwordEnc"), y el valor guardado es la forma cifrada, no el texto plano suelto.
    // (Nota: no se puede afirmar `raw` no contiene la subcadena "secreta" a secas, porque el
    // `encrypt` de prueba envuelve el texto como `ENC(secreta)`, que la contiene literalmente;
    // la propiedad real que importa es que no exista un campo plano con la contraseña.)
    const raw = b.read() as string;
    expect(raw).not.toContain('"password":');
    expect(raw).toContain("ENC(secreta)");

    const loaded = loadCredentials(b);
    expect(loaded).toEqual({ deviceId: "d1", email: "e@x", password: "secreta", tenantId: "t1" });
  });

  it("loadCredentials devuelve null si no hay fichero (no emparejado)", () => {
    const b = fakeBackend();
    expect(loadCredentials(b)).toBeNull();
  });
});
