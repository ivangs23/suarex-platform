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
import { CatalogToolbar } from "./CatalogToolbar";
import { CategoryEditForm } from "./CategoryEditForm";
import { CategoryForm } from "./CategoryForm";
import { CategoryTree } from "./CategoryTree";
import { ConfirmDeleteForm } from "./ConfirmDeleteForm";
import { buildCatalogView } from "./catalog-view";
import styles from "./catalogo.module.css";
import { ExtraForm } from "./ExtraForm";
import { MoveCategoryForm } from "./MoveCategoryForm";
import { MoveProductForm } from "./MoveProductForm";
import { ProductEditForm } from "./ProductEditForm";
import { ProductForm } from "./ProductForm";

const BASE_PATH = "/admin/catalogo";

/**
 * Gestión de catálogo. `requireManager()` es la primera barrera (redirige a `/staff/login`
 * si no es owner/admin del tenant resuelto por Host); cada Server Action del formulario
 * vuelve a comprobarlo por su cuenta vía `managerAction`, así que esta página NUNCA es la
 * única guarda -- solo evita renderizar nada de gestión a quien no tiene permiso.
 *
 * Los filtros (`?q=`, `?cat=`) viven en la URL, no en estado de cliente: funciona sin
 * JavaScript, el enlace es compartible y el botón "atrás" hace lo esperado -- el mismo
 * criterio que la carta pública. Toda la lógica de qué se ve está en `buildCatalogView`,
 * que es pura y está probada aparte.
 *
 * Precios: `AdminProduct.price`/`AdminExtra.price` llegan en EUROS (`numeric(10,2)`, ver
 * `packages/db/src/admin-catalog.ts`) -- igual que la carta pública, se convierten a
 * céntimos con `Math.round(price * 100)` SOLO para mostrarlos con `formatCents`, nunca se
 * guardan así.
 */
// `AdminProduct.imageUrl` es la RUTA dentro del bucket `catalog` que devuelve
// `uploadProductImage` (p. ej. "tenant/{tenantId}/products/{uuid}.png"), no una URL
// completa -- el bucket es público en lectura (`20260722000007_catalog_storage.sql`), así
// que basta anteponerle el endpoint público de Storage; NEXT_PUBLIC_* se inlinea en build
// time y no expone ninguna clave de servicio.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

function catalogImageUrl(imagePath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/catalog/${imagePath}`;
}

export default async function AdminCatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, params] = await Promise.all([requireManager(), searchParams]);

  const [catalog, assignableAllergens, settings] = await Promise.all([
    listAdminCatalog(session.tenantId),
    listAssignableAllergens(session.tenantId),
    getTenantSettings(session.tenantId),
  ]);

  const locale = settings?.locale ?? "es";
  const currency = settings?.currency ?? "EUR";

  // `?q=a&q=b` (repetido) llega como array; nos quedamos con el primero.
  const primero = (v: string | string[] | undefined): string | null =>
    (Array.isArray(v) ? v[0] : v) ?? null;
  const q = primero(params.q) ?? "";
  const cat = primero(params.cat);

  const view = buildCatalogView({
    categories: catalog.categories,
    query: q,
    currentSlug: cat,
    basePath: BASE_PATH,
  });

  const categoryOptions = catalog.categories.map((category) => ({
    id: category.id,
    name: category.nameI18n.es ?? category.slug,
  }));

  // Para los selects de mover: el árbol YA aplanado por `buildCatalogView`, con su
  // profundidad. Una lista plana de 59 nombres no dice de dónde cuelga cada uno, y en esta
  // carta hay varios "BLANCO" y varios "TINTO" en ramas distintas.
  const moveOptions = view.tree.map((n) => ({ id: n.id, name: n.name, depth: n.depth }));

  const productOptions = catalog.categories.flatMap((category) =>
    category.products.map((product) => ({ id: product.id, name: product.nameI18n.es ?? "" })),
  );

  const allergenOptions = assignableAllergens.map((allergen) => ({
    id: allergen.id,
    name: allergen.nameI18n.es ?? String(allergen.id),
  }));
  const allergenNameById = new Map(allergenOptions.map((a) => [a.id, a.name]));

  // Categoría seleccionada, resuelta una vez para el bloque de editar/borrar.
  const seleccionada = cat ? catalog.categories.find((c) => c.slug === cat) : undefined;
  const filtrando = q !== "" || view.currentName !== null;

  return (
    <>
      <div className={styles.head}>
        <h1>Catálogo</h1>
        <span className={styles.count} data-testid="catalog-count">
          {filtrando
            ? `${view.matchCount} de ${view.totalProducts} productos`
            : `${view.totalProducts} productos en ${view.tree.length} categorías`}
        </span>
      </div>

      <CatalogToolbar query={q} currentSlug={seleccionada ? cat : null} basePath={BASE_PATH} />

      <div className={styles.layout}>
        <CategoryTree
          nodes={view.tree}
          allHref={q ? `${BASE_PATH}?q=${encodeURIComponent(q)}` : BASE_PATH}
          showingAll={view.currentName === null}
        />

        <div>
          {view.currentPath.length > 0 ? (
            <p className={styles.crumbs} data-testid="catalog-crumbs">
              {view.currentPath.map((node, i) => (
                <span key={node.id}>
                  {i > 0 ? " › " : null}
                  <a href={node.href}>{node.name}</a>
                </span>
              ))}
            </p>
          ) : null}

          {view.hiddenCount > 0 ? (
            <p className={styles.empty} data-testid="catalog-truncated">
              Se muestran {view.items.length} de {view.matchCount}. Afina la búsqueda o elige una
              categoría para ver el resto.
            </p>
          ) : null}

          {view.items.length === 0 ? (
            <p className={styles.empty} data-testid="catalog-empty">
              {filtrando
                ? "Ningún producto coincide con este filtro."
                : "Todavía no hay productos. Crea una categoría y añade el primero."}
            </p>
          ) : (
            <ul className={styles.items}>
              {view.items.map(({ product, categoryId, categoryPath }) => {
                const allergenNames = product.allergenIds
                  .map((id) => allergenNameById.get(id))
                  .filter((name): name is string => Boolean(name));

                return (
                  <li key={product.id} className={styles.item} data-testid="admin-product">
                    <div className={styles.itemHead}>
                      {product.imageUrl ? (
                        // biome-ignore lint/performance/noImgElement: miniatura de admin; next/image exigiría remotePatterns con el host de Supabase, que varía por despliegue
                        <img
                          className={styles.thumb}
                          data-testid="admin-product-image"
                          src={catalogImageUrl(product.imageUrl)}
                          alt=""
                          width={40}
                          height={40}
                        />
                      ) : null}
                      <span className={styles.itemName}>{product.nameI18n.es}</span>
                      <span className={styles.itemPrice}>
                        {formatCents(Math.round(product.price * 100), locale, currency)}
                      </span>
                      {product.isAvailable ? null : (
                        <span className={`${styles.badge} ${styles.badgeHidden}`}>Oculto</span>
                      )}
                      {/* La ruta completa es lo que distingue dos productos con el MISMO
                          nombre al buscar (las muchas "COPA" de bodegas distintas). */}
                      <span className={styles.itemPath}>{categoryPath}</span>
                    </div>

                    {allergenNames.length > 0 ? (
                      <p className={styles.count}>Alérgenos: {allergenNames.join(", ")}</p>
                    ) : null}

                    <details className={styles.details}>
                      <summary>Editar producto</summary>
                      <ProductEditForm
                        productId={product.id}
                        name={product.nameI18n.es ?? ""}
                        description={product.descriptionI18n?.es ?? ""}
                        price={product.price}
                        allergenIds={product.allergenIds}
                        allergens={allergenOptions}
                        imagePath={product.imageUrl}
                        imageUrl={product.imageUrl ? catalogImageUrl(product.imageUrl) : null}
                      />
                    </details>

                    <details className={styles.details}>
                      <summary>Mover producto</summary>
                      <MoveProductForm
                        productId={product.id}
                        currentCategoryId={categoryId}
                        sortOrder={product.sortOrder}
                        options={moveOptions}
                      />
                    </details>

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

          {/* Editar y borrar la categoría seleccionada. Solo aparece cuando hay una: con 59
              categorías, repetir su formulario en cada una llenaba la página de campos que
              nadie estaba mirando. */}
          {seleccionada ? (
            <section className={styles.card} data-testid="admin-category">
              <h2>Categoría seleccionada</h2>
              <h3 data-testid="admin-category-name">
                {seleccionada.nameI18n.es ?? seleccionada.slug}
              </h3>
              <details className={styles.details}>
                <summary>Editar categoría</summary>
                <CategoryEditForm
                  categoryId={seleccionada.id}
                  name={seleccionada.nameI18n.es ?? seleccionada.slug}
                  slug={seleccionada.slug}
                  destination={seleccionada.destination}
                />
              </details>
              <details className={styles.details}>
                <summary>Mover categoría</summary>
                <MoveCategoryForm
                  categoryId={seleccionada.id}
                  currentParentId={seleccionada.parentId}
                  sortOrder={seleccionada.sortOrder}
                  options={moveOptions}
                />
              </details>
              <ConfirmDeleteForm
                action={deleteCategoryAction}
                hiddenName="category_id"
                hiddenValue={seleccionada.id}
                confirmMessage={`Borrar la categoría "${seleccionada.nameI18n.es ?? seleccionada.slug}" borra TAMBIÉN todos sus productos y extras. Esta acción no se puede deshacer. ¿Continuar?`}
                label="Borrar categoría"
              />
            </section>
          ) : null}

          <section className={styles.card}>
            <h2>Añadir</h2>
            <details className={styles.details}>
              <summary>Nueva categoría</summary>
              <CategoryForm />
            </details>
            <details className={styles.details}>
              <summary>Nuevo producto</summary>
              {categoryOptions.length === 0 ? (
                <p>Crea primero una categoría para poder dar de alta productos.</p>
              ) : (
                <ProductForm categories={categoryOptions} allergens={allergenOptions} />
              )}
            </details>
            <details className={styles.details}>
              <summary>Nuevo extra</summary>
              {productOptions.length === 0 ? (
                <p>Crea primero un producto para poder añadirle extras.</p>
              ) : (
                <ExtraForm products={productOptions} />
              )}
            </details>
          </section>

          <section className={styles.card}>
            <h2>Alérgenos propios</h2>
            {catalog.allergens.length === 0 ? (
              <p className={styles.count}>
                Este cliente todavía no ha declarado alérgenos propios.
              </p>
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
            <details className={styles.details}>
              <summary>Nuevo alérgeno</summary>
              <AllergenForm />
            </details>
          </section>
        </div>
      </div>
    </>
  );
}
