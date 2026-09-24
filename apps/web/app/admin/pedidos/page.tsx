import { listOrderHistory } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { requireManager } from "@/lib/require-manager";
import styles from "./pedidos.module.css";

/**
 * HISTÓRICO DE PEDIDOS.
 *
 * El tablero de `/staff` solo enseña lo activo: en cuanto una comanda se sirve desaparece y no
 * hay dónde volver a verla. Esto contesta "¿qué pidió la mesa 4 anoche?" y "¿este cobro de
 * 38 € de qué era?".
 *
 * Las líneas van dentro de un `<details>`: la lista se lee de un vistazo y el detalle se abre
 * solo para el pedido que interesa. Con 50 pedidos desplegados a la vez la página sería
 * inservible, que es justo cuando más falta hace.
 */
const ETIQUETA: Record<string, string> = {
  pending: "Sin pagar",
  paid: "Pagado",
  preparing: "Preparando",
  served: "Servido",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
};

export default async function PedidosPage() {
  const session = await requireManager();
  const pedidos = await listOrderHistory(session.tenantId);

  return (
    <main>
      <h1>Pedidos</h1>

      {pedidos.length === 0 ? (
        <p data-testid="pedidos-vacio">Todavía no hay pedidos.</p>
      ) : (
        <ul className={styles.lista} data-testid="pedidos-lista">
          {pedidos.map((p) => (
            <li key={p.id} className={styles.pedido} data-testid="pedido-fila">
              <details>
                <summary className={styles.cabecera}>
                  <span className={styles.numero}>#{p.orderNumber}</span>
                  <span className={styles.mesa}>{p.tableLabel ? `Mesa ${p.tableLabel}` : "—"}</span>
                  <span className={styles.fecha}>
                    {new Date(p.createdAt).toLocaleString("es-ES", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className={styles.estado} data-estado={p.status}>
                    {ETIQUETA[p.status] ?? p.status}
                  </span>
                  <span className={styles.total}>
                    {formatCents(p.totalCents, "es-ES", "EUR")}
                    {/* Un total de 38 € engañaría si el pedido se devolvió: se dice al lado. */}
                    {p.refundedCents > 0 ? (
                      <span className={styles.devuelto}>
                        −{formatCents(p.refundedCents, "es-ES", "EUR")}
                      </span>
                    ) : null}
                  </span>
                </summary>

                <ul className={styles.lineas}>
                  {p.lineas.map((linea) => (
                    <li key={`${linea.nombre}-${linea.cantidad}`} className={styles.linea}>
                      <span>
                        {linea.cantidad}× {linea.nombre}
                      </span>
                      <span>{formatCents(linea.importeCents, "es-ES", "EUR")}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
