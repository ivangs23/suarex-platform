import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderChangePayload = {
  id: string;
  tenant_id: string;
  status: string;
  kitchen_status: string;
  bar_status: string;
  order_number: number;
};

/**
 * El nombre del canal lleva el tenant para que dos negocios no compartan tráfico,
 * pero el canal NO es la garantía de aislamiento: la garantía es RLS, que se
 * aplica a los eventos y está demostrada en `tests/integration/realtime-isolation.test.ts`.
 * Un nombre de canal es una convención; una policy es un control.
 */
export function subscribeToOrders(
  client: SupabaseClient,
  tenantId: string,
  onChange: (order: OrderChangePayload) => void,
): () => void {
  const channel = client
    .channel(`tenant:${tenantId}:orders`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
      const row = payload.new as OrderChangePayload | null;
      if (row) onChange(row);
    })
    .subscribe();

  return () => {
    void channel.unsubscribe();
  };
}
