import { getStaffSession } from "@/lib/supabase-server";
import { requireTenant } from "@/lib/tenant-context";
import { avisoDePermiso } from "./aviso-de-permiso";
import { LoginForm } from "./LoginForm";
import { destinoTrasLogin } from "./next-path";

/**
 * El login del personal. Se resuelve en el servidor solo para una cosa: si quien llega ya había
 * entrado en ESTE negocio y su rol no le deja ver la sección de gestión que pedía, el formulario
 * le dice por qué está aquí (ver `aviso-de-permiso.ts`). Todo lo demás es el formulario de siempre.
 */
export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const destino = destinoTrasLogin(typeof next === "string" ? next : null);
  // Sin cabeceras de tenant no debería llegarse aquí (ver el matcher de proxy.ts); si pasara, el
  // login de siempre, sin aviso.
  const tenant = await requireTenant().catch(() => null);
  const sesion = tenant ? await getStaffSession(tenant) : null;

  return <LoginForm aviso={avisoDePermiso(sesion, destino)} />;
}
