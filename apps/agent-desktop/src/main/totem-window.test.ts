import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./totem-window.js";

const TOTEM = "https://manuela.suarex.app/totem/abc-123";

describe("isSameOrigin (blindaje de la ventana kiosko)", () => {
  it("deja navegar dentro del propio totem", () => {
    expect(isSameOrigin("https://manuela.suarex.app/totem/abc-123?cat=cafes", TOTEM)).toBe(true);
    expect(isSameOrigin("https://manuela.suarex.app/otra", TOTEM)).toBe(true);
  });

  it("bloquea otro host, aunque se le parezca", () => {
    expect(isSameOrigin("https://otro.suarex.app/totem/abc", TOTEM)).toBe(false);
    expect(isSameOrigin("https://manuela.suarex.app.malo.com/", TOTEM)).toBe(false);
  });

  it("bloquea otro esquema y otro puerto: el origen es los tres a la vez", () => {
    expect(isSameOrigin("http://manuela.suarex.app/totem/abc", TOTEM)).toBe(false);
    expect(isSameOrigin("https://manuela.suarex.app:8443/totem/abc", TOTEM)).toBe(false);
  });

  it("bloquea esquemas que sacarían del navegador", () => {
    expect(isSameOrigin("file:///C:/Windows/System32/cmd.exe", TOTEM)).toBe(false);
    expect(isSameOrigin("javascript:alert(1)", TOTEM)).toBe(false);
  });

  it("una URL ilegible no navega: ante la duda, se queda donde está", () => {
    expect(isSameOrigin("no-es-una-url", TOTEM)).toBe(false);
    expect(isSameOrigin("", TOTEM)).toBe(false);
  });
});
