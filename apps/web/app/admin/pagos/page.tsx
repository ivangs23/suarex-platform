import {
  getPaymentConfigForManager,
  getStripeConfigForManager,
  getTenantSettings,
} from "@suarex/db";
import { PAYMENT_PROVIDERS } from "@suarex/payments";
import { requireManager } from "@/lib/require-manager";
import { PaymentConfigForm } from "./PaymentConfigForm";
import { StripeConfigForm } from "./StripeConfigForm";

/**
 * Config del método de pago del negocio (canal totem). `requireManager()` es la primera barrera;
 * `setPaymentConfigAction` la vuelve a comprobar por su cuenta vía `managerAction`.
 *
 * Los secretos NO se leen aquí para la vista (ver `getPaymentConfigForManager`): solo se sabe
 * cuáles hay guardados, para que el navegador nunca reciba ninguno.
 */
export default async function AdminPagosPage() {
  const session = await requireManager();
  const [config, stripe, settings] = await Promise.all([
    getPaymentConfigForManager(session.tenantId),
    getStripeConfigForManager(session.tenantId),
    getTenantSettings(session.tenantId),
  ]);

  /* Cada canal se cobra de una forma y solo se enseña lo que el cliente tiene contratado: pedirle
     credenciales de datáfono a quien solo tiene carta por QR -- o al revés -- es cómo una pantalla
     de ajustes se vuelve un muro que nadie lee. */
  const canales = settings?.channels ?? [];
  const tieneQr = canales.includes("qr-mesa");
  const tieneTotem = canales.includes("kiosko");

  return (
    <main>
      <h1>Pagos</h1>

      {tieneQr ? (
        <section data-testid="pagos-qr">
          <h2>Cobro por QR</h2>
          <p>
            Las credenciales de la cuenta de Stripe de este negocio. El dinero entra en ella
            directamente.
          </p>
          <StripeConfigForm
            publishableKey={stripe?.publishableKey ?? ""}
            secretsSet={stripe?.secretsSet ?? []}
          />
        </section>
      ) : null}

      {tieneTotem ? (
        <section data-testid="pagos-totem">
          <h2>Cobro en el totem</h2>
          <p>
            Cómo cobra el datáfono. El terminal físico de cada totem se asigna en{" "}
            <a href="/admin/dispositivos">Dispositivos</a>: es del aparato, no de la cuenta.
          </p>
          <PaymentConfigForm
            providers={PAYMENT_PROVIDERS}
            provider={config?.provider ?? ""}
            config={config?.config ?? {}}
            secretsSet={config?.secretsSet ?? []}
            mock={config?.mock ?? true}
          />
        </section>
      ) : null}

      {!tieneQr && !tieneTotem ? (
        <p data-testid="pagos-sin-canales">
          Este negocio no tiene ningún canal de venta encendido, así que no hay nada que cobrar. Se
          activan en <a href="/admin/ajustes">Ajustes</a>.
        </p>
      ) : null}
    </main>
  );
}
