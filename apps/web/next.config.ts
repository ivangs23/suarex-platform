import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@suarex/config", "@suarex/db"],
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
