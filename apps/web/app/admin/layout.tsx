import type { ReactNode } from "react";
import { requireManager } from "@/lib/require-manager";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireManager(); // redirige si no es gestor; nada se renderiza para un staff
  return (
    <div>
      <nav>
        <a href="/admin">Inicio</a> · <a href="/admin/catalogo">Catálogo</a> ·{" "}
        <a href="/admin/mesas">Mesas</a> · <a href="/admin/dispositivos">Dispositivos</a> ·{" "}
        <a href="/admin/impresoras">Impresoras</a>
      </nav>
      {children}
    </div>
  );
}
