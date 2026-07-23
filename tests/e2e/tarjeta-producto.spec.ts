import { expect, test } from "@playwright/test";

/**
 * LA FOTO NO PUEDE TAPAR EL BOTÓN DE PEDIR.
 *
 * Pasó de verdad: la foto se colocaba en una rejilla de fila automática con `max-height:
 * 100%`, el porcentaje se resolvía contra la fila, la fila crecía hasta la altura natural de
 * la imagen y el tope acababa valiendo la propia altura de la foto -- es decir, no limitaba
 * nada. Con las fotos VERTICALES del cliente, la imagen salía a 246 px sobre una franja de
 * 144 y se comía el nombre y el botón de añadir.
 *
 * `toBeVisible()` NO lo habría cazado: para Playwright un botón tapado por otra caja sigue
 * siendo visible. Por eso aquí se comprueba geometría -- que la foto cabe en su marco -- y
 * quién recibe de verdad el toque en el centro del botón.
 *
 * La foto se inyecta como data-URI vertical en vez de depender del catálogo: el seed no trae
 * fotos, y una regresión que solo aparece con las imágenes de un cliente concreto no puede
 * quedar cubierta solo cuando ese cliente está importado.
 */

// 100 × 400: la proporción que rompía el marco. Un PNG mínimo generado al vuelo.
const FOTO_VERTICAL =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="400"><rect width="100" height="400" fill="#654321"/></svg>',
  ).toString("base64");

const CARTAS = [
  {
    nombre: "garum",
    qr: "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111",
    hoja: "http://garum.localhost:3000/1?cat=tintos",
  },
  {
    nombre: "manuela",
    qr: "http://manuela.localhost:3000/m/33333333-3333-3333-3333-333333333333",
    hoja: "http://manuela.localhost:3000/1?cat=tostas",
  },
];

for (const carta of CARTAS) {
  test(`${carta.nombre}: una foto vertical no desborda su marco ni tapa el botón`, async ({
    page,
  }) => {
    await page.goto(carta.qr);
    await page.goto(carta.hoja);

    const tarjeta = page.getByTestId("product").first();
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.getByTestId("open-product-sheet")).toBeVisible();

    // Se le pone una foto vertical a la primera tarjeta, tenga o no una en el catálogo.
    const medidas = await tarjeta.evaluate(async (li, src) => {
      let img = li.querySelector("img");
      if (!img) {
        // Un tema puede no pintar <img> cuando el producto no tiene foto: se crea una en el
        // mismo sitio donde iría, para medir el marco de verdad.
        img = document.createElement("img");
        li.firstElementChild?.prepend(img);
      }
      const original = img;
      await new Promise<void>((listo) => {
        original.onload = () => listo();
        original.onerror = () => listo();
        original.src = src as string;
      });

      const boton = li.querySelector('[data-testid="open-product-sheet"]');
      const b = boton?.getBoundingClientRect();
      const encima =
        b && b.width > 0 ? document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) : null;

      const marco = (original.parentElement as HTMLElement).getBoundingClientRect();
      const foto = original.getBoundingClientRect();

      return {
        desborda: foto.height > marco.height + 1 || foto.bottom > marco.bottom + 1,
        // Quién recibe el toque donde el comensal va a tocar.
        recibeElToque: encima?.closest('[data-testid="open-product-sheet"]') !== null,
      };
    }, FOTO_VERTICAL);

    expect(medidas.desborda).toBe(false);
    expect(medidas.recibeElToque).toBe(true);
  });
}
