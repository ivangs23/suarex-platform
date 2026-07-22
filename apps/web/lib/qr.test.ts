import { describe, expect, it } from "vitest";
import { tableQrSvg } from "./qr.js";

describe("tableQrSvg", () => {
  it("genera un SVG que contiene la estructura de un QR", async () => {
    const svg = await tableQrSvg("http://garum.localhost:3000/m/abc");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("rechaza una cadena vacía", async () => {
    await expect(tableQrSvg("")).rejects.toThrow();
  });
});
