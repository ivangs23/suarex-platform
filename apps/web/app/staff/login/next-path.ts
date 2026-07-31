/**
 * A dónde ir después de iniciar sesión.
 *
 * Quien pincha en "Productos" y se encuentra el login espera aterrizar en Productos, no en
 * otra pantalla cualquiera. Antes siempre se caía en `/staff`, así que en la app de escritorio
 * la cabecera decía "Productos" mientras debajo se veían las comandas.
 *
 * El destino llega por la URL (`?next=…`), así que es ENTRADA DEL EXTERIOR aunque hoy la ponga
 * nuestro propio redirect: cualquiera puede mandar a alguien un enlace al login con el `next`
 * que quiera. Un `next` sin validar convierte esta página en un redirector abierto -- se inicia
 * sesión en el sitio de verdad y se acaba en el del atacante, con la confianza ya ganada. Por
 * eso solo se aceptan rutas de ESTE sitio, y ante la mínima duda se cae en `/staff`.
 */

const POR_DEFECTO = "/staff";

export function destinoTrasLogin(next: string | null | undefined): string {
  if (!next) return POR_DEFECTO;

  // Tiene que ser una ruta absoluta de este sitio. `//evil.com` y `/\evil.com` son
  // protocol-relative: el navegador los resuelve como OTRO host, aunque empiecen por barra.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return POR_DEFECTO;
  }

  // Una URL absoluta con esquema (`https:`, y sobre todo `javascript:`) nunca empieza por
  // barra, así que lo de arriba ya las descarta. Esto cubre lo que quede raro -- bytes de
  // control, saltos de línea partiendo cabeceras -- sin intentar adivinar.
  for (const caracter of next) {
    const codigo = caracter.codePointAt(0) ?? 0;
    if (codigo < 0x20 || codigo === 0x7f) return POR_DEFECTO;
  }

  return next;
}
