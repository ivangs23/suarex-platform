import type { Metadata } from "next";
import type { ReactNode } from "react";

// El pedido y el recibo de un comensal son suyos: fuera de los buscadores.
export const metadata: Metadata = { robots: { index: false } };

export default function PedidoLayout({ children }: { children: ReactNode }) {
  return children;
}
