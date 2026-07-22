import { describe, expect, it } from "vitest";
import { enqueueByDevice } from "./queue.js";

describe("enqueueByDevice", () => {
  it("serializa las tareas del mismo dispositivo, en orden", async () => {
    const order: number[] = [];
    const slow = (n: number, ms: number) =>
      enqueueByDevice("dev-a", async () => {
        await new Promise((r) => setTimeout(r, ms));
        order.push(n);
      });

    await Promise.all([slow(1, 30), slow(2, 5), slow(3, 1)]);
    // Mismo dispositivo: se ejecutan en el orden de encolado pese a los tiempos.
    expect(order).toEqual([1, 2, 3]);
  });

  it("una tarea que falla no bloquea la siguiente del mismo dispositivo", async () => {
    await enqueueByDevice("dev-b", async () => {
      throw new Error("boom");
    }).catch(() => {});
    const ok = await enqueueByDevice("dev-b", async () => "ok");
    expect(ok).toBe("ok");
  });

  it("dispositivos distintos no se serializan entre sí", async () => {
    const start = Date.now();
    await Promise.all([
      enqueueByDevice("x", () => new Promise((r) => setTimeout(r, 40))),
      enqueueByDevice("y", () => new Promise((r) => setTimeout(r, 40))),
    ]);
    // En paralelo tarda ~40ms, no ~80ms.
    expect(Date.now() - start).toBeLessThan(75);
  });
});
