import { describe, expect, it } from "vitest";
import {
  isPlatformHost,
  normalizeCustomDomain,
  parseTenantHost,
  resolveRootDomains,
  validarSlugPlataforma,
} from "./tenant-host.js";

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

describe("isPlatformHost", () => {
  const RAICES = ["suarex.app", "localhost"];

  it("reconoce admin.<raíz>, con puerto y en cualquier caja", () => {
    expect(isPlatformHost("admin.suarex.app", RAICES)).toBe(true);
    expect(isPlatformHost("admin.localhost:3000", RAICES)).toBe(true);
    expect(isPlatformHost("ADMIN.SuarEx.app", RAICES)).toBe(true);
    expect(isPlatformHost("  admin.suarex.app  ", RAICES)).toBe(true);
  });

  it("no confunde un host de cliente con el de plataforma", () => {
    expect(isPlatformHost("garum.suarex.app", RAICES)).toBe(false);
    expect(isPlatformHost("suarex.app", RAICES)).toBe(false);
    expect(isPlatformHost("", RAICES)).toBe(false);
  });

  it("un cliente no puede llegar a la consola por parecerse", () => {
    // Estas cuatro son las suplantaciones que un `startsWith`/`includes` dejaría pasar. La
    // comparación es exacta sobre el host completo por este motivo.
    expect(isPlatformHost("admin.garum.com", RAICES), "dominio propio ajeno").toBe(false);
    expect(isPlatformHost("admin.suarex.app.evil.com", RAICES), "sufijo falso").toBe(false);
    expect(isPlatformHost("admin.garum.suarex.app", RAICES), "etiqueta anidada").toBe(false);
    expect(isPlatformHost("notadmin.suarex.app", RAICES), "prefijo pegado").toBe(false);
  });

  it("`admin` sigue siendo un slug reservado para los tenants", () => {
    // Las dos cosas tienen que decir lo mismo: si `admin` dejara de estar reservado, un
    // cliente podría registrarse con ese slug y colisionar con la consola.
    expect(parseTenantHost("admin.suarex.app", RAICES)).toBeNull();
  });
});

describe("validarSlugPlataforma", () => {
  it("acepta un slug normal de cliente", () => {
    expect(validarSlugPlataforma("bar-paco")).toBe(true);
    expect(validarSlugPlataforma("garum")).toBe(true);
    expect(validarSlugPlataforma("la-taberna-2")).toBe(true);
  });

  it("rechaza lo que no puede ser un subdominio", () => {
    // El slug ACABA SIENDO el subdominio por el que se sirve ese cliente para siempre, y
    // cambiarlo después obliga a reimprimir todos los QR de las mesas.
    expect(validarSlugPlataforma("Bar Paco"), "espacios y mayúsculas").toBe(false);
    expect(validarSlugPlataforma("bar_paco"), "guion bajo").toBe(false);
    expect(validarSlugPlataforma("-paco"), "empieza por guion").toBe(false);
    expect(validarSlugPlataforma("paco-"), "acaba en guion").toBe(false);
    expect(validarSlugPlataforma("ab"), "demasiado corto").toBe(false);
    expect(validarSlugPlataforma("a".repeat(50)), "demasiado largo").toBe(false);
    expect(validarSlugPlataforma("bar.paco"), "punto: sería otra etiqueta").toBe(false);
  });

  it("rechaza los subdominios reservados", () => {
    // Un cliente con slug `admin` colisionaría con la consola de plataforma. La lista es la
    // MISMA que usa `parseTenantHost`, no una copia: dos listas que deben decir lo mismo
    // acaban divergiendo.
    for (const reservado of ["www", "api", "admin", "app"]) {
      expect(validarSlugPlataforma(reservado), reservado).toBe(false);
    }
  });
});

describe("studio como subdominio reservado", () => {
  it("un cliente no puede llamarse `studio`", () => {
    // `deploy/Caddyfile` enruta `studio.<dominio>` al Studio de Supabase: un tenant con ese
    // slug tendría su carta permanentemente tapada, sin ningún error que lo explicara.
    expect(validarSlugPlataforma("studio")).toBe(false);
    expect(parseTenantHost("studio.suarex.app", ["suarex.app"])).toBeNull();
  });
});
