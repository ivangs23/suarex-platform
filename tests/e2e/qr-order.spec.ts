import { expect, test } from "@playwright/test";
import { deleteOrder, findOrderByPublicToken, orderLineNotes } from "./helpers/orders-db.js";

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
  await expect(page.getByTestId("cart-total")).toHaveText("42,00 €");
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
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");

  await page.getByTestId("cart-open").click();
  await page.getByTestId("cart-panel").getByTestId("cart-pay").click();
  // `commit`: basta con que la navegación arranque, que es cuando la URL ya trae el token.
  // Esperar al `load` metía en el reloj la creación del PaymentIntent en Stripe y, en dev, la
  // primera compilación de `/pedido/[publicToken]` -- dos esperas que no son de este test y
  // que lo hacían fallar en la suite completa aunque pasara aislado cinco veces seguidas.
  await page.waitForURL(/\/pedido\//, { waitUntil: "commit", timeout: 30_000 });

  const publicToken = new URL(page.url()).pathname.split("/").pop() as string;
  const { orderId } = await findOrderByPublicToken(publicToken);
  // El pedido es real a partir de aquí: se borra pase lo que pase con la aserción.
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

test("desde la tarjeta se quitan unidades, y a cero el producto sale del carrito", async ({
  page,
}) => {
  // Sin el menos, un plato añadido de más obligaba a llamar al camarero: la barra del total
  // solo sumaba.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  await tarjeta.getByTestId("open-product-sheet").click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
  await tarjeta.getByTestId("add-to-cart").click();
  await expect(tarjeta.getByTestId("cart-units")).toHaveText("2");
  await expect(page.getByTestId("cart-total")).toHaveText("36,00 €");

  await tarjeta.getByTestId("remove-from-cart").click();
  await expect(tarjeta.getByTestId("cart-units")).toHaveText("1");
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");

  // A cero desaparece el contador y la barra entera: el carrito vuelve a estar vacío.
  await tarjeta.getByTestId("remove-from-cart").click();
  await expect(tarjeta.getByTestId("cart-units")).toHaveCount(0);
  await expect(page.getByTestId("cart-bar")).toHaveCount(0);
});

test("quitar un producto olvida también sus extras", async ({ page }) => {
  // Si las extras sobrevivieran a sacarlo del carrito, volver a añadirlo traería de vuelta
  // una elección que el comensal ya había deshecho -- y la cobraría.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  await tarjeta.getByTestId("open-product-sheet").click();
  const ficha = page.getByTestId("product-sheet");
  await ficha.getByTestId("extra-checkbox").click();
  await ficha.getByTestId("sheet-add").click();
  await expect(page.getByTestId("cart-total")).toHaveText("21,00 €");

  // Quitarlo se lleva la línea entera, con su extra: volver a añadirlo sin personalizar
  // vuelve al precio base y no arrastra una elección ya deshecha.
  await tarjeta.getByTestId("remove-from-cart").click();
  await tarjeta.getByTestId("open-product-sheet").click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");
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
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");

  await page.goto("http://garum.localhost:3000/1?cat=blancos");
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");
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
