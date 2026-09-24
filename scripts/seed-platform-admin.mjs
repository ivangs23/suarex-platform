/**
 * Da de alta un SUPERADMIN de plataforma (equipo de SuarEx): su cuenta de Auth y su fila en
 * `platform_admins`.
 *
 *   node scripts/seed-platform-admin.mjs --email ivan@suarex.app
 *
 * Es el ÚNICO camino para crear un superadmin, y es a propósito: exige acceso al servidor (la
 * service key), no basta con tener una sesión en la consola. Si la propia consola pudiera
 * crear superadmins, comprometer una sola cuenta comprometería la plataforma entera. Por el
 * mismo motivo `platform_admins` tiene RLS sin policies y revoke a anon/authenticated: no hay
 * ningún otro camino hacia esa tabla.
 *
 * IDEMPOTENTE: reejecutar no duplica nada. Reutiliza la cuenta si el correo ya existe y crea
 * la fila solo si falta.
 *
 * Lee la URL y la service key de `supabase status` (igual que seed-staff.mjs) para no depender
 * de que `.env.test` exista o esté al día, y guarda ahí las credenciales para que Playwright
 * las encuentre sin exportar nada a mano.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ENV_TEST_PATH = ".env.test";

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const email = arg("email");
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Uso: node scripts/seed-platform-admin.mjs --email <correo>");
  process.exit(1);
}
const password = arg("password") ?? `sx-${randomBytes(12).toString("base64url")}`;

function persistToEnvTest(key, value) {
  if (!existsSync(ENV_TEST_PATH)) return;
  const lines = readFileSync(ENV_TEST_PATH, "utf8")
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith(`${key}=`));
  writeFileSync(ENV_TEST_PATH, `${[...lines, `${key}=${value}`].join("\n")}\n`);
}

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }));
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Buscar la cuenta paginando: `listUsers()` sin argumentos solo trae los 50 más recientes, y
// una cuenta antigua -- justo el caso de reejecutar esto meses después -- no saldría.
async function buscarUsuarioPorEmail(buscado) {
  const objetivo = buscado.toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) return null;
    const encontrado = data.users.find((u) => u.email?.toLowerCase() === objetivo);
    if (encontrado) return encontrado;
  }
}

let usuario = await buscarUsuarioPorEmail(email);
let passwordNueva = false;
if (!usuario) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  usuario = data.user;
  passwordNueva = true;
}

const { error: errorFila } = await admin
  .from("platform_admins")
  .upsert({ user_id: usuario.id, email }, { onConflict: "user_id" });
if (errorFila) throw errorFila;

persistToEnvTest("PLATFORM_ADMIN_EMAIL", email);
if (passwordNueva) persistToEnvTest("PLATFORM_ADMIN_PASSWORD", password);

console.log(`Superadmin de plataforma: ${email} (user_id ${usuario.id})`);
console.log(
  passwordNueva
    ? `Contraseña: ${password}  — guardada también en ${ENV_TEST_PATH} (gitignorado).`
    : "La cuenta ya existía: se conserva su contraseña actual y solo se aseguró la fila en platform_admins.",
);
