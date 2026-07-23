export type Tenant = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
};

export type TenantSettingsRow = {
  tenantId: string;
  branding: Record<string, unknown>;
  fiscal: Record<string, unknown>;
  locale: string;
  currency: string;
  channels: string[];
  features: Record<string, unknown>;
  /** Slug del tema de la carta pública (`tenant_settings.theme`). Ver
   * `apps/web/app/[mesa]/themes`: `generic` se pinta con el branding, los temas a medida
   * son componentes codificados. */
  theme: string;
};

export type Category = {
  id: string;
  slug: string;
  /** Categoría padre (`categories.parent_id`), o `null` si es raíz. Permite cartas en
   * árbol navegables por niveles, imprescindible en cartas grandes. */
  parentId: string | null;
  nameI18n: Record<string, string>;
  /** Emoji identificativo de la categoría (🍷, ☕...), o `null`. En una carta que se
   * navega por niveles es lo que permite reconocer una categoría de un vistazo antes de
   * leerla. Opcional: sin icono, el tema simplemente no pinta nada. */
  icon: string | null;
  sortOrder: number;
};

export type ProductExtra = {
  id: string;
  nameI18n: Record<string, string>;
  price: number;
};

export type Product = {
  id: string;
  categoryId: string;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  price: number;
  /** Ruta de la foto dentro del bucket `catalog`, o `null`. NO es una URL completa: el
   * bucket es público en lectura y la carta le antepone el endpoint de Storage. */
  imagePath: string | null;
  isAvailable: boolean;
  sortOrder: number;
  extras: ProductExtra[];
};

export type TableRow = {
  id: string;
  tenantId: string;
  venueId: string;
  label: string;
  isActive: boolean;
  /**
   * Fix (Task 5, D2): `findTableByToken` ya conocía este valor (busca precisamente POR
   * él) pero no lo devolvía en la fila; `listTables` (`admin-tables.ts`) tampoco lo
   * seleccionaba. La pantalla de gestión de mesas (Task 5) necesita el token de CADA
   * mesa para componer `https://{host}/m/{token}` y generar su QR (`tableQrSvg`,
   * `apps/web/lib/qr.ts`) -- añadido aquí, al tipo compartido, en vez de crear un tipo
   * `AdminTableRow` paralelo solo por este campo.
   */
  token: string;
};

export type CartLineInput = {
  productId: string;
  quantity: number;
  extraIds: string[];
  notes: string | null;
};

export type OrderStatus = {
  orderNumber: number;
  status: string;
  totalCents: number;
  currency: string;
};
