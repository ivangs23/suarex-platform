// Fixture DELIBERADAMENTE roto. Nunca debe compilar. Existe como prueba, ejecutable por
// máquina, de que las dos garantías estructurales de packages/db (ver ../client.ts) son
// errores reales de TypeScript, no una convención que un review pueda pasar por alto.
//
// Excluido del proyecto normal por `packages/db/tsconfig.json` (`exclude`), así que NO
// forma parte de `pnpm typecheck`. Se compila aparte, a propósito, contra
// `tsconfig.fixture.json` (mismas opciones estrictas que el resto del paquete, via
// `extends`) desde `tests/integration/tenant-filter-structural.test.ts`, que además
// verifica que el error observado sea EXACTAMENTE el esperado (código + símbolo), no
// solo "algo falló".

// 1) `serviceClient` no se exporta desde client.ts: este import debe fallar con TS2459
//    ("declares 'serviceClient' locally, but it is not exported") -- confirmado
//    empíricamente contra este mismo fixture, ver el test que lo invoca.
import { serviceClient } from "../client.js";

// 2) `tenantScoped` exige tenantId como segundo argumento obligatorio: omitirlo debe
//    fallar con TS2554 ("Expected 2 arguments, but got 1").
import { tenantScoped } from "../client.js";

serviceClient();
tenantScoped("categories");
