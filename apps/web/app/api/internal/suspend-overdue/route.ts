import { suspendExpiredGrace } from "@suarex/db";
import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";

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

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron no configurado" }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const enviado = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  // Comparación en tiempo constante: una comparación normal filtra por su tiempo cuántos
  // caracteres iniciales acertó un atacante, y este secreto no rota.
  if (!timingSafeEqualStr(enviado, secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const suspendidos = await suspendExpiredGrace();
    return NextResponse.json({ suspendidos });
  } catch (error) {
    console.error("[cron:suspend-overdue] Error barriendo gracias vencidas:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
