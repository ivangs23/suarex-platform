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
};

export type Category = {
  id: string;
  slug: string;
  nameI18n: Record<string, string>;
  sortOrder: number;
};

export type Product = {
  id: string;
  categoryId: string;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
};
