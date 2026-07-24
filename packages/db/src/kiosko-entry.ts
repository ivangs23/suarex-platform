import { devicesTableForTotemToken } from "./client.js";

/** Tenant + venue de un totem, resueltos por su token (autoridad del canal kiosko). */
export type TotemEntry = { tenantId: string; venueId: string; deviceId: string };

/**
 * Resuelve el tenant+venue de un totem por su `totem_token` (igual que `findTableByToken` para la
 * mesa). SOLO devuelve algo si el device tiene el rol `kiosko`: el token de un device que solo
 * imprime (`agente`) no abre un totem. `null` si el token no existe o no es un totem -- sin
 * revelar cuáles existen.
 */
export async function findDeviceByTotemToken(token: string): Promise<TotemEntry | null> {
  const { data, error } = await devicesTableForTotemToken()
    .select("id, tenant_id, venue_id, roles")
    .eq("totem_token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const roles = (data.roles as string[] | null) ?? [];
  if (!roles.includes("kiosko")) return null;
  return {
    tenantId: data.tenant_id as string,
    venueId: data.venue_id as string,
    deviceId: data.id as string,
  };
}
