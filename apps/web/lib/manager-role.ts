/** Roles que gestionan el negocio (catálogo, cierre, personal). Aparte de `require-manager.ts`
 *  para poder usarlo sin arrastrar la capa de servidor (cabeceras, sesión, base de datos). */
export type ManagerRole = "owner" | "admin";

export function isManagerRole(role: string): role is ManagerRole {
  return role === "owner" || role === "admin";
}
