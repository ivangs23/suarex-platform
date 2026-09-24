"use server";

import { ventasACsv, ventasDelDia } from "@suarex/db";
import { managerAction } from "@/lib/require-manager";

/**
 * Genera el CSV del día. Va como Server Action y no como ruta de API por el mismo motivo que
 * el resto del panel: `managerAction` garantiza estructuralmente que nadie llega aquí sin ser
 * gestor del tenant resuelto por Host. Una ruta de API tendría que repetir ese guard a mano.
 */
export const descargarCsvAction = managerAction(
  async (session): Promise<{ nombre: string; contenido: string }> => {
    const ventas = await ventasDelDia(session.tenantId);
    const hoy = new Date().toISOString().slice(0, 10);
    return { nombre: `ventas-${hoy}.csv`, contenido: ventasACsv(ventas) };
  },
);
