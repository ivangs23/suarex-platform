"use server";

import {
  createCategory,
  createExtra,
  createProduct,
  createTenantAllergen,
  deleteCategory,
  deleteExtra,
  deleteProduct,
  deleteTenantAllergen,
  setProductAvailability,
  updateCategory,
  updateProduct,
  uploadProductImage,
} from "@suarex/db";
import { revalidatePath } from "next/cache";
import { parseAllergenId, parseAvailability } from "@/lib/catalog-action-input";
import { managerAction } from "@/lib/require-manager";

/**
 * SECURITY: patrón obligatorio de TODA Server Action de este fichero.
 *
 *   1. Fix round 1 (Finding 1): cada action de este fichero se define como
 *      `managerAction(async (session, formData) => { ... })` (`apps/web/lib/require-manager.ts`)
 *      en vez de empezar a mano por `const session = await requireManager();`. El wrapper
 *      ejecuta `requireManager()` -- rechaza (redirige) a `staff`/`device`/no-autenticado/
 *      otro-tenant -- ANTES de invocar el cuerpo de la action, así que `fn` recibe la
 *      sesión ya verificada como primer argumento y no tiene ningún camino de ejecución
 *      que la sortee: una futura action (D2/D3: mesas, dispositivos, personal) no puede
 *      "olvidar" la comprobación porque no hay ningún sitio donde escribirla a mano.
 *   2. El `tenantId` que llega a cada repositorio de `@suarex/db` es SIEMPRE
 *      `session.tenantId` (derivado del claim `tenant_id` verificado del JWT, vía
 *      `resolveStaffSession` -- ver `apps/web/lib/staff-session.ts`), NUNCA un campo
 *      del `formData` que el navegador controla. Ninguna función de este fichero
 *      acepta ni lee un `tenant_id`/`tenantId` del formulario.
 *
 * Los repositorios de `packages/db/src/admin-catalog.ts` usan el service role (saltan
 * RLS) precisamente porque la comprobación de rol vive aquí, no en ellos. En este
 * camino (Server Action de este fichero) las garantías son ESTRUCTURALES, no RLS:
 * (1) `managerAction` -- comprobación de rol imposible de olvidar, ver arriba -- y
 * (2) `tenantScoped` exigiendo `tenantId` obligatorio en cada repositorio. RLS
 * (`20260722000006_role_write_policies.sql`) NO es un backstop de este camino --
 * el service role la salta, así que aquí nunca llega a evaluarse -- sino la barrera
 * independiente de un camino distinto: un JWT `authenticated` válido hablando
 * directo contra PostgREST sin pasar por esta app. Ver el docstring de
 * `requireManager` (`lib/require-manager.ts`) para el razonamiento completo.
 */

function requiredString(formData: FormData, field: string): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) throw new Error(`Falta el campo obligatorio: ${field}`);
  return value;
}

function optionalString(formData: FormData, field: string): string | undefined {
  const raw = formData.get(field);
  if (raw === null) return undefined;
  const value = String(raw).trim();
  return value === "" ? undefined : value;
}

function parseDestination(formData: FormData): "cocina" | "barra" | undefined {
  const raw = formData.get("destination");
  if (raw === null) return undefined;
  return raw === "barra" ? "barra" : "cocina";
}

/**
 * El precio SIEMPRE llega del formulario como una cadena en EUROS (p. ej. "9.50"),
 * nunca ya convertida a céntimos -- `products.price`/`product_extras.price` son
 * `numeric(10,2)` en euros (ver `packages/db/src/admin-catalog.ts`). Esta función solo
 * hace el `Number(...)`; un valor no numérico ("abc") produce `NaN`, y uno negativo
 * sigue siendo negativo -- ambos casos los rechaza `assertValidPrice` DENTRO del
 * repositorio (`createProduct`/`updateProduct`/`createExtra`), que es la única
 * validación de este invariante: no se duplica aquí para no arriesgarse a que las dos
 * copias diverjan.
 */
function parseEuroPrice(formData: FormData, field: string): number {
  return Number(requiredString(formData, field));
}

function parseOptionalEuroPrice(formData: FormData, field: string): number | undefined {
  const raw = optionalString(formData, field);
  return raw === undefined ? undefined : Number(raw);
}

function parseAllergenIds(formData: FormData): number[] | undefined {
  const raw = formData.get("allergen_ids");
  if (raw === null) return undefined;
  const text = String(raw).trim();
  if (!text) return [];
  return text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value));
}

/**
 * Si el formulario trae un fichero en el campo `image`, lo sube con
 * `uploadProductImage(tenantId, ...)` -- SIEMPRE con el `tenantId` de la sesión, nunca
 * uno del propio formulario -- y devuelve la ruta resultante. Sin fichero (o un fichero
 * vacío, campo opcional no rellenado), devuelve `undefined` para no tocar
 * `image_url` en un update parcial.
 */
async function extractImagePath(tenantId: string, formData: FormData): Promise<string | undefined> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return undefined;

  const bytes = new Uint8Array(await file.arrayBuffer());
  return uploadProductImage(tenantId, { bytes, contentType: file.type });
}

// ---------------------------------------------------------------- categorías

export const createCategoryAction = managerAction(async (session, formData: FormData) => {
  const slug = requiredString(formData, "slug");
  const nameEs = requiredString(formData, "name_es");

  await createCategory(session.tenantId, {
    slug,
    nameI18n: { es: nameEs },
    destination: parseDestination(formData),
  });
  revalidatePath("/admin/catalogo");
});

export const updateCategoryAction = managerAction(async (session, formData: FormData) => {
  const categoryId = requiredString(formData, "category_id");
  const nameEs = optionalString(formData, "name_es");

  await updateCategory(session.tenantId, categoryId, {
    slug: optionalString(formData, "slug"),
    nameI18n: nameEs !== undefined ? { es: nameEs } : undefined,
    destination: parseDestination(formData),
  });
  revalidatePath("/admin/catalogo");
});

export const deleteCategoryAction = managerAction(async (session, formData: FormData) => {
  const categoryId = requiredString(formData, "category_id");

  await deleteCategory(session.tenantId, categoryId);
  revalidatePath("/admin/catalogo");
});

// ---------------------------------------------------------------- productos

export const createProductAction = managerAction(async (session, formData: FormData) => {
  const categoryId = requiredString(formData, "category_id");
  const nameEs = requiredString(formData, "name_es");
  const price = parseEuroPrice(formData, "price");
  const descriptionEs = optionalString(formData, "description_es");
  const imagePath = await extractImagePath(session.tenantId, formData);

  await createProduct(session.tenantId, {
    categoryId,
    nameI18n: { es: nameEs },
    descriptionI18n: descriptionEs !== undefined ? { es: descriptionEs } : undefined,
    price,
    imagePath,
    allergenIds: parseAllergenIds(formData),
  });
  revalidatePath("/admin/catalogo");
});

export const updateProductAction = managerAction(async (session, formData: FormData) => {
  const productId = requiredString(formData, "product_id");
  const nameEs = optionalString(formData, "name_es");
  const descriptionEs = optionalString(formData, "description_es");
  const imagePath = await extractImagePath(session.tenantId, formData);

  await updateProduct(session.tenantId, productId, {
    categoryId: optionalString(formData, "category_id"),
    nameI18n: nameEs !== undefined ? { es: nameEs } : undefined,
    descriptionI18n: descriptionEs !== undefined ? { es: descriptionEs } : undefined,
    price: parseOptionalEuroPrice(formData, "price"),
    imagePath,
    allergenIds: parseAllergenIds(formData),
  });
  revalidatePath("/admin/catalogo");
});

export const deleteProductAction = managerAction(async (session, formData: FormData) => {
  const productId = requiredString(formData, "product_id");

  await deleteProduct(session.tenantId, productId);
  revalidatePath("/admin/catalogo");
});

export const setProductAvailabilityAction = managerAction(async (session, formData: FormData) => {
  const productId = requiredString(formData, "product_id");
  const isAvailable = parseAvailability(requiredString(formData, "is_available"));

  await setProductAvailability(session.tenantId, productId, isAvailable);
  revalidatePath("/admin/catalogo");
});

// ---------------------------------------------------------------- extras

export const createExtraAction = managerAction(async (session, formData: FormData) => {
  const productId = requiredString(formData, "product_id");
  const nameEs = requiredString(formData, "name_es");
  const price = parseEuroPrice(formData, "price");

  await createExtra(session.tenantId, { productId, nameI18n: { es: nameEs }, price });
  revalidatePath("/admin/catalogo");
});

export const deleteExtraAction = managerAction(async (session, formData: FormData) => {
  const extraId = requiredString(formData, "extra_id");

  await deleteExtra(session.tenantId, extraId);
  revalidatePath("/admin/catalogo");
});

// ---------------------------------------------------------------- alérgenos del tenant

export const createTenantAllergenAction = managerAction(async (session, formData: FormData) => {
  const nameEs = requiredString(formData, "name_es");
  const icon = optionalString(formData, "icon");

  await createTenantAllergen(session.tenantId, { nameI18n: { es: nameEs }, icon });
  revalidatePath("/admin/catalogo");
});

export const deleteTenantAllergenAction = managerAction(async (session, formData: FormData) => {
  const allergenId = parseAllergenId(requiredString(formData, "allergen_id"));

  await deleteTenantAllergen(session.tenantId, allergenId);
  revalidatePath("/admin/catalogo");
});
