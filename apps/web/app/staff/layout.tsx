import type { Metadata } from "next";
import type { ReactNode } from "react";

// El tablero del personal no es contenido público: fuera de los buscadores.
export const metadata: Metadata = { robots: { index: false } };

export default function StaffLayout({ children }: { children: ReactNode }) {
  return children;
}
