import { describe, expect, it } from "vitest";
import { renderEscPos } from "./render.js";

describe("renderEscPos", () => {
  it("produce bytes no vacíos y termina en el comando de corte", () => {
    const buf = renderEscPos([
      { kind: "text", text: "Hola", align: "center", bold: true },
      { kind: "cut" },
    ]);
    expect(buf.length).toBeGreaterThan(0);
    // GS V — comando de corte de ESC/POS.
    expect(buf.includes(Buffer.from([0x1d, 0x56]))).toBe(true);
  });

  it("incluye el texto de las líneas", () => {
    const buf = renderEscPos([{ kind: "text", text: "PEDIDO", align: "left" }, { kind: "cut" }]);
    expect(buf.includes(Buffer.from("PEDIDO", "latin1"))).toBe(true);
  });

  it("conserva el símbolo del euro (charset PC858_EURO)", () => {
    const buf = renderEscPos([{ kind: "text", text: "10€", align: "left" }, { kind: "cut" }]);
    // 0xD5 es "€" en la variante euro de la codepage 858 usada por el charset
    // PC858_EURO. Si `removeSpecialCharacters` lo hubiera descartado, o si el
    // charset fuera el equivocado, este byte no aparecería en el buffer.
    expect(buf.includes(Buffer.from([0xd5]))).toBe(true);
  });
});
