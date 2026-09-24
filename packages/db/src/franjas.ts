/**
 * FRANJAS HORARIAS DE CARTA.
 *
 * Un local con dos servicios quiere que a las 13:00 no se vean los desayunos y que a las 10:00
 * no se pueda pedir la carta de cena. La franja se guarda en la CATEGORÍA (`visible_desde` /
 * `visible_hasta`, ver `20260924000002_franjas_horarias.sql`) porque es como piensa un hostelero:
 * "la carta de mediodía", no "este plato de 13 a 16".
 *
 * Todo lo que decide vive aquí y es puro. El filtro no se puede hacer en PostgREST -- una franja
 * que cruza medianoche no es un `between` -- y hacerlo en el repositorio dejaría las horas
 * frontera sin forma de probarlas salvo esperando a que den las 20:00.
 */

/** Minutos desde medianoche de `"HH:MM"` o `"HH:MM:SS"` (PostgREST devuelve `time` con segundos). */
function aMinutos(hora: string): number {
  const [h = "0", m = "0"] = hora.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Minutos desde medianoche EN LA ZONA DE LA SEDE, no en la del servidor. El mismo motivo por el
 * que `marcar_agotado_hoy` calcula con `venues.timezone` en SQL: un local en Canarias vería
 * aparecer la carta de cena una hora antes de lo que cree, y el servidor puede estar en UTC.
 */
export function minutosEnZona(ahora: Date, timezone: string): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(ahora);
  const valor = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  // `% 24`: con `hour12: false` algunas versiones de ICU devuelven "24" para medianoche.
  return (valor("hour") % 24) * 60 + valor("minute");
}

/**
 * ¿Toca esta categoría ahora mismo? `null` en las dos horas = siempre (el caso de casi todas).
 *
 * Intervalo semiabierto `[desde, hasta)`: una carta que abre a las 08:00 se ve A las 08:00, y a
 * las 12:00 en punto ya no -- ahí empieza la siguiente, y las dos visibles a la vez es peor que
 * ninguna.
 */
export function categoriaVisibleAhora(
  desde: string | null,
  hasta: string | null,
  minutosAhora: number,
): boolean {
  if (desde == null || hasta == null) return true;

  const ini = aMinutos(desde);
  const fin = aMinutos(hasta);

  // Franja que CRUZA MEDIANOCHE (cena de 20:00 a 02:00): `ini <= ahora < fin` sería falso a la
  // 01:00, y la carta de cena desaparecería en mitad del servicio.
  if (ini > fin) return minutosAhora >= ini || minutosAhora < fin;

  return minutosAhora >= ini && minutosAhora < fin;
}

type ConFranja = {
  id: string;
  parentId: string | null;
  visibleDesde: string | null;
  visibleHasta: string | null;
};

/**
 * Aplica las franjas a un ÁRBOL de categorías: una hija dentro de un padre fuera de hora se
 * oculta también, aunque ella no tenga franja propia. Si no, ocultar "Cenas" dejaría "Cenas >
 * Postres" colgando en la carta de mediodía, accesible y sin contexto.
 *
 * La herencia es transitiva (nieta dentro de hija dentro de padre oculto) y tolera un `parentId`
 * que no esté en la lista: se trata como raíz en vez de desaparecer, porque una categoría
 * huérfana visible es un defecto cosmético y una carta vacía es una venta perdida.
 */
export function filtrarPorFranja<T extends ConFranja>(categorias: T[], minutosAhora: number): T[] {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const decidido = new Map<string, boolean>();

  const visible = (cat: T): boolean => {
    const cacheada = decidido.get(cat.id);
    if (cacheada !== undefined) return cacheada;
    // Se marca antes de recorrer el padre: un ciclo en los datos (que la FK no impide) colgaría
    // el render de la carta, y eso es peor que pintar una categoría de más.
    decidido.set(cat.id, true);

    const propia = categoriaVisibleAhora(cat.visibleDesde, cat.visibleHasta, minutosAhora);
    const padre = cat.parentId ? porId.get(cat.parentId) : undefined;
    const resultado = propia && (padre ? visible(padre) : true);

    decidido.set(cat.id, resultado);
    return resultado;
  };

  return categorias.filter(visible);
}
