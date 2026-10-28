import { type APIRequestContext, expect, test } from "@playwright/test";

/**
 * `/api/tls-check` es el endpoint `ask` de Caddy: decide si se pide un certificado
 * on-demand a Let's Encrypt para un host que el comodín no cubre.
 *
 * Es alcanzable desde internet y protege una cuota COMPARTIDA: si autorizara de más,
 * cualquiera podría apuntar dominios suyos a la IP y agotar el límite de emisión, dejando a
 * todos los clientes sin renovar. Por eso lo que se prueba aquí es sobre todo lo que NIEGA.
 */

/**
 * Reproduce EXACTAMENTE cómo llama Caddy: conecta por IP y manda `Host: web:3000` (el
 * nombre del servicio en la red de Docker), que no es el de ningún cliente.
 *
 * Ese Host no es un detalle. La primera versión de este fichero llamaba con
 * `garum.localhost` -- un tenant real -- y todo pasaba, mientras en el VPS el endpoint
 * devolvía 404 porque `proxy.ts` lo interceptaba antes de ejecutarse. Caddy habría recibido
 * 404 siempre y ningún cliente con dominio propio habría podido servirse por HTTPS.
 */
function ask(request: APIRequestContext, query = "") {
  return request.get(`http://127.0.0.1:3000/api/tls-check${query}`, {
    headers: { Host: "web:3000" },
  });
}

test("sin parámetro domain, deniega", async ({ request }) => {
  const res = await ask(request);
  expect(res.status()).toBe(403);
});

test("un dominio desconocido deniega", async ({ request }) => {
  const res = await ask(request, "?domain=no-es-de-nadie.ejemplo.com");
  expect(res.status()).toBe(403);
});

// Hosts de la plataforma: con comodín (`PLATFORM_TLS=cloudflare`) Caddy no pregunta por ellos;
// bajo demanda, sí. Se autorizan solo los que la plataforma sirve de verdad.
test("el subdominio de un cliente activo autoriza el certificado", async ({ request }) => {
  const res = await ask(request, "?domain=garum.localhost");
  expect(res.status()).toBe(200);
});

test("api. y admin. de la plataforma autorizan el certificado", async ({ request }) => {
  for (const host of ["api.localhost", "admin.localhost"]) {
    expect((await ask(request, `?domain=${host}`)).status(), host).toBe(200);
  }
});

test("el subdominio de un slug que no existe deniega", async ({ request }) => {
  const res = await ask(request, "?domain=no-es-de-nadie.localhost");
  expect(res.status()).toBe(403);
});

test("reservados, anidados y el dominio desnudo de la plataforma deniegan", async ({ request }) => {
  for (const host of ["studio.localhost", "www.localhost", "x.garum.localhost", "localhost"]) {
    expect((await ask(request, `?domain=${host}`)).status(), host).toBe(403);
  }
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
    const res = await ask(request, `?domain=${encodeURIComponent(valor)}`);
    expect(res.status(), `dominio ${JSON.stringify(valor)}`).toBe(403);
  }
});

test("todas las negativas son indistinguibles entre sí", async ({ request }) => {
  // Si un desconocido y un mal formado respondieran distinto, este endpoint sería un
  // oráculo para enumerar qué clientes tiene la plataforma y cuáles están suspendidos.
  const desconocido = await ask(request, "?domain=uno.ejemplo.com");
  const malFormado = await ask(request, "?domain=https://dos.ejemplo.com");

  expect(desconocido.status()).toBe(malFormado.status());
  expect(await desconocido.text()).toBe(await malFormado.text());
});

test("el dominio propio de un cliente activo SÍ autoriza el certificado", async ({ request }) => {
  // Control positivo: sin él, todas las negativas de arriba podrían estar bien por el
  // motivo equivocado (un endpoint que siempre denegara las pasaría todas).
  // `garum-demo.test` lo siembra supabase/seed.sql como custom_domain de garum.
  const res = await ask(request, "?domain=garum-demo.test");
  expect(res.status()).toBe(200);
});

test("el dominio propio se acepta sin importar mayúsculas", async ({ request }) => {
  // Caddy pregunta con el Host tal cual llegó; en la base está normalizado en minúsculas.
  const res = await ask(request, "?domain=GARUM-DEMO.test");
  expect(res.status()).toBe(200);
});

test("el www de un dominio propio activo SÍ autoriza el certificado", async ({ request }) => {
  // Sin certificado para `www.`, la redirección al dominio (`proxy.ts`) no respondería por HTTPS.
  const res = await ask(request, "?domain=www.garum-demo.test");
  expect(res.status()).toBe(200);
});

test("el www de un dominio que no es de nadie deniega", async ({ request }) => {
  const res = await ask(request, "?domain=www.no-es-de-nadie.ejemplo.com");
  expect(res.status()).toBe(403);
});
