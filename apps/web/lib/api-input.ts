import {
  MAX_CANTIDAD_LINEA,
  MAX_EXTRAS_LINEA,
  MAX_LINEAS_PEDIDO,
  MAX_NOTAS_LINEA,
} from "@suarex/domain";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * FORMA del cuerpo de las rutas API, validada en el borde. El NEGOCIO (producto disponible,
 * opciones obligatorias, precios) lo sigue decidiendo `createPendingOrder`: zod solo garantiza
 * que lo que llega tiene la forma que el código da por hecha, en vez de un cast.
 *
 * `z.guid()` y no `z.uuid()`: el segundo exige la variante RFC y rechazaría ids válidos para
 * Postgres, como los `1111…` que siembra `supabase/seed.sql`.
 */

const lineaSchema = z.object({
  productId: z.guid(),
  quantity: z.number().int().min(1).max(MAX_CANTIDAD_LINEA),
  extraIds: z.array(z.guid()).max(MAX_EXTRAS_LINEA).default([]),
  notes: z
    .string()
    .max(MAX_NOTAS_LINEA)
    .nullish()
    .transform((nota) => nota ?? null),
});

const lineasSchema = z.array(lineaSchema).min(1).max(MAX_LINEAS_PEDIDO);

/** `POST /api/orders` (canal QR). La mesa NO viaja aquí: sale de la cookie. */
export const orderLinesSchema = z.object({ lines: lineasSchema });

/** `POST /api/kiosko/orders`. `tableLabel` se valida aparte, para dar al totem su propio
 *  mensaje ("Número de mesa inválido"). */
export const kioskoOrderSchema = z.object({
  token: z.guid(),
  tableLabel: z.unknown().optional(),
  lines: lineasSchema,
});

/** `POST /api/devices/pair`. */
export const pairDeviceSchema = z.object({ pairingCode: z.string().min(1) });

/** El mismo texto genérico que ya daban las rutas: nada del esquema llega al comensal. */
export function peticionInvalida(): Response {
  return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
}

/**
 * Lee el JSON del cuerpo y lo valida. Un JSON roto y uno con otra forma dan la misma
 * respuesta: `alFallar`, por defecto el 400 genérico. Quien necesite otra (el emparejamiento,
 * que contesta siempre el mismo 404 para no revelar si un código existe) la pasa.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  alFallar: () => Response = peticionInvalida,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { ok: false, response: alFallar() };
  }
  const resultado = schema.safeParse(json);
  return resultado.success
    ? { ok: true, data: resultado.data }
    : { ok: false, response: alFallar() };
}
