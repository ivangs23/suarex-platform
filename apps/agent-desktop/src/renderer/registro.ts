/** Una entrada del registro, lista para pintar. */
export type Entrada = {
  /** `null` en una línea que no trae fecha (lo que se escribió fuera del logger). */
  cuando: Date | null;
  nivel: "info" | "aviso" | "error";
  mensaje: string;
  /** Las líneas de una traza de error, que el fichero guarda debajo de su mensaje. */
  detalle: string[];
};

export type Filtro = "todo" | "avisos" | "errores";

const LINEA = /^(\d{4}-\d{2}-\d{2}T\S+) \[(\w+)\] (.*)$/;

function nivelDe(texto: string): Entrada["nivel"] {
  if (texto === "error") return "error";
  if (texto === "warn") return "aviso";
  return "info";
}

/**
 * Las líneas de `read-log` (de la más reciente a la más antigua) agrupadas en entradas: una traza
 * de error ocupa varias líneas en el fichero y se pega a su mensaje. Como llegan al revés, las
 * líneas de la traza aparecen ANTES que la suya.
 */
export function entradasDelRegistro(lineas: string[]): Entrada[] {
  const entradas: Entrada[] = [];
  let pendientes: string[] = [];
  for (const linea of lineas) {
    const m = LINEA.exec(linea);
    if (!m) {
      pendientes.unshift(linea);
      continue;
    }
    const [, iso, nivel, mensaje] = m as unknown as [string, string, string, string];
    const cuando = new Date(iso);
    entradas.push({
      cuando: Number.isNaN(cuando.getTime()) ? null : cuando,
      nivel: nivelDe(nivel),
      mensaje,
      detalle: pendientes,
    });
    pendientes = [];
  }
  if (pendientes.length > 0) {
    entradas.push({ cuando: null, nivel: "info", mensaje: pendientes.join(" "), detalle: [] });
  }
  return entradas;
}

export function filtrar(entradas: Entrada[], filtro: Filtro): Entrada[] {
  if (filtro === "errores") return entradas.filter((e) => e.nivel === "error");
  if (filtro === "avisos") return entradas.filter((e) => e.nivel !== "info");
  return entradas;
}
