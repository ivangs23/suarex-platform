import { normalizeCustomDomain, resolveRootDomains } from "@suarex/config";
import { isActiveCustomDomain } from "@suarex/db";
import { NextResponse } from "next/server";

// La respuesta depende de qué dominios hay dados de alta en ese instante: cachearla haría
// que un cliente recién configurado siguiera sin poder obtener certificado, o que uno
// suspendido lo siguiera renovando.
export const dynamic = "force-dynamic";

const ROOT_DOMAINS = resolveRootDomains(process.env);

/**
 * `GET /api/tls-check?domain=<host>` — el endpoint `ask` de Caddy.
 *
 * Caddy lo consulta ANTES de pedirle a Let's Encrypt un certificado on-demand para un host
 * que no cubre el comodín de la plataforma. `200` = emítelo; cualquier otra cosa = no.
 *
 * SIN ESTE ENDPOINT, on-demand TLS es un agujero grave: cualquiera puede apuntar su propio
 * dominio a la IP del servidor y provocar que Caddy pida un certificado por él. Let's
 * Encrypt limita a 300 pedidos nuevos por cuenta y hora, así que un atacante con un puñado
 * de dominios agota la cuota y deja a TODOS los clientes sin poder renovar -- una caída
 * total de la plataforma provocada desde fuera, sin tocar el servidor.
 *
 * Responde deliberadamente con un cuerpo vacío y sin distinguir causas: un dominio
 * desconocido, uno mal formado y uno de un cliente suspendido dan el MISMO 403. Este
 * endpoint es alcanzable desde internet y contestar distinto lo convertiría en un oráculo
 * para enumerar qué clientes tiene la plataforma y cuáles están suspendidos.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain");
  if (!domain) return new NextResponse(null, { status: 403 });

  // Misma normalización que en el borde de escritura: si Caddy pregunta por `EJEMPLO.com`
  // y en la base está `ejemplo.com`, tiene que casar. Y un host bajo un dominio raíz de la
  // plataforma se rechaza aquí también -- esos los cubre el comodín, no on-demand.
  const normalized = normalizeCustomDomain(domain, ROOT_DOMAINS);
  if (!normalized) return new NextResponse(null, { status: 403 });

  try {
    const known = await isActiveCustomDomain(normalized);
    return new NextResponse(null, { status: known ? 200 : 403 });
  } catch (error) {
    // Falla CERRADO. Si la base no responde, negar el certificado solo retrasa una emisión
    // (Caddy reintenta); autorizarla a ciegas abriría exactamente el agujero que este
    // endpoint existe para tapar, y justo cuando menos se está mirando.
    console.error("[tls-check] fallo al resolver el dominio propio:", error);
    return new NextResponse(null, { status: 403 });
  }
}
