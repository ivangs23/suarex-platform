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

// Sin STAFF_SEED_PASSWORD explícita, generamos una aleatoria en vez de exigir
// que alguien la elija a mano: nunca se hardcodea en el repo, y así
// `pnpm seed:staff` funciona por defecto en un clon nuevo sin que nadie tenga
// que inventarse ni recordar una contraseña.
const explicitPassword = process.env.STAFF_SEED_PASSWORD;
const password = explicitPassword ?? randomBytes(24).toString("base64url");

// La guardamos en `.env.test` -- el mismo fichero gitignorado que `pnpm db:env`
// genera y que Vitest (`vitest.config.ts`) y Playwright (`playwright.config.ts`)
// ya cargan -- en vez de inventar un segundo mecanismo de configuración.
// `tests/e2e/staff-auth.spec.ts` la lee de ahí sin que nadie tenga que
// exportarla a mano al correr `pnpm test:e2e`. Se escribe SIEMPRE (también
// cuando se pasó STAFF_SEED_PASSWORD explícita) para que `.env.test` refleje
// siempre la contraseña realmente sembrada, nunca una desincronizada de una
// ejecución anterior.
function persistPasswordToEnvTest(value) {
  if (!existsSync(ENV_TEST_PATH)) {
    throw new Error(
      `Falta ${ENV_TEST_PATH}: corre \`pnpm db:env\` antes de \`pnpm seed:staff\` (ver README).`,
    );
  }
  const existingLines = readFileSync(ENV_TEST_PATH, "utf8")
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("STAFF_SEED_PASSWORD="));
  writeFileSync(
    ENV_TEST_PATH,
    `${[...existingLines, `STAFF_SEED_PASSWORD=${value}`].join("\n")}\n`,
  );
}

persistPasswordToEnvTest(password);
console.log(
  explicitPassword
    ? `STAFF_SEED_PASSWORD (explícita) guardada en ${ENV_TEST_PATH}.`
    : `STAFF_SEED_PASSWORD no definida: se generó una aleatoria y se guardó en ${ENV_TEST_PATH} ` +
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
