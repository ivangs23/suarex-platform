"use client";

import { formatCents } from "@suarex/domain";
import { useMemo, useState } from "react";

type Product = { id: string; categoryId: string; name: string; priceCents: number };
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
  const [error, setError] = useState<string | null>(null);

  const totalCents = useMemo(
    () =>
      products.reduce(
        (sum, product) => sum + product.priceCents * (quantities[product.id] ?? 0),
        0,
      ),
    [products, quantities],
  );

  function add(productId: string) {
    setQuantities((current) => ({ ...current, [productId]: (current[productId] ?? 0) + 1 }));
  }

  async function checkout() {
    setError(null);
    const lines = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity, extraIds: [], notes: null }));

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
                <li key={product.id} data-testid="product">
                  {product.name} — {formatCents(product.priceCents, locale, currency)}
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
