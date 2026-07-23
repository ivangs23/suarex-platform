import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { elegirAdaptador } from "./lib/source-adapters.mjs";

/**
 * Importa el catálogo real de un cliente a la plataforma, desde un volcado JSON de su
 * aplicación anterior.
 *
 *   node scripts/import-catalog.mjs .import/garum-catalogo.json garum --reemplazar
 *
 * NO toca en ningún momento el Supabase de producción del cliente: trabaja sobre un fichero
 * ya descargado. Bajar ese fichero es un paso aparte y de SOLO LECTURA (su anon key, la
 * misma que su web entrega a cualquier visitante).
 *
 * Cada cliente trae su carta en el esquema que se inventó su aplicación anterior. Esas
 * diferencias NO viven aquí: `scripts/lib/source-adapters.mjs` traduce cada origen a una
 * forma canónica y este fichero solo conoce esa forma. Para migrar un cliente nuevo se
 * escribe un adaptador; el importador no se toca.
 *
 * Es IDEMPOTENTE: identifica las categorías por `slug` y los productos por (categoría,
 * nombre), así que ejecutarlo dos veces actualiza en vez de duplicar.
 *
 * Solo se ejecuta a mano, en local o contra el VPS, nunca empaquetado en ningún bundle --
 * por eso puede usar el SDK crudo con la service role key, igual que `seed-staff.mjs`.
 */

const args = process.argv.slice(2);
const reemplazar = args.includes("--reemplazar");
const sinImagenes = args.includes("--sin-imagenes");
const [jsonPath, tenantSlug] = args.filter((a) => !a.startsWith("--"));

if (!jsonPath || !tenantSlug) {
  console.error(
    "Uso: node scripts/import-catalog.mjs <fichero.json> <slug> [--reemplazar] [--sin-imagenes]\n" +
      "  --reemplazar    borra antes el catálogo que ya tuviera el cliente, para que el\n" +
      "                  resultado sea EXACTAMENTE el volcado y no una mezcla con lo anterior.\n" +
      "  --sin-imagenes  no descarga ni sube las fotos. Útil para iterar rápido sobre los\n" +
      "                  datos sin esperar a la red.",
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}

const db = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const crudo = JSON.parse(readFileSync(jsonPath, "utf8"));
const adaptador = elegirAdaptador(crudo);
const origen = adaptador.convierte(crudo);
console.log(`Formato detectado: ${adaptador.nombre}`);

const { data: tenant, error: tenantError } = await db
  .from("tenants")
  .select("id")
  .eq("slug", tenantSlug)
  .maybeSingle();

if (tenantError) throw tenantError;
if (!tenant) {
  console.error(`No existe ningún cliente con slug '${tenantSlug}'.`);
  process.exit(1);
}
const tenantId = tenant.id;

// ---------------------------------------------------------------------------
// 0. Reemplazo opcional.
//
// Sin esto, importar sobre un cliente que ya tenía catálogo (p. ej. el de muestra del seed)
// deja una MEZCLA: las categorías cuyo slug coincide se fusionan y las que no, se quedan
// colgando. El resultado parece correcto pero la carta enseña categorías que el cliente no
// tiene. El `on delete cascade` de categories -> products -> product_extras se lleva todo.
// ---------------------------------------------------------------------------

if (reemplazar) {
  const { error } = await db.from("categories").delete().eq("tenant_id", tenantId);
  if (error) throw error;
  console.log(`Catálogo anterior de '${tenantSlug}' borrado (--reemplazar).`);
}

// ---------------------------------------------------------------------------
// 1. Categorías, en dos pasadas.
//
// El árbol NO se puede insertar de una: `parent_id` referencia `categories(id)`, y los ids
// de destino no existen hasta después del insert. Se insertan planas y luego se enlazan.
// ---------------------------------------------------------------------------

const filasCategoria = origen.categories.map((c) => ({
  tenant_id: tenantId,
  slug: c.slug,
  name_i18n: c.nameI18n,
  icon: c.icon,
  destination: c.destination,
  sort_order: c.sortOrder,
}));

const { error: catError } = await db
  .from("categories")
  .upsert(filasCategoria, { onConflict: "tenant_id,slug" });
if (catError) throw catError;

const { data: categoriasDestino, error: leerCatError } = await db
  .from("categories")
  .select("id, slug")
  .eq("tenant_id", tenantId);
if (leerCatError) throw leerCatError;

/** slug -> id en destino */
const idPorSlug = new Map(categoriasDestino.map((c) => [c.slug, c.id]));
/** sourceId -> slug, para traducir los padres del volcado */
const slugPorSourceId = new Map(origen.categories.map((c) => [c.sourceId, c.slug]));

let enlazadas = 0;
let padresPerdidos = 0;
for (const c of origen.categories) {
  if (!c.parentSourceId) continue;
  const slugPadre = slugPorSourceId.get(c.parentSourceId);
  const idPadre = slugPadre ? idPorSlug.get(slugPadre) : undefined;
  if (!idPadre) {
    // Un padre que no viene en el volcado: se deja como categoría raíz en vez de abortar.
    // Perder la jerarquía de una rama es recuperable; perder el catálogo entero, no.
    console.warn(`  aviso: la categoría '${c.slug}' apunta a un padre que no está en el volcado`);
    padresPerdidos++;
    continue;
  }
  const { error } = await db
    .from("categories")
    .update({ parent_id: idPadre })
    .eq("tenant_id", tenantId)
    .eq("slug", c.slug);
  if (error) throw error;
  enlazadas++;
}

// ---------------------------------------------------------------------------
// 2. Productos.
//
// Sin clave natural en la base (no hay `unique` sobre nombre), la idempotencia se resuelve
// aquí: se lee lo que ya hay y se decide actualizar o insertar por (categoría, nombre).
// ---------------------------------------------------------------------------

const { data: productosDestino, error: leerProdError } = await db
  .from("products")
  .select("id, category_id, name_i18n")
  .eq("tenant_id", tenantId);
if (leerProdError) throw leerProdError;

const clave = (categoryId, nombre) => `${categoryId} ${nombre}`;
const idPorClave = new Map(
  productosDestino.map((p) => [clave(p.category_id, p.name_i18n?.es ?? ""), p.id]),
);

const aInsertar = [];
const aActualizar = [];
let sinCategoria = 0;

/** Resuelve la categoría de destino de un producto canónico, o `undefined`. */
function categoriaDe(p) {
  const slug = slugPorSourceId.get(p.categorySourceId);
  return slug ? idPorSlug.get(slug) : undefined;
}

for (const p of origen.products) {
  const categoryId = categoriaDe(p);
  if (!categoryId) {
    // Su categoría no vino en el volcado: se cuenta y se informa al final en vez de
    // colarlo en una categoría cualquiera.
    sinCategoria++;
    continue;
  }

  const fila = {
    tenant_id: tenantId,
    category_id: categoryId,
    name_i18n: p.nameI18n,
    description_i18n: p.descriptionI18n,
    price: p.price,
    allergen_ids: p.allergenIds,
    is_available: p.isAvailable,
    sort_order: p.sortOrder,
  };

  const existente = idPorClave.get(clave(categoryId, p.nameI18n.es ?? ""));
  if (existente) aActualizar.push({ id: existente, fila });
  else aInsertar.push(fila);
}

if (aInsertar.length > 0) {
  const { error } = await db.from("products").insert(aInsertar);
  if (error) throw error;
}
for (const { id, fila } of aActualizar) {
  const { error } = await db.from("products").update(fila).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// 3. Extras de producto. Van después porque referencian el `id` del producto, que solo se
// conoce tras insertarlo. Se releen de la base: los del origen son de OTRA base.
// ---------------------------------------------------------------------------

const { data: productosFinales, error: releerError } = await db
  .from("products")
  .select("id, category_id, name_i18n, image_url")
  .eq("tenant_id", tenantId);
if (releerError) throw releerError;

const productoPorClave = new Map(
  productosFinales.map((p) => [clave(p.category_id, p.name_i18n?.es ?? ""), p]),
);

const { data: extrasExistentes, error: leerExtrasError } = await db
  .from("product_extras")
  .select("product_id, name_i18n")
  .eq("tenant_id", tenantId);
if (leerExtrasError) throw leerExtrasError;

const extrasYaPuestos = new Set(
  extrasExistentes.map((e) => `${e.product_id} ${e.name_i18n?.es ?? ""}`),
);

const extrasAInsertar = [];
for (const p of origen.products) {
  const categoryId = categoriaDe(p);
  if (!categoryId) continue;
  const destino = productoPorClave.get(clave(categoryId, p.nameI18n.es ?? ""));
  if (!destino) continue;

  for (const e of p.extras) {
    const nombre = e.nameI18n.es ?? "";
    if (extrasYaPuestos.has(`${destino.id} ${nombre}`)) continue;
    extrasAInsertar.push({
      tenant_id: tenantId,
      product_id: destino.id,
      name_i18n: e.nameI18n,
      price: e.price,
    });
  }
}

if (extrasAInsertar.length > 0) {
  const { error } = await db.from("product_extras").insert(extrasAInsertar);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// 4. Fotos de producto.
//
// El volcado trae URLs públicas del Storage del CLIENTE. Copiarlas tal cual dejaría la
// carta dependiendo para siempre del servidor del que se está migrando: el día que lo
// apague, todas las fotos desaparecen. Se descargan y se resuben a NUESTRO bucket.
//
// Descargar es leer una URL pública, exactamente lo que hace el navegador de cualquiera que
// abra su carta. No se toca su base de datos.
// ---------------------------------------------------------------------------

const TIPOS_IMAGEN = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES_IMAGEN = 5 * 1024 * 1024;

let fotosSubidas = 0;
let fotosConservadas = 0;
const fotosFallidas = [];

/**
 * Descarga una imagen del origen y la sube a NUESTRO bucket. Devuelve la ruta, o lanza.
 *
 * Común a productos y categorías: las dos vienen del Storage del cliente y las dos tienen
 * que dejar de depender de él.
 */
async function migrarImagen(urlOrigen, subcarpeta) {
  const respuesta = await fetch(urlOrigen);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

  // El tipo lo dicta la respuesta, no la extensión de la URL: una `.png` servida como otra
  // cosa produciría un objeto que luego no se puede mostrar.
  const contentType = (respuesta.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!TIPOS_IMAGEN.has(contentType)) {
    throw new Error(`tipo no admitido: ${contentType || "(sin content-type)"}`);
  }

  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES_IMAGEN) {
    throw new Error(`pesa ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB (máx 5)`);
  }

  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const ruta = `tenant/${tenantId}/${subcarpeta}/${crypto.randomUUID()}.${ext}`;

  const { error } = await db.storage
    .from("catalog")
    .upload(ruta, bytes, { contentType, upsert: false });
  if (error) throw error;
  return ruta;
}

if (!sinImagenes) {
  const pendientes = [];
  for (const p of origen.products) {
    if (!p.imageUrl) continue;
    const categoryId = categoriaDe(p);
    if (!categoryId) continue;
    const destino = productoPorClave.get(clave(categoryId, p.nameI18n.es ?? ""));
    if (!destino) continue;
    if (destino.image_url) {
      // Ya tiene una NUESTRA: no se vuelve a bajar. Para forzar la actualización de una
      // foto concreta, quítala desde el panel y reimporta.
      fotosConservadas++;
      continue;
    }
    pendientes.push({ productId: destino.id, nombre: p.nameI18n.es ?? "", url: p.imageUrl });
  }

  if (pendientes.length > 0) console.log(`\nDescargando ${pendientes.length} fotos…`);

  for (const [i, foto] of pendientes.entries()) {
    try {
      const ruta = await migrarImagen(foto.url, "products");
      const { error } = await db
        .from("products")
        .update({ image_url: ruta })
        .eq("id", foto.productId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      fotosSubidas++;
      process.stdout.write(`  ${i + 1}/${pendientes.length}\r`);
    } catch (e) {
      // Una foto que falla NO aborta la importación: perder una imagen es recuperable,
      // perder el catálogo a medias no. Se listan todas al final para reintentarlas.
      fotosFallidas.push(`${foto.nombre}: ${e.message}`);
    }
  }
  if (pendientes.length > 0) process.stdout.write("\n");

  // --- Imágenes de CATEGORÍA -------------------------------------------------------
  // Manuela usa una foto por categoría en sus tiles; garum solo emoji. Se migran igual:
  // copiar su URL dejaría la carta dependiendo de su servidor.
  const { data: catsDestino, error: errCats } = await db
    .from("categories")
    .select("id, slug, image_url")
    .eq("tenant_id", tenantId);
  if (errCats) throw errCats;
  const catPorSlug = new Map(catsDestino.map((c) => [c.slug, c]));

  const catsPendientes = origen.categories.filter((c) => {
    if (!c.imageUrl) return false;
    const destino = catPorSlug.get(c.slug);
    if (!destino) return false;
    if (destino.image_url) {
      fotosConservadas++;
      return false;
    }
    return true;
  });

  if (catsPendientes.length > 0)
    console.log(`Descargando ${catsPendientes.length} fotos de categoría…`);

  for (const [i, c] of catsPendientes.entries()) {
    try {
      const ruta = await migrarImagen(c.imageUrl, "categories");
      const { error } = await db
        .from("categories")
        .update({ image_url: ruta })
        .eq("tenant_id", tenantId)
        .eq("slug", c.slug);
      if (error) throw error;
      fotosSubidas++;
      process.stdout.write(`  ${i + 1}/${catsPendientes.length}\r`);
    } catch (e) {
      fotosFallidas.push(`categoría ${c.slug}: ${e.message}`);
    }
  }
  if (catsPendientes.length > 0) process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
// Informe. Se dice EXPLÍCITAMENTE qué se ha descartado: un importador que calla lo que deja
// fuera parece completo cuando no lo es.
// ---------------------------------------------------------------------------

const idiomas = new Set();
for (const c of origen.categories) for (const k of Object.keys(c.nameI18n)) idiomas.add(k);
for (const p of origen.products) for (const k of Object.keys(p.nameI18n)) idiomas.add(k);

console.log(`\nCliente '${tenantSlug}' (${tenantId})`);
console.log(`  categorías:  ${filasCategoria.length} (${enlazadas} enlazadas al árbol)`);
console.log(`  productos:   ${aInsertar.length} nuevos, ${aActualizar.length} actualizados`);
console.log(`  extras:      ${extrasAInsertar.length} nuevos`);
console.log(
  `  fotos:       ${fotosSubidas} subidas` +
    (fotosConservadas ? `, ${fotosConservadas} ya estaban` : "") +
    (fotosFallidas.length ? `, ${fotosFallidas.length} fallidas` : ""),
);
console.log(`  idiomas:     ${[...idiomas].sort().join(", ") || "(ninguno)"}`);
console.log(
  `  en el origen: ${origen.products.length} productos, ${origen.categories.length} categorías`,
);
if (padresPerdidos > 0) console.log(`  padres no encontrados: ${padresPerdidos}`);
if (sinCategoria > 0) console.log(`  productos sin categoría en el volcado: ${sinCategoria}`);

if (fotosFallidas.length > 0) {
  console.log("\n  Fotos que no se pudieron migrar:");
  for (const f of fotosFallidas) console.log(`    - ${f}`);
}

const descartados = new Set();
if (sinImagenes) descartados.add("fotos de producto y categoría (--sin-imagenes)");
if (descartados.size > 0) {
  console.log("\n  NO importado:");
  for (const d of [...descartados].sort()) console.log(`    - ${d}`);
}
