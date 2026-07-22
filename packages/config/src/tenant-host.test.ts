import { describe, expect, it } from "vitest";
import { normalizeCustomDomain, parseTenantHost, resolveRootDomains } from "./tenant-host.js";

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

describe("normalizeCustomDomain", () => {
  const ROOTS = ["suarex.app", "localhost"];

  it("acepta un dominio real y lo normaliza", () => {
    expect(normalizeCustomDomain("GarumVinoteca.com", ROOTS)).toBe("garumvinoteca.com");
    expect(normalizeCustomDomain("  carta.garumvinoteca.com  ", ROOTS)).toBe(
      "carta.garumvinoteca.com",
    );
  });

  it("rechaza lo que no es un nombre de host", () => {
    // Recortar la URL escondería el error del owner hasta que fallara el certificado.
    expect(normalizeCustomDomain("https://garumvinoteca.com", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("garumvinoteca.com/carta", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("garumvinoteca.com:443", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("usuario@garumvinoteca.com", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("garum vinoteca.com", ROOTS)).toBeNull();
  });

  it("rechaza nombres sin punto y direcciones IP", () => {
    // No pueden llevar certificado público ni resolverse desde fuera.
    expect(normalizeCustomDomain("localhost", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("intranet", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("192.168.1.10", ROOTS)).toBeNull();
  });

  it("rechaza etiquetas mal formadas", () => {
    expect(normalizeCustomDomain("-mal.com", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("mal-.com", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("do..ble.com", ROOTS)).toBeNull();
    expect(normalizeCustomDomain(`${"a".repeat(64)}.com`, ROOTS)).toBeNull();
    expect(normalizeCustomDomain(`${"a".repeat(63)}.com`, ROOTS)).toBe(`${"a".repeat(63)}.com`);
  });

  it("rechaza cualquier dominio bajo una raíz de la plataforma", () => {
    // Guardarlo no secuestra nada hoy (parseTenantHost mira las raíces antes), pero deja
    // una fila inútil que pediría certificados que el comodín ya cubre, y convierte
    // cualquier cambio futuro en ese orden de resolución en un secuestro entre clientes.
    expect(normalizeCustomDomain("otro.suarex.app", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("suarex.app", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("api.suarex.app", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("hondo.api.suarex.app", ROOTS)).toBeNull();
    // Un dominio que solo TERMINA parecido no cuelga de la raíz: sí vale.
    expect(normalizeCustomDomain("nosuarex.app", ROOTS)).toBe("nosuarex.app");
  });

  it("rechaza vacío y un dominio más largo que el límite del RFC", () => {
    expect(normalizeCustomDomain("", ROOTS)).toBeNull();
    expect(normalizeCustomDomain("   ", ROOTS)).toBeNull();
    const largo = `${Array.from({ length: 11 }, () => "a".repeat(24)).join(".")}.com`;
    expect(largo.length).toBeGreaterThan(253);
    expect(normalizeCustomDomain(largo, ROOTS)).toBeNull();
  });
});
