import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `scripts/**` va aquí y no en un paquete propio porque los scripts viven en la raíz
    // del repo, fuera del workspace: `turbo test` recorre paquetes y nunca los vería.
    // Son puros (no tocan la base), así que comparten ejecución sin coste.
    include: ["tests/integration/**/*.test.ts", "scripts/**/*.test.mjs"],
    setupFiles: ["dotenv/config"],
    env: { DOTENV_CONFIG_PATH: ".env.test" },
    testTimeout: 30_000,
    fileParallelism: false,
    // Pool de hilos (con `forks`, en Windows, la pasada se colgaba), `retry: 2` para los fallos
    // de timing del ENTORNO (un bug de verdad falla los tres intentos) y un reporter que cuenta
    // los reintentos. Ver docs/decisions/0006-reintentos-y-pool-de-la-integracion.md.
    pool: "threads",
    retry: 2,
    reporters: ["default", "./tests/helpers/reintentos-reporter.ts"],
  },
});
