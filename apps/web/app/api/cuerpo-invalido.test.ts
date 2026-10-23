import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las tres rutas que leen un cuerpo JSON, con un cuerpo que no tiene la forma esperada: se
 * rechazan en el borde, ANTES de tocar la base. Por eso `@suarex/db` va simulado entero y cada
 * caso exige que no se haya llamado a nada de él.
 */
const db = vi.hoisted(() => ({
  attachPaymentIntent: vi.fn(),
  cancelOrphanedPendingOrder: vi.fn(),
  checkOrderRateLimit: vi.fn(),
  checkPairRateLimit: vi.fn(),
  createPendingOrder: vi.fn(),
  findDeviceByTotemToken: vi.fn(),
  findTableByToken: vi.fn(),
  getTenantSettings: vi.fn(),
  getTenantStripeAccount: vi.fn(),
  pairDevice: vi.fn(),
}));

vi.mock("@suarex/db", () => ({ ...db, OrderCartError: class OrderCartError extends Error {} }));
// Hay cookie de mesa: si la ruta rechaza, es por el cuerpo y no por faltarle la mesa.
vi.mock("@/lib/mesa-cookie", () => ({
  readMesaToken: async () => "11111111-1111-1111-1111-111111111111",
}));
vi.mock("@/lib/stripe", () => ({ resolveStripeKeys: vi.fn(), stripeClientWithKey: vi.fn() }));

const pedidos = await import("./orders/route");
const kiosko = await import("./kiosko/orders/route");
const emparejar = await import("./devices/pair/route");

const PRODUCTO = "4a0e9c1e-7a52-4d47-9c3b-2b5f4b8f1a10";
const peticion = (cuerpo: string) =>
  new Request("http://garum.localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: cuerpo,
  });

function noSeTocoLaBase() {
  for (const [nombre, fn] of Object.entries(db)) {
    expect(fn, `${nombre} no debía llamarse`).not.toHaveBeenCalled();
  }
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/orders con un cuerpo inválido", () => {
  it.each([
    ["JSON roto", "{no es json"],
    ["sin líneas", JSON.stringify({ lines: [] })],
    [
      "productId que no es uuid",
      JSON.stringify({ lines: [{ productId: "1; drop table orders", quantity: 1 }] }),
    ],
    ["cantidad como texto", JSON.stringify({ lines: [{ productId: PRODUCTO, quantity: "2" }] })],
  ])("%s: 400 genérico y no toca la base", async (_, cuerpo) => {
    const respuesta = await pedidos.POST(peticion(cuerpo));
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ error: "Petición inválida" });
    noSeTocoLaBase();
  });

  it("control: un cuerpo válido sí pasa el borde y llega a la base", async () => {
    db.findTableByToken.mockResolvedValue(null);
    const respuesta = await pedidos.POST(
      peticion(JSON.stringify({ lines: [{ productId: PRODUCTO, quantity: 1 }] })),
    );
    expect(respuesta.status).toBe(404);
    expect(db.findTableByToken).toHaveBeenCalledOnce();
  });
});

describe("POST /api/kiosko/orders con un cuerpo inválido", () => {
  it.each([
    ["JSON roto", "{"],
    ["sin token", JSON.stringify({ lines: [{ productId: PRODUCTO, quantity: 1 }] })],
    ["con token y líneas vacías", JSON.stringify({ token: PRODUCTO, lines: [] })],
  ])("%s: 400 genérico y no toca la base", async (_, cuerpo) => {
    const respuesta = await kiosko.POST(peticion(cuerpo));
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ error: "Petición inválida" });
    noSeTocoLaBase();
  });

  it("la mesa del totem conserva su propio mensaje", async () => {
    const respuesta = await kiosko.POST(
      peticion(
        JSON.stringify({
          token: PRODUCTO,
          tableLabel: "200",
          lines: [{ productId: PRODUCTO, quantity: 1 }],
        }),
      ),
    );
    expect(respuesta.status).toBe(400);
    expect(await respuesta.json()).toEqual({ error: "Número de mesa inválido (1–100)" });
    noSeTocoLaBase();
  });
});

describe("POST /api/devices/pair con un cuerpo inválido", () => {
  it.each([
    ["JSON roto", "{"],
    ["sin código", JSON.stringify({})],
    ["código que no es texto", JSON.stringify({ pairingCode: 123 })],
  ])("%s: el MISMO 404 que un código inexistente, sin tocar la base", async (_, cuerpo) => {
    const respuesta = await emparejar.POST(peticion(cuerpo));
    expect(respuesta.status).toBe(404);
    expect(await respuesta.json()).toEqual({ error: "Código de emparejamiento inválido" });
    noSeTocoLaBase();
  });
});
