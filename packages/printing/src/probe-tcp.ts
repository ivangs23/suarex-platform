import net from "node:net";

export type ProbeResult = { ok: boolean; reason?: string };

const DEFAULT_PROBE_TIMEOUT_MS = 3000;

/**
 * Sonda de conexión TCP a una impresora de red: intenta CONECTAR (sin escribir ni imprimir nada)
 * y cierra. `ok` si la conexión se estableció; si no, `reason` con el motivo (rechazada, host
 * inalcanzable, timeout).
 *
 * A diferencia del camino de ENTREGA (`printToPrinter`, que a propósito NO pre-sondea porque el
 * puerto 9100 acepta una sola conexión a la vez y un ping competiría con la impresión real), esto
 * es un diagnóstico MANUAL: lo dispara el owner desde el desktop cuando NO se está imprimiendo,
 * así que sondear aquí no le quita el turno a ninguna comanda. No certifica que la impresora
 * imprima (ESC/POS crudo no da acuse), solo que acepta la conexión -- suficiente para distinguir
 * "apagada / IP mal / cable fuera" de "responde".
 */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result: ProbeResult): void => {
      if (done) return;
      done = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on("timeout", () =>
      finish({ ok: false, reason: "tiempo de espera agotado al conectar" }),
    );
    socket.on("error", (err) => finish({ ok: false, reason: err.message }));
    socket.connect(port, host, () => finish({ ok: true }));
  });
}
