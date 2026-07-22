import { tenantScoped } from "./client.js";
import type { TableRow } from "./types.js";

export type CreateTableInput = {
  venueId: string;
  label: string;
  sortOrder?: number;
};

export type UpdateTableInput = Partial<{
  venueId: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}>;

/**
 * Crea una mesa. El `token` (uuid, columna `token` de `public.tables`, ver
 * `supabase/migrations/20260721000004_tables.sql`) lo genera la base con su propio
 * `default gen_random_uuid()` -- este repositorio nunca lo inventa ni lo recibe como
 * entrada, así que no hay ningún camino por el que un valor adivinable o repetido
 * llegue a ser el token de una mesa. `venueId` que pertenezca a otro tenant lo rechaza
 * el trigger `assert_same_tenant` (misma tabla), no una comprobación en esta capa: igual
 * que `createProduct`/`createExtra` en `admin-catalog.ts`, este repositorio confía en que
 * la base rechace la referencia cruzada y se limita a propagar el error de Postgres tal
 * cual (`cross-tenant reference rejected`).
 */
export async function createTable(
  tenantId: string,
  input: CreateTableInput,
): Promise<{ id: string; token: string }> {
  const { data, error } = await tenantScoped("tables", tenantId)
    .insert({
      venue_id: input.venueId,
      label: input.label,
      sort_order: input.sortOrder ?? 0,
    })
    .select("id, token")
    .single();
  if (error) throw error;
  return { id: data.id as string, token: data.token as string };
}

export async function updateTable(
  tenantId: string,
  tableId: string,
  patch: UpdateTableInput,
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.venueId !== undefined) values.venue_id = patch.venueId;
  if (patch.label !== undefined) values.label = patch.label;
  if (patch.sortOrder !== undefined) values.sort_order = patch.sortOrder;
  if (patch.isActive !== undefined) values.is_active = patch.isActive;

  const { error } = await tenantScoped("tables", tenantId).update(values).eq("id", tableId);
  if (error) throw error;
}

/** No re-genera el `token`: borrar y volver a crear una mesa con el mismo `label` produce
 * deliberadamente un token nuevo (un QR ya impreso de una mesa borrada no debe seguir
 * resolviendo a una mesa nueva homónima). */
export async function deleteTable(tenantId: string, tableId: string): Promise<void> {
  const { error } = await tenantScoped("tables", tenantId).delete().eq("id", tableId);
  if (error) throw error;
}

type TableRowDb = {
  id: string;
  tenant_id: string;
  venue_id: string;
  label: string;
  is_active: boolean;
};

/**
 * Lectura acotada al tenant para la pantalla de gestión de mesas (Task 5). Ordenada por
 * `sort_order` (orden de aparición en el panel), aunque ese campo no forma parte de
 * `TableRow` -- el mismo tipo público que usa `findTableByToken` (`src/tables.ts`) para
 * la resolución de un pedido, reutilizado aquí a propósito en vez de inventar un tipo
 * `AdminTableRow` paralelo para una diferencia que no lo justifica todavía.
 */
export async function listTables(tenantId: string): Promise<TableRow[]> {
  const { data, error } = await tenantScoped("tables", tenantId)
    .select("id, tenant_id, venue_id, label, is_active")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data as TableRowDb[]).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    venueId: row.venue_id,
    label: row.label,
    isActive: row.is_active,
  }));
}
