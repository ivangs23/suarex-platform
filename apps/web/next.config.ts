import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Las tres decisiones de este fichero (webpack, `standalone` con la raíz del monorepo e imágenes
// sin optimizador) están razonadas en docs/decisions/0004-build-de-la-web.md.

// Raíz del monorepo: sin ella, `standalone` deja fuera los `packages/*` y el store de pnpm.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const config: NextConfig = {
  // El optimizador pide la imagen a la URL del tenant, que no siempre resuelve desde el servidor.
  images: { unoptimized: true },
  // Servidor autocontenido para la imagen de Docker (ver deploy/Dockerfile).
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@suarex/config", "@suarex/db", "@suarex/realtime"],
  // Imports NodeNext (`./x.js` -> `./x.ts`) de los paquetes sin compilar: solo webpack.
  experimental: {
    extensionAlias: { ".js": [".ts", ".tsx", ".js"] },
  },
};

export default config;
