import { ventasDelDia } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { requireManager } from "@/lib/require-manager";
import { descargarCsvAction } from "./actions";
import { DescargarCsv } from "./DescargarCsv";
import styles from "./informes.module.css";

/**
 * VENTAS DEL DÍA.
 *
 * Lo que el hostelero pregunta el día 2: cuánto ha vendido hoy y de qué. Solo lectura: no
 * cierra turno ni congela nada (decisión D1 del spec de la Fase 3). Un arqueo obliga a decidir
 * de qué día es un pedido de la 01:30 y qué pasa con un turno partido, y esas respuestas
 * dependen de lo que exija la asesoría de cada cliente.
 */
export default async function InformesPage() {
  const session = await requireManager();
  const ventas = await ventasDelDia(session.tenantId);

  const maximoPorHora = Math.max(1, ...ventas.porHora.map((h) => h.importeCents));

  return (
    <main>
      <h1>Ventas de hoy</h1>

      <section className={styles.resumen} data-testid="informe-resumen">
        <p className={styles.dato}>
          <span className={styles.numero} data-testid="informe-total">
            {formatCents(ventas.totalCents, "es-ES", "EUR")}
          </span>
          <span className={styles.etiqueta}>cobrado</span>
        </p>
        <p className={styles.dato}>
          <span className={styles.numero} data-testid="informe-pedidos">
            {ventas.numPedidos}
          </span>
          <span className={styles.etiqueta}>{ventas.numPedidos === 1 ? "pedido" : "pedidos"}</span>
        </p>
      </section>

      {ventas.numPedidos === 0 ? (
        <p data-testid="informe-vacio">Todavía no hay ventas hoy.</p>
      ) : (
        <>
          <h2>Por franja horaria</h2>
          {/* Barras con CSS puro: una librería de gráficos para ocho barras sería más peso de
              descarga que información. La anchura relativa basta para ver dónde está el
              servicio. */}
          <ul className={styles.franjas} data-testid="informe-franjas">
            {ventas.porHora.map((franja) => (
              <li key={franja.hora} className={styles.franja}>
                <span className={styles.hora}>{String(franja.hora).padStart(2, "0")}:00</span>
                <span
                  className={styles.barra}
                  style={{ width: `${(franja.importeCents / maximoPorHora) * 100}%` }}
                />
                <span className={styles.importe}>
                  {formatCents(franja.importeCents, "es-ES", "EUR")}
                </span>
              </li>
            ))}
          </ul>

          <h2>Por producto</h2>
          <table className={styles.tabla} data-testid="informe-productos">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Unidades</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              {ventas.porProducto.map((p) => (
                <tr key={p.nombre}>
                  <td>{p.nombre}</td>
                  <td>{p.unidades}</td>
                  <td>{formatCents(p.importeCents, "es-ES", "EUR")}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <DescargarCsv accion={descargarCsvAction} />
        </>
      )}
    </main>
  );
}
