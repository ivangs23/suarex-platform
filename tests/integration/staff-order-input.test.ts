import { describe, expect, it } from "vitest";
import {
  InvalidStaffOrderInputError,
  parseMarkStationDoneInput,
} from "../../apps/web/lib/staff-order-input.js";

/**
 * Fix round 2 (Finding 4): cubre `parseMarkStationDoneInput` -- la validación que la
 * Server Action `markStationDone` (`apps/web/app/staff/actions.ts`) aplica a `orderId`/
 * `station` ANTES de resolver sesión o tocar la base de datos. Ver el docstring de
 * `apps/web/lib/staff-order-input.ts` para el porqué: un caller que invoque la acción
 * directamente (no a través del botón de `OrdersBoard.tsx`) no pasa por el tipado
 * `"cocina" | "barra"` de TypeScript, que solo existe en tiempo de compilación.
 */
const VALID_ORDER_ID = "11111111-1111-1111-1111-111111111111";

describe("parseMarkStationDoneInput", () => {
  it("control positivo: orderId UUID + station válida -> se aceptan tal cual", () => {
    expect(parseMarkStationDoneInput(VALID_ORDER_ID, "cocina")).toEqual({
      orderId: VALID_ORDER_ID,
      station: "cocina",
    });
    expect(parseMarkStationDoneInput(VALID_ORDER_ID, "barra")).toEqual({
      orderId: VALID_ORDER_ID,
      station: "barra",
    });
  });

  it("rechaza una station que no es exactamente 'cocina' ni 'barra', en vez de enrutarla en silencio a 'barra'", () => {
    expect(() => parseMarkStationDoneInput(VALID_ORDER_ID, "cocinaX")).toThrow(
      InvalidStaffOrderInputError,
    );
    expect(() => parseMarkStationDoneInput(VALID_ORDER_ID, "")).toThrow(
      InvalidStaffOrderInputError,
    );
    expect(() => parseMarkStationDoneInput(VALID_ORDER_ID, "BARRA")).toThrow(
      InvalidStaffOrderInputError,
    );
  });

  it("rechaza un orderId que no es un UUID, en vez de dejarlo llegar crudo a Postgres", () => {
    expect(() => parseMarkStationDoneInput("no-es-un-uuid", "barra")).toThrow(
      InvalidStaffOrderInputError,
    );
    expect(() => parseMarkStationDoneInput("", "barra")).toThrow(InvalidStaffOrderInputError);
    // Casi un UUID (un carácter fuera de rango) -- prueba que la validación es de
    // formato real, no solo de longitud.
    expect(() =>
      parseMarkStationDoneInput("1111111g-1111-1111-1111-111111111111", "barra"),
    ).toThrow(InvalidStaffOrderInputError);
  });
});
