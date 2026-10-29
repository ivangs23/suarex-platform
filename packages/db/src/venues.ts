import { tenantScoped } from "./client.js";
import type { Json } from "./database.types.js";
import { objetoJson } from "./json.js";

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

/**
 * Zona horaria de la sede por defecto del tenant. Mismo criterio que `marcar_agotado_hoy` en
 * SQL (`order by is_default desc`, 'Europe/Madrid' de reserva): las franjas de carta y el
 * "se acabó hoy" tienen que estar de acuerdo sobre qué hora es en el local, o un mismo
 * restaurante vería aparecer la carta de cena a una hora y reponerse los platos a otra.
 *
 * Nunca lanza: si esta lectura fallara, el precio de acertar la zona es servir la carta con la
 * hora del servidor; el de propagar el error, no servir carta.
 */
export async function zonaHorariaDelTenant(tenantId: string): Promise<string> {
  const { data } = await tenantScoped("venues", tenantId)
    .select("timezone")
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.timezone as string | undefined) ?? "Europe/Madrid";
}

/** Los días de `venues.opening_hours`, de lunes a domingo. */
export const DIAS_DE_LA_SEMANA = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
export type DiaDeLaSemana = (typeof DIAS_DE_LA_SEMANA)[number];
/** Un tramo `["13:00", "16:00"]`, en hora local de la sede. */
export type Tramo = [string, string];
/** Día ausente = no publicado; `[]` = cerrado ese día. */
export type Horario = Partial<Record<DiaDeLaSemana, Tramo[]>>;

/** Lo que la sede publica. Cada campo es `null` si el cliente no lo ha rellenado. */
export type FichaPublica = {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  phone: string | null;
  openingHours: Horario | null;
};

export type FichaDeLaSede = FichaPublica & { venueId: string; timezone: string };

/** El horario guardado, sin cast a ciegas: lo que no tenga la forma de un tramo se descarta. */
function horarioJson(valor: Json | null): Horario | null {
  if (valor === null) return null;
  const dias = objetoJson(valor);
  const horario: Horario = {};
  for (const dia of DIAS_DE_LA_SEMANA) {
    const tramos = dias[dia];
    if (!Array.isArray(tramos)) continue;
    horario[dia] = tramos.filter(
      (t): t is Tramo =>
        Array.isArray(t) && t.length === 2 && t.every((hora) => typeof hora === "string"),
    );
  }
  return horario;
}

/**
 * Ficha pública de una sede: la por defecto, que es la que pinta la carta, o la `venueId` que
 * edita el panel. `null` si no hay sede (o si `venueId` es de otro tenant).
 */
export async function fichaPublicaDeLaSede(
  tenantId: string,
  venueId?: string,
): Promise<FichaDeLaSede | null> {
  const consulta = tenantScoped("venues", tenantId).select(
    "id, timezone, address_street, address_postal_code, address_city, address_region, phone, opening_hours",
  );
  const { data, error } = await (venueId ? consulta.eq("id", venueId) : consulta)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    venueId: data.id,
    timezone: data.timezone,
    street: data.address_street,
    postalCode: data.address_postal_code,
    city: data.address_city,
    region: data.address_region,
    phone: data.phone,
    openingHours: horarioJson(data.opening_hours),
  };
}

/** Guarda la ficha de una sede. Si `venueId` es de otro tenant, no toca nada (como `updateTable`). */
export async function guardarFichaPublica(
  tenantId: string,
  venueId: string,
  ficha: FichaPublica,
): Promise<void> {
  const { error } = await tenantScoped("venues", tenantId)
    .update({
      address_street: ficha.street,
      address_postal_code: ficha.postalCode,
      address_city: ficha.city,
      address_region: ficha.region,
      phone: ficha.phone,
      opening_hours: ficha.openingHours,
    })
    .eq("id", venueId);
  if (error) throw error;
}
