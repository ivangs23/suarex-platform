"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const TABS = [
  { href: "/admin", label: "Inicio" },
  { href: "/admin/informes", label: "Informes" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/catalogo", label: "Catálogo" },
  { href: "/admin/mesas", label: "Mesas" },
  { href: "/admin/dispositivos", label: "Dispositivos" },
  { href: "/admin/impresoras", label: "Impresoras" },
  { href: "/admin/pagos", label: "Pagos" },
  { href: "/admin/ajustes", label: "Ajustes" },
  { href: "/admin/cierre", label: "Cierre de caja" },
  { href: "/admin/personal", label: "Personal" },
  // Al final del todo a propósito: se mira cuando ya se ha configurado, no antes.
  { href: "/admin/instalacion", label: "Puesta en marcha" },
] as const;

/**
 * Pestañas del panel. `"use client"` solo para leer la ruta activa y marcarla con
 * `aria-current`: sin eso, en un panel de diez secciones no hay forma de saber dónde se
 * está, y el subrayado de la pestaña activa es lo que lo dice de un vistazo.
 *
 * `Link`, no `<a>`.
 *
 * Con `<a>`, cada clic en una pestaña era una carga de documento entera: el navegador
 * descartaba la aplicación y la volvía a montar de cero -- 2,7 MB de JavaScript otra vez, más
 * de medio segundo de espera con la pantalla en blanco, y el árbol de React reconstruido para
 * cambiar la parte de abajo. Diez veces por sesión de trabajo.
 *
 * Con `Link` el servidor sigue haciendo exactamente el mismo trabajo -- estas páginas siguen
 * siendo componentes de servidor y `requireManager()` se ejecuta igual en cada una: no se
 * relaja ninguna comprobación. Lo que cambia es el transporte: viaja la respuesta ya
 * renderizada de la sección nueva, unos kilobytes, y la cabecera con las pestañas ni se
 * desmonta. Además Next precarga la sección al pasar por encima, así que el clic suele caer
 * sobre algo que ya está.
 */
export function AdminTabs() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs} aria-label="Secciones del panel">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          className={styles.tab}
          href={tab.href}
          // Coincidencia exacta: sin ella, "/admin" quedaría marcado en todas las
          // secciones, porque todas empiezan por esa ruta.
          aria-current={pathname === tab.href ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
