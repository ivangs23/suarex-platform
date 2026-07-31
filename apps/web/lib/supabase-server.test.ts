import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El adaptador de cookies del cliente de servidor.
 *
 * Lo que se prueba es un fallo REAL, visto en la propia app: pasada una hora de sesión, la
 * primera visita al panel devolvía un 500 -- "Cookies can only be modified in a Server Action
 * or Route Handler". Nadie escribía cookies a mano; las escribía auth-js al rotar un access
 * token caducado, desde dentro del render de un componente de servidor, que es donde Next lo
 * prohíbe. El panel se caía solo por haber estado abierto demasiado rato.
 */

type Adaptador = {
  getAll: () => { name: string; value: string }[];
  setAll: (items: { name: string; value: string; options?: unknown }[]) => void;
};

let adaptador: Adaptador | null = null;
let almacen: { set: (n: string, v: string, o?: unknown) => void; getAll: () => [] };

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opciones: { cookies: Adaptador }) => {
    adaptador = opciones.cookies;
    return {};
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => almacen,
}));

const { staffServerClient } = await import("./supabase-server");

const NUEVAS = [{ name: "sb-access-token", value: "nuevo", options: { path: "/" } }];

beforeEach(() => {
  adaptador = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("staffServerClient", () => {
  it("no revienta cuando el entorno no deja escribir cookies", async () => {
    // Un componente de servidor: la respuesta ya va en camino y `set` lanza.
    almacen = {
      getAll: () => [],
      set: () => {
        throw new Error("Cookies can only be modified in a Server Action or Route Handler");
      },
    };

    await staffServerClient();
    expect(adaptador).not.toBeNull();

    // Rotar el token no puede tumbar la página: quien refresca la sesión de verdad es
    // `proxy.ts`, antes de llegar aquí.
    expect(() => adaptador?.setAll(NUEVAS)).not.toThrow();
  });

  it("sí escribe donde SÍ se puede: una Server Action o un Route Handler", async () => {
    /* El arreglo no es "dejar de escribir cookies". Si se hubiera resuelto con un `setAll`
       vacío, la rotación del token no se persistiría nunca y la sesión moriría a la hora
       aunque la persona estuviera trabajando. */
    const escritas: string[] = [];
    almacen = { getAll: () => [], set: (nombre) => escritas.push(nombre) };

    await staffServerClient();
    adaptador?.setAll(NUEVAS);

    expect(escritas).toEqual(["sb-access-token"]);
  });
});
