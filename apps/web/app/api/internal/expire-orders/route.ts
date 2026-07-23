import { expirePendingOrders } from "@suarex/db";
import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";

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

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Sin secreto no se puede autenticar a quien llama: se rechaza en vez de dejar pasar.
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
    const expirados = await expirePendingOrders();
    return NextResponse.json({ expirados });
  } catch (error) {
    console.error("[cron:expire-orders] Error barriendo pedidos pendientes:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
