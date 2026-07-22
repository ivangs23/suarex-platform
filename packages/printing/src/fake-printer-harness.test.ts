import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type FakedPrinter, startFakePrinter } from "../../../tests/helpers/fake-escpos-server.js";

/**
 * Prueba el harness `startFakePrinter` en sí mismo, con un cliente TCP crudo
 * (no `node-thermal-printer`) para verificar sus tres garantías por separado:
 * captura de bytes, conteo de conexiones, y simulación de una conexión fallida.
 * Usamos un cliente crudo porque `node-thermal-printer` escribe en modo
 * "fire-and-forget" (sin esperar respuesta), así que no siempre observa un
 * `socket.destroy()` del lado servidor antes de que su propio `write()` local
 * ya se haya dado por completado — un cliente que sí escucha 'error'/'close'
 * expone el fallo de forma determinista.
 */
function connectRaw(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => resolve(socket));
    socket.on("error", reject);
  });
}

let printer: FakedPrinter;
afterEach(async () => {
  await printer?.close();
});

describe("startFakePrinter (harness)", () => {
  it("captura exactamente los bytes escritos por el cliente", async () => {
    printer = await startFakePrinter();
    const socket = await connectRaw(printer.port);
    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.from("ABC123"), (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((r) => setTimeout(r, 20));
    socket.destroy();

    expect(printer.received().equals(Buffer.from("ABC123"))).toBe(true);
  });

  it("cuenta cada conexión entrante, incluidas varias seguidas", async () => {
    printer = await startFakePrinter();
    expect(printer.connectionCount()).toBe(0);

    const first = await connectRaw(printer.port);
    first.destroy();
    await new Promise((r) => setTimeout(r, 10));
    expect(printer.connectionCount()).toBe(1);

    const second = await connectRaw(printer.port);
    second.destroy();
    await new Promise((r) => setTimeout(r, 10));
    expect(printer.connectionCount()).toBe(2);
  });

  it("failNextConnection() hace que la próxima conexión se destruya sin datos", async () => {
    printer = await startFakePrinter();
    printer.failNextConnection();

    const failedSocket = await connectRaw(printer.port);
    // `destroy()` sin motivo produce un cierre "limpio" (hadError: false) del
    // lado del cliente; lo que prueba la simulación de fallo es que el socket
    // se cierra de inmediato, sin datos ni posibilidad de intercambio, en vez
    // de comportarse como una impresora sana que permanece conectada.
    const closed = await new Promise<boolean>((resolve) => {
      failedSocket.on("error", () => {
        /* un RST también es una manifestación válida del fallo */
      });
      failedSocket.on("close", () => resolve(true));
    });
    expect(closed).toBe(true);
    expect(printer.connectionCount()).toBe(1);

    // La siguiente conexión ya no está marcada para fallar: funciona con normalidad.
    const goodSocket = await connectRaw(printer.port);
    await new Promise<void>((resolve, reject) => {
      goodSocket.write(Buffer.from("OK"), (err) => (err ? reject(err) : resolve()));
    });
    await new Promise((r) => setTimeout(r, 20));
    goodSocket.destroy();

    expect(printer.connectionCount()).toBe(2);
    expect(printer.received().equals(Buffer.from("OK"))).toBe(true);
  });
});
