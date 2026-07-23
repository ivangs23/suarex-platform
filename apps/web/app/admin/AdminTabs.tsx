"use client";

import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const TABS = [
  { href: "/admin", label: "Inicio" },
  { href: "/admin/catalogo", label: "Catálogo" },
  { href: "/admin/mesas", label: "Mesas" },
  { href: "/admin/dispositivos", label: "Dispositivos" },
  { href: "/admin/impresoras", label: "Impresoras" },
  { href: "/admin/ajustes", label: "Ajustes" },
  { href: "/admin/personal", label: "Personal" },
] as const;

/**
 * Pestañas del panel. `"use client"` solo para leer la ruta activa y marcarla con
 * `aria-current`: sin eso, en un panel de siete secciones no hay forma de saber dónde se
 * está, y el subrayado de la pestaña activa es lo que lo dice de un vistazo.
 *
 * Los enlaces siguen siendo `<a>` normales -- navegación del servidor, sin estado de
 * cliente ni router propio.
 */
export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs} aria-label="Secciones del panel">
      {TABS.map((tab) => (
        <a
          key={tab.href}
          className={styles.tab}
          href={tab.href}
          // Coincidencia exacta: sin ella, "/admin" quedaría marcado en todas las
          // secciones, porque todas empiezan por esa ruta.
          aria-current={pathname === tab.href ? "page" : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
