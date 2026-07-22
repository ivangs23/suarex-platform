import { listStaff } from "@suarex/db";
import { requireManager } from "@/lib/require-manager";
import { StaffForm } from "./StaffForm";

/** Gestión de personal (D3). `requireManager()` primera barrera; `createStaffAction` la
 * revalida por su cuenta vía `managerAction`. Muestra el personal humano del tenant y el
 * formulario de alta de un camarero. */
export default async function AdminPersonalPage() {
  const session = await requireManager();
  const staff = await listStaff(session.tenantId);

  return (
    <main>
      <h1>Gestión de personal</h1>

      {staff.length === 0 ? <p>Todavía no hay personal.</p> : null}
      <ul>
        {staff.map((member) => (
          <li key={member.userId} data-testid="staff-member" data-user-id={member.userId}>
            {member.email} — {member.role}
          </li>
        ))}
      </ul>

      <StaffForm />
    </main>
  );
}
