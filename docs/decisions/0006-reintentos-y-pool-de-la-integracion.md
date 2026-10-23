# 0006 — Integración: `retry: 2` para el entorno, contado, y pool de hilos

**Estado:** vigente · **Fecha:** 2026-10-23

## Contexto

`pnpm test:integration` (`vitest.config.ts`) golpea servicios reales: Supabase local, Realtime
(que tarda en calentar su consumidor WAL tras un `db reset`), sockets de la impresora falsa, la
RPC de reserva de impresión bajo concurrencia. Sus fallos intermitentes eran de TIMING de esos
servicios, no del comportamiento que verificaban. Y en Windows, con el pool `forks` (un proceso
por fichero, ~73 por pasada), alguno se quedaba vivo sin llegar a ejecutar nada (~0,17 s de CPU,
sin sockets) y la pasada no terminaba nunca: 4 de ~8 pasadas el 2026-10-23.

## Decisión

- **`retry: 2`.** Un test que falla se reintenta hasta dos veces. Un bug de verdad falla los tres
  intentos y sigue en rojo; el reintento distingue "el WAL no había calentado" de "el código está
  mal". Lo mismo en e2e (`retries: 2` en `playwright.config.ts`, por el cold compile de Next).
- **Se cuenta.** `tests/helpers/reintentos-reporter.ts` lista al final los que solo pasaron al
  reintentar, y `scripts/flaky-e2e.mjs` hace lo mismo con el e2e. Un test que aparece 3 veces
  en esas listas se abre como issue (README → "Verificación").
- **`pool: "threads"`.** Con hilos no se crea ningún proceso: 8 pasadas seguidas sin cuelgue, en
  el mismo tiempo (188-212 s). Solo en el config de integración: los unitarios nunca se colgaron.
- `fileParallelism: false`: los ficheros comparten la base y sus fixtures.

## Consecuencias

- Un flaky ya no pasa en silencio, pero tampoco tumba la suite: el coste es mirar la lista.
- La causa del cuelgue en Windows no está confirmada; los hilos la esquivan. Un test que necesite
  APIs de proceso (`process.chdir`) no funciona en hilos: hoy no hay ninguno.
- Descartado: subir los timeouts (no arregla un proceso que no arranca) o quitar el reintento
  (la suite fallaría por el entorno y se acabaría ignorando).
