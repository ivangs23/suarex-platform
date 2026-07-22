"use server";

import { markStationDone as markStationDoneInDb } from "@suarex/db";
import { revalidatePath } from "next/cache";
import { parseMarkStationDoneInput } from "@/lib/staff-order-input";
import { getStaffSession } from "@/lib/supabase-server";
import { requireTenant } from "@/lib/tenant-context";

/**
 * SECURITY: la ÚNICA Server Action de la superficie de personal que muta un pedido.
 * Nótese lo que ESTA firma no acepta: `tenantId`. El tenant sale exclusivamente de
 * `getStaffSession(tenant)` -- que a su vez exige el tenant resuelto por Host
 * (`requireTenant()`, ver `lib/tenant-context.ts`) y lo contrasta contra el claim
 * `tenant_id` verificado del JWT (`resolveStaffSession`, ver su docstring) -- nunca de
 * un argumento, cabecera o cookie que el navegador pudiera fijar. Una Server Action que
 * aceptase `tenantId` del cliente sería exactamente el agujero que el resto de este
 * sistema evita (ver `packages/db/src/client.ts`, `tenantScoped`).
 *
 * Sin sesión válida para el tenant resuelto por Host, esta función no llega a tocar la
 * base de datos: lanza, en vez de proceder con un `tenantId` inexistente o ajeno.
 *
 * `revalidatePath` cubre el caso sin JS / recarga dura; el refresco normal en vivo lo
 * hace `OrdersBoard` al recibir un evento de Realtime, no esta llamada.
 *
 * Fix round 2 (Finding 4): `station` se tipa aquí como `string`, no como
 * `"cocina" | "barra"` -- ese tipo más estrecho es el contrato que usa el botón de
 * `OrdersBoard.tsx`, pero una Server Action es, bajo el capó, un endpoint HTTP normal, y
 * un caller que la invoque directamente (no a través del botón) no pasa por ningún
 * tipado en tiempo de ejecución. `parseMarkStationDoneInput` (`lib/staff-order-input.ts`)
 * valida `station` (exactamente "cocina" o "barra") y `orderId` (UUID) ANTES de resolver
 * sesión o tocar la base de datos, y lanza `InvalidStaffOrderInputError` -- un error
 * limpio -- en vez de dejar que un `station` inválido se enrute en silencio o que un
 * `orderId` malformado llegue crudo a Postgres.
 */
export async function markStationDone(orderId: string, station: string): Promise<void> {
  const input = parseMarkStationDoneInput(orderId, station);

  const tenant = await requireTenant();
  const session = await getStaffSession(tenant);
  if (!session) {
    throw new Error("No autenticado");
  }

  await markStationDoneInDb(session.tenantId, input.orderId, input.station);
  revalidatePath("/staff");
}
