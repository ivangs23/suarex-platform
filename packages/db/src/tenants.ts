import { parseTenantHost, tenantSettingsSchema } from "@suarex/config";
import { serviceClient } from "./client.js";
import type { Tenant, TenantSettingsRow } from "./types.js";

export async function findTenantByHost(
  host: string,
  rootDomains: string[],
): Promise<Tenant | null> {
  const ref = parseTenantHost(host, rootDomains);
  if (!ref) return null;

  const query = serviceClient().from("tenants").select("id, slug, name, status");
  const { data, error } =
    ref.kind === "subdomain"
      ? await query.eq("slug", ref.slug).maybeSingle()
      : await query.eq("custom_domain", ref.domain).maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    status: data.status as Tenant["status"],
  };
}

export async function getTenantSettings(tenantId: string): Promise<TenantSettingsRow | null> {
  const { data, error } = await serviceClient()
    .from("tenant_settings")
    .select("tenant_id, branding, fiscal, locale, currency, channels, features")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // `branding` deliberadamente NO pasa por tenantSettingsSchema (la declara
  // `z.unknown()` a propósito): su propia validación -- con su propio never-throw y
  // degradación campo a campo -- vive en parseBranding() (@suarex/config), consumida
  // más abajo en la cadena por apps/web/app/layout.tsx. Validarla aquí también sería
  // una segunda fuente de verdad para el mismo campo.
  const parsed = tenantSettingsSchema.safeParse({
    branding: data.branding,
    fiscal: data.fiscal,
    locale: data.locale,
    currency: data.currency,
    channels: data.channels,
    features: data.features,
  });

  // Nunca lanza: si la fila no valida contra el schema (drift de datos -- hoy no hay
  // ningún camino de escritura autenticado hacia esta tabla, pero un futuro CRUD de
  // administración podría producirlo), se degrada CAMPO A CAMPO usando `path[0]` de
  // cada issue de Zod para identificar solo las claves que realmente fallaron. Un
  // `locale`/`currency` corrupto no debe arrastrar `channels`/`features` -- ni mucho
  // menos `branding` -- a su default también: la fila entera nunca se blanquea por un
  // único campo inválido.
  const invalid = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]));

  return {
    tenantId: data.tenant_id as string,
    branding: data.branding as Record<string, unknown>,
    fiscal: invalid.has("fiscal") ? {} : (data.fiscal as Record<string, unknown>),
    locale: invalid.has("locale") ? "es" : (data.locale as string),
    currency: invalid.has("currency") ? "EUR" : (data.currency as string),
    channels: invalid.has("channels") ? [] : (data.channels as string[]),
    features: invalid.has("features") ? {} : (data.features as Record<string, unknown>),
  };
}
