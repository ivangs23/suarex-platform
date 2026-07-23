import { cookies } from "next/headers";

/**
 * La mesa en la que está sentado el comensal, guardada en una cookie httpOnly.
 *
 * POR QUÉ UNA COOKIE Y NO LA URL. El QR impreso codifica `/m/{token}`, y ese token es lo
 * único que demuestra que quien pide está de verdad en esa mesa. La carta, en cambio, vive
 * en `/{mesa}` -- una URL con el número de mesa, que es público y que el comensal ve, copia
 * y comparte. Si para poder pedir hubiera que llevar el token en esa URL o incrustarlo en el
 * HTML, cualquiera que supiera el número podría mandar comandas a una mesa ajena desde su
 * casa. Con la cookie, el token entra UNA vez al escanear y no vuelve a salir del servidor:
 * ni el JavaScript de la página lo ve (httpOnly) ni aparece en ninguna URL compartible.
 *
 * `sameSite: lax` para que sobreviva a la navegación normal (el redirect del QR, los enlaces
 * de la carta) pero no viaje en peticiones cruzadas de otro sitio.
 *
 * `secure` solo fuera de desarrollo: en local la carta se sirve por http en
 * `garum.localhost:3000`, y una cookie `secure` ahí no se guardaría nunca.
 */
export const MESA_COOKIE = "suarex_mesa";

/** Una jornada larga. Pasado ese plazo hay que volver a escanear, que es lo esperable:
 *  la mesa de ayer no dice nada de dónde está sentado hoy. */
const MAX_AGE_SEGUNDOS = 12 * 60 * 60;

export function mesaCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SEGUNDOS,
    secure: process.env.NODE_ENV === "production",
  };
}

/** Token de la mesa fijado al escanear el QR, o `null` si este navegador no ha escaneado. */
export async function readMesaToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(MESA_COOKIE)?.value ?? null;
}
