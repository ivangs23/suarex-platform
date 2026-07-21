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
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
