/**
 * Validación del formulario de alta de cliente de la consola de plataforma, construida encima
 * de los parsers genéricos de `form-parse.ts` (mismo patrón que `settings-action-input.ts`).
 *
 * Se RECHAZA en el borde en vez de degradar, y aquí con más motivo que en ningún otro
 * formulario: el `slug` acaba siendo el subdominio por el que se sirve ese cliente para
 * siempre, y cambiarlo después obliga a reimprimir los códigos QR de todas sus mesas.
 */
import { validarSlugPlataforma } from "@suarex/config";
import { InvalidFormFieldError, requiredString } from "./form-parse";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type NuevoCliente = {
  slug: string;
  name: string;
  ownerEmail: string;
  theme: string;
  locale: string;
  currency: string;
};

export function parseNuevoCliente(formData: FormData): NuevoCliente {
  const slug = requiredString(formData, "slug").trim().toLowerCase();
  if (!validarSlugPlataforma(slug)) {
    throw new InvalidFormFieldError(
      `Slug inválido: ${JSON.stringify(slug)}. Solo minúsculas, números y guiones (no al ` +
        "principio ni al final), entre 3 y 40 caracteres, y no puede ser un subdominio " +
        "reservado (www, api, admin, app).",
    );
  }

  const ownerEmail = requiredString(formData, "owner_email").trim().toLowerCase();
  if (!EMAIL.test(ownerEmail)) {
    throw new InvalidFormFieldError(`Correo inválido: ${JSON.stringify(ownerEmail)}`);
  }

  const currency = requiredString(formData, "currency").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidFormFieldError(`Código de moneda inválido (3 letras): ${currency}`);
  }

  return {
    slug,
    name: requiredString(formData, "name").trim(),
    ownerEmail,
    theme: requiredString(formData, "theme").trim(),
    locale: requiredString(formData, "locale").trim(),
    currency,
  };
}
