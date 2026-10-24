import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Las decisiones de este fichero (webpack, `standalone` con la raíz del monorepo, imágenes sin
// optimizador y el tope del cuerpo) están razonadas en docs/decisions/0004-build-de-la-web.md.

// Tope del cuerpo de Server Actions y proxy: una foto de móvil hasta `MAX_BYTES_IMAGEN`
// (`@suarex/domain`, 15MB) más la cabecera del multipart. Lo cubre el e2e de la foto.
const TOPE_CUERPO = "16mb";

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
    // Por defecto 1MB y 10MB; el del proxy además TRUNCA en silencio en vez de fallar.
    serverActions: { bodySizeLimit: TOPE_CUERPO },
    proxyClientMaxBodySize: TOPE_CUERPO,
  },
};

export default config;
