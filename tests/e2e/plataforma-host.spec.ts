import { expect, test } from "@playwright/test";

/**
 * LA FRONTERA DEL HOST DE PLATAFORMA, EN LAS DOS DIRECCIONES.
 *
 * La consola de plataforma es la única superficie que ve a TODOS los clientes a la vez. Dos
 * garantías independientes la acotan, y las dos se comprueban aquí porque una sola no basta:
 *
 *   1. `/plataforma` NUNCA se sirve bajo el host de un cliente. Sin esto,
 *      `garum.localhost/plataforma` llegaría a la página con un tenant ya resuelto y la única
 *      defensa sería el guard de rol -- una sola barrera.
 *   2. Bajo el host de plataforma NO se sirve nada del producto: ni carta, ni panel, ni
 *      tablero de personal.
 */

const TENANT = "http://garum.localhost:3000";
const PLATAFORMA = "http://admin.localhost:3000";

test("la consola no existe bajo el host de un cliente", async ({ request }) => {
  for (const ruta of ["/plataforma", "/plataforma/", "/plataforma/login", "/plataforma/x/y"]) {
    const res = await request.get(`${TENANT}${ruta}`, { failOnStatusCode: false });
    expect(res.status(), `${ruta} bajo un host de tenant`).toBe(404);
  }
});

test("bajo el host de plataforma no se sirve nada del producto", async ({ request }) => {
  for (const ruta of ["/1", "/staff", "/staff/login", "/admin", "/legal/privacidad"]) {
    const res = await request.get(`${PLATAFORMA}${ruta}`, { failOnStatusCode: false });
    expect(res.status(), `${ruta} bajo el host de plataforma`).toBe(404);
  }
});

test("el host de plataforma SÍ está atendido: el cron llega, no cae en not-found", async ({
  request,
}) => {
  // Esta es la que distingue "host de plataforma atendido" de "host desconocido": las dos
  // darían 404 en las rutas de arriba. `/api/internal/*` se permite por este host a
  // propósito -- es donde debe apuntar el cron, porque un tenant suspendido devolvería 503 y
  // mataría el barrido para todos los demás. Sin credencial responde 401 o 503, nunca 404.
  const res = await request.post(`${PLATAFORMA}/api/internal/suspend-overdue`, {
    failOnStatusCode: false,
  });
  expect([401, 503]).toContain(res.status());
  expect(res.status(), "un 404 significaría que el host de plataforma no se atiende").not.toBe(404);
});

test("un host desconocido sigue siendo 404, no se cuela por parecerse a la consola", async ({
  request,
}) => {
  // `notadmin.localhost` y `admin.garum.localhost` no son el host de plataforma: la
  // comparación de `isPlatformHost` es exacta, no por prefijo.
  for (const host of ["http://notadmin.localhost:3000", "http://admin.garum.localhost:3000"]) {
    const res = await request.post(`${host}/api/internal/suspend-overdue`, {
      failOnStatusCode: false,
    });
    expect(res.status(), `${host} no puede comportarse como la consola`).toBe(404);
  }
});
