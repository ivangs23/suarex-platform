import { purgeOrderPersonalData } from "@suarex/db";
import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";

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

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron no configurado" }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  const enviado = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!timingSafeEqualStr(enviado, secret)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const resultado = await purgeOrderPersonalData();
    return NextResponse.json(resultado);
  } catch (error) {
    log.error("cron.purge_orders_fallo", { error });
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
