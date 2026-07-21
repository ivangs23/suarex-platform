import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// `auth.users` no lo toca `supabase/seed.sql` directamente (vive en el esquema
// de GoTrue, no en `public`): las altas de usuarios de verdad pasan por la API
// de administración, aquí, y no por SQL plano. Este script solo se ejecuta a
// mano en local, nunca en producción ni empaquetado en ningún bundle -- por
// eso puede importar el SDK crudo con la service role key (ver excepción
// dedicada en biome.json).

const password = process.env.STAFF_SEED_PASSWORD;
if (!password) {
  throw new Error(
    "Falta STAFF_SEED_PASSWORD: define la contraseña de desarrollo del personal sembrado " +
      "(ver README) y vuelve a ejecutar, p. ej. `STAFF_SEED_PASSWORD=... pnpm seed:staff`.",
  );
}

// Igual que scripts/write-test-env.mjs: se lee del stack local vía `supabase status`
// en vez de un .env, para no depender de que exista/esté actualizado .env.test.
const raw = execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" });
const status = JSON.parse(raw);

const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Tenants demo sembrados por supabase/seed.sql.
const DEMO_TENANT_SLUGS = ["garum", "manuela"];

for (const slug of DEMO_TENANT_SLUGS) {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .single();
  if (tenantError) {
    throw new Error(
      `Tenant '${slug}' no encontrado (¿corriste \`supabase db reset\`?): ${tenantError.message}`,
    );
  }

  const email = `staff@${slug}.local`;

  // Idempotente: si ya existe un usuario con este email (ejecuciones repetidas
  // de este script sobre el mismo stack, sin pasar por `supabase db reset`),
  // se reutiliza en vez de fallar por email duplicado.
  const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) {
    throw new Error(`No se pudo listar usuarios existentes: ${listError.message}`);
  }
  let userId = existingUsers.users.find((u) => u.email === email)?.id;

  if (!userId) {
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userError) {
      throw new Error(`No se pudo crear el usuario ${email}: ${userError.message}`);
    }
    userId = user.user.id;
  } else {
    console.log(`Usuario ${email} ya existía, se reutiliza.`);
  }

  const { data: existingMembership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenant.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMembership) {
    console.log(`Membresía de ${email} en '${slug}' ya existía, se omite.`);
    continue;
  }

  const { error: membershipError } = await admin.from("memberships").insert({
    user_id: userId,
    tenant_id: tenant.id,
    role: "staff",
  });
  if (membershipError) {
    throw new Error(`No se pudo crear la membresía de ${email}: ${membershipError.message}`);
  }

  console.log(`Personal sembrado: ${email} -> tenant '${slug}' (rol staff)`);
}
