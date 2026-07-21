import { expect, test } from "@playwright/test";
import { deleteOrder, findOrderByPublicToken } from "./helpers/orders-db.js";

/**
 * Cobertura de regresión para `GET /api/pedido/[publicToken]`
 * (`apps/web/app/api/pedido/[publicToken]/route.ts`).
 *
 * Por qué e2e y no un test unitario de `getOrderByPublicToken`: el bug real que
 * motiva este fichero no vivía en `getOrderByPublicToken` -- esa función siempre
 * se comportó igual, lanzando la excepción de Postgres `22P02` (`invalid input
 * syntax for type uuid`) para cualquier token no-UUID. El bug estaba en el
 * `try/catch` (o su ausencia) alrededor de esa llamada DENTRO del route handler:
 * sin él, esa excepción escapaba como un 500 sin capturar de Next.js en vez de
 * convertirse en el mismo 404 genérico que ve un token bien formado pero
 * inexistente. Un test unitario de `getOrderByPublicToken` seguiría viendo esa
 * función lanzar (eso es correcto y esperado) y nunca ejercitaría el `catch` del
 * handler ni el código HTTP que efectivamente llega al navegador del comensal --
 * exactamente la pieza donde vivió el bug. Solo un test que golpea la ruta real
 * (servidor Next real, handler real, catch real) puede fallar si ese catch
 * desaparece o deja de capturar lo que hace falta.
 */

const GARUM_TABLE_TOKEN = "11111111-1111-1111-1111-111111111111";
const BASE = "http://garum.localhost:3000";

// Igual que `firstProductId` en `staff-board.spec.ts`, pero contra la
// `APIRequestContext` de Playwright (`request`) en lugar de `page.request`: este
// fichero no necesita un navegador real, solo peticiones HTTP contra la ruta.
async function firstGarumProductId(
  request: import("@playwright/test").APIRequestContext,
): Promise<string> {
  const response = await request.get(`${BASE}/m/${GARUM_TABLE_TOKEN}`);
  const html = await response.text();
  const match = html.match(/data-product-id="([0-9a-f-]{36})"/);
  if (!match?.[1]) throw new Error("No se encontró ningún producto en la carta de garum");
  return match[1];
}

test.describe("GET /api/pedido/[publicToken]", () => {
  test("un publicToken real devuelve exactamente {orderNumber, status, totalCents, currency}", async ({
    request,
  }) => {
    const productId = await firstGarumProductId(request);
    const createResponse = await request.post(`${BASE}/api/orders`, {
      data: {
        tableToken: GARUM_TABLE_TOKEN,
        lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const { publicToken } = (await createResponse.json()) as { publicToken: string };
    const { orderId } = await findOrderByPublicToken(publicToken);

    // A partir de aquí el pedido existe de verdad en la base: el `finally` lo
    // borra pase lo que pase en el resto del test (mismo patrón que
    // `staff-board.spec.ts`).
    try {
      const response = await request.get(`${BASE}/api/pedido/${publicToken}`);
      expect(response.status()).toBe(200);

      const body = (await response.json()) as Record<string, unknown>;

      // La aserción que importa de verdad: el CONJUNTO exacto de claves, no solo
      // que las cuatro esperadas estén presentes. Si algún día el endpoint
      // empezara a filtrar el id interno del pedido, el tenant, las líneas o un
      // timestamp, las cuatro claves esperadas seguirían estando ahí y una
      // aserción de "contiene" no lo detectaría; comparar el array de claves
      // ordenado sí lo hace.
      expect(Object.keys(body).sort()).toEqual(
        ["currency", "orderNumber", "status", "totalCents"].sort(),
      );

      expect(typeof body.orderNumber).toBe("number");
      expect(typeof body.status).toBe("string");
      expect(typeof body.totalCents).toBe("number");
      expect(typeof body.currency).toBe("string");
    } finally {
      await deleteOrder(orderId);
    }
  });

  test("un publicToken con formato UUID válido pero inexistente da 404", async ({ request }) => {
    const response = await request.get(`${BASE}/api/pedido/00000000-0000-0000-0000-000000000000`);
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual({ error: "Pedido no encontrado" });
  });

  /**
   * Esta es la aserción de seguridad real (ver comentario de cabecera de este
   * fichero y el comentario del propio route.ts). Antes del fix, un
   * `publicToken` no-UUID hacía que Postgres lanzara `22P02` (cast de `uuid`
   * inválido) ANTES de que `getOrderByPublicToken` pudiera devolver `null`, y esa
   * excepción escapaba del handler como un 500 sin capturar -- un código HTTP
   * distinto del 404 que recibe un UUID bien formado pero inexistente, es decir,
   * un canal por el que un atacante podría distinguir "no existe" de "formato
   * inválido". Si ese `try/catch` alguna vez se elimina, o `getOrderByPublicToken`
   * cambia de forma que ese error dejara de capturarse, este test debe fallar
   * aquí -- no en un curl manual que nadie vuelve a ejecutar.
   */
  test("un publicToken malformado (no-UUID) da el MISMO 404 que uno inexistente, nunca un 500", async ({
    request,
  }) => {
    const nonexistentResponse = await request.get(
      `${BASE}/api/pedido/00000000-0000-0000-0000-000000000000`,
    );
    const nonexistentBody = await nonexistentResponse.json();

    const malformedResponse = await request.get(`${BASE}/api/pedido/this-is-not-a-uuid-at-all`);
    const malformedBody = await malformedResponse.json();

    expect(malformedResponse.status()).toBe(404);
    expect(malformedResponse.status()).toBe(nonexistentResponse.status());
    expect(malformedBody).toEqual(nonexistentBody);
    expect(malformedBody).toEqual({ error: "Pedido no encontrado" });
  });
});
