import { checkPairRateLimit, pairDevice } from "@suarex/db";
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";

/**
 * `POST /api/devices/pair`: la única puerta por la que un instalador sin secretos (sin
 * URL de Supabase, sin anon key, sin token) puede convertirse en una cuenta autenticada
 * del tenant. Un código malformado (body sin `pairingCode` de tipo string) y uno bien
 * formado pero inexistente/caducado responden con exactamente el mismo 404 -- mismo
 * cuerpo, mismo status -- para no revelar nunca si un código concreto llegó a existir.
 * Cualquier fallo interno (Postgres, Auth) también se colapsa a ese mismo 404, registrando
 * el original en el log del servidor para no perder visibilidad ante un fallo real de
 * infraestructura.
 */
function notFound() {
  return NextResponse.json({ error: "Código de emparejamiento inválido" }, { status: 404 });
}

function tooManyRequests() {
  return NextResponse.json({ error: "Demasiados intentos, prueba más tarde" }, { status: 429 });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { pairingCode?: unknown } | null;
  const pairingCode = typeof body?.pairingCode === "string" ? body.pairingCode : null;

  if (!pairingCode) {
    return notFound();
  }

  // Rate-limit por IP: defensa en profundidad. Un fallo de la comprobación NO abre la
  // puerta (fail-closed) -- se colapsa al 404 uniforme, registrando el fallo real.
  try {
    const allowed = await checkPairRateLimit(getClientIp(request));
    if (!allowed) return tooManyRequests();
  } catch (error) {
    console.error("[devices] Error en rate-limit de emparejamiento:", error);
    return notFound();
  }

  let result: Awaited<ReturnType<typeof pairDevice>>;
  try {
    result = await pairDevice(pairingCode);
  } catch (error) {
    console.error("[devices] Error emparejando dispositivo:", error);
    return notFound();
  }

  if (!result) {
    return notFound();
  }

  return NextResponse.json({
    deviceId: result.deviceId,
    email: result.email,
    password: result.password,
    tenantId: result.tenantId,
  });
}
