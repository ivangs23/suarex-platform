import { parseTenantHost, tenantSettingsSchema } from "@suarex/config";
import { tenantScoped, tenantsTableForHostResolution } from "./client.js";
import type { Tenant, TenantSettingsRow } from "./types.js";

export async function findTenantByHost(
  host: string,
  rootDomains: string[],
): Promise<Tenant | null> {
  const ref = parseTenantHost(host, rootDomains);
  if (!ref) return null;

  // Exención deliberada: aún no hay tenantId que aplicar, ver el docstring de
  // `tenantsTableForHostResolution` en ./client.ts.
  const query = tenantsTableForHostResolution().select("id, slug, name, status");
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

/**
 * Identificador de la cuenta de Stripe conectada del tenant (`acct_...`), o null
 * si aún no ha completado el onboarding de Connect. NO es un secreto: es el
 * identificador público de una cuenta. La clave secreta de un cliente nunca
 * llega a esta plataforma, que es justamente el motivo de usar Connect.
 */
export async function getTenantStripeAccount(tenantId: string): Promise<string | null> {
  const { data, error } = await tenantsTableForHostResolution()
    .select("stripe_account_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) throw error;
  return (data?.stripe_account_id as string | null) ?? null;
}

export async function getTenantSettings(tenantId: string): Promise<TenantSettingsRow | null> {
  const { data, error } = await tenantScoped("tenant_settings", tenantId)
    .select("tenant_id, branding, fiscal, locale, currency, channels, features")
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

export type UpdateTenantSettingsInput = {
  branding: Record<string, unknown>;
  fiscal: Record<string, unknown>;
  locale: string;
  currency: string;
};

/**
 * Escribe los ajustes del negocio del tenant (marca, fiscal, idioma, moneda). UPSERT sobre
 * la PK `tenant_id`: si el tenant todavía no tiene fila en `tenant_settings` la crea, si la
 * tiene la actualiza -- así el panel funciona igual para un tenant recién provisionado que
 * para uno ya configurado, sin depender de que exista un trigger que siembre la fila.
 *
 * Deliberadamente NO escribe `channels` ni `features`: quedan fuera del alcance de D3 y se
 * preservan intactos (el UPSERT solo toca las columnas que recibe). `updated_at` se fija a
 * mano porque no hay trigger que lo haga (ver el esquema de `20260721000001_core_tenancy.sql`).
 *
 * `branding`/`fiscal` se guardan tal cual como jsonb: la validación de forma vive en el
 * borde de la Server Action (`apps/web/lib/settings-action-input.ts`) en escritura y en
 * `parseBranding`/`tenantSettingsSchema` en lectura. Este repositorio no revalida para no
 * ser una segunda fuente de verdad divergente.
 */
export async function updateTenantSettings(
  tenantId: string,
  input: UpdateTenantSettingsInput,
): Promise<void> {
  const { error } = await tenantScoped("tenant_settings", tenantId).upsert(
    {
      branding: input.branding,
      fiscal: input.fiscal,
      locale: input.locale,
      currency: input.currency,
      updated_at: new Date().toISOString(),
    },
    "tenant_id",
  );
  if (error) throw error;
}
