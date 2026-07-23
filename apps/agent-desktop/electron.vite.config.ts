import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`PLATFORM_WEB_ORIGIN` se hornean en tiempo de build vía
 * `define`, leyéndolas de las envs del proceso de build (todas públicas por diseño; el
 * service role NUNCA se define aquí). En dev se leen de `process.env`; en el build de
 * producción se pasan por la línea de comandos / CI.
 *
 * `SUPABASE_URL` y `PLATFORM_WEB_ORIGIN` son orígenes DISTINTOS: el primero es el host de la
 * API de Supabase (`https://<proj>.supabase.co`), usado por `runAgent`; el segundo es el
 * origin de la web Next.js de la plataforma (p. ej. `https://garum.suarex.app`), de donde
 * cuelga `/api/devices/pair`. Ver `baked-config.ts` para el detalle.
 *
 * `externalizeDepsPlugin` mantiene `electron` y `koffi` (nativo) FUERA del bundle -- se
 * cargan desde node_modules empaquetado. Los `@suarex/*` (TS del workspace) SÍ se bundlean:
 * se excluyen del externalize para que Vite los transpile en vez de tratarlos como externos.
 */
const bakedEnv = {
  "import.meta.env.SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL ?? ""),
  "import.meta.env.SUPABASE_ANON_KEY": JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ""),
  "import.meta.env.PLATFORM_WEB_ORIGIN": JSON.stringify(process.env.PLATFORM_WEB_ORIGIN ?? ""),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@suarex/agent", "@suarex/printing"] })],
    define: bakedEnv,
    build: { rollupOptions: { external: ["koffi"] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // El preload DEBE emitirse como `index.js`, que es la ruta que pasa `main/index.ts` a
    // `webPreferences.preload`. Con el paquete marcado `"type": "module"`, electron-vite
    // lo emitía como `index.mjs`: Electron no encontraba el fichero, NO avisaba de nada, y
    // la ventana se quedaba sin `window.agent` -- con la interfaz aparentemente bien pero
    // sin ningún botón operativo. Un fallo silencioso que solo se ve al usar la app.
    build: {
      rollupOptions: {
        output: { entryFileNames: "[name].js", format: "cjs" },
      },
    },
  },
  renderer: {
    define: bakedEnv,
  },
});
