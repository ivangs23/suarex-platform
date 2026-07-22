import { listActiveOrders } from "@suarex/db";
import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/supabase-server";
import { requireTenant } from "@/lib/tenant-context";
import { OrdersBoard } from "./OrdersBoard";

/**
 * Panel de comandas: exige una sesión de personal válida PARA EL TENANT RESUELTO POR
 * HOST antes de renderizar nada, vía `getStaffSession(tenant)` (ver su docstring en
 * `lib/staff-session.ts`, finding 1 de la revisión de seguridad). Sin esta comprobación
 * explícita, una futura página que solo mirase "¿hay sesión?" podría servir el tablero
 * de un restaurante bajo el Host de otro.
 *
 * `session.tenantId` (nunca `tenant.id`) es lo que se pasa a `listActiveOrders`: ambos
 * coinciden aquí porque `resolveStaffSession` ya lo garantiza, pero usar el del session
 * deja explícito que el dato que manda es el del claim verificado, no el resuelto por
 * Host, incluso aunque en este punto del código ya se sepa que son iguales.
 */
export default async function StaffHome() {
  // Defensa en profundidad, mismo patrón que layout.tsx/[mesa]/page.tsx: si
  // esta ruta llegase alguna vez sin cabeceras de tenant (no debería, dado el
  // matcher de proxy.ts), degrada a la misma redirección que "sin sesión" en
  // vez de un 500 sin capturar.
  const tenant = await requireTenant().catch(() => null);
  if (!tenant) {
    redirect("/staff/login");
  }

  const session = await getStaffSession(tenant);
  if (!session) {
    // Sin sesión, token expirado/malformado/forjado, sin claim tenant_id, o
    // mismatch de tenant: los cuatro fallan cerrado igual (ver
    // resolveStaffSession) y los cuatro terminan en la misma redirección, a
    // propósito -- no revelar cuál de ellos ocurrió.
    redirect("/staff/login");
  }

  const orders = await listActiveOrders(session.tenantId);

  return (
    <main>
      <h1>Personal de {tenant.slug}</h1>
      <p data-testid="staff-tenant">{tenant.slug}</p>
      <OrdersBoard tenantId={session.tenantId} orders={orders} />
    </main>
  );
}
