"use server";

import { parseBranding, resolveRootDomains } from "@suarex/config";
import {
  getTenantSettings,
  setTenantCustomDomain,
  updateTenantSettings,
  uploadBrandingLogo,
} from "@suarex/db";
import { revalidatePath } from "next/cache";
import { managerAction } from "@/lib/require-manager";
import {
  parseBrandingFields,
  parseCurrency,
  parseCustomDomain,
  parseFiscalFields,
  parseLocale,
} from "@/lib/settings-action-input";

const ROOT_DOMAINS = resolveRootDomains(process.env);

/**
 * SECURITY: mismo patrón obligatorio que el resto de `app/admin/**` (ver el docstring de
 * `catalogo/actions.ts`): `managerAction` comprueba owner/admin ANTES del cuerpo, y el
 * `tenantId` es SIEMPRE `session.tenantId`, nunca del formulario.
 *
 * El logo se sube aparte (Storage, `uploadBrandingLogo`) y su URL se fusiona en `branding`.
 * Si el formulario no trae fichero nuevo, se PRESERVA el `logoUrl` que ya tuviera el tenant
 * (leído de los ajustes actuales vía `parseBranding`, que degrada con seguridad) -- guardar
 * la marca sin volver a subir el logo no debe borrarlo.
 */
export const updateSettingsAction = managerAction(async (session, formData: FormData) => {
  const brandingFields = parseBrandingFields(formData);
  const fiscal = parseFiscalFields(formData);
  const locale = parseLocale(formData);
  const currency = parseCurrency(formData);
  const customDomain = parseCustomDomain(formData, ROOT_DOMAINS);

  // Punto de partida del logo: el que ya está guardado (o null).
  const current = await getTenantSettings(session.tenantId);
  let logoUrl = parseBranding(current?.branding).logoUrl;

  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const bytes = new Uint8Array(await logo.arrayBuffer());
    logoUrl = await uploadBrandingLogo(session.tenantId, { bytes, contentType: logo.type });
  }

  await updateTenantSettings(session.tenantId, {
    branding: {
      name: brandingFields.name,
      colors: brandingFields.colors,
      fonts: brandingFields.fonts,
      logoUrl,
    },
    fiscal,
    locale,
    currency,
  });

  // El dominio propio vive en `tenants`, no en `tenant_settings`: escritura aparte. Va
  // DESPUÉS de los ajustes a propósito -- es la única que puede fallar por un conflicto con
  // otro cliente (índice único), y así ese fallo no se lleva por delante el resto del
  // formulario, que ya quedó guardado.
  await setTenantCustomDomain(session.tenantId, customDomain);

  // La marca vive en el layout raíz (CSS vars) y el nombre en la carta: revalidar todo.
  revalidatePath("/admin/ajustes");
  revalidatePath("/", "layout");
});
