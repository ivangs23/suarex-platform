import { registrarEscaneoRpc, tenantScoped } from "./client.js";

/**
 * ANALÍTICA DE CARTA.
 *
 * Las ventas (`reports.ts`) dicen lo que SÍ se pidió. Aquí van las dos preguntas que los
 * pedidos por sí solos no pueden responder:
 *
 * - Cuánta gente escanea el QR y no llega a pedir. Sin el contador de escaneos, lo que no se
 *   convierte en pedido es sencillamente invisible.
 * - Qué platos no pide NADIE. Ese sí sale de los pedidos, pero por AUSENCIA: hay que cruzarlos
 *   con el catálogo, porque un plato que no vende no aparece en ningún informe de ventas.
 *
 * Lo que NO se mide, a propósito: qué fichas de producto se abren. Exigiría una baliza desde el
 * navegador del comensal y un registro por visita, que es un tratamiento de datos nuevo -- la
 * política de privacidad declara hoy una cookie técnica y ninguna analítica. Los dos números de
 * arriba se obtienen con un entero por sede y día, sin identificar a nadie.
 */

/** Un plato de la carta que no ha vendido ni una unidad en el periodo. */
export type ProductoSinVender = {
  id: string;
  nombre: string;
  categoria: string;
};

export type AnaliticaDeCarta = {
  /** Días que abarca el informe, contando hoy. */
  dias: number;
  escaneos: number;
  /** Pedidos COBRADOS en el periodo. Un carrito abandonado no es una conversión. */
  pedidos: number;
  /**
   * Pedidos por escaneo. `null` -- no `0` -- cuando no hubo escaneos: cero entre cero no es
   * 0 %, y enseñarle "0 % de conversión" a un local que acaba de empezar es decirle que su
   * carta no funciona cuando lo que pasa es que nadie ha escaneado todavía.
   *
   * NO es "el porcentaje de comensales que piden": una mesa de cuatro suele escanear cuatro
   * veces y hacer un pedido. Sirve para comparar el local consigo mismo a lo largo del tiempo,
   * que es para lo que la pantalla lo presenta.
   */
  pedidosPorEscaneo: number | null;
  sinVender: ProductoSinVender[];
};

/**
 * Los mismos estados que cuentan como venta en `reports.ts`. `pending` y `cancelled` fuera: un
 * carrito abandonado es justo lo contrario de una conversión.
 */
const ESTADOS_COBRADOS = ["paid", "preparing", "served", "refunded"] as const;

/**
 * Suma un escaneo del QR. Nunca lanza: el contador es información de gestión y la ruta del QR
 * es el primer paso del comensal -- dejarlo sin carta porque no se pudo contar sería cambiar
 * una venta por una estadística.
 */
export async function registrarEscaneo(tableId: string): Promise<void> {
  const { error } = await registrarEscaneoRpc(tableId);
  if (error) {
    console.error("[analytics] no se pudo contar el escaneo:", error.message);
  }
}

export async function analiticaDeCarta(tenantId: string, dias = 30): Promise<AnaliticaDeCarta> {
  const desde = new Date();
  desde.setDate(desde.getDate() - (dias - 1));
  desde.setHours(0, 0, 0, 0);
  // `menu_scans.dia` es una fecha local de la sede, no un instante: se compara con otra fecha.
  const desdeDia = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}-${String(desde.getDate()).padStart(2, "0")}`;

  const [scans, pedidos, catalogo] = await Promise.all([
    tenantScoped("menu_scans", tenantId).select("escaneos").gte("dia", desdeDia),
    tenantScoped("orders", tenantId)
      .select("id, order_items(product_id)")
      .in("status", [...ESTADOS_COBRADOS])
      .not("paid_at", "is", null)
      .gte("paid_at", desde.toISOString()),
    // Solo lo que está EN la carta: un plato retirado a propósito (`is_available` false) no es
    // un plato que no se vende, y meterlo enterraría los que sí importan.
    tenantScoped("products", tenantId)
      .select("id, name_i18n, categories(name_i18n)")
      .eq("is_available", true),
  ]);
  if (scans.error) throw scans.error;
  if (pedidos.error) throw pedidos.error;
  if (catalogo.error) throw catalogo.error;

  const escaneos = (scans.data ?? []).reduce((acc, fila) => acc + (fila.escaneos as number), 0);
  const numPedidos = (pedidos.data ?? []).length;

  const vendidos = new Set<string>();
  for (const pedido of pedidos.data ?? []) {
    const lineas = (pedido.order_items ?? []) as unknown as { product_id: string | null }[];
    for (const linea of lineas) {
      if (linea.product_id) vendidos.add(linea.product_id);
    }
  }

  type FilaProducto = {
    id: string;
    name_i18n: Record<string, string>;
    categories: { name_i18n: Record<string, string> } | null;
  };
  const sinVender = (catalogo.data as unknown as FilaProducto[])
    .filter((p) => !vendidos.has(p.id))
    .map((p) => ({
      id: p.id,
      nombre: p.name_i18n.es ?? "",
      categoria: p.categories?.name_i18n.es ?? "",
    }))
    // Por categoría y luego por nombre: así se lee como la carta y no como un volcado.
    .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));

  return {
    dias,
    escaneos,
    pedidos: numPedidos,
    pedidosPorEscaneo: escaneos === 0 ? null : numPedidos / escaneos,
    sinVender,
  };
}
