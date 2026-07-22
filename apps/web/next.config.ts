import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Raíz del monorepo (apps/web -> ../..). `output: "standalone"` traza las dependencias
// reales y las copia a `.next/standalone`; en un workspace de pnpm hay que decirle dónde
// empieza el repo o traza solo `apps/web` y deja fuera los `packages/*` enlazados y el
// store de pnpm, produciendo una imagen que arranca y revienta en el primer import.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const config: NextConfig = {
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
