/**
 * Validación PURA de los datos de alta de un cliente. Sin red ni base: se separa aquí para
 * probarla sin Supabase, igual que `source-adapters.mjs` y `storage-orphans.mjs`.
 *
 * Un alta va contra la base de PRODUCCIÓN, y un dato mal formado ahí no es un fallo cosmético:
 * un slug con mayúsculas o un espacio rompe el subdominio por el que se sirve la carta, y un
 * email inválido crea un owner que nunca podrá entrar. Se valida ANTES de tocar nada.
 */

/**
 * El slug es la identidad del cliente en la URL (`{slug}.suarex.app`) y la clave por la que la
 * carta resuelve el tenant (ver `findTenantByHost`). Solo minúsculas, números y guiones, sin
 * empezar ni acabar en guión: cualquier otra cosa produce un subdominio inválido o ambiguo.
 */
export function validarSlug(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      `Slug inválido: "${slug}". Solo minúsculas, números y guiones (p. ej. "bar-paco").`,
    );
  }
  if (slug.length > 63) {
    // Un subdominio no puede pasar de 63 caracteres (RFC 1035).
    throw new Error(`Slug demasiado largo: "${slug}" (máx 63 caracteres).`);
  }
  return slug;
}

/** Email del owner. No se valida a fondo (eso lo hace Auth), solo que tenga forma de email:
 *  un typo evidente aquí crea una cuenta a la que su dueño nunca podrá entrar. */
export function validarEmail(email) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Email inválido: "${email}".`);
  }
  return email.toLowerCase();
}

/** Idiomas y monedas que la plataforma sabe pintar; un valor fuera de aquí daría una carta
 *  a medias (ver `apps/web/lib/i18n.ts`). */
const IDIOMAS = new Set(["es", "en", "pt"]);

export function validarIdioma(idioma) {
  if (!IDIOMAS.has(idioma)) {
    throw new Error(`Idioma no soportado: "${idioma}". Usa uno de: ${[...IDIOMAS].join(", ")}.`);
  }
  return idioma;
}
