import { describe, expect, it } from "vitest";
import { parseTenantHost, resolveRootDomains } from "./tenant-host.js";

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

  it("recorta espacios en una raíz mal escrita (p.ej. 'localhost, suarex.app')", () => {
    const rootsWithSpace = ["localhost", " suarex.app"];
    expect(parseTenantHost("garum.suarex.app", rootsWithSpace)).toEqual({
      kind: "subdomain",
      slug: "garum",
    });
  });
});

describe("resolveRootDomains", () => {
  it("recorta cada entrada y descarta las vacías", () => {
    expect(resolveRootDomains({ TENANT_ROOT_DOMAINS: "localhost, suarex.app" })).toEqual([
      "localhost",
      "suarex.app",
    ]);
  });

  it("descarta una entrada vacía por coma final", () => {
    expect(resolveRootDomains({ TENANT_ROOT_DOMAINS: "localhost,suarex.app," })).toEqual([
      "localhost",
      "suarex.app",
    ]);
  });

  it("sin definir en development cae a ['localhost']", () => {
    expect(resolveRootDomains({ NODE_ENV: "development" })).toEqual(["localhost"]);
  });

  it("sin definir fuera de development lanza en vez de defaultear en silencio", () => {
    expect(() => resolveRootDomains({ NODE_ENV: "production" })).toThrow(
      /TENANT_ROOT_DOMAINS no está definida/,
    );
  });

  it("sin definir y sin NODE_ENV (nunca asumas development) también lanza", () => {
    expect(() => resolveRootDomains({})).toThrow(/TENANT_ROOT_DOMAINS no está definida/);
  });

  it("vacía fuera de development lanza igual que sin definir", () => {
    expect(() => resolveRootDomains({ TENANT_ROOT_DOMAINS: "", NODE_ENV: "production" })).toThrow(
      /TENANT_ROOT_DOMAINS no está definida/,
    );
  });

  it("solo comas/espacios (ningún dominio válido) lanza", () => {
    expect(() =>
      resolveRootDomains({ TENANT_ROOT_DOMAINS: " , ,", NODE_ENV: "production" }),
    ).toThrow(/no contiene ningún dominio válido/);
  });
});
