import { sweepDeviceHealth } from "@suarex/db";
import { cronRoute } from "@/lib/cron-route";
import { log } from "@/lib/log";

/**
 * BARRIDO DE SALUD DE DISPOSITIVOS.
 *
 * Encuentra los PCs de cocina que llevan más de N minutos sin latir y los que acaban de
 * volver. Solo las TRANSICIONES: ver `sweepDeviceHealth`.
 *
 * Los avisos van al log estructurado, que es donde vive toda la observabilidad de la
 * plataforma (decisión D2 del spec de la Fase 2). El script de cron que lo llama puede
 * además mandarlos por correo — ver `deploy/scripts/device-health.sh`.
 *
 * Por qué a soporte y no al restaurante (decisión D3): al principio habrá falsos positivos
 * —wifi doméstico, el PC que alguien apaga al cerrar— y cada falso positivo enviado al
 * cliente es una llamada igualmente, pero con el cliente ya alarmado. Cuando el ruido esté
 * medido, se baja el aviso al restaurante como cambio aparte.
 */
export const runtime = "nodejs";

/** El umbral vive SOLO aquí: `sweepDeviceHealth` lo recibe siempre explícito, así que su
 *  valor por defecto nunca se usa y no hay dos fuentes para la misma política. */
const UMBRAL_MINUTOS = 10;

export const POST = cronRoute("cron.device_health_fallo", async () => {
  const { caidos, recuperados } = await sweepDeviceHealth(UMBRAL_MINUTOS);

  for (const d of caidos) {
    log.error("dispositivo.caido", {
      deviceId: d.deviceId,
      tenantSlug: d.tenantSlug,
      nombre: d.nombre,
      ultimoLatido: d.ultimoLatido,
      umbralMinutos: UMBRAL_MINUTOS,
    });
  }
  for (const d of recuperados) {
    log.info("dispositivo.recuperado", {
      deviceId: d.deviceId,
      tenantSlug: d.tenantSlug,
      nombre: d.nombre,
    });
  }

  // El cuerpo lleva los detalles para que el script de cron pueda mandarlos por correo sin
  // tener que leer los logs del contenedor.
  return { caidos, recuperados };
});
