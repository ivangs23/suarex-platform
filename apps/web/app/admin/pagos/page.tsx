import { getPaymentConfigForManager } from "@suarex/db";
import { requireManager } from "@/lib/require-manager";
import { PaymentConfigForm } from "./PaymentConfigForm";

/**
 * Config de pago del negocio (Paytef, canal totem). `requireManager()` es la primera barrera;
 * `setPaymentConfigAction` la vuelve a comprobar por su cuenta vía `managerAction`.
 *
 * La clave secreta NO se lee aquí para la vista (ver `getPaymentConfigForManager`): solo se sabe
 * si hay una guardada, para que el navegador nunca reciba el secreto.
 */
export default async function AdminPagosPage() {
  const session = await requireManager();
  const config = await getPaymentConfigForManager(session.tenantId);

  return (
    <main>
      <h1>Pagos (datáfono del totem)</h1>
      <p>
        Credenciales de Paytef para cobrar por datáfono en el totem. El pinpad de cada totem se
        asigna en <a href="/admin/dispositivos">Dispositivos</a>.
      </p>
      <PaymentConfigForm
        accessKey={config?.accessKey ?? ""}
        companyId={config?.companyId ?? ""}
        mock={config?.mock ?? true}
        hasSecret={config?.hasSecret ?? false}
      />
    </main>
  );
}
