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

const brandingSchema = z.object({
  colors: z
    .object({
      bg: colorSchema.optional(),
      fg: colorSchema.optional(),
      primary: colorSchema.optional(),
      accent: colorSchema.optional(),
      muted: colorSchema.optional(),
    })
    .partial()
    .optional(),
  logoUrl: z.string().url().nullable().optional(),
  fonts: z
    .object({ display: fontSchema.optional(), body: fontSchema.optional() })
    .partial()
    .optional(),
});

/** Nunca lanza: un ajuste inválido degrada al default, la carta no se cae por un color. */
export function parseBranding(raw: unknown): Branding {
  const parsed = brandingSchema.safeParse(raw);
  const value = parsed.success ? parsed.data : {};

  return {
    colors: { ...DEFAULT_BRANDING.colors, ...(value.colors ?? {}) },
    logoUrl: value.logoUrl ?? DEFAULT_BRANDING.logoUrl,
    fonts: { ...DEFAULT_BRANDING.fonts, ...(value.fonts ?? {}) },
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
