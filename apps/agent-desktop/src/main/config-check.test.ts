import { describe, expect, it } from "vitest";
import { faltaEnConfigHorneada, mensajeDeConfigIncompleta } from "./config-check.js";

const COMPLETA = {
  SUPABASE_URL: "https://proyecto.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  PLATFORM_WEB_ORIGIN: "https://garum.suarex.app",
};

/**
 * El fallo que esto cierra ya ocurrió: un ejecutable compilado sin estas variables arranca
 * exactamente igual que uno sano, y luego cada parte falla por su lado con un error que apunta a
 * otro sitio. Se buscó en las contraseñas durante media hora.
 */
describe("faltaEnConfigHorneada", () => {
  it("un build completo no tiene nada que decir", () => {
    expect(faltaEnConfigHorneada(COMPLETA)).toEqual([]);
  });

  it("nombra la variable que falta, no 'hay un problema de configuración'", () => {
    // Quien lea esto tiene que volver a generar el ejecutable: lo que necesita es el nombre
    // exacto que pasarle al build.
    expect(faltaEnConfigHorneada({ ...COMPLETA, PLATFORM_WEB_ORIGIN: "" })).toEqual([
      "PLATFORM_WEB_ORIGIN",
    ]);
  });

  it("las nombra TODAS: arreglar una y volver a fallar es el mismo viaje otra vez", () => {
    expect(
      faltaEnConfigHorneada({ SUPABASE_URL: "", SUPABASE_ANON_KEY: "", PLATFORM_WEB_ORIGIN: "" }),
    ).toEqual(["SUPABASE_URL", "SUPABASE_ANON_KEY", "PLATFORM_WEB_ORIGIN"]);
  });

  it("una variable con solo espacios cuenta como ausente", () => {
    // `define` hornea lo que le den. Un valor en blanco no conecta con nada, así que da igual
    // que técnicamente 'esté'.
    expect(faltaEnConfigHorneada({ ...COMPLETA, SUPABASE_URL: "   " })).toEqual(["SUPABASE_URL"]);
  });
});

describe("mensajeDeConfigIncompleta", () => {
  it("dice qué falta y que no es culpa de quien lo está usando", () => {
    const mensaje = mensajeDeConfigIncompleta(["PLATFORM_WEB_ORIGIN"]);
    expect(mensaje).toContain("PLATFORM_WEB_ORIGIN");
    // Lo segundo importa tanto como lo primero: sin ello, quien lo lee vuelve a probar
    // contraseñas, que es justo lo que pasó.
    expect(mensaje).toContain("contraseña");
  });
});
