import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

// Mismo `.env.test` que ya carga Vitest (`vitest.config.ts`, generado por
// `pnpm db:env` y completado con `STAFF_SEED_PASSWORD` por `pnpm seed:staff`)
// -- no un segundo mecanismo de configuración. `dotenv.config` no pisa una
// variable ya presente en el entorno, así que exportar `STAFF_SEED_PASSWORD`
// a mano (p. ej. para usar una contraseña propia) sigue funcionando igual
// que antes; esto solo añade el valor por defecto que ya quedó en el fichero.
// Playwright forkea sus workers heredando `process.env` de este proceso
// (ver `runner/index.js`, `fork(..., { env: { ...process.env, ... } })`), así
// que fijarlo aquí, antes de `defineConfig`, basta para que los tests lo vean.
dotenv.config({ path: ".env.test" });

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://garum.localhost:3000" },
  webServer: {
    command: "pnpm --filter @suarex/web dev",
    url: "http://garum.localhost:3000/1",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
