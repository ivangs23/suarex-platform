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

/** Una extra elegible de un producto, ya en céntimos. */
export type CartExtra = { id: string; name: string; priceLabel: string; priceCents: number };

/** Lo mínimo que el carrito necesita de un producto para contar y cobrar. */
export type CartProduct = { id: string; name: string; priceCents: number; extras: CartExtra[] };

type CartState = {
  /** Unidades por producto. */
  quantities: Record<string, number>;
  /** Extras elegidas por producto, aplicadas a TODAS las unidades de esa línea. */
  selectedExtras: Record<string, string[]>;
  totalLabel: string;
  totalCents: number;
  error: string | null;
  enviando: boolean;
  /** `false` cuando este navegador no ha escaneado el QR de ninguna mesa. */
  canOrder: boolean;
  add: (product: CartProduct) => void;
  toggleExtra: (productId: string, extraId: string) => void;
  checkout: () => void;
};

/**
 * EL CARRITO ES UNO SOLO, PARA TODOS LOS CLIENTES.
 *
 * Toda la lógica de pedir -- contar unidades, aplicar extras, sumar, crear el pedido -- vive
 * aquí y en ningún otro sitio. Los temas solo colocan los botones y el resumen donde encajen
 * en su diseño. Es la misma regla que ya cumple la navegación de la carta: la página calcula,
 * el tema pinta.
 *
 * Nació de un fallo real: el carrito vivía en una segunda carta (`/m/{token}`) sin tema, así
 * que ningún cliente lo veía con su marca y cada mejora se hacía en una pantalla que no
 * enseñaba nadie.
 */
const CartContext = createContext<CartState | null>(null);

/** Carrito en curso de ESTA visita, para que sobreviva a navegar entre categorías. */
const CLAVE_CARRITO = "suarex_carrito";

type CarritoGuardado = {
  quantities: Record<string, number>;
  selectedExtras: Record<string, string[]>;
  enCarrito: Record<string, CartProduct>;
};

export function useCart(): CartState | null {
  return useContext(CartContext);
}

export function CartProvider({
  children,
  locale,
  currency,
  canOrder,
}: {
  children: ReactNode;
  locale: string;
  currency: string;
  /** Solo se puede pedir habiendo escaneado el QR de la mesa (ver `lib/mesa-cookie.ts`). */
  canOrder: boolean;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedExtras, setSelectedExtras] = useState<Record<string, string[]>>({});
  // Los productos que han entrado al carrito, guardados al añadirlos: el total se calcula
  // sobre ellos y no sobre el nivel que se esté viendo, porque navegar a otra categoría
  // desmonta los productos anteriores y si no el total se desharía al cambiar de pantalla.
  const [enCarrito, setEnCarrito] = useState<Record<string, CartProduct>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /* EL CARRITO SOBREVIVE A LA NAVEGACIÓN. La carta se navega por niveles con enlaces
     normales, así que cada categoría es una carga de página nueva y el estado de React se
     pierde entero. Un pedido real cae en categorías distintas -- un vino y una tosta -- y sin
     esto el comensal perdería lo que llevaba cada vez que cambiara de pantalla.

     `sessionStorage` y no `localStorage`: el carrito es de ESTA visita. Volver mañana al
     restaurante y encontrarse el pedido de ayer a medio hacer sería peor que empezar de cero.

     Se hidrata en un efecto, no en el `useState` inicial, porque en el servidor no existe:
     leerlo durante el render daría una marca distinta a la del cliente. */
  useEffect(() => {
    try {
      const crudo = window.sessionStorage.getItem(CLAVE_CARRITO);
      if (!crudo) return;
      const guardado = JSON.parse(crudo) as Partial<CarritoGuardado>;
      setQuantities(guardado.quantities ?? {});
      setSelectedExtras(guardado.selectedExtras ?? {});
      setEnCarrito(guardado.enCarrito ?? {});
    } catch {
      // Un carrito guardado ilegible (otra versión, manipulado) se ignora: empezar vacío es
      // molesto; romper la carta entera, no se puede.
      window.sessionStorage.removeItem(CLAVE_CARRITO);
    }
  }, []);

  useEffect(() => {
    try {
      const vacio = Object.keys(enCarrito).length === 0;
      if (vacio) {
        window.sessionStorage.removeItem(CLAVE_CARRITO);
        return;
      }
      window.sessionStorage.setItem(
        CLAVE_CARRITO,
        JSON.stringify({ quantities, selectedExtras, enCarrito } satisfies CarritoGuardado),
      );
    } catch {
      // Sin almacenamiento (modo privado de algunos navegadores) el carrito sigue
      // funcionando dentro de una misma pantalla; solo deja de sobrevivir al cambio.
    }
  }, [quantities, selectedExtras, enCarrito]);

  // Cifra ORIENTATIVA para el comensal. El cobro real lo recalcula `createPendingOrder`
  // desde la base de datos ignorando por completo lo que diga el navegador.
  const totalCents = useMemo(
    () =>
      Object.values(enCarrito).reduce((suma, product) => {
        const unidades = quantities[product.id] ?? 0;
        if (unidades === 0) return suma;
        const extrasCents = (selectedExtras[product.id] ?? []).reduce((extraSuma, extraId) => {
          const extra = product.extras.find((e) => e.id === extraId);
          return extraSuma + (extra?.priceCents ?? 0);
        }, 0);
        return suma + (product.priceCents + extrasCents) * unidades;
      }, 0),
    [enCarrito, quantities, selectedExtras],
  );

  const add = useCallback((product: CartProduct) => {
    setEnCarrito((actual) => ({ ...actual, [product.id]: product }));
    setQuantities((actual) => ({ ...actual, [product.id]: (actual[product.id] ?? 0) + 1 }));
  }, []);

  const toggleExtra = useCallback((productId: string, extraId: string) => {
    setSelectedExtras((actual) => {
      const elegidas = actual[productId] ?? [];
      const siguiente = elegidas.includes(extraId)
        ? elegidas.filter((id) => id !== extraId)
        : [...elegidas, extraId];
      return { ...actual, [productId]: siguiente };
    });
  }, []);

  const checkout = useCallback(async () => {
    setError(null);
    setEnviando(true);

    const lines = Object.entries(quantities)
      .filter(([, unidades]) => unidades > 0)
      .map(([productId, quantity]) => ({
        productId,
        quantity,
        extraIds: selectedExtras[productId] ?? [],
        notes: null,
      }));

    try {
      // Sin `tableToken`: la mesa la pone el servidor desde la cookie httpOnly del QR, así
      // que este navegador no puede pedir para una mesa que no sea la suya.
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines }),
      });

      const payload = (await response.json()) as { error?: string; publicToken?: string };
      if (!response.ok || !payload.publicToken) {
        setError(payload.error ?? "No se pudo crear el pedido");
        setEnviando(false);
        return;
      }

      window.location.href = `/pedido/${payload.publicToken}`;
    } catch {
      setError("No se pudo crear el pedido");
      setEnviando(false);
    }
  }, [quantities, selectedExtras]);

  const value = useMemo<CartState>(
    () => ({
      quantities,
      selectedExtras,
      totalCents,
      totalLabel: formatCents(totalCents, locale, currency),
      error,
      enviando,
      canOrder,
      add,
      toggleExtra,
      checkout,
    }),
    [
      quantities,
      selectedExtras,
      totalCents,
      locale,
      currency,
      error,
      enviando,
      canOrder,
      add,
      toggleExtra,
      checkout,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
