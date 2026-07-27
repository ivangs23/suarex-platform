import { getPaymentConfigForManager } from "@suarex/db";
import { PAYMENT_PROVIDERS } from "@suarex/payments";
import { requireManager } from "@/lib/require-manager";
import { PaymentConfigForm } from "./PaymentConfigForm";

/**
 * Config del método de pago del negocio (canal totem). `requireManager()` es la primera barrera;
 * `setPaymentConfigAction` la vuelve a comprobar por su cuenta vía `managerAction`.
 *
 * Los secretos NO se leen aquí para la vista (ver `getPaymentConfigForManager`): solo se sabe
 * cuáles hay guardados, para que el navegador nunca reciba ninguno.
 */
export default async function AdminPagosPage() {
  const session = await requireManager();
  const config = await getPaymentConfigForManager(session.tenantId);

  return (
    <main>
      <h1>Pagos (datáfono del totem)</h1>
      <p>
        Cómo cobra el totem. El terminal físico de cada totem se asigna en{" "}
        <a href="/admin/dispositivos">Dispositivos</a>: es del aparato, no de la cuenta.
      </p>
      <PaymentConfigForm
        providers={PAYMENT_PROVIDERS}
        provider={config?.provider ?? ""}
        config={config?.config ?? {}}
        secretsSet={config?.secretsSet ?? []}
        mock={config?.mock ?? true}
      />
    </main>
  );
}
