import { expect, test } from "@playwright/test";

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

test("sin sesión, /staff redirige al acceso", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/staff");
  await expect(page).toHaveURL(/\/staff\/login/);
});

test("un pedido pagado aparece en el panel", async ({ page }) => {
  await loginAsStaff(page, "garum.localhost", "staff@garum.local");

  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByTestId("order-card")).toHaveCount(0);

  // El pedido se crea por la API pública, como lo haría un comensal real.
  const productId = await firstProductId(page, "garum.localhost", GARUM_TABLE_TOKEN);
  const response = await page.request.post("http://garum.localhost:3000/api/orders", {
    data: {
      tableToken: GARUM_TABLE_TOKEN,
      lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
    },
  });
  expect(response.ok()).toBeTruthy();

  // Llega solo, sin recargar: eso es lo que prueba Realtime.
  await expect(page.getByTestId("order-card")).toHaveCount(1, { timeout: REALTIME_WAIT_MS });

  // Limpieza + cobertura de "marcar hecho": el producto de garum (Ribera del Duero) es
  // de categoría "vinos", destino barra, así que cocina queda "na" y barra "pending".
  // Marcarla hecha resuelve la única estación pendiente -> el pedido pasa a `served` (ver
  // markStationDone) y desaparece de listActiveOrders. Sin esto, el pedido creado por
  // este test quedaría `pending` para siempre y rompería el `toHaveCount(0)` de arriba en
  // la siguiente ejecución de esta misma suite (nada más en el stack local lo limpia).
  await markFirstCardDone(page);
  await expect(page.getByTestId("order-card")).toHaveCount(0, { timeout: REALTIME_WAIT_MS });
});

/**
 * Aislamiento del tablero, con CONTROL POSITIVO en ambas direcciones -- sin esto el test
 * no probaría nada (ver el brief de esta tarea: dos componentes de este proyecto ya
 * produjeron aislamiento "verde" vacío al filtrar por una foreign key que hacía
 * imposible que una fila fugada llegara a renderizarse). La secuencia importa: se
 * comprueba la ausencia de fuga INMEDIATAMENTE después de crear el pedido de garum, antes
 * de crear el de manuela, y de nuevo al revés -- así una fuga en cualquiera de las dos
 * direcciones se detecta en el paso que la produce, no se diluye en el conteo final.
 *
 * `OrdersBoard` (`apps/web/app/staff/OrdersBoard.tsx`) no vuelve a filtrar por tenant del
 * lado del cliente -- pinta exactamente lo que `listActiveOrders(session.tenantId)`
 * devuelve -- así que este test SÍ depende enteramente del `.eq("tenant_id", tenantId)`
 * de `tenantScoped` en `packages/db/src/staff-orders.ts`; no hay ningún filtro de
 * componente que pueda enmascarar una fuga real. Verificado en el self-review quitando
 * ese filtro a mano y viendo fallar este mismo test (ver el informe de la tarea).
 */
test("el personal de un tenant no ve los pedidos del otro (con control positivo)", async ({
  browser,
}) => {
  const garumContext = await browser.newContext();
  const manuelaContext = await browser.newContext();

  try {
    const garumPage = await garumContext.newPage();
    const manuelaPage = await manuelaContext.newPage();

    await loginAsStaff(garumPage, "garum.localhost", "staff@garum.local");
    await loginAsStaff(manuelaPage, "manuela.localhost", "staff@manuela.local");

    await expect(garumPage.getByTestId("order-card")).toHaveCount(0);
    await expect(manuelaPage.getByTestId("order-card")).toHaveCount(0);

    // 1. Pedido de garum. Control positivo (garum lo ve) Y aislamiento (manuela sigue en
    // 0, no ha visto nada que no le pertenece) en el mismo paso.
    const garumProductId = await firstProductId(garumPage, "garum.localhost", GARUM_TABLE_TOKEN);
    const garumOrder = await garumPage.request.post("http://garum.localhost:3000/api/orders", {
      data: {
        tableToken: GARUM_TABLE_TOKEN,
        lines: [{ productId: garumProductId, quantity: 1, extraIds: [], notes: null }],
      },
    });
    expect(garumOrder.ok()).toBeTruthy();

    await expect(garumPage.getByTestId("order-card")).toHaveCount(1, { timeout: REALTIME_WAIT_MS });
    await expect(manuelaPage.getByTestId("order-card")).toHaveCount(0);

    // 2. Pedido de manuela. Control positivo (manuela lo ve) Y aislamiento (garum se
    // queda en 1, NO en 2 -- si viera 2, el pedido de manuela se habría fugado a garum).
    const manuelaProductId = await firstProductId(
      manuelaPage,
      "manuela.localhost",
      MANUELA_TABLE_TOKEN,
    );
    const manuelaOrder = await manuelaPage.request.post(
      "http://manuela.localhost:3000/api/orders",
      {
        data: {
          tableToken: MANUELA_TABLE_TOKEN,
          lines: [{ productId: manuelaProductId, quantity: 1, extraIds: [], notes: null }],
        },
      },
    );
    expect(manuelaOrder.ok()).toBeTruthy();

    await expect(manuelaPage.getByTestId("order-card")).toHaveCount(1, {
      timeout: REALTIME_WAIT_MS,
    });
    await expect(garumPage.getByTestId("order-card")).toHaveCount(1);

    // Limpieza: mismo motivo que en el test anterior -- sin esto, estos dos pedidos
    // quedarían `pending` para siempre y romperían el `toHaveCount(0)` inicial de
    // cualquier test posterior que comparta este stack local.
    await markFirstCardDone(garumPage);
    await markFirstCardDone(manuelaPage);
    await expect(garumPage.getByTestId("order-card")).toHaveCount(0, { timeout: REALTIME_WAIT_MS });
    await expect(manuelaPage.getByTestId("order-card")).toHaveCount(0, {
      timeout: REALTIME_WAIT_MS,
    });
  } finally {
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

async function markFirstCardDone(page: import("@playwright/test").Page): Promise<void> {
  await page
    .getByTestId("order-card")
    .first()
    .getByRole("button", { name: /marcar hecho/i })
    .click();
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
