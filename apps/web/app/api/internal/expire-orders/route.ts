import { expirePendingOrders } from "@suarex/db";
import { cronRoute } from "@/lib/cron-route";

/**
 * BARRIDO DE PEDIDOS PENDIENTES CADUCADOS.
 *
 * Existe porque no se puede depender de pg_cron: el Supabase autoalojado del despliegue no
 * siempre lo trae en `shared_preload_libraries`, así que la programación de la migración
 * `20260721000009` se salta en silencio. Este endpoint hace lo mismo y lo dispara el cron
 * del SISTEMA (crontab del host / tarea programada), que existe en cualquier servidor. Ver
 * `deploy/scripts/expire-orders.sh` y el README de deploy.
 *
 * NO es un endpoint público: cancela pedidos. Se protege con un secreto compartido
 * (`CRON_SECRET`) en la cabecera `Authorization: Bearer ...`. FALLA CERRADO -- sin secreto
 * configurado responde 503 y no barre nada, para que un despliegue a medio configurar no
 * deje el endpoint abierto por accidente. `nodejs` porque `@suarex/db` usa el SDK con la
 * service role key, que no va en el runtime edge.
 */
export const runtime = "nodejs";

export const POST = cronRoute("cron.expire_orders_fallo", async () => ({
  expirados: await expirePendingOrders(),
}));
