import { describe, expect, it, vi } from "vitest";
import { dominioPropioRespondeAqui, origenDeLosQr } from "./qr-origin.js";

describe("origenDeLosQr", () => {
  it("con dominio propio, el QR va a él aunque el panel se abra desde el subdominio", () => {
    expect(
      origenDeLosQr({
        customDomain: "garumvinoteca.com",
        host: "garum.srv1121554.hstgr.cloud",
        forwardedProto: "https",
      }),
    ).toBe("https://garumvinoteca.com");
  });

  it("sin dominio propio, usa el Host de la petición y su protocolo", () => {
    expect(
      origenDeLosQr({ customDomain: null, host: "garum.suarex.app", forwardedProto: "https" }),
    ).toBe("https://garum.suarex.app");
  });

  it("sin x-forwarded-proto y fuera de localhost, asume https", () => {
    expect(
      origenDeLosQr({ customDomain: null, host: "garum.suarex.app", forwardedProto: null }),
    ).toBe("https://garum.suarex.app");
  });

  it("en desarrollo ignora el dominio propio: no hay TLS para él en local", () => {
    expect(
      origenDeLosQr({
        customDomain: "garum-demo.test",
        host: "garum.localhost:3000",
        forwardedProto: null,
      }),
    ).toBe("http://garum.localhost:3000");
  });
});

describe("dominioPropioRespondeAqui", () => {
  it("es true solo con un 200 de tls-check en ese dominio", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(dominioPropioRespondeAqui("garumvinoteca.com", fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://garumvinoteca.com/api/tls-check?domain=garumvinoteca.com",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("es false si el dominio sigue sirviendo otra web", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    await expect(dominioPropioRespondeAqui("garumvinoteca.com", fetchImpl)).resolves.toBe(false);
  });

  it("es false, sin lanzar, si el dominio no resuelve o no contesta", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(dominioPropioRespondeAqui("garumvinoteca.com", fetchImpl)).resolves.toBe(false);
  });
});
