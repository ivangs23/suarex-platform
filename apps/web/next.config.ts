import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Raíz del monorepo (apps/web -> ../..). `output: "standalone"` traza las dependencias
// reales y las copia a `.next/standalone`; en un workspace de pnpm hay que decirle dónde
// empieza el repo o traza solo `apps/web` y deja fuera los `packages/*` enlazados y el
// store de pnpm, produciendo una imagen que arranca y revienta en el primer import.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const config: NextConfig = {
  // next/image SIN el optimizador (`unoptimized`), a propósito. El optimizador de Next resuelve
  // la imagen fuente con un fetch HTTP a la MISMA URL de la petición -- que aquí lleva el
  // subdominio del tenant (`{slug}.dominio`) -- y ese host, para un asset LOCAL de `/public`,
  // no siempre resuelve desde el propio servidor (en local, `tenant.localhost` no resuelve para
  // el fetch de Node): el optimizador devuelve 400 y la imagen sale rota. Y las fotos de
  // catálogo YA se suben optimizadas (900px WebP, ver packages/db/src/image.js), así que
  // re-optimizarlas solo gastaría CPU en el VPS. Los assets de marca locales se optimizan en
  // ORIGEN (comprimidos en `public/brands/`). Se usa next/image igualmente por su API: reserva
  // el hueco con width/height (evita el salto de layout) y hace lazy-load solo.
  images: { unoptimized: true },
  // Servidor autocontenido para la imagen de Docker (ver deploy/Dockerfile): un
  // `server.js` con solo lo que se usa, en vez de meter todo el monorepo y sus
  // node_modules en la imagen.
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@suarex/config", "@suarex/db", "@suarex/realtime"],
  // @suarex/config y @suarex/db se consumen como fuente TypeScript sin compilar
  // (workspace:*, exports "." -> "./src/index.ts") y sus imports internos usan
  // la convención NodeNext ("./tenants.js" referenciando "./tenants.ts"). Webpack
  // resuelve esto vía extensionAlias; Turbopack todavia no tiene equivalente
  // (https://github.com/vercel/next.js/issues/82945, abierto), por eso el bundler
  // de desarrollo/build se fija a webpack en package.json.
  experimental: {
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
};

export default config;
