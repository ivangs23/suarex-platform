import { getTenantBillingState } from "@suarex/db";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireManager } from "@/lib/require-manager";
import { AdminTabs } from "./AdminTabs";
import styles from "./admin.module.css";
import { BillingBanner } from "./BillingBanner";

// El panel no es contenido público: fuera de los buscadores.
export const metadata: Metadata = { robots: { index: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireManager(); // redirige si no es gestor; nada se renderiza para un staff

  // El aviso de impago no puede tumbar el panel: si la lectura falla, el gestor sigue
  // entrando y trabajando -- simplemente no ve el aviso. Cortarle el acceso al panel por un
  // fallo al consultar su estado de facturación sería el peor momento posible para hacerlo.
  const billing = await getTenantBillingState(session.tenantId).catch(() => null);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>SuarEx</span>
        <AdminTabs />
      </header>
      <main className={styles.main}>
        {billing ? (
          <BillingBanner planStatus={billing.planStatus} graceUntil={billing.graceUntil} />
        ) : null}
        {children}
      </main>
    </div>
  );
}
