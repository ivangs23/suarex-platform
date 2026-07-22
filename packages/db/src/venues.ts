import { tenantScoped } from "./client.js";

export type VenueRow = {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  isDefault: boolean;
};

type VenueRowDb = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  is_default: boolean;
};

/**
 * Lectura acotada al tenant para las pantallas de gestión de mesas/dispositivos/
 * impresoras (Task 5, D2): `createTable`/`createDevice`/`createPrinter` exigen un
 * `venueId` (`venue_id` es `not null` en `tables`/`devices`/`printers`, ver
 * `20260721000004_tables.sql`/`20260722000001_devices_printers.sql`), pero ninguna
 * pantalla de esta fase gestiona altas/bajas de locales -- eso queda fuera de alcance de
 * D2. Devuelve todos los locales del tenant (en la práctica uno solo: el que siembra
 * `supabase/seed.sql`/`createTenantFixture` con `is_default: true`, protegido además por
 * `venues_single_default_per_tenant`, el índice único parcial sobre `is_default`) para
 * que cada pantalla auto-rellene el `venue_id` de sus formularios con el local por
 * defecto, sin pedírselo a quien gestiona -- y para poder traducir el `venueId` de una
 * fila a un nombre legible en la lista (p. ej. la columna "venue" de la pantalla de
 * dispositivos).
 */
export async function listVenues(tenantId: string): Promise<VenueRow[]> {
  const { data, error } = await tenantScoped("venues", tenantId)
    .select("id, tenant_id, name, slug, is_default")
    .order("is_default", { ascending: false });
  if (error) throw error;

  return (data as VenueRowDb[]).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    slug: row.slug,
    isDefault: row.is_default,
  }));
}
