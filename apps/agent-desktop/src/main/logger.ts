export type LogLevel = "info" | "warn" | "error";

/**
 * Destino de escritura del log. Inyectable a propósito (mismo patrón que `ConfigBackend`): en
 * producción escribe a un fichero rotativo en `userData` (`real-log-backend.ts`), en las
 * pruebas es un fake en memoria. Así este módulo queda puro y testeable sin tocar `fs` ni
 * Electron.
 */
export type LogSink = {
  append(line: string): void;
  /** Todo el log disponible (fichero activo + rotado), para volcarlo en el diagnóstico. */
  read(): string;
};

export type Logger = {
  info(msg: string): void;
  warn(msg: string): void;
  /** El segundo argumento, si viene, se serializa (stack de `Error` incluido) tras el mensaje. */
  error(msg: string, err?: unknown): void;
};

/** Línea determinista: `<iso> [nivel] mensaje`. `nowIso` se inyecta para no depender del reloj. */
export function formatLine(nowIso: string, level: LogLevel, msg: string): string {
  return `${nowIso} [${level}] ${msg}`;
}

/** Serializa cualquier cosa lanzada: el stack de un `Error` (que es lo que sirve para depurar),
 * o una representación razonable de lo que sea. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function createLogger(sink: LogSink, nowIso: () => string): Logger {
  const write = (level: LogLevel, msg: string): void => {
    sink.append(formatLine(nowIso(), level, msg));
  };
  return {
    info: (msg) => write("info", msg),
    warn: (msg) => write("warn", msg),
    error: (msg, err) => write("error", err === undefined ? msg : `${msg} ${describeError(err)}`),
  };
}
