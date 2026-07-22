import { tablesTableForTokenResolution } from "./client.js";
import type { TableRow } from "./types.js";

/**
 * Como `findTenantByHost`, esta consulta ocurre ANTES de conocer el tenant: el token
 * del QR es precisamente lo que lo determina. A partir del `tenantId` devuelto, todo
 * lo demás va acotado.
 */
export async function findTableByToken(token: string): Promise<TableRow | null> {
  const { data, error } = await tablesTableForTokenResolution()
    .select("id, tenant_id, venue_id, label, is_active, token")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    tenantId: data.tenant_id as string,
    venueId: data.venue_id as string,
    label: data.label as string,
    isActive: data.is_active as boolean,
    token: data.token as string,
  };
}
