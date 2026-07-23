"use server";

import { parseBranding, resolveRootDomains } from "@suarex/config";
import {
  getTenantSettings,
  setTenantCustomDomain,
  updateTenantSettings,
  uploadBrandingImage,
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
 * Las imágenes de marca (el logo y la foto de la pantalla de bienvenida) se suben aparte
 * (Storage, `uploadBrandingImage`) y sus URLs se fusionan en `branding`. Si el formulario no
 * trae fichero nuevo, se PRESERVA la que ya tuviera el tenant (leída de los ajustes actuales
 * vía `parseBranding`, que degrada con seguridad) -- guardar la marca sin volver a subir la
 * foto no debe borrarla.
 */
export const updateSettingsAction = managerAction(async (session, formData: FormData) => {
  const brandingFields = parseBrandingFields(formData);
  const fiscal = parseFiscalFields(formData);
  const locale = parseLocale(formData);
  const currency = parseCurrency(formData);
  const customDomain = parseCustomDomain(formData, ROOT_DOMAINS);

  // Punto de partida de cada imagen: la que ya está guardada (o null).
  const current = await getTenantSettings(session.tenantId);
  const guardado = parseBranding(current?.branding);

  const subirSiViene = async (campo: string, actual: string | null) => {
    const file = formData.get(campo);
    if (!(file instanceof File) || file.size === 0) return actual;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return uploadBrandingImage(session.tenantId, { bytes, contentType: file.type });
  };

  const logoUrl = await subirSiViene("logo", guardado.logoUrl);
  const heroUrl = await subirSiViene("hero", guardado.heroUrl);

  await updateTenantSettings(session.tenantId, {
    branding: {
      name: brandingFields.name,
      colors: brandingFields.colors,
      fonts: brandingFields.fonts,
      logoUrl,
      heroUrl,
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
