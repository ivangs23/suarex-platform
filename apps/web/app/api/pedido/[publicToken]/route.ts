import { getOrderByPublicToken } from "@suarex/db";
import { NextResponse } from "next/server";

// El comensal sondea este endpoint cada pocos segundos (ver StatusPoller.tsx)
// esperando ver avanzar `pending` -> `paid` -> `served` sin recargar: cachear la
// respuesta, aunque sea brevemente, dejaría la pantalla congelada en un estado
// viejo justo cuando el pedido cambia.
export const dynamic = "force-dynamic";

// Función, no una constante `Response` compartida: el `body` de un `Response`
// es un stream que se bloquea al leerse una vez, así que reutilizar la MISMA
// instancia entre peticiones concurrentes rompería (o daría cuerpos vacíos en)
// todas menos la primera. Cada llamada crea una respuesta nueva.
function notFound() {
  return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
}

/**
 * `GET /api/pedido/{publicToken}`: la única puerta que tiene el navegador del
 * comensal hacia el estado de SU pedido. Devuelve exactamente
 * `{ orderNumber, status, totalCents, currency }` -- lo mismo que ya renderiza
 * `app/pedido/[publicToken]/page.tsx` en el primer render server-side -- y nada
 * más: ni el id interno del pedido, ni el tenant, ni las líneas, ni el `table_id`.
 * Un `public_token` prueba que el llamante tiene el enlace de UN pedido; no
 * autoriza a ver nada del negocio detrás de él.
 *
 * Un token inexistente y uno malformado responden exactamente igual (mismo
 * 404, mismo cuerpo): `public_token` es una columna `uuid`, así que un token
 * con formato inválido (no-UUID) hace que Postgres lance ANTES de que
 * `getOrderByPublicToken` pueda distinguir "no existe" de "formato raro" --
 * verificado en local, ese fallo llega aquí como una excepción normal
 * (`code: "22P02"`), no como un `null`. Sin este `catch`, ese caso se colaba
 * como 500 (código HTTP `error instanceof Error` de Next), un canal de
 * distinción por status code que un atacante podría usar para separar
 * "token con formato válido que no existe" de "token con formato inválido" --
 * exactamente el tipo de fuga que este endpoint existe para no tener. Se
 * registra en el log del servidor para no perder visibilidad ante un fallo de
 * infraestructura real (Postgres caído, etc.), pero el comensal SIEMPRE ve el
 * mismo 404 genérico, sea cual sea la causa.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ publicToken: string }> },
) {
  const { publicToken } = await params;

  let order: Awaited<ReturnType<typeof getOrderByPublicToken>>;
  try {
    order = await getOrderByPublicToken(publicToken);
  } catch (error) {
    console.error(`[pedido] Error resolviendo publicToken ${publicToken}:`, error);
    return notFound();
  }

  if (!order) {
    return notFound();
  }

  return NextResponse.json({
    orderNumber: order.orderNumber,
    status: order.status,
    totalCents: order.totalCents,
    currency: order.currency,
  });
}
