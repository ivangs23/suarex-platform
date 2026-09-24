/**
 * LOG A FICHERO DEL AGENTE.
 *
 * Este proceso corre desatendido y OCULTO en la bandeja del PC de una cocina, meses seguidos.
 * Hasta ahora todo iba a `console`, que en una app empaquetada no lo ve nadie: cuando algo
 * fallaba, la única información disponible era "no imprime".
 *
 * Tres decisiones, todas por el mismo motivo -- que el log sea algo que se pueda MANDAR a
 * soporte y que nunca estorbe a la impresión:
 *
 * - **Nunca lanza.** Disco lleno, permisos, un antivirus con el fichero abierto. Perder el log
 *   es malo; dejar de imprimir porque no se pudo escribir es peor.
 * - **Rota a dos generaciones.** Sin tope, el fichero crece hasta llenar el único disco que hay
 *   en ese PC. Con dos generaciones siempre queda el tramo anterior al fallo, que es justo el
 *   que interesa.
 * - **Redacta antes de escribir.** Si el fichero puede llevar un secreto dentro, no se puede
 *   mandar por correo -- y entonces no sirve para nada.
 */

export type LogBackend = {
  /** Bytes del log actual. 0 si todavía no existe. */
  size(): number;
  append(linea: string): void;
  /** El actual pasa a ser el anterior; el anterior anterior se pierde. */
  rotate(): void;
  /** Anterior + actual, en orden cronológico, para el diagnóstico exportable. */
  read(): string;
};

export type NivelLog = "info" | "warn" | "error";

/** Medio mega. Suficiente para varios días de actividad normal en una cocina. */
export const TAMANO_MAXIMO = 512 * 1024;

/**
 * Nombres de clave cuyo VALOR no debe acabar en el fichero, con el mismo criterio que
 * `apps/web/lib/log.ts`: se filtra por nombre y no por contenido, porque acertar con la forma
 * de un secreto es imposible y equivocarse es silencioso.
 */
const CLAVES_PROHIBIDAS = [
  "password",
  "contrasena",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "key",
];

const CLAVE_VALOR = new RegExp(
  // `"password": "x"`, `password=x`, `apikey: 'x'` -- las tres formas en las que esto aparece
  // de verdad, ya sea en un JSON volcado o en una query string de un mensaje de error.
  `("?)\\b(${CLAVES_PROHIBIDAS.join("|")})\\1\\s*[:=]\\s*("[^"]*"|'[^']*'|[^\\s,}&]+)`,
  "gi",
);

// Un JWT suelto dentro de un mensaje de error de Supabase no viene con su nombre de clave
// delante, así que el filtro por nombre no lo pilla. Su forma sí es inconfundible.
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function redactar(texto: string): string {
  return texto.replace(JWT, "[oculto]").replace(CLAVE_VALOR, (_m, comilla, clave) => {
    const nombre = comilla ? `"${clave}"` : clave;
    return `${nombre}: "[oculto]"`;
  });
}

/** Escribe una línea, rotando antes si toca. No lanza nunca. */
export function registrarLinea(
  backend: LogBackend,
  nivel: NivelLog,
  mensaje: string,
  ahora: Date,
): void {
  try {
    if (backend.size() > TAMANO_MAXIMO) backend.rotate();
    backend.append(`${ahora.toISOString()} ${nivel.toUpperCase()} ${redactar(mensaje)}\n`);
  } catch {
    // A propósito en silencio: avisar del fallo del log por `console` llamaría al log otra vez.
  }
}

/**
 * Desvía `console.log`/`warn`/`error` también al fichero, conservando la salida original.
 *
 * Se INTERCEPTA en vez de reescribir los sitios que hoy loguean. Cambiarlos uno a uno dejaría
 * el problema resuelto solo para las trazas de hoy: la siguiente que alguien añada volvería a
 * perderse, y nadie se acuerda de una regla así seis meses después. Interceptando, cualquier
 * traza nueva -- también las de `packages/agent`, que corre en este mismo proceso -- acaba en
 * el fichero sin que haya que recordar nada.
 *
 * Devuelve la función para deshacerlo (los tests la usan; en producción no se desinstala).
 */
export function instalarLogDeFichero(
  backend: LogBackend,
  ahora: () => Date = () => new Date(),
): () => void {
  const originales = { log: console.log, warn: console.warn, error: console.error };

  const envolver = (nivel: NivelLog, original: (...args: unknown[]) => void) => {
    return (...args: unknown[]): void => {
      original(...args);
      registrarLinea(backend, nivel, args.map(aTexto).join(" "), ahora());
    };
  };

  console.log = envolver("info", originales.log);
  console.warn = envolver("warn", originales.warn);
  console.error = envolver("error", originales.error);

  return () => {
    console.log = originales.log;
    console.warn = originales.warn;
    console.error = originales.error;
  };
}

/** Un argumento de `console` como texto. De un Error se queda el mensaje y la traza. */
function aTexto(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (valor instanceof Error) return `${valor.name}: ${valor.message}\n${valor.stack ?? ""}`;
  try {
    return JSON.stringify(valor);
  } catch {
    // Referencias cíclicas: un objeto ilegible no debe hacer desaparecer la línea entera.
    return String(valor);
  }
}
