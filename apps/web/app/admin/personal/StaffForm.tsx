import { createStaffAction } from "./actions";

/** Alta de un camarero: email + contraseña (la fija el owner y se la comunica en persona;
 * no hay email de invitación en esta fase). Funcional, sin estilos. */
export function StaffForm() {
  return (
    <form action={createStaffAction} data-testid="staff-form">
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Contraseña (mín. 8)
        <input name="password" type="text" required minLength={8} />
      </label>
      <button type="submit">Dar de alta</button>
    </form>
  );
}
