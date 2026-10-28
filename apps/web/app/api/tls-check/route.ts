import {
  dominioSinWww,
  hostDePlataforma,
  normalizeCustomDomain,
  resolveRootDomains,
} from "@suarex/config";
import { findTenantBySlug, isActiveCustomDomain } from "@suarex/db";
import { NextResponse } from "next/server";
import { log } from "@/lib/log";

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
/** `api.` y `admin.` siempre; el subdominio de un cliente, solo si está ACTIVO. */
async function esHostDePlataformaActivo(
  host: NonNullable<ReturnType<typeof hostDePlataforma>>,
): Promise<boolean> {
  if (host.tipo === "fijo") return true;
  return (await findTenantBySlug(host.slug))?.status === "active";
}

/** El dominio propio de un cliente activo, o su `www.`: sin certificado para `www.`, la
 *  redirección al dominio que hace `proxy.ts` nunca llegaría a responder por HTTPS. */
async function esDominioPropioActivo(dominio: string): Promise<boolean> {
  if (await isActiveCustomDomain(dominio)) return true;
  const sinWww = dominioSinWww(dominio, ROOT_DOMAINS);
  return sinWww !== null && (await isActiveCustomDomain(sinWww));
}

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain");
  if (!domain) return new NextResponse(null, { status: 403 });

  // Un host de la plataforma solo llega aquí sin comodín (`PLATFORM_TLS=bajo_demanda`, ver
  // deploy/Caddyfile). Todo lo demás tiene que ser un dominio propio bien formado.
  const plataforma = hostDePlataforma(domain, ROOT_DOMAINS);
  const normalized = normalizeCustomDomain(domain, ROOT_DOMAINS);
  if (!plataforma && !normalized) return new NextResponse(null, { status: 403 });

  try {
    const autorizado = plataforma
      ? await esHostDePlataformaActivo(plataforma)
      : normalized !== null && (await esDominioPropioActivo(normalized));
    return new NextResponse(null, { status: autorizado ? 200 : 403 });
  } catch (error) {
    // Falla CERRADO. Si la base no responde, negar el certificado solo retrasa una emisión
    // (Caddy reintenta); autorizarla a ciegas abriría exactamente el agujero que este
    // endpoint existe para tapar, y justo cuando menos se está mirando.
    log.error("tls_check.fallo", { error });
    return new NextResponse(null, { status: 403 });
  }
}
