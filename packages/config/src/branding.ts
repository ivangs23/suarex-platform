import { z } from "zod";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT = /^[a-zA-Z0-9 ,'-]+$/;

export type Branding = {
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  logoUrl: string | null;
  fonts: { display: string; body: string };
};

export const DEFAULT_BRANDING: Branding = {
  colors: {
    bg: "#f5f1e8",
    fg: "#0f0f0f",
    primary: "#a88445",
    accent: "#1f1d1a",
    muted: "#d9d1bd",
  },
  logoUrl: null,
  fonts: { display: "system-ui", body: "system-ui" },
};

const colorSchema = z.string().regex(HEX);
const fontSchema = z.string().regex(FONT).max(64);

/**
 * Lee `obj[key]` sin lanzar nunca: ni si `obj` no es un objeto, ni si el
 * acceso a la propiedad dispara un getter que lanza. Un valor explícito
 * `undefined` y una propiedad ausente se devuelven igual (undefined), que
 * es exactamente el tratamiento que necesitamos para que el merge con el
 * default sea consistente en ambos casos (finding 4).
 */
function safeProp(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  try {
    return Reflect.get(obj as object, key);
  } catch {
    return undefined;
  }
}

/**
 * Valida una hoja individual contra su schema sin lanzar nunca. Devuelve
 * `undefined` tanto si el valor no cumple el schema como si evaluarlo
 * lanza por cualquier motivo (defensivo: para valores primitivos ya
 * extraídos por safeProp esto no debería lanzar, pero nunca es gratis
 * asumirlo).
 */
function safeParseLeaf<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  try {
    const result = schema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Un valor ausente o `undefined` explícito siempre pierde frente al default. */
function withDefault<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

/**
 * `logoUrl` solo admite URLs absolutas http/https. Se rechaza deliberadamente
 * cualquier otro esquema (`javascript:`, `data:`, `vbscript:`, `file:`, ...)
 * y también las rutas relativas: el storage de logos (Supabase Storage,
 * `tenant/{id}/...`) siempre entrega URLs absolutas https, no hay ningún
 * consumidor en este código que sirva logos desde una ruta relativa propia
 * del tenant, y aceptar rutas relativas sin más abriría la puerta a formas
 * ambiguas (p.ej. URLs "protocol-relative" `//host/...`) sin ningún
 * beneficio real. Mantener el contrato mínimo: absoluto, http o https.
 */
function safeParseLogoUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Nunca lanza: un ajuste inválido degrada, campo a campo, a su default. */
export function parseBranding(raw: unknown): Branding {
  const colorsRaw = safeProp(raw, "colors");
  const fontsRaw = safeProp(raw, "fonts");
  const logoUrlRaw = safeProp(raw, "logoUrl");

  return {
    colors: {
      bg: withDefault(
        safeParseLeaf(colorSchema, safeProp(colorsRaw, "bg")),
        DEFAULT_BRANDING.colors.bg,
      ),
      fg: withDefault(
        safeParseLeaf(colorSchema, safeProp(colorsRaw, "fg")),
        DEFAULT_BRANDING.colors.fg,
      ),
      primary: withDefault(
        safeParseLeaf(colorSchema, safeProp(colorsRaw, "primary")),
        DEFAULT_BRANDING.colors.primary,
      ),
      accent: withDefault(
        safeParseLeaf(colorSchema, safeProp(colorsRaw, "accent")),
        DEFAULT_BRANDING.colors.accent,
      ),
      muted: withDefault(
        safeParseLeaf(colorSchema, safeProp(colorsRaw, "muted")),
        DEFAULT_BRANDING.colors.muted,
      ),
    },
    logoUrl: withDefault(safeParseLogoUrl(logoUrlRaw), DEFAULT_BRANDING.logoUrl),
    fonts: {
      display: withDefault(
        safeParseLeaf(fontSchema, safeProp(fontsRaw, "display")),
        DEFAULT_BRANDING.fonts.display,
      ),
      body: withDefault(
        safeParseLeaf(fontSchema, safeProp(fontsRaw, "body")),
        DEFAULT_BRANDING.fonts.body,
      ),
    },
  };
}

export function brandingToCssVars(branding: Branding): string {
  const declarations = [
    `--color-bg:${branding.colors.bg}`,
    `--color-fg:${branding.colors.fg}`,
    `--color-primary:${branding.colors.primary}`,
    `--color-accent:${branding.colors.accent}`,
    `--color-muted:${branding.colors.muted}`,
    `--font-display:${branding.fonts.display}`,
    `--font-body:${branding.fonts.body}`,
  ];
  return `${declarations.join(";")};`;
}
