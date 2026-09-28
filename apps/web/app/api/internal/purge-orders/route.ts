import { purgeOrderPersonalData } from "@suarex/db";
import { cronRoute } from "@/lib/cron-route";

/**
 * RETENCIÓN DE DATOS DEL COMENSAL.
 *
 * Ejecuta los plazos que la política de privacidad publicada promete (90 días las notas, 24
 * meses el pedido). Lo dispara el cron del SISTEMA, igual que `expire-orders` y por el mismo
 * motivo: no se puede depender de pg_cron en el Supabase autoalojado.
 *
 * NO es un endpoint público: borra datos de forma irreversible. Se protege con el secreto
 * compartido (`CRON_SECRET`) y FALLA CERRADO -- sin secreto responde 503 y no borra nada.
 */
export const runtime = "nodejs";

export const POST = cronRoute(
  "cron.purge_orders_fallo",
  async () => await purgeOrderPersonalData(),
);
