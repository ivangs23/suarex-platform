import { platformAdminsTable } from "./client.js";

/**
 * ¿Es este usuario del equipo de SuarEx?
 *
 * Búsqueda por clave primaria contra `platform_admins`, que es INALCANZABLE desde PostgREST:
 * RLS sin policies más `revoke all from anon, authenticated`. La única forma de entrar en esa
 * tabla es el `service_role`, y la única forma de añadirse es tener acceso al servidor
 * (`scripts/seed-platform-admin.mjs`).
 *
 * Eso es deliberado: si un superadmin pudiera darse de alta a sí mismo desde la consola,
 * comprometer una sola cuenta comprometería la plataforma entera.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await platformAdminsTable()
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}
