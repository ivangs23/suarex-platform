import type { Metadata } from "next";
import type { ReactNode } from "react";

// El totem lleva el token de su dispositivo en la URL: fuera de los buscadores.
export const metadata: Metadata = { robots: { index: false } };

export default function TotemLayout({ children }: { children: ReactNode }) {
  return children;
}
