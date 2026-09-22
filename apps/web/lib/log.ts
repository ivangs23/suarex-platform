/**
 * LOG ESTRUCTURADO.
 *
 * Una línea JSON por evento, a stdout/stderr. Docker las recoge y `logrotate` las corta: sin
 * proveedores nuevos y sin sacar un solo dato del servidor.
 *
 * Esa decisión (D2 del spec de la Fase 2) no es de herramientas, es legal: la política de
 * privacidad que se publica a cada comensal nombra EXACTAMENTE dos destinatarios —SuarEx y
 * Stripe— y hay un contrato de encargo con cada cliente. Meter Sentry o cualquier SaaS
 * significaría un encargado más, actualizar los tres documentos legales de todos los tenants y
 * firmar un DPA nuevo. Para diagnosticar "no imprime" no hace falta.
 *
 * LA GARANTÍA QUE SOSTIENE ESTO: ningún dato personal entra en el log. `order_items.notes` es
 * texto libre del comensal —ahí acaba "para la alérgica" o "mesa de Marta"— y los logs viven
 * fuera de los plazos de retención que la política promete (90 días / 24 meses). Un log con
 * notas dentro convierte este fichero en un tratamiento no declarado. Por eso la redacción es
 * por NOMBRE DE CLAVE y no depende de que quien llame se acuerde.
 */

export type Nivel = "error" | "warn" | "info";

/** Claves cuyo valor NUNCA se escribe. Se comparan por subcadena y sin distinguir mayúsculas,
 *  así que `userEmail`, `ACCESS_TOKEN` o `notes_es` también caen. Ampliar esta lista es
 *  barato; olvidarse de una es lo que cuesta caro. */
export const CLAVES_PROHIBIDAS = [
  "notes",
  "nota",
  "email",
  "correo",
  "password",
  "contrasena",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "phone",
  "telefono",
] as const;

const REDACTADO = "[redactado]";

function esProhibida(clave: string): boolean {
  const k = clave.toLowerCase();
  return CLAVES_PROHIBIDAS.some((prohibida) => k.includes(prohibida));
}

/**
 * Un `Error` se reduce a tipo y mensaje. El stack puede llevar rutas del servidor y, en un
 * error de Postgres, fragmentos de la consulta con valores dentro.
 *
 * RECURRE por los objetos anidados. Sin esto, la redacción solo miraba las claves de primer
 * nivel: `log.error("x", { pedido })` habría escrito las `notes` del comensal enteras. La
 * promesa del docstring de arriba es "ningún dato personal en el log", y una garantía que
 * depende de cómo el llamante estructure su objeto no es una garantía.
 *
 * `profundidad` corta a 4 niveles: más abajo casi nunca hay información útil y sí riesgo de
 * ciclos (que el try/catch de `lineaDeLog` ya cubre, pero mejor no llegar).
 */
function normalizar(valor: unknown, profundidad = 0): unknown {
  if (valor instanceof Error) return { tipo: valor.name, mensaje: valor.message };
  if (typeof valor === "function") return "[funcion]";
  if (typeof valor === "bigint") return valor.toString();
  if (valor === null || typeof valor !== "object") return valor;
  if (profundidad >= 4) return "[profundo]";

  if (Array.isArray(valor)) return valor.map((v) => normalizar(v, profundidad + 1));

  const limpio: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    limpio[clave] = esProhibida(clave) ? REDACTADO : normalizar(v, profundidad + 1);
  }
  return limpio;
}

/**
 * Compone la línea. Separada de `log` para poder probarla sin espiar la consola, y con `ts`
 * inyectable para que el test no dependa del reloj.
 */
export function lineaDeLog(
  nivel: Nivel,
  evento: string,
  datos: Record<string, unknown> = {},
  ts: string = new Date().toISOString(),
): string {
  const limpio: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(datos)) {
    limpio[clave] = esProhibida(clave) ? REDACTADO : normalizar(valor);
  }

  try {
    return JSON.stringify({ ts, level: nivel, event: evento, ...limpio });
  } catch {
    // Referencia circular u otro valor no serializable. Un logger que LANZA dentro de un
    // `catch` convierte un error ya manejado en un 500: nunca puede fallar.
    return JSON.stringify({
      ts,
      level: nivel,
      event: evento,
      _aviso: "datos no serializables, omitidos",
    });
  }
}

function emitir(nivel: Nivel, evento: string, datos?: Record<string, unknown>): void {
  const linea = lineaDeLog(nivel, evento, datos);
  // stderr para error/warn, stdout para info: así `docker logs` los separa y un `grep` sobre
  // el flujo de errores no arrastra el ruido informativo.
  if (nivel === "error") console.error(linea);
  else if (nivel === "warn") console.warn(linea);
  else console.info(linea);
}

/**
 * `evento` es un identificador estable en minúsculas y con puntos (`stripe.reembolso_sin_pedido`),
 * NO una frase. Es lo que permite agrupar y contar: una frase con un id interpolado dentro
 * genera un evento distinto por cada ocurrencia y no se puede agregar.
 */
export const log = {
  error: (evento: string, datos?: Record<string, unknown>) => emitir("error", evento, datos),
  warn: (evento: string, datos?: Record<string, unknown>) => emitir("warn", evento, datos),
  info: (evento: string, datos?: Record<string, unknown>) => emitir("info", evento, datos),
};
