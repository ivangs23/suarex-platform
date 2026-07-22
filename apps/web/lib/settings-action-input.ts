/**
 * Validación estricta del formulario de ajustes del negocio (`app/admin/ajustes`),
 * construida ENCIMA de los parsers genéricos de `form-parse.ts` (mismo patrón que
 * `catalog-action-input.ts`/`device-action-input.ts`). En el borde de la Server Action se
 * RECHAZA (no se degrada en silencio) un color/fuente/IVA/moneda inválido: mejor UX que
 * dejar que `parseBranding` lo degrade a default en lectura sin que el owner se entere.
 * Los regex de color/fuente NO se duplican aquí -- se reusan vía `isHexColor`/`isFontName`
 * de `@suarex/config`, la misma fuente que usa `parseBranding` en lectura.
 */
import { isFontName, isHexColor } from "@suarex/config";
import { InvalidFormFieldError, optionalString, requiredString } from "./form-parse";

function requiredHexColor(formData: FormData, field: string): string {
  const value = requiredString(formData, field);
  if (!isHexColor(value)) {
    throw new InvalidFormFieldError(`Color inválido en ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

function requiredFont(formData: FormData, field: string): string {
  const value = requiredString(formData, field);
  if (!isFontName(value)) {
    throw new InvalidFormFieldError(`Fuente inválida en ${field}: ${JSON.stringify(value)}`);
  }
  return value;
}

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

export function parseBrandingFields(formData: FormData): {
  name: string | null;
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  fonts: { display: string; body: string };
} {
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
