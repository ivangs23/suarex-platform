import { suspendExpiredGrace } from "@suarex/db";
import { cronRoute } from "@/lib/cron-route";

/**
 * BARRIDO DE VENTANAS DE GRACIA VENCIDAS.
 *
 * El webhook de facturación ABRE la ventana cuando Stripe comunica un impago; nadie vuelve a
 * llamar cuando vence, porque Stripe no manda un evento "han pasado siete días". Esto la
 * CIERRA. Lo dispara el cron del SISTEMA, igual que `expire-orders` y por el mismo motivo (no
 * se puede depender de pg_cron en el Supabase autoalojado).
 *
 * NO es un endpoint público: suspende clientes. Se protege con el secreto compartido
 * (`CRON_SECRET`) en `Authorization: Bearer ...` y FALLA CERRADO -- sin secreto configurado
 * responde 503 y no barre nada, para que un despliegue a medio configurar no deje abierto un
 * endpoint capaz de cortarle el servicio a todos los clientes a la vez.
 */
export const runtime = "nodejs";

export const POST = cronRoute("cron.suspend_overdue_fallo", async () => ({
  suspendidos: await suspendExpiredGrace(),
}));
