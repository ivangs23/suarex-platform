import {
  createCategory,
  createExtra,
  createProduct,
  createTenantAllergen,
  deleteCategory,
  deleteExtra,
  deleteProduct,
  deleteTenantAllergen,
  listAdminCatalog,
  setProductAvailability,
  updateCategory,
  updateProduct,
} from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin as adminClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenantA: TenantFixture;
let tenantB: TenantFixture;

beforeAll(async () => {
  tenantA = await createTenantFixture(`admin-catalog-a-${nonce()}`);
  tenantB = await createTenantFixture(`admin-catalog-b-${nonce()}`);
});

afterAll(async () => {
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

describe("createCategory + listAdminCatalog", () => {
  it("crea la fila y listAdminCatalog la devuelve", async () => {
    const { id } = await createCategory(tenantA.tenantId, {
      slug: `entrantes-${nonce()}`,
      nameI18n: { es: "Entrantes" },
      destination: "cocina",
    });

    const catalog = await listAdminCatalog(tenantA.tenantId);
    const category = catalog.categories.find((c) => c.id === id);
    expect(category).toBeDefined();
    expect(category?.nameI18n.es).toBe("Entrantes");
    expect(category?.destination).toBe("cocina");
  });
});

describe("createProduct", () => {
  it("lleva su category_id, precio e image_path", async () => {
    const { id: categoryId } = await createCategory(tenantA.tenantId, {
      slug: `principales-${nonce()}`,
      nameI18n: { es: "Principales" },
    });

    const { id: productId } = await createProduct(tenantA.tenantId, {
      categoryId,
      nameI18n: { es: "Paella" },
      price: 12.5,
      imagePath: "tenant/x/products/paella.png",
    });

    const catalog = await listAdminCatalog(tenantA.tenantId);
    const product = catalog.categories.flatMap((c) => c.products).find((p) => p.id === productId);

    expect(product).toBeDefined();
    expect(product?.categoryId).toBe(categoryId);
    expect(product?.price).toBe(12.5);
    expect(product?.imageUrl).toBe("tenant/x/products/paella.png");
  });

  it("rechaza un precio negativo", async () => {
    const { id: categoryId } = await createCategory(tenantA.tenantId, {
      slug: `precio-neg-${nonce()}`,
      nameI18n: { es: "X" },
    });

    await expect(
      createProduct(tenantA.tenantId, {
        categoryId,
        nameI18n: { es: "Malo" },
        price: -5,
      }),
    ).rejects.toThrow(/precio/i);
  });

  it("rechaza un precio no finito", async () => {
    const { id: categoryId } = await createCategory(tenantA.tenantId, {
      slug: `precio-nan-${nonce()}`,
      nameI18n: { es: "X" },
    });

    await expect(
      createProduct(tenantA.tenantId, {
        categoryId,
        nameI18n: { es: "Malo" },
        price: Number.NaN,
      }),
    ).rejects.toThrow(/precio/i);
  });
});

describe("aislamiento entre tenants", () => {
  it("createProduct con una categoryId de otro tenant es rechazado", async () => {
    const { id: categoryOfB } = await createCategory(tenantB.tenantId, {
      slug: `ajena-${nonce()}`,
      nameI18n: { es: "Ajena" },
    });

    await expect(
      createProduct(tenantA.tenantId, {
        categoryId: categoryOfB,
        nameI18n: { es: "Intruso" },
        price: 5,
      }),
    ).rejects.toThrow(/cross-tenant/i);

    // El intento fallido tampoco deja rastro en el listado de A.
    const catalog = await listAdminCatalog(tenantA.tenantId);
    const leaked = catalog.categories
      .flatMap((c) => c.products)
      .find((p) => p.nameI18n.es === "Intruso");
    expect(leaked).toBeUndefined();
  });

  it("createExtra con un productId de otro tenant es rechazado", async () => {
    const { id: categoryOfB } = await createCategory(tenantB.tenantId, {
      slug: `extra-ajena-${nonce()}`,
      nameI18n: { es: "ExtraAjena" },
    });
    const { id: productOfB } = await createProduct(tenantB.tenantId, {
      categoryId: categoryOfB,
      nameI18n: { es: "ProdB" },
      price: 3,
    });

    await expect(
      createExtra(tenantA.tenantId, {
        productId: productOfB,
        nameI18n: { es: "ExtraIntrusa" },
        price: 1,
      }),
    ).rejects.toThrow(/cross-tenant/i);
  });

  it("el repositorio nunca escribe en un tenant distinto del tenantId recibido", async () => {
    const { id } = await createCategory(tenantA.tenantId, {
      slug: `propio-${nonce()}`,
      nameI18n: { es: "Propio" },
    });

    const catalogA = await listAdminCatalog(tenantA.tenantId);
    expect(catalogA.categories.some((c) => c.id === id)).toBe(true);

    const catalogB = await listAdminCatalog(tenantB.tenantId);
    expect(catalogB.categories.some((c) => c.id === id)).toBe(false);
  });
});

/**
 * Fix round 1 (Finding 3): `tenantScoped(table, tenantId).update(...)/.delete(...)` ya
 * añade `.eq("tenant_id", tenantId)` como filtro base (ver `packages/db/src/client.ts`),
 * lo que hace que un `id` de otro tenant sea un no-op seguro -- probado para `categories`
 * en `tenant-filter-structural.test.ts` a nivel de `tenantScoped` directamente. Este
 * bloque pins la MISMA garantía pero en los cuatro repositorios de este fichero que la
 * capa de Server Actions llama de verdad (`updateProduct`/`deleteProduct`/
 * `updateCategory`/`deleteCategory`): que el filtro se sostiene en el camino de
 * update/delete de `admin-catalog.ts`, no solo en el de "adjuntar por FK" ya cubierto por
 * el bloque "aislamiento entre tenants" de arriba.
 */
describe("update/delete cross-tenant es un no-op seguro", () => {
  it("updateCategory con el id de otro tenant no afecta ninguna fila y B queda intacta", async () => {
    const { id: categoryOfB } = await createCategory(tenantB.tenantId, {
      slug: `cross-cat-upd-${nonce()}`,
      nameI18n: { es: "Original B" },
    });

    await updateCategory(tenantA.tenantId, categoryOfB, { nameI18n: { es: "Hackeada por A" } });

    const { data: rowB } = await adminClient
      .from("categories")
      .select("name_i18n")
      .eq("id", categoryOfB)
      .single();
    expect(rowB?.name_i18n).toEqual({ es: "Original B" });
  });

  it("deleteCategory con el id de otro tenant no borra la fila de B", async () => {
    const { id: categoryOfB } = await createCategory(tenantB.tenantId, {
      slug: `cross-cat-del-${nonce()}`,
      nameI18n: { es: "Sigue viva" },
    });

    await deleteCategory(tenantA.tenantId, categoryOfB);

    const { data: rowB } = await adminClient
      .from("categories")
      .select("id")
      .eq("id", categoryOfB)
      .maybeSingle();
    expect(rowB?.id).toBe(categoryOfB);
  });

  it("updateProduct con el id de otro tenant no afecta ninguna fila y B queda intacta", async () => {
    const { id: categoryOfB } = await createCategory(tenantB.tenantId, {
      slug: `cross-prod-upd-${nonce()}`,
      nameI18n: { es: "Cat B" },
    });
    const { id: productOfB } = await createProduct(tenantB.tenantId, {
      categoryId: categoryOfB,
      nameI18n: { es: "Original B" },
      price: 4.5,
    });

    await updateProduct(tenantA.tenantId, productOfB, { price: 999 });

    const { data: rowB } = await adminClient
      .from("products")
      .select("price, name_i18n")
      .eq("id", productOfB)
      .single();
    expect(Number(rowB?.price)).toBe(4.5);
    expect(rowB?.name_i18n).toEqual({ es: "Original B" });
  });

  it("deleteProduct con el id de otro tenant no borra la fila de B", async () => {
    const { id: categoryOfB } = await createCategory(tenantB.tenantId, {
      slug: `cross-prod-del-${nonce()}`,
      nameI18n: { es: "Cat B" },
    });
    const { id: productOfB } = await createProduct(tenantB.tenantId, {
      categoryId: categoryOfB,
      nameI18n: { es: "Sigue vivo" },
      price: 2,
    });

    await deleteProduct(tenantA.tenantId, productOfB);

    const { data: rowB } = await adminClient
      .from("products")
      .select("id")
      .eq("id", productOfB)
      .maybeSingle();
    expect(rowB?.id).toBe(productOfB);
  });
});

describe("update/delete de categorías y productos", () => {
  it("updateCategory cambia los campos, deleteCategory borra la fila", async () => {
    const { id } = await createCategory(tenantA.tenantId, {
      slug: `upd-${nonce()}`,
      nameI18n: { es: "Antes" },
    });

    await updateCategory(tenantA.tenantId, id, { nameI18n: { es: "Después" } });
    let catalog = await listAdminCatalog(tenantA.tenantId);
    expect(catalog.categories.find((c) => c.id === id)?.nameI18n.es).toBe("Después");

    await deleteCategory(tenantA.tenantId, id);
    catalog = await listAdminCatalog(tenantA.tenantId);
    expect(catalog.categories.some((c) => c.id === id)).toBe(false);
  });

  it("updateProduct, setProductAvailability y deleteProduct", async () => {
    const { id: categoryId } = await createCategory(tenantA.tenantId, {
      slug: `prod-upd-${nonce()}`,
      nameI18n: { es: "Cat" },
    });
    const { id: productId } = await createProduct(tenantA.tenantId, {
      categoryId,
      nameI18n: { es: "Prod" },
      price: 5,
    });

    await setProductAvailability(tenantA.tenantId, productId, false);
    let catalog = await listAdminCatalog(tenantA.tenantId);
    let product = catalog.categories.flatMap((c) => c.products).find((p) => p.id === productId);
    expect(product?.isAvailable).toBe(false);

    await updateProduct(tenantA.tenantId, productId, { price: 7.25 });
    catalog = await listAdminCatalog(tenantA.tenantId);
    product = catalog.categories.flatMap((c) => c.products).find((p) => p.id === productId);
    expect(product?.price).toBe(7.25);

    await deleteProduct(tenantA.tenantId, productId);
    catalog = await listAdminCatalog(tenantA.tenantId);
    product = catalog.categories.flatMap((c) => c.products).find((p) => p.id === productId);
    expect(product).toBeUndefined();
  });

  it("createExtra/deleteExtra", async () => {
    const { id: categoryId } = await createCategory(tenantA.tenantId, {
      slug: `extra-${nonce()}`,
      nameI18n: { es: "Cat" },
    });
    const { id: productId } = await createProduct(tenantA.tenantId, {
      categoryId,
      nameI18n: { es: "Prod" },
      price: 5,
    });
    const { id: extraId } = await createExtra(tenantA.tenantId, {
      productId,
      nameI18n: { es: "Extra" },
      price: 1,
    });

    let catalog = await listAdminCatalog(tenantA.tenantId);
    let product = catalog.categories.flatMap((c) => c.products).find((p) => p.id === productId);
    expect(product?.extras.some((e) => e.id === extraId)).toBe(true);

    await deleteExtra(tenantA.tenantId, extraId);
    catalog = await listAdminCatalog(tenantA.tenantId);
    product = catalog.categories.flatMap((c) => c.products).find((p) => p.id === productId);
    expect(product?.extras.some((e) => e.id === extraId)).toBe(false);
  });

  it("createTenantAllergen/deleteTenantAllergen", async () => {
    const { id } = await createTenantAllergen(tenantA.tenantId, {
      nameI18n: { es: "Personalizado" },
    });

    let catalog = await listAdminCatalog(tenantA.tenantId);
    expect(catalog.allergens.some((a) => a.id === id)).toBe(true);

    await deleteTenantAllergen(tenantA.tenantId, id);
    catalog = await listAdminCatalog(tenantA.tenantId);
    expect(catalog.allergens.some((a) => a.id === id)).toBe(false);
  });
});
