import type { UsbRawSink } from "@suarex/printing";

/**
 * Frontera inyectable sobre winspool: la LÓGICA del sink (abrir → escribir todo → cerrar,
 * y tratar un write parcial como fallo) se prueba headless con un binding falso; la
 * implementación REAL (`loadWinspoolBinding`, koffi) solo se carga y ejerce en Windows.
 */
export type WinspoolBinding = {
  openPrinter(printerName: string): unknown;
  writeRawDoc(handle: unknown, docName: string, buffer: Buffer): number;
  closePrinter(handle: unknown): void;
};

const DOC_NAME = "SuarEx ticket";

/** Compone un `UsbRawSink` a partir de un binding. Cierra SIEMPRE (finally) si se llegó a
 * abrir; un write parcial (menos bytes de los pedidos) es un fallo. */
export function makeUsbSink(binding: WinspoolBinding): UsbRawSink {
  return async (buffer: Buffer, printerName: string): Promise<void> => {
    const handle = binding.openPrinter(printerName); // lanza si no se pudo abrir
    try {
      const written = binding.writeRawDoc(handle, DOC_NAME, buffer);
      if (written !== buffer.length) {
        throw new Error(
          `impresión USB incompleta: se escribieron ${written} de ${buffer.length} bytes`,
        );
      }
    } finally {
      binding.closePrinter(handle);
    }
  };
}

/**
 * Binding REAL con koffi contra `winspool.drv`. SOLO se invoca en Windows (Task 5 lo llama
 * tras comprobar `process.platform === "win32"`). Se importa koffi de forma perezosa y
 * dinámica dentro de la función para que este módulo se pueda importar y typecheckear en
 * macOS/Linux sin cargar el binario nativo. La secuencia RAW es OpenPrinterW →
 * StartDocPrinterW(datatype "RAW") → StartPagePrinter → WritePrinter → EndPagePrinter →
 * EndDocPrinter → ClosePrinter.
 *
 * NOTA sobre `import()` dinámico en vez de `require`: este workspace es ESM puro
 * (`"type": "module"` + `verbatimModuleSyntax`), así que un `require` global no existe en
 * runtime salvo que se cree con `node:module#createRequire` -- usarlo tal cual fallaría en
 * Windows igual que aquí. `import()` dinámico sí es válido en ESM y sigue siendo perezoso
 * (no se evalúa hasta llamar a `loadWinspoolBinding`), así que esta función es async; quien
 * la consuma (Task 5: `printers.ts`, `agent-runner.ts`) debe hacer `await loadWinspoolBinding()`.
 *
 * NOTA DE VALIDACIÓN: esta es la parte más incierta de la fase; la firma exacta de las
 * funciones koffi (out-params, structs) puede necesitar ajuste en el PC Windows real. El
 * botón "Imprimir ticket de prueba" (Task 6) la ejercita de forma aislada.
 */
export async function loadWinspoolBinding(): Promise<WinspoolBinding> {
  const koffi = (await import("koffi")).default;
  const winspool = koffi.load("winspool.drv");

  const DOC_INFO_1W = koffi.struct("DOC_INFO_1W", {
    pDocName: "str16",
    pOutputFile: "str16",
    pDatatype: "str16",
  });

  const OpenPrinterW = winspool.func(
    "int __stdcall OpenPrinterW(str16 pPrinterName, _Out_ void **phPrinter, void *pDefault)",
  );
  const StartDocPrinterW = winspool.func(
    "uint32 __stdcall StartDocPrinterW(void *hPrinter, uint32 Level, DOC_INFO_1W *pDocInfo)",
  );
  const StartPagePrinter = winspool.func("int __stdcall StartPagePrinter(void *hPrinter)");
  const WritePrinter = winspool.func(
    "int __stdcall WritePrinter(void *hPrinter, void *pBuf, uint32 cbBuf, _Out_ uint32 *pcWritten)",
  );
  const EndPagePrinter = winspool.func("int __stdcall EndPagePrinter(void *hPrinter)");
  const EndDocPrinter = winspool.func("int __stdcall EndDocPrinter(void *hPrinter)");
  const ClosePrinter = winspool.func("int __stdcall ClosePrinter(void *hPrinter)");

  return {
    openPrinter(printerName: string): unknown {
      const out: unknown[] = [null];
      const ok = OpenPrinterW(printerName, out, null);
      if (!ok || !out[0]) throw new Error(`no se pudo abrir la impresora "${printerName}"`);
      return out[0];
    },
    writeRawDoc(handle: unknown, docName: string, buffer: Buffer): number {
      const docInfo = koffi.as(
        { pDocName: docName, pOutputFile: null, pDatatype: "RAW" },
        DOC_INFO_1W,
      );
      const job = StartDocPrinterW(handle, 1, docInfo);
      if (job === 0) throw new Error("StartDocPrinter falló");
      if (!StartPagePrinter(handle)) throw new Error("StartPagePrinter falló");
      const written: number[] = [0];
      const ok = WritePrinter(handle, buffer, buffer.length, written);
      EndPagePrinter(handle);
      EndDocPrinter(handle);
      if (!ok) throw new Error("WritePrinter falló");
      return written[0] ?? 0;
    },
    closePrinter(handle: unknown): void {
      ClosePrinter(handle);
    },
  };
}
