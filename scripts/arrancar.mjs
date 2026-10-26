/**
 * `pnpm arrancar`: el proyecto entero para probar en local, en una orden. Docker → Supabase (y el
 * 502 de Kong) → hosts → secreto del webhook → web, `stripe listen` y la app de escritorio.
 * Ctrl+C lo para todo.
 *
 *   --comprobar       solo comprueba, no levanta nada
 *   --sin-stripe      sin webhook: los pagos no pasarán a «pagado»
 *   --sin-escritorio  sin la app de escritorio (el agente de impresión)
 */
import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import {
  conValor,
  cuentasDemo,
  EVENTOS_WEBHOOK,
  entornoHijo,
  esClaveDeTest,
  HOSTS_LOCALES,
  leerEnv,
  matarArbol,
} from "./lib/arranque.mjs";

const RAIZ = join(import.meta.dirname, "..");
const ENV_WEB = join(RAIZ, "apps/web/.env.local");
const ENV_TEST = join(RAIZ, ".env.test");
const WEB = "garum.localhost:3000";
// Por el host de un tenant: bajo `localhost` a secas, `proxy.ts` no sirve la ruta.
const WEBHOOK = `http://${WEB}/api/webhook/stripe`;
const DOCKER_DESKTOP = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";

const opciones = new Set(process.argv.slice(2));
const soloComprobar = opciones.has("--comprobar");
const sinStripe = opciones.has("--sin-stripe");
const sinEscritorio = opciones.has("--sin-escritorio");

const paso = (texto) => console.log(`\n▸ ${texto}`);
const bien = (texto) => console.log(`  ✓ ${texto}`);
const aviso = (texto) => console.log(`  ! ${texto}`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function salir(texto) {
  console.error(`\n✗ ${texto}`);
  process.exit(1);
}

/** Una orden de consola, con `shell` por los `.cmd` de Windows (pnpm, supabase). */
function correr(orden, env = {}, timeout = 60_000) {
  const r = spawnSync(orden, {
    cwd: RAIZ,
    shell: true,
    encoding: "utf8",
    timeout,
    env: { ...process.env, ...env },
  });
  return { ok: r.status === 0, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Código HTTP de un GET, o 0 si no responde. `host` para hablar con un tenant sin DNS. */
function estadoHttp(url, host, timeout = 5_000) {
  return new Promise((resolve) => {
    const peticion = http.get(url, { headers: host ? { host } : {}, timeout }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    peticion.on("timeout", () => peticion.destroy());
    peticion.on("error", () => resolve(0));
  });
}

function entorno() {
  paso("Ficheros de entorno");
  if (!existsSync(ENV_WEB)) salir("Falta apps/web/.env.local. La primera vez: README → Arranque.");
  const web = leerEnv(readFileSync(ENV_WEB, "utf8"));
  for (const clave of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!web.get(clave)) salir(`apps/web/.env.local no tiene ${clave}.`);
  }
  bien("apps/web/.env.local");
  const test = existsSync(ENV_TEST) ? leerEnv(readFileSync(ENV_TEST, "utf8")) : new Map();
  if (test.get("OWNER_SEED_PASSWORD")) bien(".env.test, con las cuentas demo");
  else aviso("sin cuentas demo: `pnpm db:env && pnpm seed:staff`");
  return { web, test };
}

async function docker() {
  paso("Docker");
  if (correr("docker info").ok) return bien("en marcha");
  if (soloComprobar) return aviso("no responde (`pnpm arrancar` abre Docker Desktop)");
  if (process.platform !== "win32" || !existsSync(DOCKER_DESKTOP)) {
    salir("Docker no responde. Arráncalo y vuelve a lanzar `pnpm arrancar`.");
  }
  // En este PC Docker Desktop no arranca solo con la sesión.
  aviso("no responde: abro Docker Desktop y espero hasta 3 min…");
  spawn(DOCKER_DESKTOP, [], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 36; i++) {
    await espera(5_000);
    if (correr("docker info").ok) return bien("en marcha");
  }
  salir("Docker Desktop no terminó de arrancar en 3 min.");
}

async function supabase(env) {
  paso("Supabase local");
  if (!correr("pnpm exec supabase status").ok) {
    if (soloComprobar) return aviso("parado (`pnpm arrancar` lo levanta)");
    console.log("  arrancando (la primera vez tarda)…");
    const r = spawnSync("pnpm exec supabase start", { cwd: RAIZ, shell: true, stdio: "inherit" });
    if (r.status !== 0) {
      salir(
        '`supabase start` falló. Si dice "forbidden by its access permissions", es WinNAT: CLAUDE.md → En Windows.',
      );
    }
  }
  bien("en marcha");
  // Tras un `db reset`, Kong puede quedarse con la IP vieja de Auth (gotcha de CLAUDE.md).
  const salud = `${env.get("SUPABASE_URL")}/auth/v1/health`;
  let estado = await estadoHttp(salud);
  if (estado === 502 && !soloComprobar) {
    aviso("auth da 502 a través de Kong: lo reinicio…");
    correr("docker restart supabase_kong_suarex-platform");
    await espera(5_000);
    estado = await estadoHttp(salud);
  }
  if (estado !== 200)
    salir(`auth responde ${estado}: mira \`docker logs supabase_kong_suarex-platform\`.`);
  bien("auth responde");
}

async function hosts() {
  paso("Hosts *.localhost");
  const faltan = [];
  for (const host of HOSTS_LOCALES) {
    await lookup(host).catch(() => faltan.push(host));
  }
  if (faltan.length === 0) return bien("resuelven todos");
  aviso("no resuelven (el navegador abre igual; el e2e y `stripe listen`, no).");
  aviso("Añádelos como admin en C:\\Windows\\System32\\drivers\\etc\\hosts:");
  for (const host of faltan) console.log(`      127.0.0.1 ${host}`);
}

/** Deja el secreto del webhook al día y dice si se puede lanzar `stripe listen`. */
function stripe(env) {
  paso("Webhook de Stripe");
  if (sinStripe) {
    aviso("--sin-stripe: los pagos no pasarán a «pagado»");
    return false;
  }
  const clave = env.get("STRIPE_SECRET_KEY");
  if (!esClaveDeTest(clave)) {
    aviso("STRIPE_SECRET_KEY no es de test: no escucho webhooks con ella");
    return false;
  }
  if (!correr("stripe --version").ok) {
    aviso(
      "sin CLI de Stripe (https://docs.stripe.com/stripe-cli): los pagos no pasarán a «pagado»",
    );
    return false;
  }
  // Con la clave del entorno no hace falta `stripe login`, y es la misma cuenta que cobra.
  const { salida } = correr("stripe listen --print-secret", { STRIPE_API_KEY: clave });
  const secreto = salida.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (!secreto) {
    aviso(`el CLI de Stripe no dio el secreto: ${salida.trim().split("\n").at(-1)}`);
    return false;
  }
  if (env.get("STRIPE_WEBHOOK_SECRET") === secreto) {
    bien("secreto del webhook al día");
  } else if (soloComprobar) {
    aviso("STRIPE_WEBHOOK_SECRET no es el de `stripe listen` (`pnpm arrancar` lo corrige)");
  } else {
    writeFileSync(
      ENV_WEB,
      conValor(readFileSync(ENV_WEB, "utf8"), "STRIPE_WEBHOOK_SECRET", secreto),
    );
    bien("STRIPE_WEBHOOK_SECRET de apps/web/.env.local puesto al de `stripe listen`");
  }
  return true;
}

const hijos = [];
let parando = false;
function pararTodo(codigo) {
  parando = true;
  for (const hijo of hijos) if (hijo.exitCode === null) matarArbol(hijo.pid);
  process.exit(codigo);
}

/** Lanza una orden larga con su salida prefijada, línea a línea. Si un proceso `critico` se
 *  cae, se para todo; si no (la app de escritorio, que se puede cerrar), lo demás sigue. */
function lanzar(nombre, orden, cambiosEnv = {}, { critico = true } = {}) {
  const hijo = spawn(orden, {
    cwd: RAIZ,
    shell: true,
    env: entornoHijo(process.env, cambiosEnv),
    detached: process.platform !== "win32",
  });
  for (const flujo of [hijo.stdout, hijo.stderr]) {
    let resto = "";
    flujo.setEncoding("utf8");
    flujo.on("data", (trozo) => {
      const lineas = (resto + trozo).split(/\r?\n/);
      resto = lineas.pop() ?? "";
      for (const linea of lineas) console.log(`[${nombre}] ${linea}`);
    });
  }
  hijo.on("exit", (codigo) => {
    if (parando) return;
    if (!critico)
      return console.log(`\n· «${nombre}» se cerró (código ${codigo}); lo demás sigue.`);
    console.error(`\n✗ «${nombre}» terminó (código ${codigo}). Paro el resto.`);
    pararTodo(codigo || 1);
  });
  hijos.push(hijo);
  return hijo;
}

function resumen(test, conWebhook, conEscritorio) {
  const lineas = [
    "",
    "════════════════════════════════════════════════════════════════",
    " Listo. Ctrl+C para pararlo todo.",
    "",
    " Carta (solo consulta)  http://garum.localhost:3000/1",
    " QR mesa 1 Garum        http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111",
    " QR mesa 1 Manuela      http://manuela.localhost:3000/m/33333333-3333-3333-3333-333333333333",
    " Supabase Studio        http://127.0.0.1:54323",
    " Correo local           http://127.0.0.1:54324",
    "",
  ];
  const cuentas = cuentasDemo(test);
  if (cuentas.length > 0) {
    lineas.push(" Cuentas demo:");
    for (const c of cuentas) lineas.push(`   ${c.url.padEnd(42)} ${c.email} / ${c.password}`);
    lineas.push("");
  }
  lineas.push(
    conWebhook
      ? " Pagos: tarjeta 4242 4242 4242 4242, fecha futura, cualquier CVC."
      : " Pagos: SIN webhook, el pedido no pasará a «pagado» ni llegará a Comandas.",
  );
  if (conEscritorio) {
    lineas.push(
      " Escritorio: se abre solo. Emparéjalo con el código de Panel → Dispositivos (Garum).",
    );
  }
  lineas.push("════════════════════════════════════════════════════════════════");
  console.log(lineas.join("\n"));
}

process.on("SIGINT", () => pararTodo(0));
process.on("SIGTERM", () => pararTodo(0));

const { web, test } = entorno();
await docker();
await supabase(web);
await hosts();
const conWebhook = stripe(web);

if (soloComprobar) {
  paso("Comprobación terminada: no he levantado nada.");
  process.exit(0);
}

paso("Web, webhook y escritorio");
if ((await estadoHttp("http://127.0.0.1:3000/", WEB)) !== 0) {
  salir("El puerto 3000 ya está ocupado: ¿hay otro `next dev` abierto?");
}
lanzar("web", "pnpm --filter @suarex/web dev");
if (conWebhook) {
  lanzar("stripe", `stripe listen --events ${EVENTOS_WEBHOOK.join(",")} --forward-to ${WEBHOOK}`, {
    STRIPE_API_KEY: web.get("STRIPE_SECRET_KEY"),
  });
}

// Espera a que Next escuche y compila la carta una vez, para que la primera visita no espere.
while ((await estadoHttp("http://127.0.0.1:3000/", WEB)) === 0) await espera(1_000);
await estadoHttp("http://127.0.0.1:3000/1", WEB, 180_000);

// El agente, cuando la web ya responde: su panel y el emparejamiento cuelgan de ella. Config
// pública (anon key), nunca la service role. Sin `ELECTRON_RUN_AS_NODE`, que heredan las
// terminales de VS Code y hace que Electron arranque como Node y muera sin ventana.
if (!sinEscritorio) {
  lanzar(
    "escritorio",
    "pnpm --filter @suarex/agent-desktop dev",
    {
      SUPABASE_URL: web.get("SUPABASE_URL"),
      SUPABASE_ANON_KEY: web.get("SUPABASE_ANON_KEY"),
      PLATFORM_WEB_ORIGIN: `http://${WEB}`,
      ELECTRON_RUN_AS_NODE: null,
    },
    { critico: false },
  );
}
resumen(test, conWebhook, !sinEscritorio);
