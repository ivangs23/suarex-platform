import { sweepDeviceHealthRpc } from "./client.js";

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

type FilaTransicion = {
  device_id: string;
  nombre: string;
  tenant_slug: string;
  ultimo_latido: string | null;
  transicion: "caido" | "recuperado";
};

/**
 * BARRIDO DE SALUD DE DISPOSITIVOS.
 *
 * `device_heartbeat` escribe `last_seen_at` en cada tick del agente, pero nadie lo leía: un PC
 * apagado se descubría cuando la cocina se quedaba sin comandas.
 *
 * Todo el trabajo vive en `sweep_device_health` (ver `20260922000003`): el UPDATE ... RETURNING
 * es atómico, así que dos ejecuciones solapadas del cron no pueden avisar las dos del mismo
 * dispositivo. Esta función solo reparte el resultado en dos listas.
 *
 * Devuelve SOLO LAS TRANSICIONES -- los que acaban de caer y los que acaban de volver -- no el
 * estado completo. Un aviso cada 5 minutos durante una caída de dos horas son 24 correos, y
 * después de eso el aviso de la caída siguiente tampoco lo lee nadie.
 */
export async function sweepDeviceHealth(minutos = 10): Promise<ResultadoSalud> {
  const { data, error } = await sweepDeviceHealthRpc(minutos);
  if (error) throw error;

  const caidos: DispositivoCaido[] = [];
  const recuperados: DispositivoCaido[] = [];

  for (const fila of (data ?? []) as FilaTransicion[]) {
    const dispositivo: DispositivoCaido = {
      deviceId: fila.device_id,
      nombre: fila.nombre,
      tenantSlug: fila.tenant_slug,
      ultimoLatido: fila.ultimo_latido,
    };
    if (fila.transicion === "caido") caidos.push(dispositivo);
    else recuperados.push(dispositivo);
  }

  return { caidos, recuperados };
}
