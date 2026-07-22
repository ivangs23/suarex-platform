import {
  findTenantByHost,
  getTenantCustomDomain,
  isActiveCustomDomain,
  setTenantCustomDomain,
} from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * Dominios propios de cliente (`tenants.custom_domain`): la vía por la que
 * `garumvinoteca.com` puede servirse desde la plataforma conservando sus QR ya impresos.
 *
 * Lo que se guarda aquí decide DOS cosas delicadas -- qué tenant sirve un `Host` y por qué
 * dominios pide Caddy certificados a Let's Encrypt (`/api/tls-check`) -- así que estas
 * pruebas van contra la base de verdad, no contra dobles.
 */
describe("dominios propios de cliente", () => {
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  const suffix = nonce();
  const dominioA = `carta-a-${suffix}.ejemplo.com`;
  const dominioB = `carta-b-${suffix}.ejemplo.com`;

  beforeAll(async () => {
    tenantA = await createTenantFixture(`dom-a-${suffix}`);
    tenantB = await createTenantFixture(`dom-b-${suffix}`);
  });

  afterAll(async () => {
    await deleteTenantFixture(tenantA);
    await deleteTenantFixture(tenantB);
  });

  it("guarda el dominio y lo devuelve", async () => {
    await setTenantCustomDomain(tenantA.tenantId, dominioA);
    expect(await getTenantCustomDomain(tenantA.tenantId)).toBe(dominioA);
  });

  it("resuelve el tenant por su dominio propio, no por subdominio", async () => {
    // Es lo que hace que garumvinoteca.com/1 sirva la carta de Garum sin redirección.
    const resuelto = await findTenantByHost(dominioA, ["suarex.app"]);
    expect(resuelto?.id).toBe(tenantA.tenantId);
  });

  it("un dominio con puerto (Host real de un navegador) resuelve igual", async () => {
    // `parseTenantHost` recorta el puerto: sin eso, un Host `dominio:443` no casaría.
    const resuelto = await findTenantByHost(`${dominioA}:443`, ["suarex.app"]);
    expect(resuelto?.id).toBe(tenantA.tenantId);
  });

  it("el dominio de un cliente NO resuelve al otro", async () => {
    await setTenantCustomDomain(tenantB.tenantId, dominioB);
    const resuelto = await findTenantByHost(dominioB, ["suarex.app"]);
    expect(resuelto?.id).toBe(tenantB.tenantId);
    expect(resuelto?.id).not.toBe(tenantA.tenantId);
  });

  it("dos clientes no pueden reclamar el mismo dominio", async () => {
    // Sin el índice único, `findTenantByHost` serviría uno u otro de forma imprevisible:
    // un cliente podría acabar viendo la carta -- y los pedidos -- de otro.
    await expect(setTenantCustomDomain(tenantB.tenantId, dominioA)).rejects.toThrow(
      /ya está asignado a otro cliente/,
    );
    // Y el que lo tenía lo conserva: el intento fallido no se lo quita.
    expect(await getTenantCustomDomain(tenantA.tenantId)).toBe(dominioA);
  });

  it("solo un cliente ACTIVO autoriza la emisión de certificado", async () => {
    expect(await isActiveCustomDomain(dominioA)).toBe(true);

    // Un cliente suspendido (p. ej. por impago) deja de renovar: la plataforma no debe
    // seguir pidiendo certificados por él.
    await admin.from("tenants").update({ status: "suspended" }).eq("id", tenantA.tenantId);
    expect(await isActiveCustomDomain(dominioA)).toBe(false);

    await admin.from("tenants").update({ status: "active" }).eq("id", tenantA.tenantId);
    expect(await isActiveCustomDomain(dominioA)).toBe(true);
  });

  it("un dominio desconocido nunca autoriza certificado", async () => {
    expect(await isActiveCustomDomain(`nadie-${suffix}.ejemplo.com`)).toBe(false);
  });

  it("borrar el dominio deja de resolver por él y de autorizar certificados", async () => {
    await setTenantCustomDomain(tenantB.tenantId, null);
    expect(await getTenantCustomDomain(tenantB.tenantId)).toBeNull();
    expect(await findTenantByHost(dominioB, ["suarex.app"])).toBeNull();
    expect(await isActiveCustomDomain(dominioB)).toBe(false);
  });
});
