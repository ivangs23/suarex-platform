import { type APIRequestContext, expect, test } from "@playwright/test";

/**
 * `www.<dominio propio>` redirige al dominio (`proxy.ts`). Un cliente guarda UN dominio
 * (`garumvinoteca.com`); sin esto, quien escribe `www.garumvinoteca.com` acabaría en un 404.
 *
 * Se llama por IP con el Host del cliente, como llega a través de Caddy. `garum-demo.test` es
 * el dominio propio que `supabase/seed.sql` le da a garum.
 */
const get = (request: APIRequestContext, host: string, ruta: string) =>
  request.get(`http://127.0.0.1:3000${ruta}`, { headers: { Host: host }, maxRedirects: 0 });

test("www del dominio propio redirige al dominio, con la ruta y la query", async ({ request }) => {
  const res = await get(request, "www.garum-demo.test:3000", "/5?cat=vinos");
  // 308 y no 301: conserva el método, y un POST a `www.` no se convertiría en GET.
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe("https://garum-demo.test/5?cat=vinos");
});

test("el www de un dominio que no es de nadie sigue siendo 404, no una redirección", async ({
  request,
}) => {
  const res = await get(request, "www.no-es-de-nadie.ejemplo.com", "/1");
  expect(res.status()).toBe(404);
  expect(res.headers().location).toBeUndefined();
});

test("el dominio propio sin www no se redirige", async ({ request }) => {
  const res = await get(request, "garum-demo.test:3000", "/5");
  expect(res.status()).toBe(200);
});
