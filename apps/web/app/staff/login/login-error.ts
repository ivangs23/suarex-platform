/**
 * Qué decirle a quien acaba de fallar el login.
 *
 * Antes esto era una sola frase para TODO: "Email o contraseña incorrectos" salía igual si la
 * contraseña estaba mal, si el servidor no respondía o si el equipo no llegaba a la plataforma.
 * Y eso no es un detalle de redacción: manda a la persona a probar contraseñas durante media hora
 * cuando el problema era la red. Pasó de verdad, con las credenciales buenas delante.
 *
 * Así que solo se dice "incorrectos" cuando el servidor ha dicho EXACTAMENTE eso. Cualquier otra
 * cosa se admite como lo que es: un fallo que no es culpa de quien está tecleando.
 */

/** Lo que hace falta de un error de Supabase Auth para decidir. `unknown` porque llega del SDK. */
type PosibleAuthError = {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
};

/** El servidor ha rechazado las credenciales, y no otra cosa. */
function sonCredencialesRechazadas(error: PosibleAuthError): boolean {
  // `code` es el discriminante estable de supabase-js; `status` 400 con este código es el
  // rechazo de usuario/contraseña. Se comprueba el código y no el mensaje porque el mensaje
  // está en inglés y cambia entre versiones.
  return error.code === "invalid_credentials" || error.code === "invalid_grant";
}

/** No se ha llegado a hablar con el servidor. */
function esFalloDeRed(error: PosibleAuthError): boolean {
  // supabase-js envuelve los fallos de fetch en `AuthRetryableFetchError`, y les pone status 0
  // cuando la petición ni siquiera salió.
  return (
    error.name === "AuthRetryableFetchError" || error.status === 0 || error.status === undefined
  );
}

export function mensajeDeErrorDeLogin(error: PosibleAuthError): string {
  if (sonCredencialesRechazadas(error)) return "Email o contraseña incorrectos";

  if (esFalloDeRed(error)) {
    return "No se pudo contactar con el servidor. Comprueba la conexión a internet de este equipo.";
  }

  // Rate limit: decir "incorrectos" aquí es especialmente cruel, porque la contraseña puede ser
  // la buena y lo único que hace falta es esperar.
  if (error.status === 429) {
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  }

  // Cualquier otra cosa (500, configuración mal, un error nuevo del SDK): se admite que el fallo
  // es del sistema y se enseña el detalle, que es lo que luego nos permite arreglarlo.
  return `No se pudo iniciar sesión: ${error.message ?? "error desconocido"}`;
}
