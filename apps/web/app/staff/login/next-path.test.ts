import { describe, expect, it } from "vitest";
import { destinoTrasLogin } from "./next-path";

/**
 * Dos cosas a la vez: que devuelva a donde ibas, y que no se pueda usar para mandarte a otro
 * sitio. Lo segundo es lo serio -- un login que redirige a donde le digan es un redirector
 * abierto: la víctima se autentica en el sitio de verdad y acaba en el del atacante, ya
 * confiada.
 */
describe("destinoTrasLogin", () => {
  it("devuelve a la ruta pedida", () => {
    expect(destinoTrasLogin("/admin/catalogo")).toBe("/admin/catalogo");
    expect(destinoTrasLogin("/admin/cierre?dia=2026-07-31")).toBe("/admin/cierre?dia=2026-07-31");
  });

  it("sin `next` va al destino de siempre", () => {
    expect(destinoTrasLogin(null)).toBe("/staff");
    expect(destinoTrasLogin(undefined)).toBe("/staff");
    expect(destinoTrasLogin("")).toBe("/staff");
  });

  it("no sale de este sitio", () => {
    expect(destinoTrasLogin("https://atacante.com/roba")).toBe("/staff");
    expect(destinoTrasLogin("http://atacante.com")).toBe("/staff");
  });

  it("rechaza las que EMPIEZAN por barra pero llevan a otro host", () => {
    // El caso que se cuela si solo se comprueba `startsWith("/")`: el navegador resuelve
    // `//atacante.com` como `https://atacante.com`, no como una ruta de este sitio.
    expect(destinoTrasLogin("//atacante.com/roba")).toBe("/staff");
    expect(destinoTrasLogin("/\\atacante.com")).toBe("/staff");
  });

  it("rechaza esquemas ejecutables", () => {
    expect(destinoTrasLogin("javascript:alert(1)")).toBe("/staff");
    expect(destinoTrasLogin("data:text/html,<h1>hola")).toBe("/staff");
  });

  it("rechaza saltos de línea y bytes de control", () => {
    // Aguas abajo, un salto de línea dentro de una ruta puede partir una cabecera en dos.
    expect(destinoTrasLogin("/admin\r\nSet-Cookie: a=b")).toBe("/staff");
    expect(destinoTrasLogin(`/admin${String.fromCharCode(9)}catalogo`)).toBe("/staff");
  });
});
