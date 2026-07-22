import { describe, expect, it } from "vitest";
import {
  InvalidDeviceActionInputError,
  MAX_PAIRING_TTL_MINUTES,
  parsePairingTtlMinutes,
} from "../../apps/web/lib/device-action-input.js";
import { InvalidFormFieldError } from "../../apps/web/lib/form-parse.js";

/**
 * Fix round 2 (Finding 1, seguridad): cubre `parsePairingTtlMinutes`, el parser que
 * `apps/web/app/admin/dispositivos/actions.ts` aplica a `ttl_minutes` ANTES de que llegue a
 * `createDevice`/`regeneratePairingCode` (`packages/db/src/admin-devices.ts`). Antes de este
 * fix, `ttl_minutes` llegaba como `Number(raw)` sin cota ni comprobación de `NaN`: un valor
 * como "999999999" emitía un código de emparejamiento efectivamente permanente, y un valor
 * no numérico llegaba como `NaN` hasta `new Date(NaN).toISOString()`, un `RangeError` sin
 * mensaje claro. Ver el docstring de `apps/web/lib/device-action-input.ts` para el porqué
 * completo, incluido por qué el repositorio también aplica el mismo tope (defensa en
 * profundidad) sin rechazar valores negativos (los tests de ese repositorio los usan a
 * propósito para simular un código ya caducado).
 */

function formDataWith(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

describe("parsePairingTtlMinutes", () => {
  it("el campo ausente (default) devuelve undefined -- el repositorio aplica su propio default de 15 minutos", () => {
    expect(parsePairingTtlMinutes(new FormData())).toBeUndefined();
  });

  it("control positivo: un valor normal se acepta tal cual", () => {
    expect(parsePairingTtlMinutes(formDataWith({ ttl_minutes: "30" }))).toBe(30);
  });

  it("control positivo: el propio tope máximo (24h) se acepta", () => {
    expect(
      parsePairingTtlMinutes(formDataWith({ ttl_minutes: String(MAX_PAIRING_TTL_MINUTES) })),
    ).toBe(MAX_PAIRING_TTL_MINUTES);
  });

  it("rechaza un valor por encima del tope de 24 horas en vez de emitir un código casi permanente", () => {
    expect(() => parsePairingTtlMinutes(formDataWith({ ttl_minutes: "999999999" }))).toThrow(
      InvalidDeviceActionInputError,
    );
    expect(() =>
      parsePairingTtlMinutes(formDataWith({ ttl_minutes: String(MAX_PAIRING_TTL_MINUTES + 1) })),
    ).toThrow(InvalidDeviceActionInputError);
  });

  it("rechaza un valor no numérico en vez de dejar pasar NaN hasta new Date(NaN) -- vía la comprobación genérica de parseOptionalInt (form-parse.ts)", () => {
    expect(() => parsePairingTtlMinutes(formDataWith({ ttl_minutes: "abc" }))).toThrow(
      InvalidFormFieldError,
    );
  });

  it("rechaza cero, negativos y decimales -- ttl_minutes debe ser un entero positivo", () => {
    expect(() => parsePairingTtlMinutes(formDataWith({ ttl_minutes: "0" }))).toThrow(
      InvalidDeviceActionInputError,
    );
    expect(() => parsePairingTtlMinutes(formDataWith({ ttl_minutes: "-5" }))).toThrow(
      InvalidDeviceActionInputError,
    );
    expect(() => parsePairingTtlMinutes(formDataWith({ ttl_minutes: "10.5" }))).toThrow(
      InvalidDeviceActionInputError,
    );
  });
});
