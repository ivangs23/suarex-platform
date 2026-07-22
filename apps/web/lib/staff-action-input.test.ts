import { describe, expect, it } from "vitest";
import { parseStaffPassword } from "./staff-action-input";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseStaffPassword", () => {
  it("acepta una contraseña de 8+ caracteres", () => {
    expect(parseStaffPassword(fd({ password: "clave123" }))).toBe("clave123");
  });
  it("rechaza una contraseña corta", () => {
    expect(() => parseStaffPassword(fd({ password: "corta" }))).toThrow(/8/);
  });
  it("rechaza una contraseña ausente", () => {
    expect(() => parseStaffPassword(fd({}))).toThrow();
  });
});
