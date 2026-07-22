import net from "node:net";

export type FakedPrinter = {
  port: number;
  received: () => Buffer;
  connectionCount: () => number;
  failNextConnection: () => void;
  failAllConnections: () => void;
  recoverConnections: () => void;
  close: () => Promise<void>;
};

/**
 * Impresora ESC/POS de mentira: un socket TCP que acepta la conexión del
 * adaptador y guarda todo lo que recibe. Permite afirmar QUÉ bytes se
 * imprimieron, CUÁNTAS veces se conectó el adaptador (para detectar duplicados),
 * y simular un fallo de conexión (para probar reintentos y recuperación).
 */
export function startFakePrinter(): Promise<FakedPrinter> {
  const chunks: Buffer[] = [];
  let connections = 0;
  let failOnce = false;
  let failAlways = false;

  const server = net.createServer((socket) => {
    connections += 1;
    if (failAlways || failOnce) {
      failOnce = false;
      socket.destroy();
      return;
    }
    socket.on("data", (d: Buffer) => chunks.push(d));
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        reject(new Error("No se pudo obtener el puerto"));
        return;
      }
      resolve({
        port: address.port,
        received: () => Buffer.concat(chunks),
        connectionCount: () => connections,
        failNextConnection: () => {
          failOnce = true;
        },
        failAllConnections: () => {
          failAlways = true;
        },
        // Añadido al componer el flujo de extremo a extremo (tests/integration/print-flow.test.ts):
        // simular "la impresora estaba caída y ahora ha vuelto" necesita apagar
        // `failAllConnections()` antes de la segunda pasada, y no había forma de hacerlo.
        // `failNextConnection()` sola no sirve para ese escenario: `printToPrinter`
        // reintenta hasta 3 veces con un socket fresco cada vez (ver
        // `packages/printing/src/print-order.ts`), así que un único fallo puntual lo
        // absorbe el propio reintento y nunca llega a manifestarse como `ok:false` de
        // cara al llamante (confirmado en `escpos-tcp.test.ts`: por eso ESE test usa
        // `failAllConnections()`, no `failNextConnection()`, para el caso "todas las
        // conexiones se tiran"). Para que una impresora "vuelva" tras un fallo genuino
        // (las 3 conexiones tiradas) hace falta poder desactivar `failAlways`.
        recoverConnections: () => {
          failAlways = false;
        },
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
