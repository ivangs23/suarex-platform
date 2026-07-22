import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * `SUPABASE_URL`/`SUPABASE_ANON_KEY` se hornean en tiempo de build vía `define`, leyéndolas
 * de las envs del proceso de build (públicas por diseño; el service role NUNCA se define
 * aquí). En dev se leen de `process.env`; en el build de producción se pasan por la línea
 * de comandos / CI.
 *
 * `externalizeDepsPlugin` mantiene `electron` y `koffi` (nativo) FUERA del bundle -- se
 * cargan desde node_modules empaquetado. Los `@suarex/*` (TS del workspace) SÍ se bundlean:
 * se excluyen del externalize para que Vite los transpile en vez de tratarlos como externos.
 */
const bakedEnv = {
  "import.meta.env.SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL ?? ""),
  "import.meta.env.SUPABASE_ANON_KEY": JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ""),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@suarex/agent", "@suarex/printing"] })],
    define: bakedEnv,
    build: { rollupOptions: { external: ["koffi"] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    define: bakedEnv,
  },
});
