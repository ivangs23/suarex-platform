import { getTenantSettings, paidOrdersBetween } from "@suarex/db";
import { formatCents, summarizeDay } from "@suarex/domain";
import { requireManager } from "@/lib/require-manager";

/**
 * CIERRE DE CAJA: el resumen de lo cobrado hoy, para contabilizarlo.
 *
 * Se mira con la calculadora al lado y se pasa a la gestoría, así que no hay gráficas ni
 * métricas: cuánto ha entrado, por dónde, y cuánto de eso es IVA de cada tipo.
 *
 * El desglose sale de `summarizeDay` (@suarex/domain), que usa la MISMA función que imprime los
 * recibos. Si el cierre hiciera su propia aritmética, algún día diferiría de la suma de los
 * tickets y no habría forma de saber cuál de los dos miente.
 *
 * El día se corta por `paid_at`, no por cuándo se creó el pedido: lo que se contabiliza es cuándo
 * entró el dinero. Uno creado a las 23:55 y pagado a las 00:05 cuenta en el día siguiente, que es
 * donde lo va a buscar quien cuadra la caja.
 */
export default async function AdminCierrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireManager();
  const query = await searchParams;

  const settings = await getTenantSettings(session.tenantId);
  const locale = settings?.locale ?? "es";
  const currency = settings?.currency ?? "EUR";

  /* El día del negocio en SU zona, no en la del servidor. Sin esto, un cierre a las 23:00 en
     España se calcularía sobre un día que en UTC ya cambió, y faltarían las últimas horas. */
  const zona = "Europe/Madrid";
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date());
  const dia =
    typeof query.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.dia) ? query.dia : hoy;

  const desde = new Date(`${dia}T00:00:00+02:00`).toISOString();
  const hasta = new Date(`${dia}T00:00:00+02:00`);
  hasta.setDate(hasta.getDate() + 1);

  const pedidos = await paidOrdersBetween(session.tenantId, desde, hasta.toISOString());
  const resumen = summarizeDay(pedidos);
  const dinero = (cents: number) => formatCents(cents, locale, currency);

  const nombreCanal = (channel: string) =>
    channel === "kiosko" ? "Totem" : channel === "qr-mesa" ? "Carta por QR" : channel;

  return (
    <main>
      <h1>Cierre de caja</h1>

      <form method="get">
        <label htmlFor="cierre-dia">Día</label>
        <input id="cierre-dia" name="dia" type="date" defaultValue={dia} max={hoy} />
        <button type="submit">Ver</button>
      </form>

      {resumen.orderCount === 0 ? (
        <p data-testid="cierre-vacio">No hay pedidos cobrados este día.</p>
      ) : (
        <>
          <section data-testid="cierre-total">
            <h2>Total cobrado</h2>
            <p>
              <strong data-testid="cierre-total-importe">{dinero(resumen.totalCents)}</strong> en{" "}
              <span data-testid="cierre-pedidos">{resumen.orderCount}</span> pedido(s)
            </p>
          </section>

          <section data-testid="cierre-canales">
            <h2>Por dónde ha entrado</h2>
            <table>
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Pedidos</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>
                {resumen.byChannel.map((canal) => (
                  <tr key={canal.channel} data-testid="cierre-canal">
                    <td>{nombreCanal(canal.channel)}</td>
                    <td>{canal.orderCount}</td>
                    <td>{dinero(canal.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section data-testid="cierre-iva">
            <h2>IVA por tipo</h2>
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Base</th>
                  <th>Cuota</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {resumen.taxByRate.map((tipo) => (
                  <tr key={tipo.taxRate} data-testid="cierre-tipo-iva">
                    <td>{Math.round(tipo.taxRate * 100)} %</td>
                    <td>{dinero(tipo.baseCents)}</td>
                    <td>{dinero(tipo.taxCents)}</td>
                    <td>{dinero(tipo.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* El redondeo se aplica UNA vez sobre la base agregada de cada tipo, que es como se
                declara. Por eso la suma de esta tabla cuadra con el total de arriba al céntimo. */}
            <p>
              El IVA se calcula sobre el total del día por cada tipo, no sumando el de cada ticket:
              así el desglose cuadra exactamente con lo cobrado.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
