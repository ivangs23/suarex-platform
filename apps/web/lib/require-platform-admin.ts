import { isPlatformAdmin } from "@suarex/db";
import { redirect } from "next/navigation";
import { guardedAction } from "./guarded-action";
import { staffServerClient } from "./supabase-server";

export type PlatformSession = { userId: string };

/**
 * GUARD DE LA CONSOLA DE PLATAFORMA. Hermano de `requireManager`, pero SIN tenant: aquí no hay
 * `hostTenant` que casar, porque el host de plataforma no resuelve ninguno (ver `proxy.ts`).
 *
 * Dos hechos independientes, los dos obligatorios: hay una sesión de Auth válida, Y ese usuario
 * está en `platform_admins`. Los dos fallos redirigen al MISMO sitio, sin distinguirse: quien
 * no es del equipo no debe poder deducir si la consola existe ni si un correo tiene acceso.
 *
 * Esta comprobación NO tiene una segunda barrera de RLS detrás: `packages/db/src/platform.ts`
 * escribe con el service role, que salta RLS por diseño. Igual que en `requireManager`, lo que
 * mantiene cerrada la consola es estructural -- este guard MÁS el 404 del proxy bajo cualquier
 * host que no sea el de plataforma -- no RLS. Son dos barreras para dos amenazas distintas, y
 * ninguna es backstop de la otra.
 */
/**
 * Envoltorio OBLIGATORIO para toda Server Action de la consola de plataforma, hermano de
 * `managerAction` y salido del mismo combinador. Antes cada action empezaba por
 * `await requirePlatformAdmin()` a mano, con un comentario que justificaba la excepción
 * diciendo que las dos actions "no comparten forma" -- cuando ambas son
 * `(formData: FormData) => Promise<void>`, exactamente la forma para la que el envoltorio
 * existe. La justificación era falsa y la barrera dependía de la memoria.
 */
export const platformAction = guardedAction(requirePlatformAdmin);

export async function requirePlatformAdmin(): Promise<PlatformSession> {
  const client = await staffServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/plataforma/login");

  if (!(await isPlatformAdmin(data.user.id))) redirect("/plataforma/login");

  return { userId: data.user.id };
}
