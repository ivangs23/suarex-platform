import {
  filtrarAgotados,
  filtrarPorFranja,
  getCategoriesSinFiltroHorario,
  getProductsSinFiltroHorario,
  getTenantSettings,
  listAssignableAllergens,
  minutosEnZona,
} from "@suarex/db";
import { revalidateTag, unstable_cache } from "next/cache";

/**
 * CACHÉ DE LA CARTA POR TENANT.
 *
 * La carta (QR y totem) leía catálogo, ajustes y alérgenos de PostgREST en CADA carga: seis
 * peticiones, más los ajustes del layout. Aquí se cachean por tenant con la etiqueta
 * `carta:<tenantId>`, que invalidan las Server Actions que escriben catálogo o ajustes
 * (`invalidarCarta`).
 *
 * Solo se cachea lo que NO depende del reloj. Las franjas horarias y el "agotado hoy" cambian
 * con la hora, sin escritura que avise, así que se filtran en cada petición sobre los datos
 * cacheados: una franja o un agotado cambian en su minuto exacto, no cuando caduque esto.
 *
 * La cookie de mesa (`canOrder`) y el tenant del host quedan FUERA: van por petición.
 *
 * `unstable_cache` y no `"use cache"`: el directivo exige `cacheComponents` en toda la app.
 */

/** Red de seguridad para lo que escribe la carta sin pasar por la app: `import-catalog`,
 *  `traducir-manuela`, SQL a mano. Lo que pasa por el panel invalida al momento. */
const TTL_SEGUNDOS = 60;

export function tagCarta(tenantId: string): string {
  return `carta:${tenantId}`;
}

function cacheada<T>(lectura: string, tenantId: string, leer: () => Promise<T>): Promise<T> {
  return unstable_cache(leer, ["carta", lectura, tenantId], {
    tags: [tagCarta(tenantId)],
    revalidate: TTL_SEGUNDOS,
  })();
}

/** `tenant_settings` del tenant (marca, canales, idioma...), cacheados con la carta. */
export function settingsDeLaCarta(tenantId: string) {
  return cacheada("settings", tenantId, () => getTenantSettings(tenantId));
}

/** Catálogo y alérgenos de la carta, con las franjas y el agotado aplicados a `ahora`. */
export async function leerCarta(tenantId: string, ahora: Date = new Date()) {
  const [{ categories, timezone }, products, allergens] = await Promise.all([
    cacheada("categorias", tenantId, () => getCategoriesSinFiltroHorario(tenantId)),
    cacheada("productos", tenantId, () => getProductsSinFiltroHorario(tenantId)),
    cacheada("alergenos", tenantId, () => listAssignableAllergens(tenantId)),
  ]);
  return {
    categories: filtrarPorFranja(categories, minutosEnZona(ahora, timezone)),
    products: filtrarAgotados(products, ahora),
    allergens,
  };
}

/**
 * Tras escribir catálogo o ajustes: la siguiente carga lee de la base. `expire: 0` y no
 * `"max"`: con `"max"` Next sirve una vez la versión vieja mientras revalida, y quien acaba de
 * editar su carta la vería sin el cambio.
 */
export function invalidarCarta(tenantId: string): void {
  revalidateTag(tagCarta(tenantId), { expire: 0 });
}
