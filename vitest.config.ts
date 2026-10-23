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
    // Hilos y no procesos: con `forks` (un proceso por fichero, ~73 por pasada), en Windows
    // alguno se quedaba colgado al arrancar sin llegar a ejecutar nada y la pasada no acababa
    // nunca (4 de ~8 el 2026-10-23). Con hilos no se crea ningún proceso.
    pool: "threads",
    /**
     * Reintenta un test que falla, hasta 2 veces más.
     *
     * Estos tests golpean una base y servicios reales -- Realtime (que tarda en calentar su
     * consumidor WAL tras un `db reset`), sockets de la impresora falsa, la RPC de reserva de
     * impresión bajo concurrencia. Sus fallos intermitentes son de TIMING de esos servicios,
     * no del comportamiento que verifican; sus propios comentarios ya lo dicen. Un reintento
     * los absorbe. Un bug de verdad no: falla los tres intentos y sigue en rojo. No esconde
     * regresiones -- distingue "el WAL no había calentado" de "el código está mal".
     */
    retry: 2,
    // ...y cuenta cuáles lo necesitaron, para que un flaky no pase en silencio.
    reporters: ["default", "./tests/helpers/reintentos-reporter.ts"],
  },
});
