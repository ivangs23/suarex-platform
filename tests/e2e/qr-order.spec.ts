import { expect, test } from "@playwright/test";
import { deleteOrder, latestOrderForTenant, orderLineNotes } from "./helpers/orders-db.js";

/**
 * El total vive en el PANEL del pedido, no en una barra siempre visible: el último gesto
 * antes de pagar tiene que ocurrir con el pedido a la vista. Este ayudante lo abre, comprueba
 * y lo cierra, para no repetir esos tres pasos en cada test.
 */
async function esperaTotal(page: import("@playwright/test").Page, total: string) {
  await page.getByTestId("cart-open").click();
  await expect(page.getByTestId("cart-panel").getByTestId("cart-panel-total")).toHaveText(total);
  await page.getByTestId("cart-panel-close").click();
}

/**
 * El recorrido del comensal: escanea el QR de su mesa y pide.
 *
 * El QR impreso codifica `/m/{token}` y ahí sigue, para siempre: hay mesas con ese código ya
 * pegado. Lo que hace ahora es fijar la mesa en una cookie httpOnly y mandar a `/{mesa}`, que
 * es LA carta -- la del tema del cliente. Antes había dos: una bonita que no vendía y otra
 * que vendía sin tema ninguno.
 */
const QR_MESA_1 = "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111";
// Los vinos tintos del seed: es donde están "Ribera del Duero" (18 €) y su extra (3 €).
const TINTOS = "http://garum.localhost:3000/1?cat=tintos";

test("un token de mesa desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto(
    "http://garum.localhost:3000/m/00000000-0000-0000-0000-000000000000",
  );
  expect(response?.status()).toBe(404);
});

test("el QR de la mesa lleva a la carta del cliente, con su tema", async ({ page }) => {
  await page.goto(QR_MESA_1);

  // Redirigido a `/{mesa}`: misma mesa, y ahora con el tema a medida de garum.
  await expect(page).toHaveURL("http://garum.localhost:3000/1");
  await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "garum");
});

test("la ficha del producto declara alérgenos, opciones y total antes de añadir", async ({
  page,
}) => {
  // El comensal decide en la ficha: qué lleva, qué puede cambiar y cuánto le va a costar.
  // Enseñar el precio DESPUÉS de añadir es como esconderlo.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  await tarjeta.getByTestId("open-product-sheet").click();

  const ficha = page.getByTestId("product-sheet");
  await expect(ficha).toBeVisible();
  await expect(ficha.getByTestId("sheet-total")).toHaveText("18,00 €");

  // La extra se elige AQUÍ y su precio se ve al momento, no al llegar a la cuenta.
  await ficha.getByTestId("extra-checkbox").first().click();
  await expect(ficha.getByTestId("sheet-total")).toHaveText("21,00 €");

  // Dos unidades: el total de la ficha las multiplica.
  await ficha.getByTestId("sheet-more").click();
  await expect(ficha.getByTestId("sheet-units")).toHaveText("2");
  await expect(ficha.getByTestId("sheet-total")).toHaveText("42,00 €");

  await ficha.getByTestId("sheet-add").click();
  await expect(ficha).toHaveCount(0);
  await esperaTotal(page, "42,00 €");
});

test("la ficha dice lo que sabe de los alérgenos, sin afirmar de más", async ({ page }) => {
  // La carta no puede afirmar "no contiene": solo puede decir qué declaró el gestor, y
  // remitir al personal ante una alergia grave.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  await page
    .getByTestId("product")
    .filter({ hasText: "Ribera del Duero" })
    .getByTestId("open-product-sheet")
    .click();

  const ficha = page.getByTestId("product-sheet");
  // El seed no declara alérgenos en este producto.
  await expect(ficha.getByTestId("sheet-allergens-empty")).toBeVisible();
  await expect(ficha).toContainText(/alergia severa/i);
});

test("una nota de la ficha llega a la comanda", async ({ page }) => {
  // La nota solo sirve si acaba en la comanda que sale por la impresora de cocina. Comprobar
  // que se escribe en el recuadro no prueba nada: este test la sigue hasta la base.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  await page
    .getByTestId("product")
    .filter({ hasText: "Ribera del Duero" })
    .getByTestId("open-product-sheet")
    .click();

  const ficha = page.getByTestId("product-sheet");
  await ficha.getByTestId("sheet-notes").fill("Sin hielo, por favor");
  await ficha.getByTestId("sheet-add").click();

  await page.getByTestId("cart-open").click();
  await page.getByTestId("cart-panel").getByTestId("cart-pay").click();

  // El pedido existe (pending) en cuanto se pulsa Pagar: `createPendingOrder` escribe las
  // líneas ANTES del cobro. Desde que el cobro ocurre en el panel, "Pagar" abre el formulario
  // de tarjeta en vez de redirigir, así que el pedido se localiza por ser el último del
  // cliente, no por un token en la URL. Esperar a que aparezca el paso de pago confirma que
  // la escritura ya resolvió.
  await expect(page.getByTestId("payment-step")).toBeVisible({ timeout: 30_000 });

  const { orderId } = await latestOrderForTenant("garum");
  try {
    expect(await orderLineNotes(orderId)).toEqual(["Sin hielo, por favor"]);
  } finally {
    await deleteOrder(orderId);
  }
});

test("el panel del pedido enseña cada línea como se pidió, y deja corregirla", async ({ page }) => {
  // Pagar sin poder revisar qué llevas es donde se llama al camarero. El panel tiene que
  // enseñar lo que DISTINGUE una línea de otra del mismo plato: sus extras y su nota.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  await tarjeta.getByTestId("open-product-sheet").click();
  const ficha = page.getByTestId("product-sheet");
  await ficha.getByTestId("extra-checkbox").click();
  await ficha.getByTestId("sheet-notes").fill("Poco frío");
  await ficha.getByTestId("sheet-add").click();

  await page.getByTestId("cart-open").click();
  const panel = page.getByTestId("cart-panel");
  const linea = panel.getByTestId("cart-line");

  await expect(linea).toHaveCount(1);
  await expect(linea).toContainText("Ribera del Duero");
  await expect(linea.getByTestId("cart-line-extras")).toContainText("Copa extra");
  await expect(linea.getByTestId("cart-line-notes")).toContainText("Poco frío");
  await expect(panel.getByTestId("cart-panel-total")).toHaveText("21,00 €");

  // Se corrige desde aquí, sin volver a la carta.
  await linea.getByTestId("cart-line-more").click();
  await expect(linea.getByTestId("cart-line-units")).toHaveText("2");
  await expect(panel.getByTestId("cart-panel-total")).toHaveText("42,00 €");

  // Y a cero la línea desaparece: el panel se queda vacío y lo dice.
  await linea.getByTestId("cart-line-less").click();
  await linea.getByTestId("cart-line-less").click();
  await expect(panel.getByTestId("cart-empty")).toBeVisible();
});

test("dos veces EXACTAMENTE lo mismo se agrupan en una línea", async ({ page }) => {
  // La otra mitad de la regla: en la comanda de cocina son el mismo plato, y separarlas solo
  // alargaría el ticket con dos entradas idénticas que el camarero tiene que leer dos veces.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  for (let i = 0; i < 2; i++) {
    await tarjeta.getByTestId("open-product-sheet").click();
    await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
  }

  await page.getByTestId("cart-open").click();
  const panel = page.getByTestId("cart-panel");
  await expect(panel.getByTestId("cart-line")).toHaveCount(1);
  await expect(panel.getByTestId("cart-line-units")).toHaveText("2");
  await expect(panel.getByTestId("cart-panel-total")).toHaveText("36,00 €");
});

test("el mismo plato pedido de dos formas son dos líneas distintas", async ({ page }) => {
  // Un café con avena y otro sin nada no son el mismo pedido: si se agruparan, una de las
  // dos elecciones se perdería por el camino y llegaría mal a la barra.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });

  await tarjeta.getByTestId("open-product-sheet").click();
  await page.getByTestId("product-sheet").getByTestId("extra-checkbox").click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();

  await tarjeta.getByTestId("open-product-sheet").click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();

  await page.getByTestId("cart-open").click();
  await expect(page.getByTestId("cart-panel").getByTestId("cart-line")).toHaveCount(2);
  await expect(page.getByTestId("cart-panel").getByTestId("cart-panel-total")).toHaveText(
    "39,00 €",
  );
});

test("la tarjeta NO lleva contador: cada vez que se pide es una línea propia", async ({ page }) => {
  // El mismo croissant puede ir una vez con york y otra sin nada. Un "2" en la tarjeta no
  // diría cuál de las dos formas está sumando, y el menos no sabría a cuál quitarle: las
  // cantidades se ajustan en el panel, donde cada línea existe por separado.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  await tarjeta.getByTestId("open-product-sheet").click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();

  await expect(tarjeta.getByTestId("cart-units")).toHaveCount(0);
  await expect(tarjeta.getByTestId("remove-from-cart")).toHaveCount(0);
  // Y el botón sigue diciendo lo mismo: se puede volver a pedir, de otra forma.
  await expect(tarjeta.getByTestId("open-product-sheet")).toHaveText(/Añadir/);
});

test("quitar una línea del pedido se lleva también sus extras", async ({ page }) => {
  // Si las extras sobrevivieran a sacarla, volver a añadir el plato traería de vuelta una
  // elección que el comensal ya había deshecho -- y la cobraría.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  await tarjeta.getByTestId("open-product-sheet").click();
  const ficha = page.getByTestId("product-sheet");
  await ficha.getByTestId("extra-checkbox").click();
  await ficha.getByTestId("sheet-add").click();
  await esperaTotal(page, "21,00 €");

  // Se quita desde el panel, que es donde vive la línea.
  await page.getByTestId("cart-open").click();
  const panel = page.getByTestId("cart-panel");
  await panel.getByTestId("cart-line-less").click();
  await expect(panel.getByTestId("cart-empty")).toBeVisible();
  await panel.getByTestId("cart-panel-close").click();

  // Volver a pedirlo sin personalizar vuelve al precio base.
  await tarjeta.getByTestId("open-product-sheet").click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
  await esperaTotal(page, "18,00 €");
});

test("volver a explorar categorías no echa a la pantalla de bienvenida", async ({ page }) => {
  // La raíz pelada ES la bienvenida: si el enlace de vuelta apuntara ahí, subir un nivel
  // sacaría al comensal de la carta y le obligaría a entrar otra vez.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  await page.getByRole("link", { name: /explorar otras categorías/i }).click();

  await expect(page.getByTestId("welcome-enter")).toHaveCount(0);
  await expect(page.getByTestId("category").filter({ hasText: "Vinos" })).toBeVisible();
});

test("el total sobrevive a cambiar de categoría", async ({ page }) => {
  // Un pedido real cae en categorías distintas: si el carrito se vaciara al navegar, no se
  // podría pedir un vino y una tosta en la misma comanda.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);
  await page.getByTestId("open-product-sheet").first().click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
  await esperaTotal(page, "18,00 €");

  await page.goto("http://garum.localhost:3000/1?cat=blancos");
  await esperaTotal(page, "18,00 €");
});

test("sin escanear el QR, la carta se consulta pero no se pide", async ({ page }) => {
  // La cookie del QR es lo único que demuestra que quien pide está sentado en esa mesa. Sin
  // ella, cualquiera podría mandar comandas a una mesa ajena sabiendo solo su número.
  await page.goto(TINTOS);

  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();
  await expect(page.getByTestId("open-product-sheet")).toHaveCount(0);
});

test("la cookie de una mesa no sirve para pedir desde otra", async ({ page }) => {
  // Control positivo del control negativo de arriba: se ESCANEA de verdad, y aun así la
  // mesa 5 no deja pedir porque lo escaneado fue la 1.
  await page.goto(QR_MESA_1);
  await page.goto("http://garum.localhost:3000/5?cat=tintos");

  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();
  await expect(page.getByTestId("open-product-sheet")).toHaveCount(0);
});

test("la carta de un tenant no muestra productos de otro", async ({ page }) => {
  await page.goto(TINTOS);
  await expect(page.getByText("Tosta de jamón")).toHaveCount(0);
});
