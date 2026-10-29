/**
 * Origen público del cliente (`https://host`): el de sus QR, su canonical, su sitemap y su robots.
 *
 * Con dominio propio, SIEMPRE él: un QR impreso dura años y el subdominio de la plataforma
 * puede cambiar. Sin él, o en desarrollo (`*.localhost`), el Host de la petición, que sale de
 * `headers()` y nunca de un formulario.
 */
export function origenPublico(input: {
  customDomain: string | null;
  host: string;
  forwardedProto: string | null;
}): string {
  const { customDomain, host, forwardedProto } = input;
  const enDesarrollo =
    host === "localhost" || /\.localhost(:\d+)?$/.test(host) || host.startsWith("localhost:");

  if (customDomain && !enDesarrollo) return `https://${customDomain}`;

  // `Host` nunca trae esquema: tras el proxy llega en `x-forwarded-proto`; sin él, solo
  // `*.localhost` (dev server sin TLS) es http.
  const protocolo = forwardedProto ?? (enDesarrollo ? "http" : "https");
  return `${protocolo}://${host}`;
}

/**
 * ¿Responde ya ESTA plataforma en el dominio propio? `/api/tls-check` pedido a través de ese
 * dominio solo da 200 si su DNS apunta aquí y el cliente está activo. Nunca lanza: es un
 * aviso, no una barrera; el dominio ya pasó por `normalizeCustomDomain` al guardarse.
 */
export async function dominioPropioRespondeAqui(
  dominio: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2500,
): Promise<boolean> {
  try {
    const url = `https://${dominio}/api/tls-check?domain=${encodeURIComponent(dominio)}`;
    const res = await fetchImpl(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
