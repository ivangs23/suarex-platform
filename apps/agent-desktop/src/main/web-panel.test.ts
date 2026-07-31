import { describe, expect, it } from "vitest";
import { esFalloDeCargaRelevante, isSameOrigin } from "./web-panel.js";

/**
 * `isSameOrigin` es la guarda que impide que el panel incrustado se convierta en un
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

/**
 * El registro de esta máquina es lo ÚNICO que se puede mirar cuando el panel falla en un equipo
 * a 300 km. Vale lo que valga su señal/ruido: si se llena de líneas rojas que no significan
 * nada, deja de mirarse, y entonces da igual lo que registre.
 */
describe("esFalloDeCargaRelevante", () => {
  it("ignora ERR_ABORTED: es el caso normal, no un fallo", () => {
    // Chromium lo emite en cada redirección y en cada `router.push`. Registrarlo pintaría de
    // rojo el funcionamiento correcto -- p. ej. cada vez que /admin manda al login.
    expect(esFalloDeCargaRelevante(-3)).toBe(false);
  });

  it("ignora el 0, que es 'sin error'", () => {
    expect(esFalloDeCargaRelevante(0)).toBe(false);
  });

  it("registra lo que sí deja al usuario sin panel", () => {
    expect(esFalloDeCargaRelevante(-105)).toBe(true); // ERR_NAME_NOT_RESOLVED
    expect(esFalloDeCargaRelevante(-102)).toBe(true); // ERR_CONNECTION_REFUSED
    expect(esFalloDeCargaRelevante(-7)).toBe(true); // ERR_TIMED_OUT
  });
});
