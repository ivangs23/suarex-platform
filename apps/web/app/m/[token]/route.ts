import { findTableByToken, registrarEscaneo } from "@suarex/db";
import { NextResponse } from "next/server";
import { MESA_COOKIE, mesaCookieOptions } from "@/lib/mesa-cookie";

/**
 * Lo que abre el QR impreso en la mesa.
 *
 * Ya no pinta una carta propia: resuelve el token, deja la mesa fijada en una cookie
 * httpOnly (ver `lib/mesa-cookie.ts`) y manda al comensal a `/{mesa}`, que es LA carta --
 * con el tema del cliente y con el carrito.
 *
 * Antes había dos cartas: `/{mesa}`, tematizada pero sin poder pedir, y `/m/{token}`, que
 * vendía pero se pintaba sin tema ninguno. Cada mejora del carrito caía en una carta que
 * ningún cliente enseñaba. Se conserva esta ruta porque hay QR ya impresos en las mesas y
 * tienen que seguir funcionando para siempre.
 *
 * Una mesa desconocida o desactivada da 404, igual que antes: no se distingue entre "ese
 * token no existe" y "esa mesa está fuera de servicio", que para quien escanea es lo mismo.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;

  const table = await findTableByToken(token);
  if (!table?.isActive) {
    return new NextResponse(null, { status: 404 });
  }

  // Se cuenta el escaneo ANTES de redirigir, que es el único momento en que sabemos que
  // alguien ha apuntado la cámara a un QR. Es un incremento sobre una fila indexada y no
  // lanza nunca: quedarse sin carta porque no se pudo contar sería cambiar una venta por una
  // estadística.
  await registrarEscaneo(table.id);

  // `Location` RELATIVA a propósito. Componerla absoluta a partir de `request.url` mandaba a
  // `localhost:3000`: `proxy.ts` reescribe la petición y esa URL ya no lleva el Host del
  // cliente, así que el comensal acababa fuera de su restaurante -- y la cookie, puesta en
  // un host que no era el suyo. Una ruta relativa conserva el Host por definición, sea
  // subdominio o dominio propio, sin que esta ruta tenga que saber cuál es.
  const response = new NextResponse(null, {
    status: 303,
    headers: { location: `/${table.label}` },
  });
  response.cookies.set(MESA_COOKIE, table.token, mesaCookieOptions());
  return response;
}
