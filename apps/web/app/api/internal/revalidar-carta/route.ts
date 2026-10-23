import { z } from "zod";
import { parseJsonBody } from "@/lib/api-input";
import { invalidarCarta } from "@/lib/carta-cache";
import { cronRoute } from "@/lib/cron-route";

/**
 * INVALIDA LA CARTA CACHEADA DE UN CLIENTE (`lib/carta-cache.ts`).
 *
 * Lo que se escribe por el panel ya invalida solo. Esto es para lo que escribe la base SIN
 * pasar por la app: un `import-catalog`, un SQL a mano, los helpers de la suite e2e. Sin
 * llamarlo, la carta lo recoge igual al caducar la caché (60 s).
 *
 *   curl -X POST https://<host>/api/internal/revalidar-carta \
 *     -H "Authorization: Bearer $CRON_SECRET" -d '{"tenantId":"<uuid>"}'
 *
 * Misma barrera que el resto de `/api/internal/*` (`CRON_SECRET`, falla cerrado): invalidar
 * no destruye nada, pero abierto serviría para vaciar la caché de todos a voluntad.
 */
export const runtime = "nodejs";

const cuerpo = z.object({ tenantId: z.guid() });

export const POST = cronRoute("cron.revalidar_carta_fallo", async (request) => {
  const entrada = await parseJsonBody(request, cuerpo);
  if (!entrada.ok) return entrada.response;
  invalidarCarta(entrada.data.tenantId);
  return { revalidada: entrada.data.tenantId };
});
