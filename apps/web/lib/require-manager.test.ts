import { describe, expect, it } from "vitest";
import { isManagerRole } from "./require-manager.js";

describe("isManagerRole", () => {
  it("owner y admin gestionan", () => {
    expect(isManagerRole("owner")).toBe(true);
    expect(isManagerRole("admin")).toBe(true);
  });
  it("staff y device no gestionan", () => {
    expect(isManagerRole("staff")).toBe(false);
    expect(isManagerRole("device")).toBe(false);
  });
});
