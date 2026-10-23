/**
 * Validación estricta del formulario de ajustes del negocio (`app/admin/ajustes`),
 * construida ENCIMA de los parsers genéricos de `form-parse.ts` (mismo patrón que
 * `catalog-action-input.ts`/`device-action-input.ts`). En el borde de la Server Action se
 * RECHAZA (no se degrada en silencio) un color/fuente/IVA/moneda inválido: mejor UX que
 * dejar que `parseBranding` lo degrade a default en lectura sin que el owner se entere.
 * Las reglas de color, fuente, tokens y ejes NO se duplican aquí -- se reusan de
 * `@suarex/config` (`isHexColor`, `isFontFamily`, `TOKEN_OPTIONS`, `LAYOUT_OPTIONS`), la misma
 * fuente que usa `parseBranding` en lectura.
 */
import {
  type Branding,
  type BrandingLayout,
  type BrandingTokens,
  type FontFamily,
  isFontFamily,
  isHexColor,
  isOneOf,
  LAYOUT_OPTIONS,
  normalizeCustomDomain,
  TOKEN_OPTIONS,
} from "@suarex/config";
import { InvalidFormFieldError, optionalString, requiredString } from "./form-parse";
import { SUPPORTED_LANGS } from "./i18n";

function requiredHexColor(formData: FormData, field: string): string {
  const value = requiredString(formData, field);
  if (!isHexColor(value)) {
    throw new InvalidFormFieldError(`Color inválido en ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Un color que se puede dejar vacío (= automático). */
function optionalHexColor(formData: FormData, field: string): string | null {
  const value = optionalString(formData, field);
  if (value === undefined) return null;
  if (!isHexColor(value)) {
    throw new InvalidFormFieldError(`Color inválido en ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

function requiredFont(formData: FormData, field: string): FontFamily {
  const value = requiredString(formData, field);
  if (!isFontFamily(value)) {
    throw new InvalidFormFieldError(`Fuente inválida en ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Un select: tiene que llegar uno de sus valores. Un valor fuera de la lista es una petición
 *  fabricada a mano, no un error de quien rellena el formulario. */
function requiredOption<T extends string>(
  formData: FormData,
  field: string,
  options: readonly T[],
): T {
  const value = requiredString(formData, field);
  if (!isOneOf(options, value)) {
    throw new InvalidFormFieldError(`Valor inválido en ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Mismos límites que `parseBranding` (`packages/config/src/branding.ts`). */
const MAX_TAGLINE_LENGTH = 120;
const MAX_BADGE_EMOJI_LENGTH = 8;
const BACKGROUND_SIZE = { min: 40, max: 600 };

/** Mismo límite que `nameSchema` en `@suarex/config` (`packages/config/src/branding.ts`):
 * en lectura, un nombre por encima de este límite se degrada en silencio a `null` (y la
 * carta pública cae a `tenant.slug`). Se rechaza aquí, en escritura, para que ese
 * degradado nunca se alcance en uso normal -- igual que color/fuente/moneda. */
const MAX_NAME_LENGTH = 80;

function optionalBusinessName(formData: FormData, field: string): string | null {
  const value = optionalString(formData, field);
  if (value === undefined) return null;
  if (value.length > MAX_NAME_LENGTH) {
    throw new InvalidFormFieldError(
      `El nombre del negocio no puede superar ${MAX_NAME_LENGTH} caracteres`,
    );
  }
  return value;
}

function parseTokenFields(formData: FormData): BrandingTokens {
  const o = TOKEN_OPTIONS;
  return {
    surface: optionalHexColor(formData, "token_surface"),
    radius: requiredOption(formData, "token_radius", o.radius),
    controlRadius: requiredOption(formData, "token_control_radius", o.controlRadius),
    shadow: requiredOption(formData, "token_shadow", o.shadow),
    border: requiredOption(formData, "token_border", o.border),
    spacing: requiredOption(formData, "token_spacing", o.spacing),
    titles: requiredOption(formData, "token_titles", o.titles),
    imageFit: requiredOption(formData, "token_image_fit", o.imageFit),
    thumb: requiredOption(formData, "token_thumb", o.thumb),
    cartIcon: requiredOption(formData, "token_cart_icon", o.cartIcon),
  };
}

function parseLayoutFields(formData: FormData): BrandingLayout {
  const o = LAYOUT_OPTIONS;
  return {
    welcome: requiredOption(formData, "layout_welcome", o.welcome),
    hero: requiredOption(formData, "layout_hero", o.hero),
    nav: requiredOption(formData, "layout_nav", o.nav),
    categories: requiredOption(formData, "layout_categories", o.categories),
    products: requiredOption(formData, "layout_products", o.products),
    langs: requiredOption(formData, "layout_langs", o.langs),
  };
}

/** Un campo por idioma de la plataforma; los vacíos no se guardan. */
function parseTagline(formData: FormData): Record<string, string> {
  const tagline: Record<string, string> = {};
  for (const lang of SUPPORTED_LANGS) {
    const value = optionalString(formData, `tagline_${lang}`);
    if (value === undefined) continue;
    if (value.length > MAX_TAGLINE_LENGTH) {
      throw new InvalidFormFieldError(
        `El lema (${lang}) no puede superar ${MAX_TAGLINE_LENGTH} caracteres`,
      );
    }
    tagline[lang] = value;
  }
  return tagline;
}

/** Sin emoji no hay insignia; con emoji, el color es obligatorio. */
function parseBadge(formData: FormData): Branding["badge"] {
  const emoji = optionalString(formData, "badge_emoji");
  if (emoji === undefined) return null;
  if (emoji.length > MAX_BADGE_EMOJI_LENGTH) {
    throw new InvalidFormFieldError("La insignia es un emoji, no un texto");
  }
  return { emoji, color: requiredHexColor(formData, "badge_color") };
}

function parseBackgroundSize(formData: FormData): number {
  const value = Number(requiredString(formData, "background_size"));
  if (!Number.isInteger(value) || value < BACKGROUND_SIZE.min || value > BACKGROUND_SIZE.max) {
    throw new InvalidFormFieldError(
      `El tamaño de la textura va de ${BACKGROUND_SIZE.min} a ${BACKGROUND_SIZE.max} px`,
    );
  }
  return value;
}

/** Todo lo de la marca que viene en el formulario. Las imágenes (logo, bienvenida, textura) se
 *  suben aparte en la Server Action. */
export function parseBrandingFields(
  formData: FormData,
): Omit<Branding, "logoUrl" | "heroUrl" | "background"> & { backgroundSizePx: number } {
  return {
    name: optionalBusinessName(formData, "name"),
    colors: {
      bg: requiredHexColor(formData, "color_bg"),
      fg: requiredHexColor(formData, "color_fg"),
      primary: requiredHexColor(formData, "color_primary"),
      accent: requiredHexColor(formData, "color_accent"),
      muted: requiredHexColor(formData, "color_muted"),
    },
    fonts: {
      display: requiredFont(formData, "font_display"),
      body: requiredFont(formData, "font_body"),
    },
    tokens: parseTokenFields(formData),
    layout: parseLayoutFields(formData),
    backgroundSizePx: parseBackgroundSize(formData),
    tagline: parseTagline(formData),
    badge: parseBadge(formData),
  };
}

export function parseFiscalFields(formData: FormData): {
  legalName?: string;
  cif?: string;
  address?: string;
  phone?: string;
  taxRate?: number;
} {
  const fiscal: {
    legalName?: string;
    cif?: string;
    address?: string;
    phone?: string;
    taxRate?: number;
  } = {
    legalName: optionalString(formData, "legal_name"),
    cif: optionalString(formData, "cif"),
    address: optionalString(formData, "address"),
    phone: optionalString(formData, "phone"),
  };

  const taxRaw = optionalString(formData, "tax_rate");
  if (taxRaw !== undefined) {
    const percent = Number(taxRaw);
    if (!Number.isFinite(percent)) {
      throw new InvalidFormFieldError(
        `IVA inválido (se esperaba un número): ${JSON.stringify(taxRaw)}`,
      );
    }
    if (percent < 0 || percent > 100) {
      throw new InvalidFormFieldError(`El IVA debe estar entre 0 y 100: ${percent}`);
    }
    // El formulario recoge un porcentaje (10 = 10 %); el schema exige una fracción 0..1.
    fiscal.taxRate = percent / 100;
  }

  return fiscal;
}

export function parseLocale(formData: FormData): string {
  return optionalString(formData, "locale") ?? "es";
}

export function parseCurrency(formData: FormData): string {
  const raw = optionalString(formData, "currency");
  if (raw === undefined) return "EUR";
  const upper = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new InvalidFormFieldError(`Código de moneda inválido (3 letras): ${JSON.stringify(raw)}`);
  }
  return upper;
}

/**
 * Dominio propio del cliente (`tenants.custom_domain`), o `null` si el campo viene vacío
 * (que es cómo se quita uno ya configurado).
 *
 * Se RECHAZA en el borde en vez de degradar, y con más motivo que el resto de campos: lo
 * que se guarde aquí decide qué certificados pide Caddy a Let's Encrypt (ver
 * `/api/tls-check`). Un valor basura no rompe una pantalla, agota una cuota compartida por
 * todos los clientes.
 *
 * `rootDomains` se pasa como parámetro en vez de leerse aquí de `process.env` para que la
 * función siga siendo pura y testeable sin tocar el entorno.
 */
export function parseCustomDomain(formData: FormData, rootDomains: string[]): string | null {
  const raw = optionalString(formData, "custom_domain");
  if (raw === undefined) return null;

  const normalized = normalizeCustomDomain(raw, rootDomains);
  if (!normalized) {
    throw new InvalidFormFieldError(
      `Dominio inválido: ${JSON.stringify(raw)}. Escribe solo el nombre del dominio ` +
        "(ejemplo.com), sin https:// ni rutas, y que no cuelgue del dominio de la plataforma.",
    );
  }
  return normalized;
}
