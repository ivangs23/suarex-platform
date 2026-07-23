import type { ReactNode } from "react";
import { requireManager } from "@/lib/require-manager";
import { AdminTabs } from "./AdminTabs";
import styles from "./admin.module.css";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireManager(); // redirige si no es gestor; nada se renderiza para un staff
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>SuarEx</span>
        <AdminTabs />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
