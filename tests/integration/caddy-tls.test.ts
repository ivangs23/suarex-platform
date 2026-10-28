import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bloquesDeSitio, leerCaddyfile, lineas, snippet } from "./helpers/caddyfile.js";

/**
 * Certificados de la plataforma según `PLATFORM_TLS` (`deploy/Caddyfile`): comodín por
 * Cloudflare, o uno por subdominio bajo demanda. Test estructural: no levanta Caddy.
 */

const caddyfile = leerCaddyfile();
const plataforma = bloquesDeSitio(caddyfile).find((b) => b.cabecera.includes("{$PLATFORM_DOMAIN}"));

describe("deploy/Caddyfile: certificados de la plataforma", () => {
  it("la plataforma elige el modo por PLATFORM_TLS, y sin definir es el comodín", () => {
    expect(plataforma && lineas(plataforma.cuerpo)).toContain(
      "import tls_{$PLATFORM_TLS:cloudflare}",
    );
  });

  it("existen los dos modos, cada uno con lo suyo", () => {
    expect(lineas(snippet(caddyfile, "tls_cloudflare"))).toContain(
      "dns cloudflare {$CLOUDFLARE_API_TOKEN}",
    );
    expect(lineas(snippet(caddyfile, "tls_bajo_demanda"))).toContain("on_demand");
  });

  it("bajo demanda siempre pregunta a tls-check antes de pedir un certificado", () => {
    // Sin `ask`, cualquiera que apunte un dominio aquí agota el cupo de Let's Encrypt.
    expect(caddyfile).toMatch(/on_demand_tls\s*\{\s*ask http:\/\/web:3000\/api\/tls-check\s*\}/);
  });

  it("el compose pasa PLATFORM_TLS a Caddy", () => {
    const compose = readFileSync(
      path.resolve(import.meta.dirname, "../../deploy/docker-compose.app.yml"),
      "utf8",
    );
    expect(compose).toMatch(/PLATFORM_TLS: \$\{PLATFORM_TLS:-cloudflare\}/);
  });
});
