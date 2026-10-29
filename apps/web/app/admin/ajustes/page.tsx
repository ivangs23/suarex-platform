import { parseBranding } from "@suarex/config";
import {
  DIAS_DE_LA_SEMANA,
  fichaPublicaDeLaSede,
  getTenantCustomDomain,
  getTenantSettings,
  listVenues,
} from "@suarex/db";
import { requireManager } from "@/lib/require-manager";
import { NOMBRE_DEL_DIA } from "@/lib/settings-action-input";
import { AjustesForm } from "./AjustesForm";
import { FichaForm } from "./FichaForm";

/** Pantalla de ajustes del negocio (D3). `requireManager()` es la primera barrera;
 * `updateSettingsAction` la vuelve a comprobar por su cuenta vía `managerAction`. */
export default async function AdminAjustesPage({
  searchParams,
}: {
  searchParams: Promise<{ sede?: string | string[] }>;
}) {
  const session = await requireManager();
  const [settings, customDomain, sedes, { sede }] = await Promise.all([
    getTenantSettings(session.tenantId),
    getTenantCustomDomain(session.tenantId),
    listVenues(session.tenantId),
    searchParams,
  ]);
  const branding = parseBranding(settings?.branding);

  const fiscal = (settings?.fiscal ?? {}) as Record<string, unknown>;
  const taxRate = typeof fiscal.taxRate === "number" ? fiscal.taxRate : undefined;

  // La sede de `?sede=`, si es de este cliente; si no, la de por defecto (`listVenues` la pone
  // primero).
  const elegida = sedes.find((s) => s.id === sede) ?? sedes[0];
  const ficha = elegida ? await fichaPublicaDeLaSede(session.tenantId, elegida.id) : null;

  return (
    <main>
      <h1>Ajustes del negocio</h1>
      <AjustesForm
        branding={branding}
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
        customDomain={customDomain ?? ""}
        channels={settings?.channels ?? []}
      />
      {ficha ? (
        <FichaForm
          key={ficha.venueId}
          sedes={sedes.map(({ id, name }) => ({ id, name }))}
          venueId={ficha.venueId}
          ficha={ficha}
          dias={DIAS_DE_LA_SEMANA.map((codigo) => ({ codigo, nombre: NOMBRE_DEL_DIA[codigo] }))}
        />
      ) : null}
    </main>
  );
}
