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

/** Los canales de venta que el producto conoce. Un cliente puede tener uno, los dos, o ninguno. */
export type SalesChannel = "qr-mesa" | "kiosko";

/**
 * ¿Este cliente tiene encendido este canal?
 *
 * La regla es literal: lo que no está en la lista, no está encendido. Nada de "vacío significa
 * todo", que es la clase de excepción que hace que un interruptor deje de significar lo que dice y
 * que nadie se atreva luego a apagarlo por si acaso.
 *
 * De alcance COMERCIAL, no de seguridad: apaga la puerta de entrada del comensal (la carta, el
 * totem), no es una barrera contra alguien que fabrique peticiones a mano. Para eso están la RLS
 * y las cookies de mesa, que siguen donde estaban.
 */
export function hasChannel(channels: readonly string[], channel: SalesChannel): boolean {
  return channels.includes(channel);
}
