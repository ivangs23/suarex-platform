import type { ReactNode } from "react";
import styles from "./plataforma.module.css";

/**
 * SOLO CÁSCARA VISUAL, SIN GUARD. En el App Router un `layout.tsx` envuelve TODAS las rutas
 * anidadas, `/plataforma/login` incluida: con el guard aquí, el login redirigiría a sí mismo en
 * bucle y nadie podría entrar nunca.
 *
 * El guard vive en cada `page.tsx` que no sea el login, y en cada Server Action.
 */
export default function PlataformaLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>SuarEx · plataforma</span>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
