import { getCategories, getProducts } from "@suarex/db";
import { requireTenant } from "@/lib/tenant-context";

export default async function MenuPage({ params }: { params: Promise<{ mesa: string }> }) {
  const { mesa } = await params;
  const tenant = await requireTenant();

  const [categories, products] = await Promise.all([
    getCategories(tenant.id),
    getProducts(tenant.id),
  ]);

  return (
    <main>
      <h1 data-testid="tenant-name">{tenant.slug}</h1>
      <p data-testid="mesa">Mesa {mesa}</p>

      {categories.map((category) => (
        <section key={category.id} data-testid="category">
          <h2>{category.nameI18n.es}</h2>
          <ul>
            {products
              .filter((product) => product.categoryId === category.id)
              .map((product) => (
                <li key={product.id} data-testid="product">
                  {product.nameI18n.es} — {product.price.toFixed(2)} €
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
