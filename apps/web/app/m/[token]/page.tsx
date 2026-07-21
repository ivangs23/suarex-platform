import { findTableByToken, getCategories, getProducts } from "@suarex/db";
import { notFound } from "next/navigation";
import { CartClient } from "./CartClient";

export default async function MesaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const table = await findTableByToken(token);
  if (!table?.isActive) notFound();

  const [categories, products] = await Promise.all([
    getCategories(table.tenantId),
    getProducts(table.tenantId),
  ]);

  return (
    <main>
      <h1>
        Mesa <span data-testid="mesa-label">{table.label}</span>
      </h1>
      <CartClient
        tableToken={token}
        categories={categories.map((c) => ({ id: c.id, name: c.nameI18n.es ?? c.slug }))}
        products={products.map((p) => ({
          id: p.id,
          categoryId: p.categoryId,
          name: p.nameI18n.es ?? "",
          priceCents: Math.round(p.price * 100),
        }))}
      />
    </main>
  );
}
