/**
 * Lógica PURA de `scripts/flaky-e2e.mjs`: recorre el informe JSON de Playwright y devuelve los
 * tests `flaky` (fallaron y pasaron al reintentar, `retries: 2`). Sin ficheros, para probarla
 * con un informe de muestra.
 *
 * Las `suites` del informe se ANIDAN (un `describe` dentro de un fichero, otro dentro de ese):
 * mirar solo el primer nivel se dejaría fuera justo los tests de los `describe`.
 */
export function testsFlaky(informe) {
  const encontrados = [];
  const recorrer = (suite, ruta) => {
    const titulos = suite.title && suite.title !== suite.file ? [...ruta, suite.title] : ruta;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status === "flaky") {
          encontrados.push({
            ubicacion: `${spec.file}:${spec.line}`,
            titulo: [...titulos, spec.title].join(" › "),
            intentos: (test.results ?? []).length,
          });
        }
      }
    }
    for (const hija of suite.suites ?? []) recorrer(hija, titulos);
  };
  for (const suite of informe?.suites ?? []) recorrer(suite, []);
  return encontrados;
}
