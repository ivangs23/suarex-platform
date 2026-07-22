import net from "node:net";

export type FakedPrinter = {
  port: number;
  received: () => Buffer;
  connectionCount: () => number;
  failNextConnection: () => void;
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

  const server = net.createServer((socket) => {
    connections += 1;
    if (failOnce) {
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
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
