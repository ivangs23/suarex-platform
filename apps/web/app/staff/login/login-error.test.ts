import { describe, expect, it } from "vitest";
import { mensajeDeErrorDeLogin } from "./login-error";

/**
 * Lo que se prueba aquí no es la redacción: es que un fallo que NO es la contraseña nunca diga
 * que es la contraseña. Ese mensaje manda a la persona a probar claves buenas una y otra vez
 * mientras el problema real (la red, el servidor) sigue ahí sin que nadie lo mire.
 */
describe("mensajeDeErrorDeLogin", () => {
  it("dice 'incorrectos' SOLO cuando el servidor ha rechazado las credenciales", () => {
    const mensaje = mensajeDeErrorDeLogin({
      name: "AuthApiError",
      status: 400,
      code: "invalid_credentials",
      message: "Invalid login credentials",
    });
    expect(mensaje).toBe("Email o contraseña incorrectos");
  });

  it("un fallo de red no se disfraza de contraseña mal puesta", () => {
    // El caso que nos costó media hora: credenciales buenas, el equipo sin llegar al servidor.
    const mensaje = mensajeDeErrorDeLogin({
      name: "AuthRetryableFetchError",
      status: 0,
      message: "Failed to fetch",
    });
    expect(mensaje).not.toContain("incorrect");
    expect(mensaje).toContain("conexión");
  });

  it("un error sin status tampoco: si no hubo respuesta, no hubo rechazo", () => {
    const mensaje = mensajeDeErrorDeLogin({ message: "Network request failed" });
    expect(mensaje).toContain("conexión");
  });

  it("el límite de intentos se explica como lo que es: hay que esperar", () => {
    const mensaje = mensajeDeErrorDeLogin({
      name: "AuthApiError",
      status: 429,
      message: "Request rate limit reached",
    });
    expect(mensaje).toContain("Espera");
    expect(mensaje).not.toContain("incorrect");
  });

  it("un fallo del servidor enseña el detalle, que es lo que permite arreglarlo", () => {
    const mensaje = mensajeDeErrorDeLogin({
      name: "AuthApiError",
      status: 500,
      message: "Database error querying schema",
    });
    expect(mensaje).toContain("Database error querying schema");
  });

  it("un error sin mensaje no imprime 'undefined' en la cara del usuario", () => {
    expect(mensajeDeErrorDeLogin({ status: 503 })).toBe(
      "No se pudo iniciar sesión: error desconocido",
    );
  });
});
