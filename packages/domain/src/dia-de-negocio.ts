/**
 * EL DÍA DEL NEGOCIO, en la zona de su sede y no en la del servidor (que en el VPS es UTC).
 *
 * El cierre y el informe de ventas preguntan "¿qué entró HOY?", y "hoy" empieza a medianoche EN
 * EL LOCAL. Un desfase fijo (`+02:00`) se equivoca medio año: el día del cambio de hora dura 23
 * o 25 horas. Aquí se calcula con el desfase real de cada instante (`Intl`), sin dependencias.
 */

/** `YYYY-MM-DD` del instante en esa zona. */
export function diaEnZona(instante: Date, zona: string): string {
  // `en-CA` formatea las fechas como `YYYY-MM-DD`.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(instante);
}

/** Hora local (0-23) del instante en esa zona. */
export function horaEnZona(instante: Date, zona: string): number {
  const hora = new Intl.DateTimeFormat("en-GB", {
    timeZone: zona,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(instante);
  return Number(hora);
}

/** Minutos que la zona va por delante de UTC en ese instante (Madrid: 60 en invierno, 120 en verano). */
function desfaseMinutos(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  const comoUtc = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour"),
    valor("minute"),
    valor("second"),
  );
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60_000);
}

/** El instante de la medianoche local de `dia` (`YYYY-MM-DD`) en esa zona. */
function medianocheEnZona(dia: string, zona: string): Date {
  const [anio, mes, diaMes] = dia.split("-").map(Number);
  const ingenua = Date.UTC(anio ?? 0, (mes ?? 1) - 1, diaMes ?? 1);
  // Dos pasadas: la primera usa el desfase de la medianoche UTC; la segunda corrige si el cambio
  // de hora cae entre esa y la local (nunca a medianoche en Europa, pero no depende de eso).
  const aprox = ingenua - desfaseMinutos(new Date(ingenua), zona) * 60_000;
  return new Date(ingenua - desfaseMinutos(new Date(aprox), zona) * 60_000);
}

/**
 * Límites `[desde, hasta)` de un día local: de su medianoche a la del día siguiente. El día del
 * cambio de hora dura 23 o 25 horas, y por eso no vale sumar 24 horas a `desde`.
 */
export function limitesDelDia(dia: string, zona: string): { desde: Date; hasta: Date } {
  const [anio, mes, diaMes] = dia.split("-").map(Number);
  const siguiente = new Date(Date.UTC(anio ?? 0, (mes ?? 1) - 1, (diaMes ?? 1) + 1))
    .toISOString()
    .slice(0, 10);
  return { desde: medianocheEnZona(dia, zona), hasta: medianocheEnZona(siguiente, zona) };
}
