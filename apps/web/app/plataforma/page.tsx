import { listPlatformTenants } from "@suarex/db";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { altaClienteAction, cambiarEstadoAction } from "./actions";
import { NuevoClienteForm } from "./NuevoClienteForm";
import styles from "./plataforma.module.css";

/**
 * Consola de plataforma: todos los clientes y su estado.
 *
 * El guard va AQUÍ y no en el layout: un `layout.tsx` envuelve también `/plataforma/login`, y
 * el login redirigiría a sí mismo en bucle.
 */
export default async function PlataformaPage() {
  await requirePlatformAdmin();
  const tenants = await listPlatformTenants();

  return (
    <>
      <NuevoClienteForm action={altaClienteAction} />

      <h2>Clientes ({tenants.length})</h2>
      <table className={styles.tabla}>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Nombre</th>
            <th>Estado</th>
            <th>Plan</th>
            <th>Gracia hasta</th>
            <th>Dominio propio</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id} data-testid="tenant-row">
              <td>{t.slug}</td>
              <td>{t.name}</td>
              <td className={t.status === "suspended" ? styles.suspendido : undefined}>
                {t.status === "suspended" ? "Suspendido" : "Activo"}
              </td>
              <td className={t.planStatus === "past_due" ? styles.impago : undefined}>
                {t.plan} · {t.planStatus}
              </td>
              <td>{t.graceUntil ? new Date(t.graceUntil).toLocaleDateString("es-ES") : "—"}</td>
              <td>{t.customDomain ?? "—"}</td>
              <td>
                <form action={cambiarEstadoAction}>
                  <input type="hidden" name="tenant_id" value={t.id} />
                  <input
                    type="hidden"
                    name="estado"
                    value={t.status === "suspended" ? "active" : "suspended"}
                  />
                  <button type="submit" className={styles.botonLinea}>
                    {t.status === "suspended" ? "Reactivar" : "Suspender"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
