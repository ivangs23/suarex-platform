import { describe, expect, it } from "vitest";
import { timingSafeEqualStr } from "./timing-safe-equal";

/**
 * Es la única barrera del endpoint de cron. Un fallo aquí -- aceptar un secreto que no
 * coincide, o petar con longitudes distintas -- abre un endpoint que cancela pedidos.
 */
describe("timingSafeEqualStr", () => {
  it("true solo si las dos cadenas son idénticas", () => {
    expect(timingSafeEqualStr("secreto-largo-123", "secreto-largo-123")).toBe(true);
  });

  it("false si difieren, aunque compartan prefijo", () => {
    expect(timingSafeEqualStr("secreto-largo-123", "secreto-largo-124")).toBe(false);
    expect(timingSafeEqualStr("secreto-largo-123", "secreto-largo-1234")).toBe(false);
  });

  it("false con longitudes distintas, sin lanzar", () => {
    // `timingSafeEqual` de Node LANZA si los buffers miden distinto: la guarda de longitud
    // lo convierte en un `false` limpio en vez de un 500 del endpoint.
    expect(timingSafeEqualStr("corto", "una-cadena-mucho-mas-larga")).toBe(false);
    expect(timingSafeEqualStr("", "x")).toBe(false);
  });

  it("dos cadenas vacías son iguales (pero el endpoint ya exige secreto no vacío)", () => {
    expect(timingSafeEqualStr("", "")).toBe(true);
  });
});
