import { describe, expect, it } from "vitest";
import { startFakePrinter } from "../../../tests/helpers/fake-escpos-server.js";
import { probeTcp } from "./probe-tcp.js";

describe("probeTcp", () => {
  it("ok cuando algo acepta la conexión en ese host:puerto", async () => {
    const printer = await startFakePrinter();
    try {
      const r = await probeTcp("127.0.0.1", printer.port);
      expect(r.ok).toBe(true);
      expect(r.reason).toBeUndefined();
    } finally {
      await printer.close();
    }
  });

  it("falla cuando no hay nada escuchando (conexión rechazada)", async () => {
    // Arranca y CIERRA para tener un puerto que estuvo en uso y ahora está libre -> rechazo
    // determinista, sin adivinar un número de puerto.
    const printer = await startFakePrinter();
    const port = printer.port;
    await printer.close();

    const r = await probeTcp("127.0.0.1", port, 1000);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});
