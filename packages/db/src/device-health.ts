import { devicesTableForHealthSweep } from "./client.js";

export type DispositivoCaido = {
  deviceId: string;
  nombre: string;
  tenantSlug: string;
  /** Última vez que latió, o null si se emparejó y no arrancó nunca. */
  ultimoLatido: string | null;
};

export type ResultadoSalud = {
  caidos: DispositivoCaido[];
  recuperados: DispositivoCaido[];
};

type FilaDispositivo = {
  id: string;
  name: string;
  last_seen_at: string | null;
  offline_alerted_at: string | null;
  tenants: { slug: string } | null;
};

function aDispositivo(f: FilaDispositivo): DispositivoCaido {
  return {
    deviceId: f.id,
    nombre: f.name,
    tenantSlug: f.tenants?.slug ?? "(desconocido)",
    ultimoLatido: f.last_seen_at,
  };
}

/**
 * BARRIDO DE SALUD DE DISPOSITIVOS.
 *
 * `device_heartbeat` escribe `last_seen_at` en cada tick del agente, pero nadie lo leía: un PC
 * apagado se descubría cuando la cocina se quedaba sin comandas.
 *
 * Devuelve SOLO LAS TRANSICIONES -- los que acaban de caer y los que acaban de volver -- no el
 * estado completo. Un aviso cada 5 minutos durante una caída de dos horas son 24 correos, y
 * después de eso el aviso de la caída siguiente tampoco lo lee nadie. Es el mismo criterio que
 * ya usa el agente de escritorio con las impresoras y el chequeo de uptime.
 *
 * Solo mira dispositivos EMPAREJADOS: uno sin emparejar nunca ha estado vivo, y avisar de que
 * "no late" sería avisar de que todavía no se ha instalado en el local.
 */
export async function sweepDeviceHealth(minutos = 10): Promise<ResultadoSalud> {
  if (!Number.isFinite(minutos) || minutos < 1) {
    // Falla cerrado: un 0 por descuido en el cron marcaría como caídos a TODOS los
    // dispositivos vivos y mandaría un aviso por cada cliente de la plataforma.
    throw new Error(`El umbral debe ser de al menos 1 minuto (recibido: ${minutos})`);
  }
  const limite = new Date(Date.now() - minutos * 60_000).toISOString();
  const ahora = new Date().toISOString();

  const { data, error } = await devicesTableForHealthSweep()
    .select("id, name, last_seen_at, offline_alerted_at, paired_at, tenants(slug)")
    .not("paired_at", "is", null);
  if (error) throw error;

  const filas = (data ?? []) as unknown as FilaDispositivo[];
  const caidos: DispositivoCaido[] = [];
  const recuperados: DispositivoCaido[] = [];

  for (const fila of filas) {
    // Sin latido desde el emparejamiento cuenta como caído: se instaló y no arrancó nunca, que
    // es exactamente el caso que hay que ver.
    const estaCaido = fila.last_seen_at === null || fila.last_seen_at < limite;
    const yaAvisado = fila.offline_alerted_at !== null;

    if (estaCaido && !yaAvisado) caidos.push(aDispositivo(fila));
    else if (!estaCaido && yaAvisado) recuperados.push(aDispositivo(fila));
  }

  if (caidos.length > 0) {
    const { error: e } = await devicesTableForHealthSweep()
      .update({ offline_alerted_at: ahora })
      .in(
        "id",
        caidos.map((d) => d.deviceId),
      );
    if (e) throw e;
  }
  if (recuperados.length > 0) {
    const { error: e } = await devicesTableForHealthSweep()
      .update({ offline_alerted_at: null })
      .in(
        "id",
        recuperados.map((d) => d.deviceId),
      );
    if (e) throw e;
  }

  return { caidos, recuperados };
}
