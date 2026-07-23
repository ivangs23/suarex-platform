/**
 * Rellena las traducciones al inglés y al portugués de la carta de Manuela (descripciones de
 * plato y nombres de categoría). Con ellas, `availableLangs` deja de ver un catálogo solo en
 * español y el selector de idioma aparece con las tres. Ver `scripts/lib/manuela-i18n.mjs`.
 *
 * Casa por el texto en español, así que es RE-EJECUTABLE: correrlo otra vez no duplica nada, y
 * hay que correrlo DESPUÉS de cada `import-catalog` (que reimporta solo en español).
 *
 *   node scripts/traducir-manuela.mjs           # simula: dice qué cambiaría, sin tocar nada
 *   node scripts/traducir-manuela.mjs --aplicar # escribe las traducciones
 *
 * Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno. NUNCA toca producción: solo
 * la base configurada.
 */
import { createClient } from "@supabase/supabase-js";
import { CATEGORIAS, DESCRIPCIONES, EXTRAS, planear } from "./lib/manuela-i18n.mjs";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const aplicar = process.argv.slice(2).includes("--aplicar");
const SLUG = "manuela";

const { data: tenant, error: errTenant } = await db
  .from("tenants")
  .select("id")
  .eq("slug", SLUG)
  .single();
if (errTenant || !tenant) {
  console.error(`No se encontró el cliente '${SLUG}':`, errTenant?.message ?? "no existe");
  process.exit(1);
}

async function traducir(tabla, campo, mapa) {
  const { data: filas, error } = await db
    .from(tabla)
    .select(`id, ${campo}`)
    .eq("tenant_id", tenant.id);
  if (error) throw new Error(`leyendo ${tabla}: ${error.message}`);

  const updates = planear(filas, campo, mapa);
  if (!aplicar) {
    console.log(`${tabla}: ${updates.length} de ${filas.length} filas cambiarían (${campo}).`);
    return;
  }
  for (const { id, valor } of updates) {
    const { error: errUpd } = await db
      .from(tabla)
      .update({ [campo]: valor })
      .eq("id", id);
    if (errUpd) throw new Error(`actualizando ${tabla} ${id}: ${errUpd.message}`);
  }
  console.log(`${tabla}: ${updates.length} filas actualizadas (${campo}).`);
}

await traducir("categories", "name_i18n", CATEGORIAS);
await traducir("products", "description_i18n", DESCRIPCIONES);
await traducir("product_extras", "name_i18n", EXTRAS);

if (!aplicar) console.log("\nSimulación. Repite con --aplicar para escribir.");
