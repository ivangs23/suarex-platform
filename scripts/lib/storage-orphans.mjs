/**
 * Lógica PURA de la limpieza de fotos huérfanas del bucket. Sin red ni base: recibe la lista
 * de objetos y el conjunto de rutas referenciadas y devuelve las que sobran. Igual que
 * `source-adapters.mjs`, se separa aquí para poder probarla sin montar Storage ni Supabase.
 *
 * Una foto huérfana es un objeto de Storage que no referencia ninguna fila. Salen de
 * `import-catalog --reemplazar` (borra las filas y resube a rutas nuevas, dejando las viejas
 * sin dueño) y de editar fotos en el panel. Nadie las mira y nadie las borra, así que el
 * bucket crece sin techo -- un solo cliente reimportado dejó ~39 MB muertos.
 */

/**
 * Extrae la ruta relativa de una URL pública de Storage
 * (`.../storage/v1/object/public/catalog/<ruta>`), o `null` si no lo es.
 *
 * `products.image_url` y `categories.image_url` YA son rutas relativas; el logo y la foto de
 * bienvenida (`branding.logoUrl`/`heroUrl`) son URLs absolutas -- hay que quedarse con su
 * ruta para compararla con lo que lista Storage.
 */
export function pathDeUrl(valor) {
  if (!valor || typeof valor !== "string") return null;
  const marca = "/storage/v1/object/public/catalog/";
  const i = valor.indexOf(marca);
  if (i !== -1) return valor.slice(i + marca.length);
  // Ya es una ruta relativa (empieza por el prefijo del tenant): se usa tal cual.
  return valor.startsWith("tenant/") ? valor : null;
}

/**
 * Objetos de `objetos` cuya ruta NO está en `referenciadas`: las fotos a borrar.
 * `referenciadas` es un Set de rutas relativas.
 */
export function orphanPaths(objetos, referenciadas) {
  return objetos.filter((ruta) => !referenciadas.has(ruta));
}

/**
 * Comprueba que TODAS las rutas cuelgan del prefijo del cliente. Es la única defensa real: el
 * script borra con service role, así que una ruta de otro prefijo borraría la foto de OTRO
 * cliente. Lanza con la primera que se salga, sin borrar nada.
 */
export function assertDentroDelTenant(tenantId, paths) {
  const prefijo = `tenant/${tenantId}/`;
  const fuera = paths.find((p) => !p.startsWith(prefijo));
  if (fuera) {
    throw new Error(`Ruta fuera del prefijo del cliente, se aborta el borrado entero: ${fuera}`);
  }
}
