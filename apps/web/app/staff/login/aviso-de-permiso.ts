import { isManagerRole } from "@/lib/manager-role";

/**
 * Qué decir cuando alguien que YA ha entrado acaba en el login porque su rol no le deja ver lo
 * que pedía.
 *
 * `requireManager` manda al login a tres casos sin distinguirlos: sin sesión, sesión de otro
 * negocio y personal sin permisos de gestión. Para los dos primeros está bien. Para el tercero el
 * formulario a secas confunde: el camarero que pulsa "Productos" en el PC de cocina ve el login
 * otra vez y cree que la app ha olvidado su contraseña.
 *
 * Solo se avisa si hay sesión de ESTE negocio (la del host) y se iba a una ruta de gestión. No
 * revela nada nuevo: quien lo lee ya sabe que ha entrado, y con qué cuenta.
 */
export function avisoDePermiso(sesion: { role: string } | null, destino: string): string | null {
  if (!sesion || isManagerRole(sesion.role)) return null;
  if (destino !== "/admin" && !destino.startsWith("/admin/")) return null;
  return "Has entrado como personal, y esta sección es de gestión. Entra con una cuenta de encargado para verla.";
}
