import { sweepDeviceHealth } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * EL BARRIDO DE SALUD DE DISPOSITIVOS.
 *
 * `device_heartbeat` escribía `last_seen_at` desde hace tiempo, pero nadie lo leía: un PC
 * apagado se descubría cuando la cocina se quedaba sin comandas.
 *
 * Lo que más se prueba aquí es que avisa SOLO EN LAS TRANSICIONES. Un aviso cada 5 minutos
 * mientras el dispositivo sigue caído es ruido que se acaba ignorando, y entonces el aviso de
 * la caída siguiente tampoco se lee.
 */

async function crearDispositivo(
  tenantId: string,
  venueId: string,
  campos: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from("devices")
    .insert({ tenant_id: tenantId, venue_id: venueId, name: `disp-${nonce()}`, ...campos })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function conSede(slug: string) {
  const fixture = await createTenantFixture(slug);
  const { data } = await admin
    .from("venues")
    .insert({ tenant_id: fixture.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  return { fixture, venueId: data?.id as string };
}

const haceMinutos = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("sweepDeviceHealth", () => {
  it("detecta un dispositivo emparejado que lleva rato sin latir", async () => {
    const { fixture, venueId } = await conSede(`caido-${nonce()}`);
    try {
      const id = await crearDispositivo(fixture.tenantId, venueId, {
        paired_at: haceMinutos(600),
        last_seen_at: haceMinutos(30),
      });

      const r = await sweepDeviceHealth(10);
      expect(r.caidos.map((d) => d.deviceId)).toContain(id);
      expect(r.caidos.find((d) => d.deviceId === id)?.tenantSlug).toBe(fixture.slug);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("NO avisa dos veces del mismo dispositivo caído", async () => {
    // La razón de ser de `offline_alerted_at`. Un aviso cada 5 minutos durante una caída de
    // dos horas son 24 correos, y el siguiente aviso real ya no lo lee nadie.
    const { fixture, venueId } = await conSede(`repe-${nonce()}`);
    try {
      const id = await crearDispositivo(fixture.tenantId, venueId, {
        paired_at: haceMinutos(600),
        last_seen_at: haceMinutos(30),
      });

      const primera = await sweepDeviceHealth(10);
      expect(primera.caidos.map((d) => d.deviceId)).toContain(id);

      const segunda = await sweepDeviceHealth(10);
      expect(
        segunda.caidos.map((d) => d.deviceId),
        "no puede repetir el aviso",
      ).not.toContain(id);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("avisa de la recuperación cuando vuelve a latir", async () => {
    const { fixture, venueId } = await conSede(`vuelve-${nonce()}`);
    try {
      const id = await crearDispositivo(fixture.tenantId, venueId, {
        paired_at: haceMinutos(600),
        last_seen_at: haceMinutos(30),
      });
      await sweepDeviceHealth(10);

      // El PC vuelve y late.
      await admin.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", id);

      const r = await sweepDeviceHealth(10);
      expect(r.recuperados.map((d) => d.deviceId)).toContain(id);

      // Y la siguiente pasada ya no dice nada de él.
      const siguiente = await sweepDeviceHealth(10);
      expect(siguiente.recuperados.map((d) => d.deviceId)).not.toContain(id);
      expect(siguiente.caidos.map((d) => d.deviceId)).not.toContain(id);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("ignora un dispositivo que nunca se emparejó", async () => {
    // Nunca ha estado vivo: avisar de que "no late" sería avisar de que aún no se ha
    // instalado en el local.
    const { fixture, venueId } = await conSede(`sinparear-${nonce()}`);
    try {
      const id = await crearDispositivo(fixture.tenantId, venueId, {
        paired_at: null,
        last_seen_at: null,
      });
      const r = await sweepDeviceHealth(10);
      expect(r.caidos.map((d) => d.deviceId)).not.toContain(id);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("no toca a un dispositivo que late con normalidad", async () => {
    const { fixture, venueId } = await conSede(`sano-${nonce()}`);
    try {
      const id = await crearDispositivo(fixture.tenantId, venueId, {
        paired_at: haceMinutos(600),
        last_seen_at: haceMinutos(2),
      });
      const r = await sweepDeviceHealth(10);
      expect(r.caidos.map((d) => d.deviceId)).not.toContain(id);
      expect(r.recuperados.map((d) => d.deviceId)).not.toContain(id);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("un dispositivo emparejado que nunca llegó a latir cuenta como caído", async () => {
    // Se instaló, se emparejó y no arrancó nunca: es exactamente el caso que hay que ver.
    const { fixture, venueId } = await conSede(`nuncalatio-${nonce()}`);
    try {
      const id = await crearDispositivo(fixture.tenantId, venueId, {
        paired_at: haceMinutos(600),
        last_seen_at: null,
      });
      const r = await sweepDeviceHealth(10);
      expect(r.caidos.map((d) => d.deviceId)).toContain(id);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});
