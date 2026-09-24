import { eurosToCents } from "@suarex/domain";
import { tenantScoped } from "./client.js";

export type ProductoVendido = {
  nombre: string;
  unidades: number;
  importeCents: number;
};

export type VentasDelDia = {
  /** Cobrado de verdad: total de los pedidos MENOS lo reembolsado. */
  totalCents: number;
  numPedidos: number;
  /** De más vendido a menos, por unidades. */
  porProducto: ProductoVendido[];
  /** Importe por hora del día (0-23), para ver las franjas de servicio. */
  porHora: { hora: number; importeCents: number }[];
};

/**
 * ESTADOS QUE CUENTAN COMO VENTA.
 *
 * `paid` es solo el primero: el flujo sigue a `preparing` y `served` DESPUÉS de cobrar (ver el
 * webhook de pagos). Filtrar únicamente por `paid` dejaría fuera casi toda la venta del día, que
 * es el error obvio aquí y el que un test fija.
 *
 * `pending` NO cuenta: es alguien que abrió el carrito y no llegó a pagar. Contarlo inflaría la
 * caja con dinero que nunca entró. `cancelled` tampoco, por lo mismo.
 *
 * `refunded` SÍ cuenta, y no es una contradicción: se cobró y se devolvió, así que el importe
 * neto se calcula restando `refunded_cents` más abajo. Excluirlo perdería los reembolsos
 * parciales, donde sí quedó dinero en caja.
 */
const ESTADOS_COBRADOS = ["paid", "preparing", "served", "refunded"] as const;

type FilaPedido = {
  paid_at: string | null;
  total: number;
  refunded_cents: number | null;
  order_items: { name_snapshot: Record<string, string>; quantity: number; line_total: number }[];
};

/**
 * Ventas del día para un restaurante. Solo lectura: no cierra turno ni congela nada (decisión
 * D1 del spec de la Fase 3).
 *
 * `desde`/`hasta` se calculan en el llamante si hace falta otro rango; por defecto, desde la
 * medianoche de hoy. Se filtra por `paid_at` y no por `created_at` porque lo que interesa es
 * cuándo entró el dinero, no cuándo se abrió el carrito.
 */
export async function ventasDelDia(
  tenantId: string,
  desde: Date = new Date(new Date().setHours(0, 0, 0, 0)),
  hasta: Date = new Date(new Date().setHours(23, 59, 59, 999)),
): Promise<VentasDelDia> {
  const { data, error } = await tenantScoped("orders", tenantId)
    .select("paid_at, total, refunded_cents, order_items(name_snapshot, quantity, line_total)")
    .in("status", [...ESTADOS_COBRADOS])
    .not("paid_at", "is", null)
    .gte("paid_at", desde.toISOString())
    .lte("paid_at", hasta.toISOString());
  if (error) throw error;

  const filas = (data ?? []) as unknown as FilaPedido[];

  let totalCents = 0;
  const porProducto = new Map<string, ProductoVendido>();
  const porHora = new Map<number, number>();

  for (const fila of filas) {
    // Neto: lo cobrado menos lo devuelto. Un informe que ignora los reembolsos dice que se
    // vendió más de lo que entró, y el hostelero no cuadraría contra el banco.
    const neto = eurosToCents(Number(fila.total)) - (fila.refunded_cents ?? 0);
    totalCents += neto;

    if (fila.paid_at) {
      const hora = new Date(fila.paid_at).getHours();
      porHora.set(hora, (porHora.get(hora) ?? 0) + neto);
    }

    for (const linea of fila.order_items ?? []) {
      // `name_snapshot` y no el catálogo de hoy: el informe refleja lo que se vendió, aunque
      // el plato se haya renombrado o borrado después.
      const nombre = linea.name_snapshot?.es ?? Object.values(linea.name_snapshot ?? {})[0] ?? "—";
      const previo = porProducto.get(nombre) ?? { nombre, unidades: 0, importeCents: 0 };
      previo.unidades += linea.quantity;
      previo.importeCents += eurosToCents(Number(linea.line_total));
      porProducto.set(nombre, previo);
    }
  }

  return {
    totalCents,
    numPedidos: filas.length,
    porProducto: [...porProducto.values()].sort((a, b) => b.unidades - a.unidades),
    porHora: [...porHora.entries()]
      .map(([hora, importeCents]) => ({ hora, importeCents }))
      .sort((a, b) => a.hora - b.hora),
  };
}

/**
 * El informe en CSV, para que el hostelero se lo pase a su asesoría.
 *
 * Separador `;` y no `,`: Excel en configuración regional española interpreta la coma como
 * separador decimal, así que un CSV con comas se abre todo en una columna. Y los importes van
 * con coma decimal por el mismo motivo.
 *
 * NUNCA incluye las notas del pedido: son texto libre del comensal y están sujetas a la
 * retención que promete la política de privacidad. Un CSV descargado vive fuera de esos
 * plazos (ver el spec de la Fase 3).
 */
export function ventasACsv(ventas: VentasDelDia): string {
  const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
  const lineas = [
    "Producto;Unidades;Importe",
    ...ventas.porProducto.map(
      (p) => `${p.nombre.replaceAll(";", ",")};${p.unidades};${euros(p.importeCents)}`,
    ),
    "",
    `TOTAL;${ventas.numPedidos} pedidos;${euros(ventas.totalCents)}`,
  ];
  return lineas.join("\n");
}
