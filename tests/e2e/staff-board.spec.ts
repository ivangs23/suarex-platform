import { expect, type Page, test } from "@playwright/test";
import { deleteOrder, findOrderByPublicToken, markOrderPaidForTest } from "./helpers/orders-db.js";

// Igual que `REALTIME_READY_TIMEOUT_MS` en `tests/integration/realtime-isolation.test.ts`:
// justo tras `supabase db reset` (o bajo varios workers de Playwright compitiendo por CPU
// con el dev server de Next), el consumidor WAL de Realtime puede tardar en calentar y el
// dev server puede tardar en compilar una ruta por primera vez -- ver también el
// comentario de `staff-auth.spec.ts` sobre exactamente este mismo efecto. Ninguno de los
// dos es parte del comportamiento que estos tests verifican.
const REALTIME_WAIT_MS = 20_000;

const GARUM_TABLE_TOKEN = "11111111-1111-1111-1111-111111111111";
// Sembrado en `supabase/seed.sql` específicamente para este archivo: sin una mesa real
// de manuela, `POST /api/orders` no puede crear un pedido para ese tenant y el test de
// aislamiento de más abajo no tendría con qué probar su control positivo.
const MANUELA_TABLE_TOKEN = "33333333-3333-3333-3333-333333333333";

/**
 * Ninguna de las dos comprueba nunca "el tablero está vacío": esa aserción es sobre TODA
 * la base de datos, no sobre lo que este test creó, y por eso rompía cada vez que una
 * ejecución anterior (u otra suite, u otra persona probando el stack a mano) dejaba
 * cualquier pedido activo de garum/manuela sin resolver -- ver brief de la tarea ("43 x
 * locator resolvió a 1 elemento": el pedido no era de ESTA ejecución, era de la
 * anterior). Cada test localiza su propia tarjeta por `data-order-id` (ver
 * `OrdersBoard.tsx`), así que es indiferente a cualquier otro pedido que exista en el
 * tablero, tanto para el positivo ("aparece") como para el negativo ("el otro tenant no
 * la ve").
 */
function cardFor(page: Page, orderId: string) {
  return page.locator(`[data-testid="order-card"][data-order-id="${orderId}"]`);
}

/** Misma tarjeta, acotada además a la sección (`aria-label`) de una estación concreta --
 * prueba que cocina y barra están separadas, no solo que la tarjeta existe en algún
 * sitio del documento. */
function cardInStation(page: Page, station: "Cocina" | "Barra", orderId: string) {
  return page.locator(
    `[aria-label="${station}"] [data-testid="order-card"][data-order-id="${orderId}"]`,
  );
}

test("sin sesión, /staff redirige al acceso", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/staff");
  await expect(page).toHaveURL(/\/staff\/login/);
});

test("un pedido pagado aparece en el panel", async ({ page }) => {
  await loginAsStaff(page, "garum.localhost", "staff@garum.local");
  await expect(page).toHaveURL(/\/staff$/);

  // El pedido se crea por la API pública, como lo haría un comensal real.
  const productId = await firstProductId(page, "garum.localhost", GARUM_TABLE_TOKEN);
  const response = await page.request.post("http://garum.localhost:3000/api/orders", {
    data: {
      tableToken: GARUM_TABLE_TOKEN,
      lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const { publicToken } = (await response.json()) as { publicToken: string };
  const { orderId } = await findOrderByPublicToken(publicToken);

  // A partir de aquí el pedido existe de verdad en la base: pase lo que pase en el resto
  // del test (incluido un fallo de aserción a mitad), el `finally` lo borra. El test es
  // dueño de este pedido, no del estado global del tablero.
  try {
    // Fix round 2 (Finding 3): simula lo que haría el webhook de Stripe -- este test
    // nunca completa un cobro real, así que sin esto el pedido queda "pending" para
    // siempre y "Marcar hecho" ya NO lo autosirve (por diseño, ver el trigger
    // `orders_auto_serve`). El nombre del test ("un pedido PAGADO aparece en el panel")
    // asume precisamente este paso.
    await markOrderPaidForTest(orderId);

    const card = cardFor(page, orderId);

    // Llega solo, sin recargar: eso es lo que prueba Realtime. La página se cargó ANTES
    // de que este pedido existiera, así que su aparición solo puede venir de la
    // suscripción, no de datos ya presentes en el render inicial.
    await expect(card).toHaveCount(1, { timeout: REALTIME_WAIT_MS });

    // El producto de garum (Ribera del Duero) es de categoría "vinos", destino barra:
    // cocina y barra están separadas -- la tarjeta vive en la sección de Barra y en
    // ninguna otra.
    await expect(cardInStation(page, "Barra", orderId)).toHaveCount(1);
    await expect(cardInStation(page, "Cocina", orderId)).toHaveCount(0);

    // "Marcar hecho" resuelve la única estación pendiente (cocina queda "na") -> el
    // pedido pasa a `served` (ver `markStationDone`) y desaparece de `listActiveOrders`.
    await card.getByRole("button", { name: /marcar hecho/i }).click();
    await expect(card).toHaveCount(0, { timeout: REALTIME_WAIT_MS });
  } finally {
    // La limpieza real: borra la fila, no depende de que "marcar hecho" haya llegado a
    // ejecutarse ni de qué haya devuelto el filtro del tablero.
    await deleteOrder(orderId);
  }
});

/**
 * Aislamiento del tablero, con CONTROL POSITIVO en ambas direcciones -- sin esto el test
 * no probaría nada (ver el brief de esta tarea: dos componentes de este proyecto ya
 * produjeron aislamiento "verde" vacío al filtrar por una foreign key que hacía
 * imposible que una fila fugada llegara a renderizarse). La secuencia importa: se
 * comprueba la ausencia de fuga de CADA pedido concreto INMEDIATAMENTE después de
 * crearlo, antes de crear el otro -- así una fuga en cualquiera de las dos direcciones
 * se detecta en el paso que la produce, no se diluye en un conteo final agregado.
 *
 * `OrdersBoard` (`apps/web/app/staff/OrdersBoard.tsx`) no vuelve a filtrar por tenant del
 * lado del cliente -- pinta exactamente lo que `listActiveOrders(session.tenantId)`
 * devuelve -- así que este test SÍ depende enteramente del `.eq("tenant_id", tenantId)`
 * de `tenantScoped` en `packages/db/src/staff-orders.ts`; no hay ningún filtro de
 * componente que pueda enmascarar una fuga real. Verificado quitando ese filtro a mano y
 * viendo fallar este mismo test (ver el informe de la tarea).
 */
test("el personal de un tenant no ve los pedidos del otro (con control positivo)", async ({
  browser,
}) => {
  const garumContext = await browser.newContext();
  const manuelaContext = await browser.newContext();
  let garumOrderId: string | undefined;
  let manuelaOrderId: string | undefined;

  try {
    const garumPage = await garumContext.newPage();
    const manuelaPage = await manuelaContext.newPage();

    await loginAsStaff(garumPage, "garum.localhost", "staff@garum.local");
    await loginAsStaff(manuelaPage, "manuela.localhost", "staff@manuela.local");

    // 1. Pedido de garum. Control positivo (garum lo ve) Y aislamiento (manuela no ve
    // ESTE pedido concreto, sea lo que sea que hubiera antes en su tablero) en el mismo
    // paso.
    const garumProductId = await firstProductId(garumPage, "garum.localhost", GARUM_TABLE_TOKEN);
    const garumResponse = await garumPage.request.post("http://garum.localhost:3000/api/orders", {
      data: {
        tableToken: GARUM_TABLE_TOKEN,
        lines: [{ productId: garumProductId, quantity: 1, extraIds: [], notes: null }],
      },
    });
    expect(garumResponse.ok()).toBeTruthy();
    const { publicToken: garumToken } = (await garumResponse.json()) as { publicToken: string };
    garumOrderId = (await findOrderByPublicToken(garumToken)).orderId;

    await expect(cardFor(garumPage, garumOrderId)).toHaveCount(1, { timeout: REALTIME_WAIT_MS });
    await expect(cardFor(manuelaPage, garumOrderId)).toHaveCount(0);

    // 2. Pedido de manuela. Control positivo (manuela lo ve) Y aislamiento (garum no ve
    // ESTE pedido concreto -- si lo viera, el pedido de manuela se habría fugado a
    // garum).
    const manuelaProductId = await firstProductId(
      manuelaPage,
      "manuela.localhost",
      MANUELA_TABLE_TOKEN,
    );
    const manuelaResponse = await manuelaPage.request.post(
      "http://manuela.localhost:3000/api/orders",
      {
        data: {
          tableToken: MANUELA_TABLE_TOKEN,
          lines: [{ productId: manuelaProductId, quantity: 1, extraIds: [], notes: null }],
        },
      },
    );
    expect(manuelaResponse.ok()).toBeTruthy();
    const { publicToken: manuelaToken } = (await manuelaResponse.json()) as {
      publicToken: string;
    };
    manuelaOrderId = (await findOrderByPublicToken(manuelaToken)).orderId;

    await expect(cardFor(manuelaPage, manuelaOrderId)).toHaveCount(1, {
      timeout: REALTIME_WAIT_MS,
    });
    await expect(cardFor(garumPage, manuelaOrderId)).toHaveCount(0);

    // Fix round 2 (Finding 3): sin marcar pagado, "Marcar hecho" ya no autosirve el
    // pedido (ver el comentario equivalente en el test anterior) y las aserciones de
    // "desaparece del tablero" de abajo fallarían por una razón ajena a este test
    // (aislamiento), no por una fuga real.
    await markOrderPaidForTest(garumOrderId);
    await markOrderPaidForTest(manuelaOrderId);

    // Cobertura de "marcar hecho" en ambos tenants antes de limpiar.
    await cardFor(garumPage, garumOrderId)
      .getByRole("button", { name: /marcar hecho/i })
      .click();
    await cardFor(manuelaPage, manuelaOrderId)
      .getByRole("button", { name: /marcar hecho/i })
      .click();
    await expect(cardFor(garumPage, garumOrderId)).toHaveCount(0, { timeout: REALTIME_WAIT_MS });
    await expect(cardFor(manuelaPage, manuelaOrderId)).toHaveCount(0, {
      timeout: REALTIME_WAIT_MS,
    });
  } finally {
    // Limpieza real de ambos pedidos, independientemente de en qué paso haya fallado el
    // test (por eso cada borrado está guardado tras comprobar que el pedido llegó a
    // crearse).
    if (garumOrderId) await deleteOrder(garumOrderId);
    if (manuelaOrderId) await deleteOrder(manuelaOrderId);
    await garumContext.close();
    await manuelaContext.close();
  }
});

async function loginAsStaff(
  page: import("@playwright/test").Page,
  host: string,
  email: string,
): Promise<void> {
  await page.goto(`http://${host}:3000/staff/login`);
  await page.getByLabel("Email").fill(email);
  // NOTA: el brief de la tarea usaba `STAFF_DEV_PASSWORD`, variable que no existe en
  // ningún sitio del repo (ver `scripts/seed-staff.mjs`, `tests/e2e/staff-auth.spec.ts`).
  // La variable real que `pnpm seed:staff` escribe en `.env.test` es `STAFF_SEED_PASSWORD`;
  // se corrige aquí para que el test pueda pasar de verdad en vez de fallar siempre en el login.
  await page.getByLabel("Contraseña").fill(process.env.STAFF_SEED_PASSWORD ?? "");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).toHaveURL(`http://${host}:3000/staff`, { timeout: 15_000 });
}

async function firstProductId(
  page: import("@playwright/test").Page,
  host: string,
  tableToken: string,
): Promise<string> {
  const response = await page.request.get(`http://${host}:3000/m/${tableToken}`);
  const html = await response.text();
  const match = html.match(/data-product-id="([0-9a-f-]{36})"/);
  if (!match?.[1]) throw new Error("No se encontró ningún producto en la carta");
  return match[1];
}
