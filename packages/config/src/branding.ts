import { z } from "zod";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Familias de letra que la carta puede usar: SOLO las que carga el layout raíz (next/font) más
 * las del sistema. Un nombre libre no servía de nada -- una familia que el navegador no tiene no
 * se pinta -- y el panel dejaba escribirlo como si funcionara.
 */
export const FONT_FAMILIES = ["playfair", "inter", "system"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

/** Pila CSS de cada familia. Sin comillas: va dentro de un `<style>` (ver `brandingToCssVars`). */
const FONT_STACKS: Record<FontFamily, string> = {
  playfair: "var(--font-playfair), Georgia, serif",
  inter: "var(--font-inter), system-ui, sans-serif",
  system: "system-ui, sans-serif",
};

/**
 * EJES DE LAYOUT de la carta (spec `2026-10-22-temas-data-driven-design.md`, sección 4). Cada
 * eje cambia DÓNDE y CÓMO se pinta algo, nunca qué pasos tiene el flujo. El primer valor de cada
 * lista es el que pinta hoy el tema genérico.
 */
export const LAYOUT_OPTIONS = {
  welcome: ["panel", "poster"],
  hero: ["plain", "card", "none"],
  nav: ["back-button", "title-pill"],
  categories: ["icon-tiles", "photo-tiles"],
  products: ["list", "cards"],
  langs: ["code", "flag"],
} as const;
export type BrandingLayout = {
  [K in keyof typeof LAYOUT_OPTIONS]: (typeof LAYOUT_OPTIONS)[K][number];
};

/**
 * TOKENS de estilo (sección 5 del spec). Enumerados y no valores libres: cada uno se traduce a
 * CSS aquí, así que lo que acaba en el `<style>` del layout es siempre un literal conocido.
 */
export const TOKEN_OPTIONS = {
  /** Radio de tarjetas: 0,75 rem | 1 rem. */
  radius: ["md", "lg"],
  /** Mesa, carrito, idiomas: píldora | rectángulo redondeado. */
  controlRadius: ["pill", "rounded"],
  shadow: ["none", "soft", "medium"],
  /** Borde de tarjeta: 1 px | 2 px. */
  border: ["thin", "thick"],
  /** Aire dentro de las tarjetas. */
  spacing: ["compact", "comfortable"],
  /** Nombres de categoría y de plato. */
  titles: ["normal", "uppercase"],
  imageFit: ["cover", "contain"],
  /** Miniatura de producto en lista: 72 | 88 px. */
  thumb: ["sm", "md"],
  cartIcon: ["none", "bag"],
} as const;
type TokenEnums = { [K in keyof typeof TOKEN_OPTIONS]: (typeof TOKEN_OPTIONS)[K][number] };
export type BrandingTokens = TokenEnums & {
  /** Fondo de tarjetas y barra. `null` = derivado del color tenue, como el genérico de siempre. */
  surface: string | null;
};

export type Branding = {
  name: string | null;
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  logoUrl: string | null;
  /**
   * Foto de la PANTALLA DE BIENVENIDA (el paso previo a la carta), o `null`.
   *
   * La bienvenida existe para todos los clientes -- es funcionalidad, no decoración. Lo que
   * cambia de uno a otro es esta foto, que por eso es un ajuste y no un asset escrito en el
   * código de un tema. Un tema a medida puede caer a su propia imagen cuando no hay ninguna
   * configurada; el genérico se queda con el color de marca.
   */
  heroUrl: string | null;
  fonts: { display: FontFamily; body: FontFamily };
  tokens: BrandingTokens;
  layout: BrandingLayout;
  /** Textura repetida de fondo de toda la carta (el patrón de copas, el terrazo...). */
  background: { imageUrl: string | null; sizePx: number };
  /** Lema bajo el nombre, POR IDIOMA: es contenido, y en inglés no puede salir en español. */
  tagline: Record<string, string>;
  /** Insignia de la bienvenida tipo `poster` (☕ en un círculo de color), o `null`. */
  badge: { emoji: string; color: string } | null;
};

/** Lo que pinta hoy el tema genérico: un cliente sin configurar nada se queda como estaba. */
export const DEFAULT_BRANDING: Branding = {
  name: null,
  colors: {
    bg: "#f5f1e8",
    fg: "#0f0f0f",
    primary: "#a88445",
    accent: "#1f1d1a",
    muted: "#d9d1bd",
  },
  logoUrl: null,
  heroUrl: null,
  fonts: { display: "playfair", body: "inter" },
  tokens: {
    surface: null,
    radius: "md",
    controlRadius: "pill",
    shadow: "none",
    border: "thin",
    spacing: "compact",
    titles: "normal",
    imageFit: "cover",
    thumb: "sm",
    cartIcon: "none",
  },
  layout: {
    welcome: "panel",
    hero: "plain",
    nav: "back-button",
    categories: "icon-tiles",
    products: "list",
    langs: "code",
  },
  background: { imageUrl: null, sizePx: 150 },
  tagline: {},
  badge: null,
};

const colorSchema = z.string().regex(HEX);
const fontSchema = z.enum(FONT_FAMILIES);
const backgroundSizeSchema = z.number().int().min(40).max(600);
const taglineSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(120));
/** Un emoji o dos, no un texto: se pinta grande dentro de un círculo. */
const badgeEmojiSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(8));
const LANG_CODE = /^[a-z]{2}$/;

/** Nombre comercial visible en la carta. Máx 80 caracteres; se recorta. No impone
 * un charset (a diferencia de fuentes/colores) porque nunca se interpola en CSS ni
 * en HTML sin escapar: React lo renderiza como texto. Solo se acota la longitud. */
const nameSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(80));

/** Validadores públicos de las hojas de marca, para el camino de ESCRITURA (el
 * formulario de ajustes, `apps/web/lib/settings-action-input.ts`). En LECTURA,
 * `parseBranding` ya degrada campo a campo; estos exports permiten rechazar en el
 * borde de la Server Action (mejor UX: un color mal escrito da error, no un silencioso
 * degradar a default) reusando exactamente los mismos regex, sin duplicarlos. */
export function isHexColor(value: unknown): boolean {
  return typeof value === "string" && HEX.test(value);
}

export function isFontFamily(value: unknown): value is FontFamily {
  return (FONT_FAMILIES as readonly unknown[]).includes(value);
}

/** ¿`value` es uno de los valores de `options`? Para validar los selects del panel. */
export function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return (options as readonly unknown[]).includes(value);
}

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
 * Assets de marca versionados con la app (`apps/web/public/brands/`): los de los clientes que
 * ya los tenían allí antes de que la marca fuera un dato. Lista cerrada de forma -- un nombre de
 * fichero plano con extensión de imagen --, así que no cabe `//host`, `..` ni nada fuera de esa
 * carpeta. Los clientes nuevos suben sus imágenes por el panel (Storage, URL absoluta).
 */
const BRAND_ASSET = /^\/brands\/[a-z0-9][a-z0-9-]*\.(?:png|jpe?g|webp|svg)$/;

/**
 * Las imágenes de marca (`logoUrl`, `heroUrl`, la textura) admiten URLs absolutas http/https o
 * una ruta de `/brands/` (arriba). Se rechaza deliberadamente cualquier otro esquema
 * (`javascript:`, `data:`, `vbscript:`, `file:`, ...) y cualquier otra ruta relativa: Storage
 * (`tenant/{id}/...`) siempre entrega URLs absolutas https, y aceptar rutas relativas sin más
 * abriría la puerta a formas ambiguas (p. ej. "protocol-relative" `//host/...`) sin ningún
 * beneficio real.
 */
function safeParseImageUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  if (BRAND_ASSET.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Un enumerado: el valor si es uno de los permitidos, si no `undefined` (cae al default). */
function safeParseOption<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return isOneOf(options, value) ? value : undefined;
}

/** `raw[key]` si es una de `options`; si no, `fallback`. */
function optionOf<T extends string>(
  raw: unknown,
  key: string,
  options: readonly T[],
  fallback: T,
): T {
  return withDefault(safeParseOption(options, safeProp(raw, key)), fallback);
}

function parseTokens(raw: unknown): BrandingTokens {
  const d = DEFAULT_BRANDING.tokens;
  const o = TOKEN_OPTIONS;
  const surfaceRaw = safeProp(raw, "surface");
  return {
    surface:
      surfaceRaw === null ? null : withDefault(safeParseLeaf(colorSchema, surfaceRaw), d.surface),
    radius: optionOf(raw, "radius", o.radius, d.radius),
    controlRadius: optionOf(raw, "controlRadius", o.controlRadius, d.controlRadius),
    shadow: optionOf(raw, "shadow", o.shadow, d.shadow),
    border: optionOf(raw, "border", o.border, d.border),
    spacing: optionOf(raw, "spacing", o.spacing, d.spacing),
    titles: optionOf(raw, "titles", o.titles, d.titles),
    imageFit: optionOf(raw, "imageFit", o.imageFit, d.imageFit),
    thumb: optionOf(raw, "thumb", o.thumb, d.thumb),
    cartIcon: optionOf(raw, "cartIcon", o.cartIcon, d.cartIcon),
  };
}

function parseLayout(raw: unknown): BrandingLayout {
  const d = DEFAULT_BRANDING.layout;
  const o = LAYOUT_OPTIONS;
  return {
    welcome: optionOf(raw, "welcome", o.welcome, d.welcome),
    hero: optionOf(raw, "hero", o.hero, d.hero),
    nav: optionOf(raw, "nav", o.nav, d.nav),
    categories: optionOf(raw, "categories", o.categories, d.categories),
    products: optionOf(raw, "products", o.products, d.products),
    langs: optionOf(raw, "langs", o.langs, d.langs),
  };
}

/** Solo los idiomas con un código válido y un texto válido; el resto se descarta. */
function parseTagline(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const tagline: Record<string, string> = {};
  for (const lang of Object.keys(raw)) {
    if (!LANG_CODE.test(lang)) continue;
    const texto = safeParseLeaf(taglineSchema, safeProp(raw, lang));
    if (texto !== undefined) tagline[lang] = texto;
  }
  return tagline;
}

/** La insignia entera o nada: un emoji sin color (o al revés) no se puede pintar. */
function parseBadge(raw: unknown): Branding["badge"] {
  const emoji = safeParseLeaf(badgeEmojiSchema, safeProp(raw, "emoji"));
  const color = safeParseLeaf(colorSchema, safeProp(raw, "color"));
  return emoji !== undefined && color !== undefined ? { emoji, color } : null;
}

/** Nunca lanza: un ajuste inválido degrada, campo a campo, a su default. */
export function parseBranding(raw: unknown): Branding {
  const colorsRaw = safeProp(raw, "colors");
  const fontsRaw = safeProp(raw, "fonts");
  const logoUrlRaw = safeProp(raw, "logoUrl");
  const heroUrlRaw = safeProp(raw, "heroUrl");
  const nameRaw = safeProp(raw, "name");
  const backgroundRaw = safeProp(raw, "background");

  return {
    name: withDefault(safeParseLeaf(nameSchema, nameRaw), DEFAULT_BRANDING.name),
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
    logoUrl: withDefault(safeParseImageUrl(logoUrlRaw), DEFAULT_BRANDING.logoUrl),
    heroUrl: withDefault(safeParseImageUrl(heroUrlRaw), DEFAULT_BRANDING.heroUrl),
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
    tokens: parseTokens(safeProp(raw, "tokens")),
    layout: parseLayout(safeProp(raw, "layout")),
    background: {
      imageUrl: withDefault(
        safeParseImageUrl(safeProp(backgroundRaw, "imageUrl")),
        DEFAULT_BRANDING.background.imageUrl,
      ),
      sizePx: withDefault(
        safeParseLeaf(backgroundSizeSchema, safeProp(backgroundRaw, "sizePx")),
        DEFAULT_BRANDING.background.sizePx,
      ),
    },
    tagline: parseTagline(safeProp(raw, "tagline")),
    badge: parseBadge(safeProp(raw, "badge")),
  };
}

/* Cada token, traducido a su valor CSS. Literales fijos: nada que venga del cliente llega al
   `<style>` del layout salvo los colores, que ya pasaron por la regex hexadecimal. */
const RADIUS_CSS = { md: "0.75rem", lg: "1rem" } as const;
const CONTROL_RADIUS_CSS = { pill: "999px", rounded: "0.9rem" } as const;
const SHADOW_CSS = {
  none: "none",
  soft: "0 2px 16px rgba(0, 0, 0, 0.07)",
  medium: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
} as const;
const BORDER_CSS = { thin: "1px", thick: "2px" } as const;
const SPACING_CSS = { compact: "0.85rem 1rem", comfortable: "1.4rem 1.5rem" } as const;
const TITLES_CSS = { normal: "none", uppercase: "uppercase" } as const;
const THUMB_CSS = { sm: "72px", md: "88px" } as const;

/**
 * Las variables de marca del `<style>` del layout raíz. La textura de fondo y la insignia NO van
 * aquí: llevan una URL y un emoji, y este bloque se inyecta con `dangerouslySetInnerHTML`, así
 * que solo admite valores que no puedan cerrar la regla (ver el test de payloads hostiles). Las
 * pinta el componente de la carta con el `style` de React.
 */
export function brandingToCssVars(branding: Branding): string {
  const { tokens } = branding;
  const declarations = [
    `--color-bg:${branding.colors.bg}`,
    `--color-fg:${branding.colors.fg}`,
    `--color-primary:${branding.colors.primary}`,
    `--color-accent:${branding.colors.accent}`,
    `--color-muted:${branding.colors.muted}`,
    // Sin superficie propia, la de siempre del genérico: el tenue al 45 %.
    `--color-surface:${tokens.surface ?? "color-mix(in srgb, var(--color-muted) 45%, transparent)"}`,
    `--font-display:${FONT_STACKS[branding.fonts.display]}`,
    `--font-body:${FONT_STACKS[branding.fonts.body]}`,
    `--radius-card:${RADIUS_CSS[tokens.radius]}`,
    `--radius-control:${CONTROL_RADIUS_CSS[tokens.controlRadius]}`,
    `--shadow-card:${SHADOW_CSS[tokens.shadow]}`,
    `--border-card:${BORDER_CSS[tokens.border]}`,
    `--space-card:${SPACING_CSS[tokens.spacing]}`,
    `--title-transform:${TITLES_CSS[tokens.titles]}`,
    `--image-fit:${tokens.imageFit}`,
    `--thumb-size:${THUMB_CSS[tokens.thumb]}`,
  ];
  return `${declarations.join(";")};`;
}
