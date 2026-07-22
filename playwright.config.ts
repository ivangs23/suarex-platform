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
  use: {
    baseURL: "http://garum.localhost:3000",
    // `*.localhost` lo resuelve el sistema a 127.0.0.1 solo, pero un DOMINIO PROPIO de
    // cliente no puede ser `.localhost`: `proxy.ts` lo tomaría por un subdominio de la
    // plataforma y lo buscaría por slug, que es justo la rama contraria a la que se quiere
    // probar. Así que el seed usa `garum-demo.test` (`.test` está reservado por el RFC 2606
    // y NUNCA resuelve en internet, de modo que ningún test puede salir por error hacia el
    // sitio real de un cliente) y aquí se le dice a Chromium que lo mande a 127.0.0.1.
    launchOptions: {
      args: ["--host-resolver-rules=MAP garum-demo.test 127.0.0.1"],
    },
  },
  webServer: {
    command: "pnpm --filter @suarex/web dev",
    url: "http://garum.localhost:3000/1",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  // Un solo dev server de Next (webpack) compartido por los 4 ficheros de esta suite,
  // no cuatro procesos independientes: por defecto (sin `fullyParallel`, el valor de
  // Playwright) esto ya deja correr los 4 ficheros a la vez, uno por worker, todos
  // contra ESE mismo servidor. Verificado empíricamente (no una suposición): con ese
  // paralelismo por defecto, la propia base de este repo -- sin ningún cambio de esta
  // tarea -- falla de forma intermitente y en un test distinto cada vez (`net::ERR_ABORTED`
  // navegando a un host distinto en `two-tenants.spec.ts`, un `staff-tenant` que no
  // llega a tiempo en `staff-auth.spec.ts`, un evento de Realtime que no llega tras
  // "marcar hecho" en `staff-board.spec.ts`...); con `workers: 1` (ejecución serie, cero
  // contención sobre el dev server/consumidor de Realtime compartidos) tres ejecuciones
  // seguidas salen limpias. No es el defecto de datos que motivó esta tarea (ese se
  // reproducía SIEMPRE en el mismo sitio, con la misma tarjeta, sin importar el
  // paralelismo) -- es contención real de un recurso compartido entre ficheros de test
  // que no tiene nada que ver entre sí, y la solución correcta es no competir por él, no
  // alargar los timeouts de las aserciones que ya son generosos.
  workers: 1,
});
