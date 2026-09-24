import { analiticaDeCarta, ventasDelDia } from "@suarex/db";
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
  const [ventas, analitica] = await Promise.all([
    ventasDelDia(session.tenantId),
    analiticaDeCarta(session.tenantId),
  ]);

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

      {/* ANALÍTICA DE CARTA. Treinta días y no hoy: la conversión de una tarde no dice nada, y
          un plato sin vender en una tarde es lo normal. */}
      <h2>Últimos {analitica.dias} días</h2>

      <section className={styles.resumen} data-testid="analitica-resumen">
        <p className={styles.dato}>
          <span className={styles.numero} data-testid="analitica-escaneos">
            {analitica.escaneos}
          </span>
          <span className={styles.etiqueta}>
            {analitica.escaneos === 1 ? "escaneo del QR" : "escaneos del QR"}
          </span>
        </p>
        <p className={styles.dato}>
          <span className={styles.numero} data-testid="analitica-conversion">
            {analitica.pedidosPorEscaneo === null
              ? "—"
              : `${Math.round(analitica.pedidosPorEscaneo * 100)}%`}
          </span>
          <span className={styles.etiqueta}>pedidos por escaneo</span>
        </p>
      </section>

      {/* Se dice qué NO es el número. Una mesa de cuatro escanea cuatro veces y hace un pedido,
          así que leerlo como "solo pide el 25 % de la gente" sería una conclusión falsa sobre
          la que alguien podría cambiar su carta. */}
      <p className={styles.nota}>
        Cada comensal de una mesa suele escanear su propio QR, así que esto no es el porcentaje de
        gente que pide. Sirve para comparar el local consigo mismo con el paso de las semanas.
      </p>

      <h2>Platos que no ha pedido nadie</h2>
      {analitica.sinVender.length === 0 ? (
        <p data-testid="analitica-sin-vender-vacio">
          Todos los platos de la carta se han pedido al menos una vez.
        </p>
      ) : (
        <table className={styles.tabla} data-testid="analitica-sin-vender">
          <thead>
            <tr>
              <th>Plato</th>
              <th>Categoría</th>
            </tr>
          </thead>
          <tbody>
            {analitica.sinVender.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{p.categoria}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
