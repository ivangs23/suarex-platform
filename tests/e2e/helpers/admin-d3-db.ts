import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.SUPABASE_URL;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!rawUrl || !rawServiceKey) {
  throw new Error(
    "Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en .env.test. Corre `pnpm db:env`.",
  );
}
const url: string = rawUrl;
const serviceKey: string = rawServiceKey;

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** El slug del tenant demo compartido por toda la suite e2e (ver `admin-d2.spec.ts`). */
const DEMO_SLUG = "garum";

async function demoTenantId(): Promise<string> {
  const { data, error } = await admin.from("tenants").select("id").eq("slug", DEMO_SLUG).single();
  if (error) throw error;
  return data.id as string;
}

export type SettingsSnapshot = {
  tenantId: string;
  branding: unknown;
  fiscal: unknown;
  locale: string;
  currency: string;
};

/** Snapshot de la fila `tenant_settings` de garum ANTES de que el test la modifique por la
 * UI, para restaurarla en el `afterEach` -- garum es un fixture compartido (`workers: 1`),
 * así que un cambio de marca no restaurado cascadearía a otros ficheros (lección de D1/D2). */
export async function snapshotDemoSettings(): Promise<SettingsSnapshot> {
  const tenantId = await demoTenantId();
  const { data, error } = await admin
    .from("tenant_settings")
    .select("branding, fiscal, locale, currency")
    .eq("tenant_id", tenantId)
    .single();
  if (error) throw error;
  return {
    tenantId,
    branding: data.branding,
    fiscal: data.fiscal,
    locale: data.locale as string,
    currency: data.currency as string,
  };
}

export async function restoreDemoSettings(snap: SettingsSnapshot): Promise<void> {
  const { error } = await admin
    .from("tenant_settings")
    .update({
      branding: snap.branding,
      fiscal: snap.fiscal,
      locale: snap.locale,
      currency: snap.currency,
    })
    .eq("tenant_id", snap.tenantId);
  if (error) throw error;
}

/** Borra el camarero de prueba por email (la membership desaparece en cascada al borrar el
 * usuario de Auth: FK `on delete cascade` sobre `auth.users`). No lanza si no existe. */
export async function deleteStaffByEmailForTest(email: string): Promise<void> {
  const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const match = (usersPage?.users ?? []).find((u) => u.email === email);
  if (!match) return;
  const { error } = await admin.auth.admin.deleteUser(match.id);
  if (error) throw error;
}
