/** IP del cliente para el rate-limit: primer salto de `x-forwarded-for` (lo que fija el
 * proxy/plataforma), con `x-real-ip` de respaldo. `"unknown"` si no hay ninguna -- todos
 * los clientes sin IP comparten cubo, lo cual es aceptable para un límite anti-abuso. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
