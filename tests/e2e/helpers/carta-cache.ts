/**
 * La carta está cacheada por tenant (`apps/web/lib/carta-cache.ts`) y solo se invalida al
 * escribir por la app. Un helper que escribe la base DIRECTAMENTE (canales, restaurar ajustes,
 * deshacer un movimiento) tiene que llamar a esto, o el test siguiente lee la carta vieja
 * durante hasta 60 s: un fallo que depende de cuánto tarde cada test.
 */
export async function revalidarCarta(tenantId: string): Promise<void> {
  const res = await fetch("http://garum.localhost:3000/api/internal/revalidar-carta", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tenantId }),
  });
  if (!res.ok) {
    throw new Error(
      `revalidar-carta respondió ${res.status}. Si el dev server lo arrancaste tú y no ` +
        "Playwright, no tiene el CRON_SECRET de la suite (ver playwright.config.ts).",
    );
  }
}
