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
  },
});
