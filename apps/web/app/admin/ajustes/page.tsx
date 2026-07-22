import { parseBranding } from "@suarex/config";
import { getTenantSettings } from "@suarex/db";
import { requireManager } from "@/lib/require-manager";
import { AjustesForm } from "./AjustesForm";

/** Pantalla de ajustes del negocio (D3). `requireManager()` es la primera barrera;
 * `updateSettingsAction` la vuelve a comprobar por su cuenta vía `managerAction`. */
export default async function AdminAjustesPage() {
  const session = await requireManager();
  const settings = await getTenantSettings(session.tenantId);
  const branding = parseBranding(settings?.branding);

  const fiscal = (settings?.fiscal ?? {}) as Record<string, unknown>;
  const taxRate = typeof fiscal.taxRate === "number" ? fiscal.taxRate : undefined;

  return (
    <main>
      <h1>Ajustes del negocio</h1>
      <AjustesForm
        name={branding.name ?? ""}
        colors={branding.colors}
        fonts={branding.fonts}
        logoUrl={branding.logoUrl}
        fiscal={{
          legalName: typeof fiscal.legalName === "string" ? fiscal.legalName : "",
          cif: typeof fiscal.cif === "string" ? fiscal.cif : "",
          address: typeof fiscal.address === "string" ? fiscal.address : "",
          phone: typeof fiscal.phone === "string" ? fiscal.phone : "",
          taxRatePercent:
            taxRate === undefined ? "" : String(Math.round(taxRate * 100 * 100) / 100),
        }}
        locale={settings?.locale ?? "es"}
        currency={settings?.currency ?? "EUR"}
      />
    </main>
  );
}
