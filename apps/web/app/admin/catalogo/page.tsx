import { getTenantSettings, listAdminCatalog, listAssignableAllergens } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { requireManager } from "@/lib/require-manager";
import { AllergenForm } from "./AllergenForm";
import {
  deleteCategoryAction,
  deleteExtraAction,
  deleteProductAction,
  deleteTenantAllergenAction,
  setProductAvailabilityAction,
} from "./actions";
import { CategoryForm } from "./CategoryForm";
import { ConfirmDeleteForm } from "./ConfirmDeleteForm";
import { ExtraForm } from "./ExtraForm";
import { ProductForm } from "./ProductForm";

/**
 * Pantalla de gestión de catálogo (Task 5, fase D1): `requireManager()` es la primera
 * barrera (redirige a `/staff/login` si no es owner/admin del tenant resuelto por
 * Host -- ver su docstring); cada Server Action del formulario vuelve a comprobarlo por
 * su cuenta vía `managerAction` (`actions.ts`), así que esta página NUNCA es la única
 * guarda -- solo evita renderizar nada de gestión a quien no tiene permiso.
 *
 * Precios: `AdminProduct.price`/`AdminExtra.price` llegan en EUROS (`numeric(10,2)`,
 * ver `packages/db/src/admin-catalog.ts`) -- igual que la carta pública (`/m/[token]`),
 * se convierten a céntimos con `Math.round(price * 100)` SOLO para mostrarlos con
 * `formatCents`, nunca se guardan así; el formulario de alta sigue enviando el precio en
 * euros tal cual (`ProductForm`/`ExtraForm`), y es la Server Action quien lo interpreta
 * (ver docstring de `parseEuroPrice` en `actions.ts`).
 */
// `AdminProduct.imageUrl` (ver `packages/db/src/admin-catalog.ts`) es la RUTA que
// devuelve `uploadProductImage` dentro del bucket `catalog` (p. ej.
// "tenant/{tenantId}/products/{uuid}.png"), no una URL completa -- el bucket es
// público en lectura (`20260722000007_catalog_storage.sql`), así que basta con
// anteponerle el endpoint público de Storage; NEXT_PUBLIC_* se inlinea en build
// time y no expone ninguna clave de servicio (mismo patrón que
// `app/staff/login/page.tsx`).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

function catalogImageUrl(imagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/catalog/${imagePath}`;
}

export default async function AdminCatalogoPage() {
  const session = await requireManager();

  const [catalog, assignableAllergens, settings] = await Promise.all([
    listAdminCatalog(session.tenantId),
    listAssignableAllergens(session.tenantId),
    getTenantSettings(session.tenantId),
  ]);

  const locale = settings?.locale ?? "es";
  const currency = settings?.currency ?? "EUR";

  const categoryOptions = catalog.categories.map((category) => ({
    id: category.id,
    name: category.nameI18n.es ?? category.slug,
  }));

  const productOptions = catalog.categories.flatMap((category) =>
    category.products.map((product) => ({
      id: product.id,
      name: product.nameI18n.es ?? "",
    })),
  );

  const allergenOptions = assignableAllergens.map((allergen) => ({
    id: allergen.id,
    name: allergen.nameI18n.es ?? String(allergen.id),
  }));

  const allergenNameById = new Map(allergenOptions.map((allergen) => [allergen.id, allergen.name]));

  return (
    <main>
      <h1>Gestión de catálogo</h1>

      <section>
        <h2>Categorías</h2>
        {catalog.categories.length === 0 ? <p>Todavía no hay categorías.</p> : null}
        {catalog.categories.map((category) => (
          <article key={category.id} data-testid="admin-category">
            <h3>
              {category.nameI18n.es ?? category.slug} <small>({category.destination})</small>
            </h3>
            <ConfirmDeleteForm
              action={deleteCategoryAction}
              hiddenName="category_id"
              hiddenValue={category.id}
              confirmMessage={`Borrar la categoría "${category.nameI18n.es ?? category.slug}" borra TAMBIÉN todos sus productos y extras. Esta acción no se puede deshacer. ¿Continuar?`}
              label="Borrar categoría"
            />

            {category.products.length === 0 ? (
              <p>Sin productos en esta categoría.</p>
            ) : (
              <ul>
                {category.products.map((product) => {
                  const priceCents = Math.round(product.price * 100);
                  const productAllergenNames = product.allergenIds
                    .map((id) => allergenNameById.get(id))
                    .filter((name): name is string => Boolean(name));

                  return (
                    <li key={product.id} data-testid="admin-product">
                      <strong>{product.nameI18n.es}</strong> —{" "}
                      {formatCents(priceCents, locale, currency)}
                      {product.isAvailable ? null : " (oculto)"}
                      {/* Miniatura funcional del panel (no una imagen pública crítica para
                      LCP); next/image exigiría configurar remotePatterns con el host de
                      Supabase, que varía por despliegue -- fuera de alcance de esta tarea. */}
                      {product.imageUrl ? (
                        // biome-ignore lint/performance/noImgElement: miniatura de admin, ver comentario arriba
                        <img
                          data-testid="admin-product-image"
                          src={catalogImageUrl(product.imageUrl)}
                          alt={product.nameI18n.es ?? ""}
                          width={80}
                          height={80}
                        />
                      ) : null}
                      {productAllergenNames.length > 0 ? (
                        <p>Alérgenos: {productAllergenNames.join(", ")}</p>
                      ) : null}
                      {product.extras.length > 0 ? (
                        <ul>
                          {product.extras.map((extra) => (
                            <li key={extra.id}>
                              {extra.nameI18n.es} (+
                              {formatCents(Math.round(extra.price * 100), locale, currency)})
                              <ConfirmDeleteForm
                                action={deleteExtraAction}
                                hiddenName="extra_id"
                                hiddenValue={extra.id}
                                confirmMessage={`Borrar el extra "${extra.nameI18n.es}". ¿Continuar?`}
                                label="Borrar extra"
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <form action={setProductAvailabilityAction}>
                        <input type="hidden" name="product_id" value={product.id} />
                        <input
                          type="hidden"
                          name="is_available"
                          value={product.isAvailable ? "false" : "true"}
                        />
                        <button type="submit">{product.isAvailable ? "Ocultar" : "Mostrar"}</button>
                      </form>
                      <ConfirmDeleteForm
                        action={deleteProductAction}
                        hiddenName="product_id"
                        hiddenValue={product.id}
                        confirmMessage={`Borrar el producto "${product.nameI18n.es}" borra TAMBIÉN sus extras. Esta acción no se puede deshacer. ¿Continuar?`}
                        label="Borrar producto"
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        ))}

        <CategoryForm />
      </section>

      <section>
        <h2>Productos</h2>
        {categoryOptions.length === 0 ? (
          <p>Crea primero una categoría para poder dar de alta productos.</p>
        ) : (
          <ProductForm categories={categoryOptions} allergens={allergenOptions} />
        )}
      </section>

      <section>
        <h2>Extras</h2>
        {productOptions.length === 0 ? (
          <p>Crea primero un producto para poder añadirle extras.</p>
        ) : (
          <ExtraForm products={productOptions} />
        )}
      </section>

      <section>
        <h2>Alérgenos propios del tenant</h2>
        {catalog.allergens.length === 0 ? (
          <p>Este tenant todavía no ha declarado alérgenos propios.</p>
        ) : (
          <ul>
            {catalog.allergens.map((allergen) => (
              <li key={allergen.id}>
                {allergen.nameI18n.es}
                <ConfirmDeleteForm
                  action={deleteTenantAllergenAction}
                  hiddenName="allergen_id"
                  hiddenValue={String(allergen.id)}
                  confirmMessage={`Borrar el alérgeno "${allergen.nameI18n.es}". ¿Continuar?`}
                  label="Borrar alérgeno"
                />
              </li>
            ))}
          </ul>
        )}
        <AllergenForm />
      </section>
    </main>
  );
}
