/**
 * Código de RECOGIDA de un pedido, derivado de su token público.
 *
 * El comensal lo ve en la pantalla del totem y lo lleerá impreso en su recibo: los dos TIENEN que
 * salir de la misma regla, o no cuadrarían. Por eso vive aquí, en un único sitio que comparten la
 * carta (`apps/web`) y el agente que imprime (`packages/agent`), en vez de repetir el recorte en
 * cada lado. Seis caracteres del token en mayúsculas: corto de leer y de cantar en barra, y
 * estable (el mismo pedido da siempre el mismo código).
 */
export function pickupCodeFromToken(publicToken: string): string {
  return publicToken.slice(0, 6).toUpperCase();
}
