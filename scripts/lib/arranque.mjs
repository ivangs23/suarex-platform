import { spawnSync } from "node:child_process";

/** Utilidades de `scripts/arrancar.mjs`, aparte para poder probarlas sin levantar nada. */

/** Hosts de tenant y de plataforma que el e2e y `stripe listen` resuelven por el SO. */
export const HOSTS_LOCALES = [
  "garum.localhost",
  "manuela.localhost",
  "admin.localhost",
  "notadmin.localhost",
  "admin.garum.localhost",
];

/** Eventos que atiende `api/webhook/stripe/route.ts`. El CLI de Stripe exige nombrarlos (o
 *  `--all-snapshot`); `arranque.test.mjs` comprueba que coinciden con los de la ruta. */
export const EVENTOS_WEBHOOK = [
  "payment_intent.succeeded",
  "charge.refunded",
  "charge.dispute.created",
];

/** `CLAVE=valor` de un fichero .env, sin comentarios ni comillas envolventes. */
export function leerEnv(texto) {
  const env = new Map();
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (m) env.set(m[1], m[2].trim().replace(/^(['"])(.*)\1$/, "$2"));
  }
  return env;
}

/** El mismo .env con `clave=valor`: sustituye la línea si existe; si no, la añade al final. */
export function conValor(texto, clave, valor) {
  const linea = `${clave}=${valor}`;
  const existente = new RegExp(`^\\s*${clave}\\s*=.*$`, "m");
  if (existente.test(texto)) return texto.replace(existente, () => linea);
  return `${texto.replace(/\s*$/, "")}\n${linea}\n`;
}

/** Cuentas demo de `pnpm seed:staff` y del superadmin, con las contraseñas de `.env.test`. */
export function cuentasDemo(envTest) {
  const cuentas = [];
  for (const slug of ["garum", "manuela"]) {
    const owner = envTest.get("OWNER_SEED_PASSWORD");
    const staff = envTest.get("STAFF_SEED_PASSWORD");
    if (owner)
      cuentas.push({
        url: `http://${slug}.localhost:3000/admin`,
        email: `owner@${slug}.local`,
        password: owner,
      });
    if (staff)
      cuentas.push({
        url: `http://${slug}.localhost:3000/staff`,
        email: `staff@${slug}.local`,
        password: staff,
      });
  }
  const admin = envTest.get("PLATFORM_ADMIN_EMAIL");
  const adminPassword = envTest.get("PLATFORM_ADMIN_PASSWORD");
  if (admin && adminPassword) {
    cuentas.push({
      url: "http://admin.localhost:3000/plataforma",
      email: admin,
      password: adminPassword,
    });
  }
  return cuentas;
}

/** Entorno de un hijo: `base` con `cambios` aplicados; `null` QUITA la variable. Sin distinguir
 *  mayúsculas, como Windows (`Path` y `PATH` son la misma). */
export function entornoHijo(base, cambios) {
  const env = { ...base };
  for (const [clave, valor] of Object.entries(cambios)) {
    for (const existente of Object.keys(env)) {
      if (existente.toUpperCase() === clave.toUpperCase()) delete env[existente];
    }
    if (valor !== null && valor !== undefined) env[clave] = valor;
  }
  return env;
}

/** Solo claves de TEST: el webhook local nunca debe escuchar los eventos de la cuenta real. */
export function esClaveDeTest(clave) {
  return typeof clave === "string" && /^(sk|rk)_test_/.test(clave);
}

/**
 * Mata un proceso y todos sus hijos. En Windows `kill` solo alcanza al primero y `next dev` se
 * queda huérfano ocupando el 3000: hace falta `taskkill /T`. En el resto, el grupo del proceso
 * (que se lanza con `detached`).
 */
export function matarArbol(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Ya no existía.
  }
}
