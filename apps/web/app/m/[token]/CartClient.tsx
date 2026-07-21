"use client";

import { formatCents } from "@suarex/domain";
import { useMemo, useState } from "react";

type Extra = { id: string; name: string; priceCents: number };
type Product = {
  id: string;
  categoryId: string;
  name: string;
  priceCents: number;
  extras: Extra[];
};
type Category = { id: string; name: string };

export function CartClient({
  tableToken,
  locale,
  currency,
  categories,
  products,
}: {
  tableToken: string;
  locale: string;
  currency: string;
  categories: Category[];
  products: Product[];
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  // Un conjunto de extras elegidas por producto, aplicado a TODAS las unidades de esa
  // línea (igual que espera `CartLineInput`: una línea = un producto + un array de
  // extraIds, no una extra distinta por unidad).
  const [selectedExtras, setSelectedExtras] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  // Este total es solo para que el comensal vea una cifra antes de pagar -- el cobro
  // real lo recalcula `createPendingOrder` desde la base de datos, ignorando esto.
  const totalCents = useMemo(
    () =>
      products.reduce((sum, product) => {
        const quantity = quantities[product.id] ?? 0;
        if (quantity === 0) return sum;
        const extrasCents = (selectedExtras[product.id] ?? []).reduce((extraSum, extraId) => {
          const extra = product.extras.find((e) => e.id === extraId);
          return extraSum + (extra?.priceCents ?? 0);
        }, 0);
        return sum + (product.priceCents + extrasCents) * quantity;
      }, 0),
    [products, quantities, selectedExtras],
  );

  function add(productId: string) {
    setQuantities((current) => ({ ...current, [productId]: (current[productId] ?? 0) + 1 }));
  }

  function toggleExtra(productId: string, extraId: string) {
    setSelectedExtras((current) => {
      const chosen = current[productId] ?? [];
      const next = chosen.includes(extraId)
        ? chosen.filter((id) => id !== extraId)
        : [...chosen, extraId];
      return { ...current, [productId]: next };
    });
  }

  async function checkout() {
    setError(null);
    const lines = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({
        productId,
        quantity,
        extraIds: selectedExtras[productId] ?? [],
        notes: null,
      }));

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tableToken, lines }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "No se pudo crear el pedido");
      return;
    }

    const { publicToken } = (await response.json()) as { publicToken: string };
    window.location.href = `/pedido/${publicToken}`;
  }

  return (
    <>
      {categories.map((category) => (
        <section key={category.id}>
          <h2>{category.name}</h2>
          <ul>
            {products
              .filter((product) => product.categoryId === category.id)
              .map((product) => (
                <li key={product.id} data-testid="product" data-product-id={product.id}>
                  {product.name} — {formatCents(product.priceCents, locale, currency)}
                  {product.extras.length > 0 ? (
                    <ul data-testid="extras-list">
                      {product.extras.map((extra) => (
                        <li key={extra.id}>
                          <label>
                            <input
                              type="checkbox"
                              data-testid="extra-checkbox"
                              data-extra-id={extra.id}
                              checked={(selectedExtras[product.id] ?? []).includes(extra.id)}
                              onChange={() => toggleExtra(product.id, extra.id)}
                            />
                            {extra.name} (+{formatCents(extra.priceCents, locale, currency)})
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button type="button" data-testid="add-to-cart" onClick={() => add(product.id)}>
                    Añadir
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <p data-testid="cart-total">{formatCents(totalCents, locale, currency)}</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" disabled={totalCents === 0} onClick={checkout}>
        Pagar
      </button>
    </>
  );
}
