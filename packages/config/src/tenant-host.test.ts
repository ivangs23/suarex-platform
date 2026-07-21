import { describe, expect, it } from "vitest";
import { parseTenantHost } from "./tenant-host.js";

const ROOTS = ["localhost", "suarex.app"];

describe("parseTenantHost", () => {
  it("extrae el slug de un subdominio", () => {
    expect(parseTenantHost("garum.suarex.app", ROOTS)).toEqual({
      kind: "subdomain",
      slug: "garum",
    });
  });

  it("ignora el puerto", () => {
    expect(parseTenantHost("manuela.localhost:3000", ROOTS)).toEqual({
      kind: "subdomain",
      slug: "manuela",
    });
  });

  it("normaliza mayúsculas", () => {
    expect(parseTenantHost("GARUM.Suarex.App", ROOTS)).toEqual({
      kind: "subdomain",
      slug: "garum",
    });
  });

  it("trata un host ajeno como dominio propio", () => {
    expect(parseTenantHost("carta.garum.es", ROOTS)).toEqual({
      kind: "domain",
      domain: "carta.garum.es",
    });
  });

  it("rechaza el dominio raíz desnudo", () => {
    expect(parseTenantHost("suarex.app", ROOTS)).toBeNull();
  });

  it("rechaza www del dominio raíz", () => {
    expect(parseTenantHost("www.suarex.app", ROOTS)).toBeNull();
  });

  it("rechaza subdominios anidados", () => {
    expect(parseTenantHost("a.b.suarex.app", ROOTS)).toBeNull();
  });

  it("rechaza un host vacío", () => {
    expect(parseTenantHost("", ROOTS)).toBeNull();
  });
});
