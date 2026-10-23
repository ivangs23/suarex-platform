import { expect, type Page, test } from "@playwright/test";

/**
 * CAPTURAS DE LA CARTA de los clientes con aspecto propio.
 *
 * Fase 2 del plan de endurecimiento: Garum y Manuela pasan de tener un componente cada uno a ser
 * DATOS sobre el componente único. Estas capturas se tomaron con los temas antiguos ANTES de
 * borrarlos y fijan cómo tienen que seguir viéndose (ver
 * `docs/superpowers/specs/2026-10-22-temas-data-driven-design.md`).
 *
 * Dependen del seed y del sistema: las referencias se generan por plataforma (el sufijo del
 * fichero) contra una base recién reseteada. En otra máquina, la primera ejecución las crea.
 */

type Pagina = { nombre: string; ruta: string };

const CLIENTES: { slug: string; qr: string; paginas: Pagina[] }[] = [
  {
    slug: "garum",
    qr: "11111111-1111-1111-1111-111111111111",
    paginas: [
      { nombre: "bienvenida", ruta: "/1" },
      { nombre: "raiz", ruta: "/1?ver=carta" },
      { nombre: "subcategorias", ruta: "/1?cat=vinos" },
      { nombre: "platos", ruta: "/1?cat=tintos" },
    ],
  },
  {
    slug: "manuela",
    qr: "33333333-3333-3333-3333-333333333333",
    paginas: [
      { nombre: "bienvenida", ruta: "/1" },
      { nombre: "raiz", ruta: "/1?ver=carta" },
      { nombre: "platos", ruta: "/1?cat=cafes" },
    ],
  },
];

const PANTALLAS = [
  { nombre: "movil", viewport: { width: 390, height: 844 } },
  { nombre: "escritorio", viewport: { width: 1280, height: 800 } },
];

/** Entra por el QR, como un comensal: con la cookie de mesa salen los botones de pedir. */
async function sentarseEnLaMesa(page: Page, origen: string, qr: string) {
  await page.goto(`${origen}/m/${qr}`);
}

async function capturar(page: Page, url: string, nombre: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  // Las fuentes las sirve la app (next/font): sin esperarlas, la captura sale con la de reserva.
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${nombre}.png`, {
    fullPage: true,
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
  });
}

for (const cliente of CLIENTES) {
  for (const pantalla of PANTALLAS) {
    test.describe(`${cliente.slug} · ${pantalla.nombre}`, () => {
      test.use({ viewport: pantalla.viewport });

      for (const pagina of cliente.paginas) {
        test(pagina.nombre, async ({ page }) => {
          const origen = `http://${cliente.slug}.localhost:3000`;
          await sentarseEnLaMesa(page, origen, cliente.qr);
          await capturar(
            page,
            `${origen}${pagina.ruta}`,
            `${cliente.slug}-${pantalla.nombre}-${pagina.nombre}`,
          );
          // Nada más ancho que la pantalla: un scroll horizontal descoloca las capas fijas
          // (ficha, carrito, hoja de pago). Es la regla de la barra en móvil, para todos.
          const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
          expect(ancho).toBeLessThanOrEqual(pantalla.viewport.width);
        });
      }
    });
  }
}
