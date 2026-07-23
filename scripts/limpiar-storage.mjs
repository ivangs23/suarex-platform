/**
 * Limpia las fotos huérfanas del bucket `catalog`: objetos de Storage que ya no referencia
 * ninguna fila. Ver `scripts/lib/storage-orphans.mjs` para el porqué (los deja
 * `import-catalog --reemplazar` y las ediciones del panel).
 *
 * BORRAR ES IRREVERSIBLE. Por defecto SIMULA: lista lo que sobra y su peso, sin tocar nada.
 * Solo con `--confirmar` borra de verdad.
 *
 *   node scripts/limpiar-storage.mjs <slug>              # simula (no borra)
 *   node scripts/limpiar-storage.mjs <slug> --confirmar  # borra los huérfanos de ese cliente
 *   node scripts/limpiar-storage.mjs --todos             # simula, todos los clientes
 *
 * Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno (en local, de `.env.test`).
 * NUNCA toca los repos/proyectos en producción: solo el bucket de la base configurada.
 */
import { createClient } from "@supabase/supabase-js";
import { assertDentroDelTenant, orphanPaths, pathDeUrl } from "./lib/storage-orphans.mjs";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const confirmar = args.includes("--confirmar");
const todos = args.includes("--todos");
const slug = args.find((a) => !a.startsWith("--"));

if (!slug && !todos) {
  console.error("Uso: node scripts/limpiar-storage.mjs <slug> [--confirmar] | --todos");
  process.exit(1);
}

const CARPETAS = ["products", "categories", "branding"];

async function listarObjetos(tenantId) {
  const rutas = [];
  for (const carpeta of CARPETAS) {
    const prefijo = `tenant/${tenantId}/${carpeta}`;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.storage
        .from("catalog")
        .list(prefijo, { limit: 1000, offset });
      if (error) throw error;
      for (const o of data ?? [])
        rutas.push({ path: `${prefijo}/${o.name}`, size: o.metadata?.size ?? 0 });
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return rutas;
}

async function referenciadasDe(tenantId) {
  const set = new Set();
  const [prods, cats, sett] = await Promise.all([
    db.from("products").select("image_url").eq("tenant_id", tenantId),
    db.from("categories").select("image_url").eq("tenant_id", tenantId),
    db.from("tenant_settings").select("branding").eq("tenant_id", tenantId),
  ]);
  for (const r of prods.data ?? []) {
    const p = pathDeUrl(r.image_url);
    if (p) set.add(p);
  }
  for (const r of cats.data ?? []) {
    const p = pathDeUrl(r.image_url);
    if (p) set.add(p);
  }
  for (const r of sett.data ?? []) {
    const b = r.branding ?? {};
    for (const p of [pathDeUrl(b.logoUrl), pathDeUrl(b.heroUrl)]) if (p) set.add(p);
  }
  return set;
}

async function limpiarTenant(slug, tenantId) {
  const [objetos, referenciadas] = await Promise.all([
    listarObjetos(tenantId),
    referenciadasDe(tenantId),
  ]);
  const rutas = objetos.map((o) => o.path);
  const huerfanas = orphanPaths(rutas, referenciadas);
  const bytes = objetos.filter((o) => huerfanas.includes(o.path)).reduce((a, o) => a + o.size, 0);

  console.log(`\nCliente '${slug}' (${tenantId})`);
  console.log(`  objetos:    ${rutas.length}`);
  console.log(`  en uso:     ${rutas.length - huerfanas.length}`);
  console.log(`  huérfanas:  ${huerfanas.length}  (${(bytes / 1048576).toFixed(1)} MB)`);

  if (huerfanas.length === 0) return;

  if (!confirmar) {
    console.log(`  (simulación: no se ha borrado nada. Añade --confirmar para borrar.)`);
    return;
  }

  // Guarda de prefijo ANTES de borrar: una sola ruta ajena aborta el lote entero.
  assertDentroDelTenant(tenantId, huerfanas);
  for (let i = 0; i < huerfanas.length; i += 200) {
    const lote = huerfanas.slice(i, i + 200);
    const { error } = await db.storage.from("catalog").remove(lote);
    if (error) throw error;
  }
  console.log(
    `  BORRADAS ${huerfanas.length} fotos huérfanas (${(bytes / 1048576).toFixed(1)} MB liberados).`,
  );
}

const { data: tenants, error } = todos
  ? await db.from("tenants").select("id, slug")
  : await db.from("tenants").select("id, slug").eq("slug", slug);
if (error) throw error;
if (!tenants?.length) {
  console.error(`No se encontró ningún cliente${todos ? "" : ` con slug '${slug}'`}.`);
  process.exit(1);
}

for (const t of tenants) await limpiarTenant(t.slug, t.id);
console.log(confirmar ? "\nHecho." : "\nSimulación terminada. Nada borrado.");
