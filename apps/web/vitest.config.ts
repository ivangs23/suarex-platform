import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {},
  /* El tsconfig de Next usa `jsx: "preserve"` (lo transforma el compilador de Next, no
     TypeScript), y el transformador de Vite lo respeta: sin esto, un test que importe un
     `.tsx` falla con "the content contains invalid JS syntax". Se fija aquí y no en el
     tsconfig porque el de Next necesita seguir en "preserve" para compilar la app.

     Lo que habilita: `themes/contract.test.tsx`, que renderiza TODOS los temas y comprueba
     que ninguno se salta un paso del flujo. Sin poder renderizar temas, esa garantía solo
     existiría en e2e, y en e2e solo se cubren los temas que algún tenant del seed usa -- el
     genérico no lo usa ninguno. */
  // Vite 8 transforma con oxc, no con esbuild: la opción equivalente vive bajo `oxc`.
  oxc: { jsx: { runtime: "automatic" } },
});
