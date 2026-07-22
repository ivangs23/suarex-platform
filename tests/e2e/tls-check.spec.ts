import { expect, test } from "@playwright/test";

/**
 * `/api/tls-check` es el endpoint `ask` de Caddy: decide si se pide un certificado
 * on-demand a Let's Encrypt para un host que el comodín no cubre.
 *
 * Es alcanzable desde internet y protege una cuota COMPARTIDA: si autorizara de más,
 * cualquiera podría apuntar dominios suyos a la IP y agotar el límite de emisión, dejando a
 * todos los clientes sin renovar. Por eso lo que se prueba aquí es sobre todo lo que NIEGA.
 */
const ASK = "http://garum.localhost:3000/api/tls-check";

test("sin parámetro domain, deniega", async ({ request }) => {
  const res = await request.get(ASK);
  expect(res.status()).toBe(403);
});

test("un dominio desconocido deniega", async ({ request }) => {
  const res = await request.get(`${ASK}?domain=no-es-de-nadie.ejemplo.com`);
  expect(res.status()).toBe(403);
});

test("un host bajo el dominio de la plataforma deniega (lo cubre el comodín)", async ({
  request,
}) => {
  const res = await request.get(`${ASK}?domain=garum.localhost`);
  expect(res.status()).toBe(403);
});

test("un valor mal formado deniega y nunca da 500", async ({ request }) => {
  // Un 500 aquí sería un canal de distinción: separaría "formato raro" de "desconocido".
  for (const valor of [
    "https://ejemplo.com",
    "ejemplo.com/carta",
    "localhost",
    "192.168.1.10",
    "-mal.com",
    "",
  ]) {
    const res = await request.get(`${ASK}?domain=${encodeURIComponent(valor)}`);
    expect(res.status(), `dominio ${JSON.stringify(valor)}`).toBe(403);
  }
});

test("todas las negativas son indistinguibles entre sí", async ({ request }) => {
  // Si un desconocido y un suspendido respondieran distinto, este endpoint sería un
  // oráculo para enumerar qué clientes tiene la plataforma y cuáles están suspendidos.
  const desconocido = await request.get(`${ASK}?domain=uno.ejemplo.com`);
  const malFormado = await request.get(`${ASK}?domain=https://dos.ejemplo.com`);

  expect(desconocido.status()).toBe(malFormado.status());
  expect(await desconocido.text()).toBe(await malFormado.text());
});

test("el dominio propio de un cliente activo SÍ autoriza el certificado", async ({ request }) => {
  // Control positivo: sin él, todas las negativas de arriba podrían estar bien por el
  // motivo equivocado (un endpoint que siempre deniega las pasaría todas).
  // `garum-demo.test` lo siembra supabase/seed.sql como custom_domain de garum.
  const res = await request.get(`${ASK}?domain=garum-demo.test`);
  expect(res.status()).toBe(200);
});

test("el dominio propio se acepta sin importar mayúsculas", async ({ request }) => {
  // Caddy pregunta con el Host tal cual llegó; en la base está normalizado en minúsculas.
  const res = await request.get(`${ASK}?domain=GARUM-DEMO.test`);
  expect(res.status()).toBe(200);
});
