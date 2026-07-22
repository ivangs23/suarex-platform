import { z } from "zod";

export const tenantSettingsSchema = z.object({
  branding: z.unknown(),
  fiscal: z
    .object({
      legalName: z.string().optional(),
      cif: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      taxRate: z.number().min(0).max(1).optional(),
    })
    .partial()
    .default({}),
  locale: z.string().default("es"),
  currency: z.string().length(3).default("EUR"),
  channels: z.array(z.enum(["qr-mesa", "kiosko"])).default([]),
  features: z.record(z.string(), z.boolean()).default({}),
  /** Slug del tema de la carta pública. `generic` se pinta al 100% con el branding; los
   * temas a medida (p. ej. `garum`, `manuela`) son componentes codificados en la web. Un
   * slug desconocido cae a `generic` en `resolveTheme`, así que esto nunca deja una carta
   * en blanco. */
  theme: z.string().default("generic"),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
