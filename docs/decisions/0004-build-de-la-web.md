# 0004 — Build de la web: webpack, `standalone` con la raíz del monorepo, imágenes sin optimizador, tope del cuerpo

**Estado:** vigente · **Fecha:** 2026-10-23 (tope del cuerpo: 2026-10-24)

## Contexto

`apps/web` consume `@suarex/config`, `@suarex/db` y `@suarex/realtime` como TypeScript sin
compilar (`exports "." -> "./src/index.ts"`), con imports NodeNext (`./tenants.js` apuntando a
`./tenants.ts`). Se despliega como imagen de Docker en un VPS con 1 vCPU para la web, y sirve
cada tenant por su subdominio (`{slug}.dominio`).

## Decisión (`apps/web/next.config.ts`)

- **webpack, no Turbopack** (fijado en `package.json`). `experimental.extensionAlias` resuelve
  `.js` → `.ts`; Turbopack no tiene equivalente (vercel/next.js#82945, abierto).
- **`output: "standalone"` con `outputFileTracingRoot` en la raíz del monorepo.** Sin la raíz,
  el trazado se queda en `apps/web` y deja fuera los `packages/*` enlazados y el store de pnpm:
  la imagen arranca y revienta en el primer import.
- **`images: { unoptimized: true }`.** El optimizador de Next pide la imagen fuente con un fetch
  a la MISMA URL de la petición, que lleva el subdominio del tenant, y ese host no siempre
  resuelve desde el propio servidor (en local, `tenant.localhost` no resuelve para el fetch de
  Node): devuelve 400 y la imagen sale rota. Las fotos de catálogo ya se suben optimizadas
  (900 px WebP, `packages/db/src/image.js`) y los assets de marca se comprimen en origen
  (`public/brands/`): re-optimizar solo gastaría CPU del VPS.
- **`serverActions.bodySizeLimit` y `proxyClientMaxBodySize` a 16MB.** Las fotos se suben por
  Server Actions (`FormData`). Por defecto Next corta su cuerpo en 1MB y el proxy en 10MB, así
  que los 15MB de `MAX_BYTES_IMAGEN` (`@suarex/domain`, pensados para fotos de móvil) eran
  papel mojado. El del proxy, además, no falla: trunca el cuerpo, y sharp recibe un PNG roto.
  16MB son los 15 de la foto más el margen del multipart.

## Consecuencias

- Se sigue usando `next/image` por su API: reserva el hueco con `width`/`height` (sin salto de
  layout) y hace lazy-load.
- Pasar a Turbopack exige antes que soporte `extensionAlias` o compilar los paquetes.
- Una foto subida sin pasar por `image.js` se sirve tal cual, sin redimensionar.
- El tope es global: cualquier Server Action, y cualquier POST que pase por el proxy, admite
  16MB. Next lee el cuerpo antes de que la acción compruebe la sesión, así que también un
  anónimo. Antes eran 10MB para el proxy, sin tope en Caddy fuera de `/api/*`.
- Subir `MAX_BYTES_IMAGEN` obliga a subir este tope; bajarlo, a mirar el e2e de la foto grande
  (`admin-catalogo-editar.spec.ts`), que sube ~14,5MB.
