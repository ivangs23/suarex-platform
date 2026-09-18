import {
  authAdminForPlatformConsole,
  platformAdminsTable,
  tenantScoped,
  tenantsTableForPlatformConsole,
} from "./client.js";
import type { PlanStatus } from "./types.js";

/**
 * ¿Es este usuario del equipo de SuarEx?
 *
 * Búsqueda por clave primaria contra `platform_admins`, que es INALCANZABLE desde PostgREST:
 * RLS sin policies más `revoke all from anon, authenticated`. La única forma de entrar en esa
 * tabla es el `service_role`, y la única forma de añadirse es tener acceso al servidor
 * (`scripts/seed-platform-admin.mjs`).
 *
 * Eso es deliberado: si un superadmin pudiera darse de alta a sí mismo desde la consola,
 * comprometer una sola cuenta comprometería la plataforma entera.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await platformAdminsTable()
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export type PlatformTenantRow = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  plan: string;
  planStatus: PlanStatus;
  graceUntil: string | null;
  customDomain: string | null;
  createdAt: string;
};

/** Todos los clientes, el más nuevo primero. La única consulta del sistema que barre entre
 *  tenants a propósito: ver la decimosexta exención en `client.ts`. */
export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  const { data, error } = await tenantsTableForPlatformConsole()
    .select("id, slug, name, status, plan, plan_status, grace_until, custom_domain, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((f) => ({
    id: f.id as string,
    slug: f.slug as string,
    name: f.name as string,
    status: f.status as "active" | "suspended",
    plan: f.plan as string,
    planStatus: f.plan_status as PlanStatus,
    graceUntil: (f.grace_until as string | null) ?? null,
    customDomain: (f.custom_domain as string | null) ?? null,
    createdAt: f.created_at as string,
  }));
}

export async function setTenantStatus(
  tenantId: string,
  status: "active" | "suspended",
): Promise<void> {
  const { error } = await tenantsTableForPlatformConsole().update({ status }).eq("id", tenantId);
  if (error) throw error;
}

/** Engancha el cliente de Stripe recién creado. Separada del alta a propósito: si Stripe no
 *  responde, el cliente ya existe y se sirve igual (nace en `trialing`); el identificador se
 *  puede enganchar después. Al revés -- abortar el alta porque Stripe falló -- dejaría al
 *  restaurante sin carta por un problema de facturación. */
export async function setTenantStripeCustomer(
  tenantId: string,
  stripeCustomerId: string,
): Promise<void> {
  const { error } = await tenantsTableForPlatformConsole()
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", tenantId);
  if (error) throw error;
}

export type CreateTenantInput = {
  slug: string;
  name: string;
  ownerEmail: string;
  theme: string;
  locale: string;
  currency: string;
  /** Host del nuevo cliente + `/staff/nueva-clave`: a donde vuelve el dueño al abrir la
   *  invitación. Lo construye la Server Action a partir del slug y la raíz configurada. */
  redirectTo: string;
};

/** Busca una cuenta de Auth por correo PAGINANDO. `listUsers()` sin argumentos solo trae los 50
 *  más recientes: una cuenta antigua -- que es exactamente el caso "el dueño ya es cliente de
 *  otro local" -- no saldría, y el alta abortaría después de haber creado ya tenant, sede y
 *  ajustes, dejando un alta a medias. auth-js 2.110.7 no tiene `getUserByEmail`. */
async function buscarUsuarioPorEmail(email: string): Promise<string | null> {
  const buscado = email.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await authAdminForPlatformConsole().listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) return null;
    const encontrado = data.users.find((u) => u.email?.toLowerCase() === buscado);
    if (encontrado) return encontrado.id;
  }
}

/**
 * Alta completa de un cliente: tenant, sede por defecto, ajustes y primer owner invitado.
 *
 * IDEMPOTENTE por slug y por correo, igual que `scripts/create-tenant.mjs` (al que sustituye):
 * un reintento tras un fallo a mitad reutiliza lo que ya exista y crea lo que falte.
 *
 * LEER-ENTONCES-CREAR, no upsert. `tenantScoped(...).upsert` es un INSERT ... ON CONFLICT DO
 * UPDATE sobre TODAS las columnas del payload, así que un segundo intento reescribiría
 * `branding` y `fiscal` a los valores del formulario y borraría lo que el dueño haya editado
 * en /admin/ajustes. Idempotente significa "no duplica ni rompe", no "restablece".
 *
 * El orden importa: la sede por defecto se crea SIEMPRE, porque sin `venues.is_default` no se
 * puede crear ningún pedido (`createPendingOrder` la exige) y el cliente tendría una carta que
 * no deja pedir.
 */
export async function createTenantWithOwner(
  input: CreateTenantInput,
): Promise<{ tenantId: string; ownerUserId: string }> {
  const existente = await tenantsTableForPlatformConsole()
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();
  if (existente.error) throw existente.error;

  let tenantId = (existente.data as { id: string } | null)?.id ?? null;
  if (!tenantId) {
    const { data, error } = await tenantsTableForPlatformConsole()
      .insert({ slug: input.slug, name: input.name })
      .select("id")
      .single();
    if (error) throw error;
    tenantId = (data as { id: string }).id;
  }

  // A partir de aquí ya hay tenantId, así que TODO lo demás va por `tenantScoped`: la consola
  // no tiene ningún privilegio extra sobre las tablas del cliente.
  const { data: sedes } = await tenantScoped("venues", tenantId).select("id");
  if (!sedes || sedes.length === 0) {
    const { error } = await tenantScoped("venues", tenantId).insert({
      name: input.name,
      slug: "principal",
      is_default: true,
      timezone: "Europe/Madrid",
    });
    if (error) throw error;
  }

  const { data: ajustes } = await tenantScoped("tenant_settings", tenantId).select("tenant_id");
  if (!ajustes || ajustes.length === 0) {
    const { error } = await tenantScoped("tenant_settings", tenantId).insert({
      // `branding.name` NO es decorativo: la carta y el recibo pintan
      // `parseBranding(branding).name ?? tenant.slug`. Con `{}` el cliente enseñaría su slug
      // ("bar-de-prueba") en vez de su nombre hasta que alguien entrara en ajustes.
      branding: { name: input.name },
      fiscal: {},
      locale: input.locale,
      currency: input.currency,
      theme: input.theme,
      channels: ["qr-mesa"],
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  // La invitación crea la cuenta Y manda el correo. Si el correo ya tenía cuenta (reintento, o
  // el dueño ya es cliente de otro local) falla, y entonces se recupera paginando.
  const invitacion = await authAdminForPlatformConsole().inviteUserByEmail(input.ownerEmail, {
    redirectTo: input.redirectTo,
  });
  const ownerUserId = invitacion.data?.user?.id ?? (await buscarUsuarioPorEmail(input.ownerEmail));
  if (!ownerUserId) {
    throw new Error(`No se pudo crear ni recuperar la cuenta de ${input.ownerEmail}`);
  }

  const { error: errorMembership } = await tenantScoped("memberships", tenantId).upsert(
    { user_id: ownerUserId, role: "owner" },
    "user_id,tenant_id",
  );
  if (errorMembership) throw errorMembership;

  return { tenantId, ownerUserId };
}
