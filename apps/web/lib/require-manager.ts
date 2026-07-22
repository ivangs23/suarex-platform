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
 * no revelar cuál de los tres es.
 *
 * Esta comprobación de rol NO tiene un "segundo barrera" de RLS detrás en el
 * camino de la Server Action: los repositorios de `packages/db` escriben con el
 * cliente de service role, que SALTA RLS por diseño (ver el docstring de
 * `serviceClient` en `packages/db/src/client.ts`). En este camino, lo único que
 * mantiene cerrada la escritura es estructural -- este guard (rol) más
 * `tenantScoped` (`tenantId` obligatorio, sin `?` ni default) -- no RLS.
 *
 * RLS (`20260722000006_role_write_policies.sql`) protege un camino DISTINTO: un
 * atacante con un JWT `authenticated` válido hablando directo contra PostgREST,
 * sin pasar por esta app -- ahí sí es la única barrera, porque este guard nunca
 * se ejecuta. Las dos barreras son independientes, cada una para su propia
 * amenaza; ninguna es backstop de la otra.
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

/**
 * Fix round 1 (Finding 1): envoltorio OBLIGATORIO para toda Server Action de gestión de
 * catálogo (ver `apps/web/app/admin/catalogo/actions.ts`). Antes, cada una de esas 11
 * actions empezaba a mano por `const session = await requireManager();` -- correcto hoy,
 * pero una futura action (D2/D3: mesas, dispositivos, personal) podría omitirlo sin que
 * nada lo detectara: la misma brecha "convención, no estructura" que este proyecto ya
 * cerró en otros puntos con `tenantScoped` (`tenantId` obligatorio, ver
 * `packages/db/src/client.ts`) y con la propia `resolveStaffSession` (`hostTenant`
 * obligatorio).
 *
 * `managerAction(fn)` devuelve una función con la firma `(...args) => Promise<void>` --
 * pensada para `(formData: FormData) => Promise<void>`, la que usan los `<form action=…>`
 * -- que SIEMPRE ejecuta `checkManager()` (`requireManager` en producción) ANTES de
 * invocar `fn`. El cuerpo de la action recibe la sesión YA verificada como primer
 * argumento: no hay ningún camino para que `fn` se ejecute sin que la comprobación de rol
 * haya pasado primero -- la barrera ya no depende de que quien escriba la siguiente action
 * se acuerde de copiarla, vive en la firma de `fn`.
 *
 * `checkManager` es un segundo parámetro inyectable (por defecto `requireManager`)
 * EXCLUSIVAMENTE para poder probar unitariamente la composición del propio wrapper (ver
 * `require-manager.test.ts`) sin tener que simular cookies/headers de una request de
 * Next -- ninguna de las 11 actions de producción pasa un segundo argumento, todas usan
 * el default real.
 */
export function managerAction<Args extends unknown[]>(
  fn: (session: ManagerSession, ...args: Args) => Promise<void>,
  checkManager: () => Promise<ManagerSession> = requireManager,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    const session = await checkManager();
    return fn(session, ...args);
  };
}
