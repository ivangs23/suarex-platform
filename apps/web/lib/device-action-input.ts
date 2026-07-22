import { parseOptionalInt } from "./form-parse";

/** Lanzado por los parsers de este módulo -- nunca llega a tocar la base de datos. */
export class InvalidDeviceActionInputError extends Error {}

/**
 * Fix round 2 (Finding 1, seguridad): tope superior de `ttl_minutes` -- 24 horas -- aplicado
 * en el borde de la Server Action (`parsePairingTtlMinutes`, este módulo) Y, como defensa en
 * profundidad, en el propio repositorio (`createDevice`/`regeneratePairingCode`,
 * `packages/db/src/admin-devices.ts`). Un código de emparejamiento es una credencial de
 * autenticación: su ventana de validez corta es precisamente el punto (ver el docstring de
 * `DEFAULT_TTL_MINUTES` en ese fichero). Antes, `ttl_minutes` llegaba de `formData` como
 * `Number(raw)` sin cota ni comprobación de `NaN`: un manager (o un bug de UI) pidiendo
 * `ttl_minutes=999999999` emitía un código efectivamente permanente, y un valor no numérico
 * llegaba como `NaN` hasta `new Date(NaN).toISOString()`, un `RangeError` sin mensaje claro.
 */
export const MAX_PAIRING_TTL_MINUTES = 24 * 60;

/**
 * `ttl_minutes` es opcional (ausente -> `undefined`, el repositorio aplica su propio
 * default de 15 minutos, ver `DEFAULT_TTL_MINUTES`). Si está presente, debe ser un entero
 * positivo y no superar `MAX_PAIRING_TTL_MINUTES`; cualquier otro valor (no numérico, cero,
 * negativo, decimal, o por encima del tope) se rechaza aquí, ANTES de llegar al
 * repositorio -- no se clampa en silencio, porque un manager pidiendo 24 horas y un manager
 * pidiendo 999999999 minutos no deberían acabar con el mismo resultado sin saberlo.
 */
export function parsePairingTtlMinutes(formData: FormData): number | undefined {
  const value = parseOptionalInt(formData, "ttl_minutes");
  if (value === undefined) return undefined;

  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidDeviceActionInputError(
      `ttl_minutes inválido (se esperaba un entero positivo): ${JSON.stringify(String(value))}`,
    );
  }
  if (value > MAX_PAIRING_TTL_MINUTES) {
    throw new InvalidDeviceActionInputError(
      `ttl_minutes no puede superar ${MAX_PAIRING_TTL_MINUTES} minutos (24 horas): ${value}`,
    );
  }
  return value;
}
