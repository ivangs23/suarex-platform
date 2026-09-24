import styles from "./admin.module.css";

/**
 * Aviso de impago en el panel del gestor.
 *
 * Existe porque la ventana de gracia solo sirve si el cliente se entera de que está dentro de
 * ella: siete días de silencio seguidos de un corte sorpresa son peores que cortar el primer
 * día, porque se entera cuando ya no puede servir mesas.
 *
 * Solo se pinta en `past_due`. `trialing` NO lleva aviso: un cliente en periodo de prueba no
 * debe ver una alarma cada vez que entra en su panel.
 */
export function BillingBanner({
  planStatus,
  graceUntil,
}: {
  planStatus: string;
  graceUntil: string | null;
}) {
  if (planStatus !== "past_due") return null;

  // Sin fecha se avisa igual, sin inventarse una: el aviso importa más que el plazo.
  const fecha = graceUntil ? new Date(graceUntil).toLocaleDateString("es-ES") : null;

  return (
    <div role="alert" className={styles.billingBanner} data-testid="billing-banner">
      <strong>No hemos podido cobrar tu suscripción.</strong>{" "}
      {fecha
        ? `Actualiza tu método de pago antes del ${fecha} para que el servicio no se interrumpa.`
        : "Actualiza tu método de pago para que el servicio no se interrumpa."}
    </div>
  );
}
