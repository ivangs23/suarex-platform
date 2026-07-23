"use client";

import { formatCents } from "@suarex/domain";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Strings } from "@/lib/i18n";

/** Una extra elegible de un producto, ya en céntimos. */
export type CartExtra = { id: string; name: string; priceLabel: string; priceCents: number };

/** Lo mínimo que el carrito necesita de un producto para contar y cobrar. */
export type CartProduct = { id: string; name: string; priceCents: number; extras: CartExtra[] };

/**
 * Una LÍNEA del carrito: un producto con las extras y la nota que eligió el comensal.
 *
 * El carrito se lleva por líneas y no por producto porque el mismo café puede pedirse dos
 * veces de formas distintas -- uno con leche de avena y otro sin lactosa -- y con una entrada
 * por producto la segunda elección pisaría a la primera. Es además la forma que ya espera el
 * pedido (`CartLineInput`): una línea = un producto + sus extras + su nota.
 */
export type CartLine = {
  /** Id local de la línea; no existe en la base, solo distingue líneas en esta pantalla. */
  id: string;
  product: CartProduct;
  quantity: number;
  extraIds: string[];
  notes: string | null;
  /** Precio de UNA unidad con sus extras, en céntimos. */
  unitCents: number;
};

type CartState = {
  lines: CartLine[];
  totalLabel: string;
  totalCents: number;
  /** Unidades totales en el carrito, para el distintivo del botón del pedido. */
  totalUnits: number;
  error: string | null;
  enviando: boolean;
  /** `false` cuando este navegador no ha escaneado el QR de ninguna mesa. */
  canOrder: boolean;
  /** Unidades que hay de un producto, sumando todas sus líneas. */
  unitsOf: (productId: string) => number;
  addLine: (
    product: CartProduct,
    opciones?: { extraIds?: string[]; notes?: string | null; quantity?: number },
  ) => void;
  /** Suma una unidad a la última línea de ese producto, o la crea sin personalizar. */
  addOne: (product: CartProduct) => void;
  /** Quita una unidad de la última línea de ese producto; a cero, la línea desaparece. */
  removeOne: (productId: string) => void;
  setLineQuantity: (lineId: string, quantity: number) => void;
  formatCents: (cents: number) => string;
  /** Textos de la plataforma en el idioma elegido. El carrito es compartido, así que sus
   *  cadenas tampoco pueden quedarse escritas en español a pelo. */
  strings: Strings;
  checkout: () => void;
};

/**
 * EL CARRITO ES UNO SOLO, PARA TODOS LOS CLIENTES.
 *
 * Toda la lógica de pedir -- líneas, extras, notas, sumas, crear el pedido -- vive aquí y en
 * ningún otro sitio. Los temas solo colocan los botones y el resumen donde encajen en su
 * diseño. Es la misma regla que ya cumple la navegación de la carta: la página calcula, el
 * tema pinta.
 *
 * Nació de un fallo real: el carrito vivía en una segunda carta (`/m/{token}`) sin tema, así
 * que ningún cliente lo veía con su marca y cada mejora se hacía en una pantalla que no
 * enseñaba nadie.
 */
const CartContext = createContext<CartState | null>(null);

/** Carrito en curso de ESTA visita, para que sobreviva a navegar entre categorías. */
const CLAVE_CARRITO = "suarex_carrito";

export function useCart(): CartState | null {
  return useContext(CartContext);
}

function unitCentsDe(product: CartProduct, extraIds: string[]): number {
  const extras = extraIds.reduce((suma, extraId) => {
    const extra = product.extras.find((e) => e.id === extraId);
    return suma + (extra?.priceCents ?? 0);
  }, 0);
  return product.priceCents + extras;
}

export function CartProvider({
  children,
  locale,
  currency,
  canOrder,
  strings,
}: {
  children: ReactNode;
  locale: string;
  currency: string;
  /** Solo se puede pedir habiendo escaneado el QR de la mesa (ver `lib/mesa-cookie.ts`). */
  canOrder: boolean;
  strings: Strings;
}) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /* EL CARRITO SOBREVIVE A LA NAVEGACIÓN. La carta se navega por niveles con enlaces
     normales, así que cada categoría es una carga de página nueva y el estado de React se
     pierde entero. Un pedido real cae en categorías distintas -- un café y una tostada -- y
     sin esto el comensal perdería lo que llevaba cada vez que cambiara de pantalla.

     `sessionStorage` y no `localStorage`: el carrito es de ESTA visita. Volver mañana al
     restaurante y encontrarse el pedido de ayer a medio hacer sería peor que empezar de cero.

     Se hidrata en un efecto, no en el `useState` inicial, porque en el servidor no existe:
     leerlo durante el render daría una marca distinta a la del cliente. */
  useEffect(() => {
    try {
      const crudo = window.sessionStorage.getItem(CLAVE_CARRITO);
      if (!crudo) return;
      const guardado = JSON.parse(crudo) as CartLine[];
      if (Array.isArray(guardado)) setLines(guardado);
    } catch {
      // Un carrito guardado ilegible (otra versión, manipulado) se ignora: empezar vacío es
      // molesto; romper la carta entera, no se puede.
      window.sessionStorage.removeItem(CLAVE_CARRITO);
    }
  }, []);

  useEffect(() => {
    try {
      if (lines.length === 0) {
        window.sessionStorage.removeItem(CLAVE_CARRITO);
        return;
      }
      window.sessionStorage.setItem(CLAVE_CARRITO, JSON.stringify(lines));
    } catch {
      // Sin almacenamiento (modo privado de algunos navegadores) el carrito sigue
      // funcionando dentro de una misma pantalla; solo deja de sobrevivir al cambio.
    }
  }, [lines]);

  // Cifra ORIENTATIVA para el comensal. El cobro real lo recalcula `createPendingOrder`
  // desde la base de datos ignorando por completo lo que diga el navegador.
  const totalCents = useMemo(
    () => lines.reduce((suma, line) => suma + line.unitCents * line.quantity, 0),
    [lines],
  );

  const totalUnits = useMemo(() => lines.reduce((suma, line) => suma + line.quantity, 0), [lines]);

  const unitsOf = useCallback(
    (productId: string) =>
      lines
        .filter((line) => line.product.id === productId)
        .reduce((suma, line) => suma + line.quantity, 0),
    [lines],
  );

  const addLine = useCallback<CartState["addLine"]>((product, opciones) => {
    const extraIds = opciones?.extraIds ?? [];
    const notes = opciones?.notes?.trim() ? opciones.notes.trim() : null;
    const quantity = Math.max(1, opciones?.quantity ?? 1);

    setLines((actual) => {
      // Dos veces lo MISMO (mismas extras, misma nota) se agrupa en una línea con más
      // unidades: en la comanda de cocina son el mismo plato, y separarlas solo alargaría
      // el ticket.
      const igual = actual.find(
        (line) =>
          line.product.id === product.id &&
          line.notes === notes &&
          line.extraIds.length === extraIds.length &&
          line.extraIds.every((id) => extraIds.includes(id)),
      );
      if (igual) {
        return actual.map((line) =>
          line.id === igual.id ? { ...line, quantity: line.quantity + quantity } : line,
        );
      }

      return [
        ...actual,
        {
          // `crypto.randomUUID` existe en todo navegador con soporte de la carta; el respaldo
          // cubre contextos no seguros (http en una IP local), donde no está definido.
          id: globalThis.crypto?.randomUUID?.() ?? `${product.id}-${actual.length}`,
          product,
          quantity,
          extraIds,
          notes,
          unitCents: unitCentsDe(product, extraIds),
        },
      ];
    });
  }, []);

  const addOne = useCallback(
    (product: CartProduct) => {
      // Sin personalizar: suma a la ÚLTIMA línea de ese producto para no crear una línea
      // nueva idéntica cada vez que se pulsa el más.
      const ultima = [...lines].reverse().find((line) => line.product.id === product.id);
      if (!ultima) {
        addLine(product);
        return;
      }
      setLines((actual) =>
        actual.map((line) =>
          line.id === ultima.id ? { ...line, quantity: line.quantity + 1 } : line,
        ),
      );
    },
    [lines, addLine],
  );

  const removeOne = useCallback((productId: string) => {
    setLines((actual) => {
      const ultima = [...actual].reverse().find((line) => line.product.id === productId);
      if (!ultima) return actual;
      if (ultima.quantity > 1) {
        return actual.map((line) =>
          line.id === ultima.id ? { ...line, quantity: line.quantity - 1 } : line,
        );
      }
      // A cero la línea desaparece ENTERA, con sus extras y su nota: dejarla a cero haría
      // que volver a añadir el producto trajera de vuelta una elección ya deshecha.
      return actual.filter((line) => line.id !== ultima.id);
    });
  }, []);

  const setLineQuantity = useCallback((lineId: string, quantity: number) => {
    setLines((actual) =>
      quantity <= 0
        ? actual.filter((line) => line.id !== lineId)
        : actual.map((line) => (line.id === lineId ? { ...line, quantity } : line)),
    );
  }, []);

  const checkout = useCallback(async () => {
    setError(null);
    setEnviando(true);

    try {
      // Sin `tableToken`: la mesa la pone el servidor desde la cookie httpOnly del QR, así
      // que este navegador no puede pedir para una mesa que no sea la suya.
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((line) => ({
            productId: line.product.id,
            quantity: line.quantity,
            extraIds: line.extraIds,
            notes: line.notes,
          })),
        }),
      });

      const payload = (await response.json()) as { error?: string; publicToken?: string };
      if (!response.ok || !payload.publicToken) {
        setError(payload.error ?? strings.orderError);
        setEnviando(false);
        return;
      }

      window.location.href = `/pedido/${payload.publicToken}`;
    } catch {
      setError(strings.orderError);
      setEnviando(false);
    }
  }, [lines, strings]);

  const value = useMemo<CartState>(
    () => ({
      lines,
      totalCents,
      totalUnits,
      totalLabel: formatCents(totalCents, locale, currency),
      error,
      enviando,
      canOrder,
      unitsOf,
      addLine,
      addOne,
      removeOne,
      setLineQuantity,
      formatCents: (cents: number) => formatCents(cents, locale, currency),
      strings,
      checkout,
    }),
    [
      lines,
      totalCents,
      totalUnits,
      locale,
      currency,
      error,
      enviando,
      canOrder,
      unitsOf,
      addLine,
      addOne,
      removeOne,
      setLineQuantity,
      strings,
      checkout,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
