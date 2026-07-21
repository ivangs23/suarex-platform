import { parseTenantHost } from "@suarex/config";
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

  return {
    tenantId: data.tenant_id as string,
    branding: data.branding as Record<string, unknown>,
    fiscal: data.fiscal as Record<string, unknown>,
    locale: data.locale as string,
    currency: data.currency as string,
    channels: data.channels as string[],
    features: data.features as Record<string, unknown>,
  };
}
