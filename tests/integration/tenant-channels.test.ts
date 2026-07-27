import { hasChannel } from "@suarex/config";
import { getTenantSettings, updateTenantSettings } from "@suarex/db";
import { afterAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "./helpers/tenants.js";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * CANALES DE VENTA por cliente (#22).
 *
 * La regla del producto es que la funcionalidad sea la misma para todos y que lo que cambie sea
 * qué tiene contratado cada uno. Hasta ahora eso era una intención: la columna `channels` existía,
 * se validaba y se leía, y no encendía ni apagaba nada. Esto prueba que ya manda -- y sobre todo
 * que se puede APAGAR, que es la mitad que se rompe sola si nadie la vigila.
 */

const fixtures: TenantFixture[] = [];

afterAll(async () => {
  for (const fixture of fixtures) await deleteTenantFixture(fixture);
});

async function tenantConCanales(channels: string[]): Promise<TenantFixture> {
  const fixture = await createTenantFixture(`ch-${nonce()}`);
  fixtures.push(fixture);
  const { error } = await admin
    .from("tenant_settings")
    .upsert({ tenant_id: fixture.tenantId, channels }, { onConflict: "tenant_id" });
  if (error) throw error;
  return fixture;
}

describe("hasChannel", () => {
  it("lo que no está en la lista, no está encendido", () => {
    expect(hasChannel(["qr-mesa"], "qr-mesa")).toBe(true);
    expect(hasChannel(["qr-mesa"], "kiosko")).toBe(false);
  });

  it("una lista vacía no enciende nada", () => {
    /* Nada de "vacío significa todo": esa excepción hace que el interruptor deje de significar lo
       que dice, y que nadie se atreva a apagar un canal por si acaso enciende los dos. */
    expect(hasChannel([], "qr-mesa")).toBe(false);
    expect(hasChannel([], "kiosko")).toBe(false);
  });

  it("los dos a la vez es una configuración normal, no un caso raro", () => {
    // Es justo el cliente que tiene carta por QR y además un totem.
    expect(hasChannel(["qr-mesa", "kiosko"], "qr-mesa")).toBe(true);
    expect(hasChannel(["qr-mesa", "kiosko"], "kiosko")).toBe(true);
  });
});

describe("los canales se guardan y se leen", () => {
  it("un cliente solo con QR no tiene el canal del totem", async () => {
    const t = await tenantConCanales(["qr-mesa"]);
    const settings = await getTenantSettings(t.tenantId);
    expect(hasChannel(settings?.channels ?? [], "qr-mesa")).toBe(true);
    expect(hasChannel(settings?.channels ?? [], "kiosko")).toBe(false);
  });

  it("el panel puede ENCENDER un canal", async () => {
    const t = await tenantConCanales(["qr-mesa"]);
    await updateTenantSettings(t.tenantId, {
      branding: {},
      fiscal: {},
      locale: "es",
      currency: "EUR",
      channels: ["qr-mesa", "kiosko"],
    });
    expect((await getTenantSettings(t.tenantId))?.channels).toEqual(["qr-mesa", "kiosko"]);
  });

  it("el panel puede APAGARLO, que es la mitad que importa", async () => {
    const t = await tenantConCanales(["qr-mesa", "kiosko"]);
    await updateTenantSettings(t.tenantId, {
      branding: {},
      fiscal: {},
      locale: "es",
      currency: "EUR",
      channels: ["qr-mesa"],
    });
    expect((await getTenantSettings(t.tenantId))?.channels).toEqual(["qr-mesa"]);
  });

  it("guardar SIN mencionar los canales no los toca", async () => {
    /* El resto del panel (marca, fiscal, idioma) comparte esta escritura. Si un guardado sin
       canales los vaciara, cambiar el color corporativo le apagaría la carta al cliente. */
    const t = await tenantConCanales(["qr-mesa", "kiosko"]);
    await updateTenantSettings(t.tenantId, {
      branding: { name: "Nuevo nombre" },
      fiscal: {},
      locale: "es",
      currency: "EUR",
    });
    expect((await getTenantSettings(t.tenantId))?.channels).toEqual(["qr-mesa", "kiosko"]);
  });

  it("se pueden apagar los dos: un cliente en pausa es una configuración legítima", async () => {
    const t = await tenantConCanales(["qr-mesa"]);
    await updateTenantSettings(t.tenantId, {
      branding: {},
      fiscal: {},
      locale: "es",
      currency: "EUR",
      channels: [],
    });
    expect((await getTenantSettings(t.tenantId))?.channels).toEqual([]);
  });
});
