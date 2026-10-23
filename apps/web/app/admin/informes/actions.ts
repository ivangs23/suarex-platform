"use server";

import { ventasACsv, ventasDelDia, zonaHorariaDelTenant } from "@suarex/db";
import { diaEnZona } from "@suarex/domain";
import { managerAction } from "@/lib/require-manager";

/**
 * Genera el CSV del día. Va como Server Action y no como ruta de API por el mismo motivo que
 * el resto del panel: `managerAction` garantiza estructuralmente que nadie llega aquí sin ser
 * gestor del tenant resuelto por Host. Una ruta de API tendría que repetir ese guard a mano.
 */
export const descargarCsvAction = managerAction(
  async (session): Promise<{ nombre: string; contenido: string }> => {
    // El día del LOCAL (su sede), también en el nombre del fichero: en UTC, a las 00:30 seguiría
    // siendo ayer.
    const zona = await zonaHorariaDelTenant(session.tenantId);
    const hoy = diaEnZona(new Date(), zona);
    const ventas = await ventasDelDia(session.tenantId, hoy, zona);
    return { nombre: `ventas-${hoy}.csv`, contenido: ventasACsv(ventas) };
  },
);
