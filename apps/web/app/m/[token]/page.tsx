import { loadTableMenu } from "@suarex/db";
import { notFound } from "next/navigation";
import { CartClient } from "./CartClient";

export default async function MesaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const menu = await loadTableMenu(token);
  if (!menu) notFound();

  const { table, categories, products, settings } = menu;
  const locale = settings?.locale ?? "es";
  const currency = settings?.currency ?? "EUR";

  return (
    <main>
      <h1>
        Mesa <span data-testid="mesa-label">{table.label}</span>
      </h1>
      <CartClient
        tableToken={token}
        locale={locale}
        currency={currency}
        categories={categories.map((c) => ({ id: c.id, name: c.nameI18n.es ?? c.slug }))}
        products={products.map((p) => ({
          id: p.id,
          categoryId: p.categoryId,
          name: p.nameI18n.es ?? "",
          priceCents: Math.round(p.price * 100),
          extras: p.extras.map((e) => ({
            id: e.id,
            name: e.nameI18n.es ?? "",
            priceCents: Math.round(e.price * 100),
          })),
        }))}
      />
    </main>
  );
}
