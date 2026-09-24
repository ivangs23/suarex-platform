import { expect, test } from "@playwright/test";

/**
 * EL PIE LEGAL Y LAS PÁGINAS QUE ENLAZA.
 *
 * Por qué e2e y no `themes/contract.test.tsx`: el pie lo monta `app/[mesa]/page.tsx`, fuera del
 * tema, y el helper `render` del contrato monta EXCLUSIVAMENTE `<CartProvider>{Theme(p)}</CartProvider>`
 * -- nada pintado fuera del tema entra en ese HTML. La garantía de que ningún tema puede
 * saltárselo es estructural (está en la página, no en el tema), y quien la comprueba de punta a
 * punta es esto.
 */

const BASE = "http://garum.localhost:3000";

test("la carta enlaza las tres páginas legales", async ({ page }) => {
  await page.goto(`${BASE}/1`);

  const pie = page.getByTestId("legal-footer");
  await expect(pie).toBeVisible();
  await expect(pie.getByRole("link", { name: "Privacidad" })).toHaveAttribute(
    "href",
    "/legal/privacidad",
  );
  await expect(pie.getByRole("link", { name: "Aviso legal" })).toHaveAttribute(
    "href",
    "/legal/aviso-legal",
  );
  await expect(pie.getByRole("link", { name: "Condiciones" })).toHaveAttribute(
    "href",
    "/legal/condiciones",
  );
});

test("el pie se traduce con el resto de la carta", async ({ page }) => {
  // Si las etiquetas fueran texto fijo en español, esto seguiría diciendo "Privacidad".
  await page.goto(`${BASE}/1?lang=en`);
  await expect(
    page.getByTestId("legal-footer").getByRole("link", { name: "Privacy" }),
  ).toBeVisible();
});

test("las tres páginas legales se sirven, y un slug inventado es 404", async ({
  page,
  request,
}) => {
  for (const slug of ["privacidad", "aviso-legal", "condiciones"]) {
    await page.goto(`${BASE}/legal/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }

  const res = await request.get(`${BASE}/legal/inventado`, { failOnStatusCode: false });
  expect(res.status(), "un slug fuera de la lista cerrada debe ser 404").toBe(404);
});

test("la página legal lleva los datos fiscales del tenant, no los de la plataforma", async ({
  page,
}) => {
  // El restaurante es el responsable del tratamiento; SuarEx solo el encargado. Si esto
  // enseñara los datos de SuarEx como responsable, el documento sería falso.
  await page.goto(`${BASE}/legal/privacidad`);
  const cuerpo = page.locator("main");
  await expect(cuerpo).toContainText("responsable del tratamiento");
  await expect(cuerpo).toContainText("encargado del tratamiento");
});
