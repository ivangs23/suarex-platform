import { redirect } from "next/navigation";
import { resolveStaffSession } from "./staff-session";
import { staffServerClient } from "./supabase-server";
import { requireTenant } from "./tenant-context";

export type ManagerRole = "owner" | "admin";
export type ManagerSession = { userId: string; tenantId: string; role: ManagerRole };

export function isManagerRole(role: string): role is ManagerRole {
  return role === "owner" || role === "admin";
}

/**
 * Guard del panel de administración. Devuelve la sesión SOLO si el usuario está
 * autenticado para el tenant resuelto por Host Y su rol es owner/admin. En
 * cualquier otro caso redirige a /staff/login -- mismo destino indistinguible
 * para "no autenticado", "otro tenant" y "staff sin permisos de gestión", para
 * no revelar cuál de los tres es. La comprobación de rol aquí es la primera
 * barrera; la RLS (ver 20260722000006_role_write_policies.sql) es la segunda.
 */
export async function requireManager(): Promise<ManagerSession> {
  const tenant = await requireTenant();
  const client = await staffServerClient();
  const session = await resolveStaffSession(client, { id: tenant.id, slug: tenant.slug });

  if (!session || !isManagerRole(session.role)) {
    redirect("/staff/login");
  }

  return { userId: session.userId, tenantId: session.tenantId, role: session.role };
}
