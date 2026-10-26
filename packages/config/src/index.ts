export type { Branding, BrandingLayout, BrandingTokens, FontFamily } from "./branding.js";
export {
  brandingToCssVars,
  DEFAULT_BRANDING,
  FONT_FAMILIES,
  isFontFamily,
  isHexColor,
  isOneOf,
  LAYOUT_OPTIONS,
  parseBranding,
  TOKEN_OPTIONS,
} from "./branding.js";
export type { SalesChannel, TenantSettings } from "./settings.schema.js";
export { hasChannel, tenantSettingsSchema } from "./settings.schema.js";
export type { TenantHostRef } from "./tenant-host.js";
export {
  dominioSinWww,
  isPlatformHost,
  normalizeCustomDomain,
  parseTenantHost,
  resolveRootDomains,
  validarSlugPlataforma,
} from "./tenant-host.js";
