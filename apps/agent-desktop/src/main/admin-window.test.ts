import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./admin-window.js";

/**
 * `isSameOrigin` es la guarda que impide que la ventana de gestión se convierta en un
 * navegador completo SIN barra de direcciones. Si deja pasar un origen ajeno, el usuario no
 * tiene forma de saber qué sitio está mirando mientras teclea su contraseña -- que es
 * exactamente la condición que necesita una página de phishing.
 */
describe("isSameOrigin", () => {
  const ORIGEN = "https://garum.suarex.app";

  it("acepta el mismo origen, con cualquier ruta", () => {
    expect(isSameOrigin(`${ORIGEN}/admin/catalogo`, ORIGEN)).toBe(true);
    expect(isSameOrigin(`${ORIGEN}/staff/login?next=/admin`, ORIGEN)).toBe(true);
    expect(isSameOrigin(ORIGEN, ORIGEN)).toBe(true);
  });

  it("rechaza un host que solo EMPIEZA igual", () => {
    // Un `startsWith` sobre la cadena dejaría pasar los dos: el atacante controla todo lo
    // que va después del punto.
    expect(isSameOrigin("https://garum.suarex.app.atacante.com/admin", ORIGEN)).toBe(false);
    expect(isSameOrigin("https://garum.suarex.app.evil.io", ORIGEN)).toBe(false);
  });

  it("rechaza el mismo host por http (degradar a texto claro no es 'el mismo sitio')", () => {
    expect(isSameOrigin("http://garum.suarex.app/admin", ORIGEN)).toBe(false);
  });

  it("rechaza otro subdominio de la plataforma", () => {
    // Otro cliente es otro origen: la sesión de este no debe viajar allí.
    expect(isSameOrigin("https://otrocliente.suarex.app/admin", ORIGEN)).toBe(false);
  });

  it("rechaza un puerto distinto", () => {
    expect(isSameOrigin("http://garum.localhost:3001/admin", "http://garum.localhost:3000")).toBe(
      false,
    );
    expect(isSameOrigin("http://garum.localhost:3000/admin", "http://garum.localhost:3000")).toBe(
      true,
    );
  });

  it("rechaza esquemas peligrosos y URLs malformadas sin lanzar", () => {
    expect(isSameOrigin("javascript:alert(1)", ORIGEN)).toBe(false);
    expect(isSameOrigin("file:///etc/passwd", ORIGEN)).toBe(false);
    expect(isSameOrigin("data:text/html,<h1>hola", ORIGEN)).toBe(false);
    expect(isSameOrigin("no-es-una-url", ORIGEN)).toBe(false);
    expect(isSameOrigin("", ORIGEN)).toBe(false);
  });

  it("sin origen configurado no acepta NADA", () => {
    // Falla cerrado: un build sin PLATFORM_WEB_ORIGIN no debe navegar a ningún sitio, y
    // desde luego no a cualquiera.
    expect(isSameOrigin(`${ORIGEN}/admin`, "")).toBe(false);
    expect(isSameOrigin("https://lo-que-sea.com", "")).toBe(false);
  });
});
