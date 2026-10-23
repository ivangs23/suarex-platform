/**
 * Lista los tests e2e que pasaron SOLO al reintentar en la última pasada de `pnpm test:e2e`
 * (lee `test-results/e2e.json`, que escribe el reporter `json` de `playwright.config.ts`).
 *
 *   node scripts/flaky-e2e.mjs
 *
 * `retries: 2` es para el entorno (cold compile de Next, Realtime frío), no para bugs: un test
 * que sale aquí una y otra vez es un bug con tapadera. Ver README → "Verificación".
 */
import { readFileSync } from "node:fs";
import { testsFlaky } from "./lib/flaky-e2e.mjs";

const RUTA = process.argv[2] ?? "test-results/e2e.json";

let informe;
try {
  informe = JSON.parse(readFileSync(RUTA, "utf8"));
} catch (e) {
  console.error(`No se pudo leer ${RUTA} (${e.message}). Corre antes \`pnpm test:e2e\`.`);
  process.exit(1);
}

const flaky = testsFlaky(informe);
if (flaky.length === 0) {
  console.log("Ningún test e2e necesitó reintento.");
} else {
  console.log(`${flaky.length} tests e2e necesitaron reintento:`);
  for (const t of flaky) console.log(`  - ${t.ubicacion} › ${t.titulo} (${t.intentos} intentos)`);
}
