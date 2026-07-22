import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// `auth.users` no lo toca `supabase/seed.sql` directamente (vive en el esquema
// de GoTrue, no en `public`): las altas de usuarios de verdad pasan por la API
// de administración, aquí, y no por SQL plano. Este script solo se ejecuta a
// mano en local, nunca en producción ni empaquetado en ningún bundle -- por
// eso puede importar el SDK crudo con la service role key (ver excepción
// dedicada en biome.json).

const ENV_TEST_PATH = ".env.test";

// Sin STAFF_SEED_PASSWORD/OWNER_SEED_PASSWORD explícitas, generamos una aleatoria
// distinta para cada rol en vez de exigir que alguien las elija a mano: nunca se
// hardcodean en el repo, y así `pnpm seed:staff` funciona por defecto en un clon
// nuevo sin que nadie tenga que inventarse ni recordar una contraseña.
const staffPassword = process.env.STAFF_SEED_PASSWORD ?? randomBytes(24).toString("base64url");
const ownerPassword = process.env.OWNER_SEED_PASSWORD ?? randomBytes(24).toString("base64url");

// Las guardamos en `.env.test` -- el mismo fichero gitignorado que `pnpm db:env`
// genera y que Vitest (`vitest.config.ts`) y Playwright (`playwright.config.ts`)
// ya cargan -- en vez de inventar un segundo mecanismo de configuración.
// `tests/e2e/staff-auth.spec.ts`/`tests/e2e/admin-catalogo.spec.ts` las leen de
// ahí sin que nadie tenga que exportarlas a mano al correr `pnpm test:e2e`. Se
// escriben SIEMPRE (también cuando se pasó la variable explícita) para que
// `.env.test` refleje siempre la contraseña realmente sembrada, nunca una
// desincronizada de una ejecución anterior.
function persistPasswordToEnvTest(key, value) {
  if (!existsSync(ENV_TEST_PATH)) {
    throw new Error(
      `Falta ${ENV_TEST_PATH}: corre \`pnpm db:env\` antes de \`pnpm seed:staff\` (ver README).`,
    );
  }
  const existingLines = readFileSync(ENV_TEST_PATH, "utf8")
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith(`${key}=`));
  writeFileSync(ENV_TEST_PATH, `${[...existingLines, `${key}=${value}`].join("\n")}\n`);
}

persistPasswordToEnvTest("STAFF_SEED_PASSWORD", staffPassword);
persistPasswordToEnvTest("OWNER_SEED_PASSWORD", ownerPassword);
console.log(
  process.env.STAFF_SEED_PASSWORD
    ? `STAFF_SEED_PASSWORD (explícita) guardada en ${ENV_TEST_PATH}.`
    : `STAFF_SEED_PASSWORD no definida: se generó una aleatoria y se guardó en ${ENV_TEST_PATH} ` +
        "(gitignorado) -- pnpm test:e2e la lee de ahí automáticamente, sin exportar nada a mano.",
);
console.log(
  process.env.OWNER_SEED_PASSWORD
    ? `OWNER_SEED_PASSWORD (explícita) guardada en ${ENV_TEST_PATH}.`
    : `OWNER_SEED_PASSWORD no definida: se generó una aleatoria y se guardó en ${ENV_TEST_PATH} ` +
        "(gitignorado) -- pnpm test:e2e la lee de ahí automáticamente, sin exportar nada a mano.",
);

// Igual que scripts/write-test-env.mjs: se lee del stack local vía `supabase status`
// en vez de un .env, para no depender de que exista/esté actualizado .env.test.
const raw = execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" });
const status = JSON.parse(raw);

const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Tenants demo sembrados por supabase/seed.sql.
const DEMO_TENANT_SLUGS = ["garum", "manuela"];

// Dos cuentas demo por tenant: `staff@{slug}.local` (rol `staff`, sin acceso a
// `/admin`) y `owner@{slug}.local` (rol `owner`, la única que `requireManager()`
// deja pasar junto con `admin` -- ver `apps/web/lib/require-manager.ts`). El panel
// de gestión de catálogo (Task 5, fase D1) necesita un owner demo para que su e2e
// (`tests/e2e/admin-catalogo.spec.ts`) pueda probar que un owner SÍ puede gestionar
// la carta, no solo que un staff no puede.
const ROLE_SEEDS = [
  { role: "staff", emailPrefix: "staff", password: staffPassword },
  { role: "owner", emailPrefix: "owner", password: ownerPassword },
];

async function seedUser({ tenantId, slug, role, emailPrefix, password }) {
  const email = `${emailPrefix}@${slug}.local`;

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
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingMembership) {
    console.log(`Membresía de ${email} en '${slug}' ya existía, se omite.`);
    return;
  }

  const { error: membershipError } = await admin.from("memberships").insert({
    user_id: userId,
    tenant_id: tenantId,
    role,
  });
  if (membershipError) {
    throw new Error(`No se pudo crear la membresía de ${email}: ${membershipError.message}`);
  }

  console.log(`Personal sembrado: ${email} -> tenant '${slug}' (rol ${role})`);
}

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

  for (const seed of ROLE_SEEDS) {
    await seedUser({ tenantId: tenant.id, slug, ...seed });
  }
}
