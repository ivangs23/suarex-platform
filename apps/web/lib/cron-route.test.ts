import { describe, expect, it, vi } from "vitest";
import { cronRoute } from "./cron-route";

/**
 * Lo que se prueba aquí es que la barrera es IMPOSIBLE DE OMITIR, no que un endpoint
 * concreto la tenga: esa era exactamente la fragilidad del guard copiado cuatro veces.
 */
function peticion(auth?: string): Request {
  return new Request("http://x/api/internal/x", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe("cronRoute", () => {
  it("sin CRON_SECRET configurado falla cerrado y NO ejecuta el trabajo", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const trabajo = vi.fn().mockResolvedValue({ ok: true });
    const res = await cronRoute("x", trabajo)(peticion("Bearer loquesea"));

    expect(res.status).toBe(503);
    expect(
      trabajo,
      "un despliegue a medio configurar no puede ejecutar esto",
    ).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("sin credencial devuelve 401 y NO ejecuta el trabajo", async () => {
    vi.stubEnv("CRON_SECRET", "secreto-real");
    const trabajo = vi.fn().mockResolvedValue({ ok: true });

    expect((await cronRoute("x", trabajo)(peticion())).status).toBe(401);
    expect((await cronRoute("x", trabajo)(peticion("Bearer otro"))).status).toBe(401);
    expect(
      (await cronRoute("x", trabajo)(peticion("secreto-real"))).status,
      "sin el prefijo Bearer",
    ).toBe(401);
    expect(trabajo).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("con la credencial correcta ejecuta y devuelve el resultado", async () => {
    vi.stubEnv("CRON_SECRET", "secreto-real");
    const res = await cronRoute("x", async () => ({ barridos: 3 }))(
      peticion("Bearer secreto-real"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ barridos: 3 });
    vi.unstubAllEnvs();
  });

  it("un fallo del trabajo devuelve 500 genérico sin filtrar el error", async () => {
    vi.stubEnv("CRON_SECRET", "secreto-real");
    const res = await cronRoute("x", async () => {
      throw new Error("detalle interno que no debe salir");
    })(peticion("Bearer secreto-real"));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("detalle interno");
    vi.unstubAllEnvs();
  });
});
