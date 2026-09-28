import { defineConfig } from "vitest/config";

// Config propia, igual que `@suarex/config` y `@suarex/printing`: sin ella este paquete
// hereda el `vitest.config.ts` de la raíz, cuyo `include` apunta a `tests/integration/**` y
// deja los tests de `src/**` sin recoger ("No test files found").
export default defineConfig({
  test: {},
});
