# Panel de administración — Fase D3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un owner/admin edita los ajustes de su negocio (nombre comercial, colores, logo, fuentes, datos fiscales, IVA, idioma, moneda) desde el panel y se reflejan en la carta pública; y da de alta camareros (`staff`) que pueden entrar al panel de comandas.

**Architecture:** Todo escribe por Server Actions envueltas en `managerAction` (comprobación de rol owner/admin imposible de olvidar) que llaman a repositorios de `@suarex/db` con service role. **D3 no añade ninguna migración**: la policy `tenant_settings_write` (owner/admin) ya existe y está probada desde D1, y el alta de personal escribe `memberships` con service role (que salta RLS), tal como ya hace el emparejamiento de dispositivos. El nombre comercial vive en `tenant_settings.branding.name` (configuración pública, junto a colores/logo/fuentes), no en `tenants.name` — así no hay que tocar la RLS de `tenants`.

**Tech Stack:** Next 16 App Router + Server Actions, Supabase (service role + Storage bucket `catalog`), `@suarex/config` (Zod + `parseBranding`), `@suarex/db`, Vitest (unit + integration), Playwright (e2e), Biome, TypeScript strict.

## Global Constraints

- **Prohibido tocar los repos/proyectos Supabase en producción.** Todo se demuestra en local con tenants de prueba.
- **Ninguna Server Action de `app/admin/**` acepta ni lee un `tenant_id`/`tenantId` del formulario.** El tenant llega SIEMPRE de `session.tenantId` (claim JWT verificado). Toda action se define como `managerAction(async (session, formData) => { … })`, nunca con `const session = await requireManager()` a mano.
- **Parsers de `FormData` genéricos** (`requiredString`/`optionalString`/`parseOptionalInt`/`parseOptionalBoolean`) se importan de `apps/web/lib/form-parse.ts`; nunca se redeclaran. La validación de reglas de dominio se construye ENCIMA, en un módulo `*-action-input.ts` propio.
- **El alta de personal usa service role (salta RLS), así que la comprobación de rol en la Server Action es el único control estructural de ese camino** — obligatoria y probada explícitamente.
- **El navegador nunca habla con Storage.** Subir logo pasa por el servidor con validación de tipo/tamaño/tenant, igual que `uploadProductImage`.
- **Cada camarero es un usuario de Auth NUEVO con exactamente una membership.** El `custom_access_token_hook` elige la membership más antigua (`order by created_at asc limit 1`); una segunda membership sobre un usuario existente sería inalcanzable por el JWT, así que NO se reutilizan usuarios.
- **El código de la app se escribe en castellano en los textos de UI** (labels, botones, mensajes), como el resto del panel.
- **TDD:** cada tarea escribe primero el test que falla, lo observa fallar, implementa, lo observa pasar, commitea. Commits frecuentes.

---

## Estructura de ficheros

```
packages/config/src/
  branding.ts                      + campo `name` en Branding + parse + exports isHexColor/isFontName
  branding.test.ts                 + casos de `name`
  index.ts                         + export isHexColor/isFontName
packages/db/src/
  tenants.ts                       + updateTenantSettings()
  storage.ts                       + uploadBrandingLogo()
  admin-staff.ts                   NUEVO: createStaff(), listStaff()
  client.ts                        + authAdminForStaffCreation() (décima exención)
  index.ts                         + exports de lo nuevo
apps/web/
  lib/settings-action-input.ts     NUEVO: parseo/validación estricta del formulario de ajustes
  lib/staff-action-input.ts        NUEVO: parseo/validación del formulario de alta de personal
  app/admin/layout.tsx             + enlaces de nav Ajustes y Personal
  app/admin/ajustes/page.tsx       NUEVO
  app/admin/ajustes/actions.ts     NUEVO: updateSettingsAction
  app/admin/ajustes/AjustesForm.tsx NUEVO
  app/admin/personal/page.tsx      NUEVO
  app/admin/personal/actions.ts    NUEVO: createStaffAction
  app/admin/personal/StaffForm.tsx NUEVO
  app/[mesa]/page.tsx              muestra branding.name (fallback slug) en la carta
tests/
  integration/admin-settings.test.ts   NUEVO
  integration/branding-logo.test.ts     NUEVO
  integration/admin-staff.test.ts       NUEVO
  e2e/admin-d3.spec.ts                   NUEVO
  e2e/helpers/admin-d3-db.ts             NUEVO: snapshot/restore de settings + borrado de staff de prueba
apps/web/lib/settings-action-input.test.ts  NUEVO (unit)
apps/web/lib/staff-action-input.test.ts      NUEVO (unit)
```

---

## Task 1: `branding.name` — nombre comercial en la marca + carta pública

**Files:**
- Modify: `packages/config/src/branding.ts`
- Modify: `packages/config/src/branding.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/web/app/[mesa]/page.tsx`

**Interfaces:**
- Produces: `Branding` gana `name: string | null`; `parseBranding` degrada `name` a `null` como cualquier otra hoja. Nuevos exports `isHexColor(v: unknown): boolean` y `isFontName(v: unknown): boolean` (los usa Task 3 para validar el formulario de escritura sin duplicar los regex).
- `name` NO se pasa a `brandingToCssVars` (no es una variable CSS); el comentario `biome-ignore` de `layout.tsx` sigue siendo cierto sin cambios.

- [ ] **Step 1: Escribir los tests que fallan** en `packages/config/src/branding.test.ts` (añadir dentro del `describe` existente de `parseBranding`, más un `describe` nuevo para los validadores):

```ts
it("acepta un name válido", () => {
  expect(parseBranding({ name: "Bar Manuela" }).name).toBe("Bar Manuela");
});

it("degrada un name ausente a null", () => {
  expect(parseBranding({}).name).toBeNull();
});

it("degrada un name no-string a null", () => {
  expect(parseBranding({ name: 123 }).name).toBeNull();
});

it("degrada un name demasiado largo a null", () => {
  expect(parseBranding({ name: "x".repeat(81) }).name).toBeNull();
});

it("recorta los espacios de un name válido", () => {
  expect(parseBranding({ name: "  Garum  " }).name).toBe("Garum");
});
```

Y para los validadores exportados:

```ts
import { isFontName, isHexColor } from "./branding.js";

describe("isHexColor", () => {
  it("acepta #abc y #aabbcc", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#AABBCC")).toBe(true);
  });
  it("rechaza no-hex", () => {
    expect(isHexColor("rojo")).toBe(false);
    expect(isHexColor("#12")).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });
});

describe("isFontName", () => {
  it("acepta una fuente simple", () => {
    expect(isFontName("Inter, sans-serif")).toBe(true);
  });
  it("rechaza caracteres peligrosos", () => {
    expect(isFontName("a<b")).toBe(false);
    expect(isFontName("x".repeat(65))).toBe(false);
    expect(isFontName(123)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter @suarex/config test`
Expected: FAIL (`name` no existe en el tipo devuelto; `isHexColor`/`isFontName` no exportados).

- [ ] **Step 3: Implementar en `packages/config/src/branding.ts`**

Añadir el tipo, el default, el schema del nombre, los validadores exportados, y el parseo. Cambios exactos:

En el `type Branding`:
```ts
export type Branding = {
  name: string | null;
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  logoUrl: string | null;
  fonts: { display: string; body: string };
};
```

En `DEFAULT_BRANDING`, añadir como primer campo:
```ts
  name: null,
```

Tras `const fontSchema = z.string().regex(FONT).max(64);` añadir:
```ts
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

export function isFontName(value: unknown): boolean {
  return typeof value === "string" && value.length <= 64 && FONT.test(value);
}
```

En `parseBranding`, tras leer `logoUrlRaw` añadir la lectura del nombre y devolverlo. Justo antes del `return {`:
```ts
  const nameRaw = safeProp(raw, "name");
```
Y en el objeto devuelto, como primer campo:
```ts
    name: withDefault(safeParseLeaf(nameSchema, nameRaw), DEFAULT_BRANDING.name),
```

- [ ] **Step 4: Exportar los validadores** en `packages/config/src/index.ts`. Sustituir la línea de exports de branding por:

```ts
export { brandingToCssVars, DEFAULT_BRANDING, isFontName, isHexColor, parseBranding } from "./branding.js";
```

- [ ] **Step 5: Mostrar el nombre en la carta** — `apps/web/app/[mesa]/page.tsx`. Cambiar los imports y el `<h1>`.

Imports (línea 1) pasan a:
```ts
import { getCategories, getProducts, getTenantSettings } from "@suarex/db";
import { parseBranding } from "@suarex/config";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
```

Dentro de la función, tras resolver `tenant` (y su `notFound()`), ampliar el `Promise.all` para traer también los settings, y derivar el nombre visible:
```ts
  const [categories, products, settings] = await Promise.all([
    getCategories(tenant.id),
    getProducts(tenant.id),
    getTenantSettings(tenant.id).catch(() => null),
  ]);
  const businessName = parseBranding(settings?.branding).name ?? tenant.slug;
```
Y el `<h1>`:
```tsx
      <h1 data-testid="tenant-name">{businessName}</h1>
```

- [ ] **Step 6: Ejecutar tests de config + typecheck del monorepo**

Run: `pnpm --filter @suarex/config test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/config/src/branding.ts packages/config/src/branding.test.ts packages/config/src/index.ts apps/web/app/[mesa]/page.tsx
git commit -m "feat(config): add branding.name (nombre comercial) + surface it on the public menu"
```

---

## Task 2: `updateTenantSettings` — repositorio de escritura de ajustes

**Files:**
- Modify: `packages/db/src/tenants.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/admin-settings.test.ts`

**Interfaces:**
- Consumes: `tenantScoped("tenant_settings", tenantId)` (con `.upsert`), `getTenantSettings` (Task 0 existente).
- Produces:
  ```ts
  export type UpdateTenantSettingsInput = {
    branding: Record<string, unknown>;
    fiscal: Record<string, unknown>;
    locale: string;
    currency: string;
  };
  export function updateTenantSettings(
    tenantId: string,
    input: UpdateTenantSettingsInput,
  ): Promise<void>;
  ```
  UPSERT sobre la PK `tenant_id` (crea la fila si el tenant aún no tiene ajustes, la actualiza si existe), fija `updated_at = now()` explícitamente (no hay trigger que lo haga). NO toca `channels` ni `features` (fuera del alcance de D3: se preservan intactos porque un UPSERT parcial sobre `tenant_id` solo escribe las columnas que se le pasan).

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/admin-settings.test.ts`:

```ts
import { getTenantSettings, updateTenantSettings } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  signInAs,
  deleteMembershipFixtureUser,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenantA: TenantFixture;
let tenantB: TenantFixture;
const staffUserIds: string[] = [];

beforeAll(async () => {
  tenantA = await createTenantFixture(`set-a-${nonce()}`);
  tenantB = await createTenantFixture(`set-b-${nonce()}`);
  await seedCatalog(tenantA.tenantId, "sa");
  await seedCatalog(tenantB.tenantId, "sb");
});

afterAll(async () => {
  for (const id of staffUserIds) await deleteMembershipFixtureUser(id);
  if (tenantA) await deleteTenantFixture(tenantA);
  if (tenantB) await deleteTenantFixture(tenantB);
});

describe("updateTenantSettings", () => {
  it("escribe branding/fiscal/locale/currency y getTenantSettings los lee de vuelta", async () => {
    await updateTenantSettings(tenantA.tenantId, {
      branding: { name: "Casa A", colors: { primary: "#123456" } },
      fiscal: { legalName: "Casa A SL", taxRate: 0.1 },
      locale: "en",
      currency: "USD",
    });
    const settings = await getTenantSettings(tenantA.tenantId);
    expect(settings?.branding).toMatchObject({ name: "Casa A" });
    expect(settings?.fiscal).toMatchObject({ legalName: "Casa A SL", taxRate: 0.1 });
    expect(settings?.locale).toBe("en");
    expect(settings?.currency).toBe("USD");
  });

  it("no toca los ajustes de otro tenant", async () => {
    const before = await getTenantSettings(tenantB.tenantId);
    await updateTenantSettings(tenantA.tenantId, {
      branding: { name: "Solo A" },
      fiscal: {},
      locale: "es",
      currency: "EUR",
    });
    const after = await getTenantSettings(tenantB.tenantId);
    expect(after?.branding).toEqual(before?.branding);
  });

  it("RLS: un staff autenticado NO puede UPDATE directo de tenant_settings (PostgREST)", async () => {
    const staff = await signInAs(tenantA.tenantId, "staff");
    staffUserIds.push(staff.userId);
    const { error } = await staff
      .from("tenant_settings")
      .update({ locale: "fr" })
      .eq("tenant_id", tenantA.tenantId);
    // RLS lo bloquea: cero filas afectadas (no error) o error de policy. Verificamos
    // que el valor NO cambió, que es la garantía que importa.
    const after = await getTenantSettings(tenantA.tenantId);
    expect(after?.locale).not.toBe("fr");
    void error;
  });

  it("RLS: un owner autenticado SÍ puede UPDATE directo (control positivo)", async () => {
    const owner = await signInAs(tenantA.tenantId, "owner");
    staffUserIds.push(owner.userId);
    const { error } = await owner
      .from("tenant_settings")
      .update({ locale: "pt" })
      .eq("tenant_id", tenantA.tenantId);
    expect(error).toBeNull();
    const after = await getTenantSettings(tenantA.tenantId);
    expect(after?.locale).toBe("pt");
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter @suarex/db... test:integration -- admin-settings` (o el runner de integración del repo; si es un único comando: `pnpm test:integration admin-settings`)
Expected: FAIL (`updateTenantSettings` no existe / no exportada).

- [ ] **Step 3: Implementar en `packages/db/src/tenants.ts`** (al final del fichero):

```ts
export type UpdateTenantSettingsInput = {
  branding: Record<string, unknown>;
  fiscal: Record<string, unknown>;
  locale: string;
  currency: string;
};

/**
 * Escribe los ajustes del negocio del tenant (marca, fiscal, idioma, moneda). UPSERT sobre
 * la PK `tenant_id`: si el tenant todavía no tiene fila en `tenant_settings` la crea, si la
 * tiene la actualiza -- así el panel funciona igual para un tenant recién provisionado que
 * para uno ya configurado, sin depender de que exista un trigger que siembre la fila.
 *
 * Deliberadamente NO escribe `channels` ni `features`: quedan fuera del alcance de D3 y se
 * preservan intactos (el UPSERT solo toca las columnas que recibe). `updated_at` se fija a
 * mano porque no hay trigger que lo haga (ver el esquema de `20260721000001_core_tenancy.sql`).
 *
 * `branding`/`fiscal` se guardan tal cual como jsonb: la validación de forma vive en el
 * borde de la Server Action (`apps/web/lib/settings-action-input.ts`) en escritura y en
 * `parseBranding`/`tenantSettingsSchema` en lectura. Este repositorio no revalida para no
 * ser una segunda fuente de verdad divergente.
 */
export async function updateTenantSettings(
  tenantId: string,
  input: UpdateTenantSettingsInput,
): Promise<void> {
  const { error } = await tenantScoped("tenant_settings", tenantId).upsert(
    {
      branding: input.branding,
      fiscal: input.fiscal,
      locale: input.locale,
      currency: input.currency,
      updated_at: new Date().toISOString(),
    },
    "tenant_id",
  );
  if (error) throw error;
}
```

- [ ] **Step 4: Exportar** en `packages/db/src/index.ts`. En el bloque de `./tenants.js` añadir el type y la función:

```ts
export type { UpdateTenantSettingsInput } from "./tenants.js";
export {
  findTenantByHost,
  getTenantSettings,
  getTenantStripeAccount,
  updateTenantSettings,
} from "./tenants.js";
```
(Sustituye la línea de export de `./tenants.js` existente por estas dos.)

- [ ] **Step 5: Ejecutar tests + typecheck**

Run: `pnpm test:integration admin-settings && pnpm typecheck`
Expected: PASS (los 4 casos).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/tenants.ts packages/db/src/index.ts tests/integration/admin-settings.test.ts
git commit -m "feat(db): add updateTenantSettings repo (upsert, owner/admin path) + RLS test"
```

---

## Task 3: Parser/validación del formulario de ajustes

**Files:**
- Create: `apps/web/lib/settings-action-input.ts`
- Test: `apps/web/lib/settings-action-input.test.ts`

**Interfaces:**
- Consumes: `requiredString`/`optionalString` de `@/lib/form-parse`, `InvalidFormFieldError` de `@/lib/form-parse`, `isHexColor`/`isFontName` de `@suarex/config`.
- Produces:
  ```ts
  export function parseBrandingFields(formData: FormData): {
    name: string | null;
    colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
    fonts: { display: string; body: string };
  };
  export function parseFiscalFields(formData: FormData): {
    legalName?: string; cif?: string; address?: string; phone?: string; taxRate?: number;
  };
  export function parseLocale(formData: FormData): string;
  export function parseCurrency(formData: FormData): string;
  ```
  `parseBrandingFields` NO incluye `logoUrl` — el logo lo gestiona la action aparte (subida + merge). El `taxRate` llega del formulario como PORCENTAJE (`"10"` = 10 %) y se convierte a fracción `0.10` (el rango que exige `tenantSettingsSchema`, 0..1); se valida 0..100 antes de convertir.

- [ ] **Step 1: Escribir el test que falla** — `apps/web/lib/settings-action-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseBrandingFields,
  parseCurrency,
  parseFiscalFields,
  parseLocale,
} from "./settings-action-input";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseBrandingFields", () => {
  it("parsea nombre, colores y fuentes válidos", () => {
    const out = parseBrandingFields(
      fd({
        name: "Bar Manuela",
        color_bg: "#ffffff",
        color_fg: "#000000",
        color_primary: "#a88445",
        color_accent: "#1f1d1a",
        color_muted: "#d9d1bd",
        font_display: "Inter",
        font_body: "Georgia",
      }),
    );
    expect(out).toEqual({
      name: "Bar Manuela",
      colors: { bg: "#ffffff", fg: "#000000", primary: "#a88445", accent: "#1f1d1a", muted: "#d9d1bd" },
      fonts: { display: "Inter", body: "Georgia" },
    });
  });

  it("nombre vacío => null", () => {
    const out = parseBrandingFields(
      fd({
        color_bg: "#ffffff", color_fg: "#000000", color_primary: "#a88445",
        color_accent: "#1f1d1a", color_muted: "#d9d1bd", font_display: "Inter", font_body: "Georgia",
      }),
    );
    expect(out.name).toBeNull();
  });

  it("rechaza un color no-hex", () => {
    expect(() =>
      parseBrandingFields(
        fd({
          color_bg: "rojo", color_fg: "#000000", color_primary: "#a88445",
          color_accent: "#1f1d1a", color_muted: "#d9d1bd", font_display: "Inter", font_body: "Georgia",
        }),
      ),
    ).toThrow(/color/i);
  });

  it("rechaza una fuente con caracteres peligrosos", () => {
    expect(() =>
      parseBrandingFields(
        fd({
          color_bg: "#ffffff", color_fg: "#000000", color_primary: "#a88445",
          color_accent: "#1f1d1a", color_muted: "#d9d1bd", font_display: "a<b", font_body: "Georgia",
        }),
      ),
    ).toThrow(/fuente/i);
  });
});

describe("parseFiscalFields", () => {
  it("convierte el IVA de porcentaje a fracción", () => {
    expect(parseFiscalFields(fd({ tax_rate: "10" }).valueOf() as FormData).taxRate).toBeCloseTo(0.1);
  });
  it("deja taxRate undefined si no viene", () => {
    expect(parseFiscalFields(fd({}).valueOf() as FormData).taxRate).toBeUndefined();
  });
  it("rechaza un IVA fuera de 0..100", () => {
    expect(() => parseFiscalFields(fd({ tax_rate: "150" }))).toThrow(/IVA|100/i);
  });
  it("rechaza un IVA no numérico", () => {
    expect(() => parseFiscalFields(fd({ tax_rate: "diez" }))).toThrow(/IVA|número/i);
  });
  it("recoge legalName/cif/address/phone opcionales", () => {
    const out = parseFiscalFields(fd({ legal_name: "Casa SL", cif: "B123", address: "Calle 1", phone: "600" }));
    expect(out).toMatchObject({ legalName: "Casa SL", cif: "B123", address: "Calle 1", phone: "600" });
  });
});

describe("parseCurrency", () => {
  it("acepta un código de 3 letras y lo pone en mayúsculas", () => {
    expect(parseCurrency(fd({ currency: "usd" }))).toBe("USD");
  });
  it("rechaza un código que no tiene 3 letras", () => {
    expect(() => parseCurrency(fd({ currency: "EU" }))).toThrow(/moneda|3/i);
  });
});

describe("parseLocale", () => {
  it("por defecto es", () => {
    expect(parseLocale(fd({}))).toBe("es");
  });
  it("recoge el locale dado", () => {
    expect(parseLocale(fd({ locale: "en" }))).toBe("en");
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter web test settings-action-input` (o el runner de unit de `apps/web`)
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `apps/web/lib/settings-action-input.ts`**

```ts
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

export function parseBrandingFields(formData: FormData): {
  name: string | null;
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  fonts: { display: string; body: string };
} {
  return {
    name: optionalString(formData, "name") ?? null,
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
      throw new InvalidFormFieldError(`IVA inválido (se esperaba un número): ${JSON.stringify(taxRaw)}`);
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
```

- [ ] **Step 4: Ejecutar tests + typecheck**

Run: `pnpm --filter web test settings-action-input && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/settings-action-input.ts apps/web/lib/settings-action-input.test.ts
git commit -m "feat(admin): strict parser/validation for the business-settings form"
```

---

## Task 4: `uploadBrandingLogo` — subida de logo a Storage

**Files:**
- Modify: `packages/db/src/storage.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/branding-logo.test.ts`

**Interfaces:**
- Consumes: `catalogBucket()` (accessor existente del bucket `catalog`).
- Produces:
  ```ts
  export function uploadBrandingLogo(
    tenantId: string,
    file: { bytes: Uint8Array; contentType: string },
  ): Promise<string>;
  ```
  Devuelve una **URL pública absoluta** (`${SUPABASE_URL}/storage/v1/object/public/catalog/tenant/{tenantId}/branding/{uuid}.{ext}`), no una ruta — porque `branding.logoUrl` exige una URL absoluta http/https (ver `parseBranding.safeParseLogoUrl`). Misma validación que `uploadProductImage` (UUID de tenant, tipo png/jpeg/webp, máx 5 MB), ANTES de tocar Storage.

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/branding-logo.test.ts`:

```ts
import { uploadBrandingLogo } from "@suarex/db";
import { afterAll, describe, expect, it } from "vitest";
import { admin } from "./helpers/tenants.js";

const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const uploadedPaths: string[] = [];

afterAll(async () => {
  if (uploadedPaths.length === 0) return;
  const { error } = await admin.storage.from("catalog").remove(uploadedPaths);
  if (error) throw error;
});

describe("uploadBrandingLogo", () => {
  it("sube un PNG bajo tenant/{id}/branding y devuelve una URL pública absoluta que responde 200", async () => {
    const tenantId = crypto.randomUUID();
    const url = await uploadBrandingLogo(tenantId, { bytes: PNG_1x1, contentType: "image/png" });
    // Guardar la ruta relativa para limpiar.
    const marker = "/storage/v1/object/public/catalog/";
    const path = url.slice(url.indexOf(marker) + marker.length);
    uploadedPaths.push(path);

    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain(`tenant/${tenantId}/branding/`);
    const res = await fetch(url);
    expect(res.status).toBe(200);
  });

  it("rechaza un tipo no permitido antes de tocar Storage", async () => {
    await expect(
      uploadBrandingLogo(crypto.randomUUID(), { bytes: PNG_1x1, contentType: "application/pdf" }),
    ).rejects.toThrow(/tipo/i);
  });

  it("rechaza un fichero demasiado grande", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    await expect(
      uploadBrandingLogo(crypto.randomUUID(), { bytes: big, contentType: "image/png" }),
    ).rejects.toThrow(/tama/i);
  });

  it("rechaza un tenantId con '../' antes de tocar Storage", async () => {
    await expect(
      uploadBrandingLogo("../evil", { bytes: PNG_1x1, contentType: "image/png" }),
    ).rejects.toThrow(/tenantId/i);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration branding-logo`
Expected: FAIL (`uploadBrandingLogo` no existe).

- [ ] **Step 3: Implementar en `packages/db/src/storage.ts`** (añadir al final; reutiliza las constantes `ALLOWED_TYPES`/`MAX_BYTES`/`UUID_RE` ya presentes en el fichero):

```ts
/**
 * Sube un logo de marca al bucket `catalog` bajo `tenant/{tenantId}/branding/`, siempre por
 * el servidor con service role -- mismo bucket, mismas garantías y misma validación que
 * `uploadProductImage` (UUID de tenant, tipo, tamaño validados ANTES de construir la ruta o
 * tocar Storage). A DIFERENCIA de `uploadProductImage`, devuelve la URL pública ABSOLUTA, no
 * la ruta: `branding.logoUrl` (ver `@suarex/config`, `safeParseLogoUrl`) solo admite URLs
 * absolutas http/https, así que quien consume el logo (el layout público) necesita la URL
 * ya resuelta, no una ruta relativa que tendría que recomponer. Se compone igual que
 * `catalogImageUrl` en `apps/web/app/admin/catalogo/page.tsx`: `${SUPABASE_URL}` +
 * el prefijo público del bucket.
 */
export async function uploadBrandingLogo(
  tenantId: string,
  file: { bytes: Uint8Array; contentType: string },
): Promise<string> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`tenantId inválido: se esperaba un UUID, se recibió "${tenantId}"`);
  }
  if (!ALLOWED_TYPES.has(file.contentType)) {
    throw new Error(`Tipo de imagen no permitido: ${file.contentType}`);
  }
  if (file.bytes.byteLength > MAX_BYTES) {
    throw new Error(
      `Tamaño de imagen no permitido: ${file.bytes.byteLength} bytes (máx ${MAX_BYTES})`,
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error("SUPABASE_URL es obligatoria para componer la URL del logo");

  const ext =
    file.contentType === "image/png" ? "png" : file.contentType === "image/webp" ? "webp" : "jpg";
  const path = `tenant/${tenantId}/branding/${crypto.randomUUID()}.${ext}`;

  const { error } = await catalogBucket().upload(path, file.bytes, {
    contentType: file.contentType,
    upsert: false,
  });
  if (error) throw error;

  return `${supabaseUrl}/storage/v1/object/public/catalog/${path}`;
}
```

- [ ] **Step 4: Exportar** en `packages/db/src/index.ts`. Sustituir la línea `export { uploadProductImage } from "./storage.js";` por:

```ts
export { uploadBrandingLogo, uploadProductImage } from "./storage.js";
```

- [ ] **Step 5: Ejecutar tests + typecheck**

Run: `pnpm test:integration branding-logo && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/storage.ts packages/db/src/index.ts tests/integration/branding-logo.test.ts
git commit -m "feat(db): add uploadBrandingLogo (catalog bucket, returns absolute public URL)"
```

---

## Task 5: Pantalla `/admin/ajustes` + Server Action

**Files:**
- Create: `apps/web/app/admin/ajustes/page.tsx`
- Create: `apps/web/app/admin/ajustes/actions.ts`
- Create: `apps/web/app/admin/ajustes/AjustesForm.tsx`
- Modify: `apps/web/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `getTenantSettings`, `updateTenantSettings`, `uploadBrandingLogo` (`@suarex/db`); `parseBranding`, `DEFAULT_BRANDING` (`@suarex/config`); `parseBrandingFields`/`parseFiscalFields`/`parseLocale`/`parseCurrency` (`@/lib/settings-action-input`); `managerAction` (`@/lib/require-manager`); `optionalString` de `@/lib/form-parse` (solo si hiciera falta — no en esta versión).
- Produces: `updateSettingsAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Implementar la Server Action** — `apps/web/app/admin/ajustes/actions.ts`:

```ts
"use server";

import {
  getTenantSettings,
  updateTenantSettings,
  uploadBrandingLogo,
} from "@suarex/db";
import { parseBranding } from "@suarex/config";
import { revalidatePath } from "next/cache";
import { managerAction } from "@/lib/require-manager";
import {
  parseBrandingFields,
  parseCurrency,
  parseFiscalFields,
  parseLocale,
} from "@/lib/settings-action-input";

/**
 * SECURITY: mismo patrón obligatorio que el resto de `app/admin/**` (ver el docstring de
 * `catalogo/actions.ts`): `managerAction` comprueba owner/admin ANTES del cuerpo, y el
 * `tenantId` es SIEMPRE `session.tenantId`, nunca del formulario.
 *
 * El logo se sube aparte (Storage, `uploadBrandingLogo`) y su URL se fusiona en `branding`.
 * Si el formulario no trae fichero nuevo, se PRESERVA el `logoUrl` que ya tuviera el tenant
 * (leído de los ajustes actuales vía `parseBranding`, que degrada con seguridad) -- guardar
 * la marca sin volver a subir el logo no debe borrarlo.
 */
export const updateSettingsAction = managerAction(async (session, formData: FormData) => {
  const brandingFields = parseBrandingFields(formData);
  const fiscal = parseFiscalFields(formData);
  const locale = parseLocale(formData);
  const currency = parseCurrency(formData);

  // Punto de partida del logo: el que ya está guardado (o null).
  const current = await getTenantSettings(session.tenantId);
  let logoUrl = parseBranding(current?.branding).logoUrl;

  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const bytes = new Uint8Array(await logo.arrayBuffer());
    logoUrl = await uploadBrandingLogo(session.tenantId, { bytes, contentType: logo.type });
  }

  await updateTenantSettings(session.tenantId, {
    branding: {
      name: brandingFields.name,
      colors: brandingFields.colors,
      fonts: brandingFields.fonts,
      logoUrl,
    },
    fiscal,
    locale,
    currency,
  });

  // La marca vive en el layout raíz (CSS vars) y el nombre en la carta: revalidar todo.
  revalidatePath("/admin/ajustes");
  revalidatePath("/", "layout");
});
```

- [ ] **Step 2: Implementar el formulario** — `apps/web/app/admin/ajustes/AjustesForm.tsx`:

```tsx
import { updateSettingsAction } from "./actions";

type Props = {
  name: string;
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  fonts: { display: string; body: string };
  logoUrl: string | null;
  fiscal: { legalName: string; cif: string; address: string; phone: string; taxRatePercent: string };
  locale: string;
  currency: string;
};

/** Formulario funcional (sin estilos) de ajustes del negocio. `encType` multipart para
 * poder subir el logo. Cada campo prellenado con el valor actual. */
export function AjustesForm(props: Props) {
  return (
    <form action={updateSettingsAction} encType="multipart/form-data" data-testid="ajustes-form">
      <fieldset>
        <legend>Marca</legend>
        <label>
          Nombre del negocio
          <input name="name" defaultValue={props.name} />
        </label>
        <label>
          Color de fondo
          <input name="color_bg" type="color" defaultValue={props.colors.bg} />
        </label>
        <label>
          Color de texto
          <input name="color_fg" type="color" defaultValue={props.colors.fg} />
        </label>
        <label>
          Color primario
          <input name="color_primary" type="color" defaultValue={props.colors.primary} />
        </label>
        <label>
          Color de acento
          <input name="color_accent" type="color" defaultValue={props.colors.accent} />
        </label>
        <label>
          Color tenue
          <input name="color_muted" type="color" defaultValue={props.colors.muted} />
        </label>
        <label>
          Fuente de títulos
          <input name="font_display" defaultValue={props.fonts.display} />
        </label>
        <label>
          Fuente de texto
          <input name="font_body" defaultValue={props.fonts.body} />
        </label>
        <label>
          Logo (PNG/JPG/WebP, máx 5 MB)
          <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        {props.logoUrl ? <img src={props.logoUrl} alt="Logo actual" width={80} /> : null}
      </fieldset>

      <fieldset>
        <legend>Datos fiscales</legend>
        <label>
          Razón social
          <input name="legal_name" defaultValue={props.fiscal.legalName} />
        </label>
        <label>
          CIF
          <input name="cif" defaultValue={props.fiscal.cif} />
        </label>
        <label>
          Dirección
          <input name="address" defaultValue={props.fiscal.address} />
        </label>
        <label>
          Teléfono
          <input name="phone" defaultValue={props.fiscal.phone} />
        </label>
        <label>
          IVA (%)
          <input name="tax_rate" type="number" step="0.01" min="0" max="100" defaultValue={props.fiscal.taxRatePercent} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Regional</legend>
        <label>
          Idioma
          <input name="locale" defaultValue={props.locale} />
        </label>
        <label>
          Moneda (3 letras)
          <input name="currency" defaultValue={props.currency} maxLength={3} />
        </label>
      </fieldset>

      <button type="submit">Guardar ajustes</button>
    </form>
  );
}
```

- [ ] **Step 3: Implementar la página** — `apps/web/app/admin/ajustes/page.tsx`:

```tsx
import { getTenantSettings } from "@suarex/db";
import { DEFAULT_BRANDING, parseBranding } from "@suarex/config";
import { requireManager } from "@/lib/require-manager";
import { AjustesForm } from "./AjustesForm";

/** Pantalla de ajustes del negocio (D3). `requireManager()` es la primera barrera;
 * `updateSettingsAction` la vuelve a comprobar por su cuenta vía `managerAction`. */
export default async function AdminAjustesPage() {
  const session = await requireManager();
  const settings = await getTenantSettings(session.tenantId);
  const branding = parseBranding(settings?.branding);

  const fiscal = (settings?.fiscal ?? {}) as Record<string, unknown>;
  const taxRate = typeof fiscal.taxRate === "number" ? fiscal.taxRate : undefined;

  return (
    <main>
      <h1>Ajustes del negocio</h1>
      <AjustesForm
        name={branding.name ?? ""}
        colors={branding.colors}
        fonts={branding.fonts}
        logoUrl={branding.logoUrl}
        fiscal={{
          legalName: typeof fiscal.legalName === "string" ? fiscal.legalName : "",
          cif: typeof fiscal.cif === "string" ? fiscal.cif : "",
          address: typeof fiscal.address === "string" ? fiscal.address : "",
          phone: typeof fiscal.phone === "string" ? fiscal.phone : "",
          taxRatePercent: taxRate === undefined ? "" : String(Math.round(taxRate * 100 * 100) / 100),
        }}
        locale={settings?.locale ?? "es"}
        currency={settings?.currency ?? "EUR"}
      />
    </main>
  );
}

// `DEFAULT_BRANDING` se importa para dejar claro de dónde salen los colores por defecto
// cuando aún no hay ajustes: `parseBranding(undefined)` ya los aplica, así que no se usa
// explícitamente aquí -- pero si prefieres, elimina el import. (Nota para el implementador:
// si Biome marca el import sin usar, quítalo; no es necesario.)
void DEFAULT_BRANDING;
```

Nota para el implementador: si `void DEFAULT_BRANDING;` o el import disparan un aviso de Biome de "no usado", **elimina el import de `DEFAULT_BRANDING` y la línea `void`** — `parseBranding(undefined)` ya cubre los defaults. No añadas un `biome-ignore`.

- [ ] **Step 4: Añadir el enlace de nav** — `apps/web/app/admin/layout.tsx`. Sustituir el `<nav>` por:

```tsx
      <nav>
        <a href="/admin">Inicio</a> · <a href="/admin/catalogo">Catálogo</a> ·{" "}
        <a href="/admin/mesas">Mesas</a> · <a href="/admin/dispositivos">Dispositivos</a> ·{" "}
        <a href="/admin/impresoras">Impresoras</a> · <a href="/admin/ajustes">Ajustes</a> ·{" "}
        <a href="/admin/personal">Personal</a>
      </nav>
```
(El enlace `Personal` apunta a la ruta de la Task 7; añadirlo ya aquí evita tocar el layout dos veces.)

- [ ] **Step 5: Verificar build + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm --filter web build`
Expected: PASS (la ruta compila; sin errores de tipos ni de lint).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/admin/ajustes apps/web/app/admin/layout.tsx
git commit -m "feat(admin): /admin/ajustes screen — edit branding, fiscal, IVA, locale, currency"
```

---

## Task 6: `createStaff` / `listStaff` — repositorio de alta de personal

**Files:**
- Create: `packages/db/src/admin-staff.ts`
- Modify: `packages/db/src/client.ts` (accessor `authAdminForStaffCreation`)
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/admin-staff.test.ts`

**Interfaces:**
- Consumes: `serviceClient().auth.admin` vía nuevo `authAdminForStaffCreation()`; `tenantScoped("memberships", tenantId)`.
- Produces:
  ```ts
  export type CreateStaffInput = { email: string; password: string };
  export type CreateStaffResult = { userId: string; email: string };
  export function createStaff(tenantId: string, input: CreateStaffInput): Promise<CreateStaffResult>;

  export type StaffMember = { userId: string; email: string; role: string; createdAt: string };
  export function listStaff(tenantId: string): Promise<StaffMember[]>;
  ```
  `createStaff`: crea un usuario de Auth NUEVO (`email_confirm: true`) + una membership `role='staff'`. Si el email ya existe, LANZA un error claro (a diferencia del emparejamiento de dispositivos, un email humano duplicado es un conflicto real, no un reintento a recuperar). Si el INSERT de la membership falla tras crear el usuario, borra el usuario recién creado (evita cuenta huérfana) y relanza. `listStaff`: memberships humanas del tenant (excluye `device`), con el email resuelto vía Auth admin.

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/admin-staff.test.ts`:

```ts
import { createStaff, listStaff } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";
import { admin } from "./helpers/tenants.js";

let tenant: TenantFixture;
const createdUserIds: string[] = [];

beforeAll(async () => {
  tenant = await createTenantFixture(`staff-${nonce()}`);
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  if (tenant) await deleteTenantFixture(tenant);
});

describe("createStaff", () => {
  it("crea un usuario que inicia sesión y cuyo JWT lleva tenant_role=staff y el tenant correcto", async () => {
    const email = `camarero-${nonce()}@fixture.local`;
    const result = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
    createdUserIds.push(result.userId);
    expect(result.email).toBe(email);

    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: "clave-secreta-1234" });
    expect(error).toBeNull();
    const { data } = await client.auth.getClaims();
    expect(data?.claims?.tenant_id).toBe(tenant.tenantId);
    expect(data?.claims?.tenant_role).toBe("staff");
  });

  it("crea exactamente una membership para ese usuario en ese tenant", async () => {
    const email = `camarero2-${nonce()}@fixture.local`;
    const result = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
    createdUserIds.push(result.userId);

    const { data } = await admin
      .from("memberships")
      .select("role")
      .eq("user_id", result.userId)
      .eq("tenant_id", tenant.tenantId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.role).toBe("staff");
  });

  it("un email duplicado lanza y no crea un segundo usuario", async () => {
    const email = `dup-${nonce()}@fixture.local`;
    const first = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
    createdUserIds.push(first.userId);

    await expect(
      createStaff(tenant.tenantId, { email, password: "otra-clave-5678" }),
    ).rejects.toThrow();

    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const matches = (usersPage?.users ?? []).filter((u) => u.email === email);
    expect(matches).toHaveLength(1);
  });
});

describe("listStaff", () => {
  it("devuelve las membership humanas del tenant con su email, no las de otro tenant", async () => {
    const other = await createTenantFixture(`staff-other-${nonce()}`);
    try {
      const email = `listado-${nonce()}@fixture.local`;
      const created = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
      createdUserIds.push(created.userId);

      const rows = await listStaff(tenant.tenantId);
      const emails = rows.map((r) => r.email);
      expect(emails).toContain(email);
      // El owner de la fixture (createTenantFixture) también es una membership humana.
      expect(emails).toContain(tenant.email);
      // Ninguna fila del otro tenant.
      expect(emails).not.toContain(other.email);
    } finally {
      await deleteTenantFixture(other);
    }
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration admin-staff`
Expected: FAIL (`createStaff`/`listStaff` no existen).

- [ ] **Step 3: Añadir el accessor** en `packages/db/src/client.ts` (al final):

```ts
/**
 * DÉCIMA EXENCIÓN DELIBERADA, mismo razonamiento que `authAdminForDevicePairing`: el alta de
 * personal (D3) crea un usuario de Supabase Auth para el camarero antes de darle su
 * membership. No hay tabla que filtrar aquí -- es la API de administración de Auth -- así que
 * no encaja en `tenantScoped`. Acotado por firma al único uso legítimo: `createStaff`/
 * `listStaff` (`src/admin-staff.ts`). NO se reutiliza `authAdminForDevicePairing`: cada
 * consumidor de la Admin API declara su propia exención estrecha y documentada, para que
 * cada punto que puede crear cuentas de Auth sea rastreable a un único llamante.
 */
export function authAdminForStaffCreation() {
  return serviceClient().auth.admin;
}
```

- [ ] **Step 4: Implementar `packages/db/src/admin-staff.ts`**

```ts
import { authAdminForStaffCreation, tenantScoped } from "./client.js";

export type CreateStaffInput = { email: string; password: string };
export type CreateStaffResult = { userId: string; email: string };

/** Códigos de `@supabase/auth-js` que significan "ya existe una cuenta con este email". */
const EMAIL_ALREADY_EXISTS_CODES = new Set(["email_exists", "user_already_exists"]);

function isEmailAlreadyExistsError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code && EMAIL_ALREADY_EXISTS_CODES.has(error.code)) return true;
  return (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("already been registered")
  );
}

/**
 * Da de alta un camarero: un usuario de Auth NUEVO más una membership `role='staff'` en el
 * tenant indicado. Ambas escrituras usan el service role (el alta de personal salta RLS por
 * diseño, ver la spec de D3), así que la comprobación de rol owner/admin vive en la Server
 * Action que llama aquí (`app/admin/personal/actions.ts`), no en este repositorio.
 *
 * A DIFERENCIA del emparejamiento de dispositivos (`src/devices.ts`, que recupera una cuenta
 * huérfana si el email determinista ya existe), aquí un email ya registrado es un CONFLICTO
 * real -- dos personas distintas no comparten cuenta -- y se LANZA con un mensaje claro, sin
 * intentar reutilizar ni resetear nada.
 *
 * El `custom_access_token_hook` elige la membership más ANTIGUA (`order by created_at asc
 * limit 1`, ver `20260721000001_core_tenancy.sql`): por eso cada camarero es un usuario
 * NUEVO con exactamente UNA membership -- una segunda membership sobre un usuario existente
 * quedaría inalcanzable por el JWT. No se reutilizan usuarios entre tenants ni roles.
 *
 * Si el INSERT de la membership falla tras crear el usuario, se borra el usuario recién
 * creado antes de relanzar: así un fallo parcial no deja una cuenta de Auth sin membership
 * (que, con un email humano, nadie recuperaría automáticamente).
 */
export async function createStaff(
  tenantId: string,
  input: CreateStaffInput,
): Promise<CreateStaffResult> {
  const authAdmin = authAdminForStaffCreation();

  const { data: created, error: createError } = await authAdmin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (createError) {
    if (isEmailAlreadyExistsError(createError)) {
      throw new Error(`Ya existe una cuenta con el email ${input.email}.`);
    }
    throw createError;
  }

  const userId = created.user.id;

  const { error: membershipError } = await tenantScoped("memberships", tenantId).insert({
    user_id: userId,
    role: "staff",
  });
  if (membershipError) {
    // Rollback de la cuenta de Auth para no dejar un usuario sin membership.
    await authAdmin.deleteUser(userId).catch(() => {});
    throw membershipError;
  }

  return { userId, email: input.email };
}

export type StaffMember = { userId: string; email: string; role: string; createdAt: string };

type MembershipRowDb = { user_id: string; role: string; created_at: string };

/**
 * Personal humano del tenant (excluye `device`), con el email resuelto vía la Admin API de
 * Auth (la tabla `memberships` no guarda email). El volumen de personal de un local de
 * hostelería es pequeño, así que resolver el email fila a fila con `getUserById` es
 * aceptable; si en el futuro crece, se pagina `listUsers` una vez y se cruza en memoria.
 */
export async function listStaff(tenantId: string): Promise<StaffMember[]> {
  const { data, error } = await tenantScoped("memberships", tenantId)
    .select("user_id, role, created_at")
    .neq("role", "device")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const authAdmin = authAdminForStaffCreation();
  const rows = data as MembershipRowDb[];
  const members: StaffMember[] = [];
  for (const row of rows) {
    const { data: user } = await authAdmin.getUserById(row.user_id);
    members.push({
      userId: row.user_id,
      email: user?.user?.email ?? "(sin email)",
      role: row.role,
      createdAt: row.created_at,
    });
  }
  return members;
}
```

- [ ] **Step 5: Exportar** en `packages/db/src/index.ts` (añadir tras el bloque de `admin-printers.js`, en orden alfabético razonable):

```ts
export type { CreateStaffInput, CreateStaffResult, StaffMember } from "./admin-staff.js";
export { createStaff, listStaff } from "./admin-staff.js";
```

- [ ] **Step 6: Ejecutar tests + typecheck**

Run: `pnpm test:integration admin-staff && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/admin-staff.ts packages/db/src/client.ts packages/db/src/index.ts tests/integration/admin-staff.test.ts
git commit -m "feat(db): add createStaff/listStaff (service-role, fresh user + one staff membership)"
```

---

## Task 7: Pantalla `/admin/personal` + Server Action

**Files:**
- Create: `apps/web/app/admin/personal/page.tsx`
- Create: `apps/web/app/admin/personal/actions.ts`
- Create: `apps/web/app/admin/personal/StaffForm.tsx`

**Interfaces:**
- Consumes: `createStaff`, `listStaff` (`@suarex/db`); `managerAction` (`@/lib/require-manager`); `requiredString` (`@/lib/form-parse`); nuevo `parseStaffPassword` (`@/lib/staff-action-input`).
- Produces: `createStaffAction(formData: FormData): Promise<void>`.

- [ ] **Step 1: Escribir el test unit del parser de contraseña** — `apps/web/lib/staff-action-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseStaffPassword } from "./staff-action-input";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseStaffPassword", () => {
  it("acepta una contraseña de 8+ caracteres", () => {
    expect(parseStaffPassword(fd({ password: "clave123" }))).toBe("clave123");
  });
  it("rechaza una contraseña corta", () => {
    expect(() => parseStaffPassword(fd({ password: "corta" }))).toThrow(/8/);
  });
  it("rechaza una contraseña ausente", () => {
    expect(() => parseStaffPassword(fd({}))).toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter web test staff-action-input`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `apps/web/lib/staff-action-input.ts`**

```ts
/**
 * Validación del formulario de alta de personal, construida sobre `form-parse.ts` (mismo
 * patrón que `settings-action-input.ts`). Supabase Auth exige una contraseña de al menos 6
 * caracteres por defecto; aquí se pide un mínimo de 8 como suelo propio, rechazado en el
 * borde de la Server Action con un mensaje claro antes de llamar a `createStaff`.
 */
import { InvalidFormFieldError, requiredString } from "./form-parse";

const MIN_PASSWORD_LENGTH = 8;

export function parseStaffPassword(formData: FormData): string {
  const password = requiredString(formData, "password");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new InvalidFormFieldError(
      `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  return password;
}
```

- [ ] **Step 4: Ejecutar el test unit**

Run: `pnpm --filter web test staff-action-input`
Expected: PASS.

- [ ] **Step 5: Implementar la Server Action** — `apps/web/app/admin/personal/actions.ts`:

```ts
"use server";

import { createStaff } from "@suarex/db";
import { revalidatePath } from "next/cache";
import { requiredString } from "@/lib/form-parse";
import { managerAction } from "@/lib/require-manager";
import { parseStaffPassword } from "@/lib/staff-action-input";

/**
 * SECURITY: `managerAction` comprueba owner/admin ANTES del cuerpo (ver `catalogo/actions.ts`).
 * El alta usa service role dentro de `createStaff`, que SALTA RLS -- así que esta
 * comprobación de rol es el ÚNICO control estructural de este camino, obligatoria y probada
 * (el e2e `admin-d3.spec.ts` verifica que un staff no puede llegar aquí). El `tenantId` es
 * siempre `session.tenantId`, nunca del formulario.
 */
export const createStaffAction = managerAction(async (session, formData: FormData) => {
  const email = requiredString(formData, "email");
  const password = parseStaffPassword(formData);

  await createStaff(session.tenantId, { email, password });
  revalidatePath("/admin/personal");
});
```

- [ ] **Step 6: Implementar el formulario** — `apps/web/app/admin/personal/StaffForm.tsx`:

```tsx
import { createStaffAction } from "./actions";

/** Alta de un camarero: email + contraseña (la fija el owner y se la comunica en persona;
 * no hay email de invitación en esta fase). Funcional, sin estilos. */
export function StaffForm() {
  return (
    <form action={createStaffAction} data-testid="staff-form">
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Contraseña (mín. 8)
        <input name="password" type="text" required minLength={8} />
      </label>
      <button type="submit">Dar de alta</button>
    </form>
  );
}
```

- [ ] **Step 7: Implementar la página** — `apps/web/app/admin/personal/page.tsx`:

```tsx
import { listStaff } from "@suarex/db";
import { requireManager } from "@/lib/require-manager";
import { StaffForm } from "./StaffForm";

/** Gestión de personal (D3). `requireManager()` primera barrera; `createStaffAction` la
 * revalida por su cuenta vía `managerAction`. Muestra el personal humano del tenant y el
 * formulario de alta de un camarero. */
export default async function AdminPersonalPage() {
  const session = await requireManager();
  const staff = await listStaff(session.tenantId);

  return (
    <main>
      <h1>Gestión de personal</h1>

      {staff.length === 0 ? <p>Todavía no hay personal.</p> : null}
      <ul>
        {staff.map((member) => (
          <li key={member.userId} data-testid="staff-member" data-user-id={member.userId}>
            {member.email} — {member.role}
          </li>
        ))}
      </ul>

      <StaffForm />
    </main>
  );
}
```

- [ ] **Step 8: Verificar build + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/admin/personal apps/web/lib/staff-action-input.ts apps/web/lib/staff-action-input.test.ts
git commit -m "feat(admin): /admin/personal — alta de camareros (staff) con email + contraseña"
```

---

## Task 8: E2E de la fase D3

**Files:**
- Create: `tests/e2e/admin-d3.spec.ts`
- Create: `tests/e2e/helpers/admin-d3-db.ts`

**Interfaces:**
- Consumes: el tenant demo `garum` sembrado (`pnpm seed:staff` da `OWNER_SEED_PASSWORD`/`STAFF_SEED_PASSWORD` en `.env.test`), igual que `admin-d2.spec.ts`.
- El helper hace de service role EXCLUSIVO de este spec: snapshot/restore de la fila `tenant_settings` de garum (para no ensuciar el fixture compartido al cambiar la marca) y borrado del camarero de prueba por email.

- [ ] **Step 1: Implementar el helper** — `tests/e2e/helpers/admin-d3-db.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.SUPABASE_URL;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!rawUrl || !rawServiceKey) {
  throw new Error("Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en .env.test. Corre `pnpm db:env`.");
}
const url: string = rawUrl;
const serviceKey: string = rawServiceKey;

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** El slug del tenant demo compartido por toda la suite e2e (ver `admin-d2.spec.ts`). */
const DEMO_SLUG = "garum";

async function demoTenantId(): Promise<string> {
  const { data, error } = await admin.from("tenants").select("id").eq("slug", DEMO_SLUG).single();
  if (error) throw error;
  return data.id as string;
}

export type SettingsSnapshot = {
  tenantId: string;
  branding: unknown;
  fiscal: unknown;
  locale: string;
  currency: string;
};

/** Snapshot de la fila `tenant_settings` de garum ANTES de que el test la modifique por la
 * UI, para restaurarla en el `afterEach` -- garum es un fixture compartido (`workers: 1`),
 * así que un cambio de marca no restaurado cascadearía a otros ficheros (lección de D1/D2). */
export async function snapshotDemoSettings(): Promise<SettingsSnapshot> {
  const tenantId = await demoTenantId();
  const { data, error } = await admin
    .from("tenant_settings")
    .select("branding, fiscal, locale, currency")
    .eq("tenant_id", tenantId)
    .single();
  if (error) throw error;
  return {
    tenantId,
    branding: data.branding,
    fiscal: data.fiscal,
    locale: data.locale as string,
    currency: data.currency as string,
  };
}

export async function restoreDemoSettings(snap: SettingsSnapshot): Promise<void> {
  const { error } = await admin
    .from("tenant_settings")
    .update({
      branding: snap.branding,
      fiscal: snap.fiscal,
      locale: snap.locale,
      currency: snap.currency,
    })
    .eq("tenant_id", snap.tenantId);
  if (error) throw error;
}

/** Borra el camarero de prueba por email (la membership desaparece en cascada al borrar el
 * usuario de Auth: FK `on delete cascade` sobre `auth.users`). No lanza si no existe. */
export async function deleteStaffByEmailForTest(email: string): Promise<void> {
  const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const match = (usersPage?.users ?? []).find((u) => u.email === email);
  if (!match) return;
  const { error } = await admin.auth.admin.deleteUser(match.id);
  if (error) throw error;
}
```

- [ ] **Step 2: Implementar el spec** — `tests/e2e/admin-d3.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";
import {
  deleteStaffByEmailForTest,
  restoreDemoSettings,
  snapshotDemoSettings,
  type SettingsSnapshot,
} from "./helpers/admin-d3-db.js";

const STAFF_PASSWORD = process.env.STAFF_SEED_PASSWORD;
const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  expect(
    OWNER_PASSWORD,
    "Falta OWNER_SEED_PASSWORD: corre `pnpm seed:staff` y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
  expect(
    STAFF_PASSWORD,
    "Falta STAFF_SEED_PASSWORD: corre `pnpm seed:staff` y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
}

// --- Ajustes: snapshot/restore de la marca compartida de garum ---
let settingsSnap: SettingsSnapshot | undefined;
let createdStaffEmail: string | undefined;

test.afterEach(async () => {
  if (settingsSnap) {
    const snap = settingsSnap;
    settingsSnap = undefined;
    try {
      await restoreDemoSettings(snap);
    } catch (error) {
      console.error("No se pudieron restaurar los ajustes de garum:", error);
    }
  }
  if (createdStaffEmail) {
    const email = createdStaffEmail;
    createdStaffEmail = undefined;
    try {
      await deleteStaffByEmailForTest(email);
    } catch (error) {
      console.error(`No se pudo borrar el camarero de prueba ${email}:`, error);
    }
  }
});

test("un owner cambia el nombre y un color, y se reflejan en la carta", async ({ page }) => {
  settingsSnap = await snapshotDemoSettings(); // se restaura pase lo que pase (afterEach)

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/ajustes");
  await expect(page.locator("h1")).toHaveText("Ajustes del negocio");

  const newName = `Garum E2E ${Date.now()}`;
  await page.getByLabel("Nombre del negocio").fill(newName);
  // Un color primario nuevo, determinista.
  await page.getByLabel("Color primario").fill("#123456");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();

  // El nombre se refleja en la carta pública (mesa 1). data-testid="tenant-name".
  await page.goto("http://garum.localhost:3000/1");
  await expect(page.getByTestId("tenant-name")).toHaveText(newName, { timeout: 15_000 });

  // El color primario llegó a las CSS vars del layout raíz.
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim(),
  );
  expect(primary).toBe("#123456");
});

test("un owner da de alta un camarero que luego entra al panel de comandas", async ({ page }) => {
  createdStaffEmail = `camarero-e2e-${Date.now()}@garum.local`; // se borra en afterEach

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/personal");
  await expect(page.locator("h1")).toHaveText("Gestión de personal");

  await page.getByLabel("Email").fill(createdStaffEmail);
  await page.getByLabel("Contraseña (mín. 8)").fill("camarero-1234");
  await page.getByRole("button", { name: "Dar de alta" }).click();

  const row = page.getByTestId("staff-member").filter({ hasText: createdStaffEmail });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // El camarero recién creado inicia sesión y aterriza en el panel de comandas.
  await page.context().clearCookies();
  await login(page, createdStaffEmail, "camarero-1234");
  await expect(page).toHaveURL("http://garum.localhost:3000/staff");
});

test("un staff no ve ajustes ni personal", async ({ page }) => {
  await login(page, "staff@garum.local", STAFF_PASSWORD as string);
  for (const path of ["/admin/ajustes", "/admin/personal"]) {
    await page.goto(`http://garum.localhost:3000${path}`);
    await expect(page).toHaveURL(/\/staff\/login/, { timeout: 15_000 });
  }
});
```

- [ ] **Step 3: Ejecutar el e2e**

Run: `pnpm seed:staff && pnpm test:e2e admin-d3`
Expected: PASS (3 tests). Si `--color-primary` no coincide exactamente por normalización del navegador, ajustar la aserción a `toContain` en minúsculas — pero `parseBranding` y `brandingToCssVars` emiten el hex tal cual, así que debería ser exacto.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/admin-d3.spec.ts tests/e2e/helpers/admin-d3-db.ts
git commit -m "test(e2e): D3 — owner edits branding reflected on menu + creates staff who logs in; staff blocked"
```

---

## Verificación final de fase

- [ ] **Suite completa desde limpio** (mismo criterio que D1/D2):

Run:
```bash
pnpm typecheck && pnpm lint
pnpm test           # unit
pnpm test:integration
pnpm seed:staff && pnpm test:e2e
```
Expected: todo verde, cero skips. Registrar los conteos en el ledger (`.superpowers/sdd/progress.md`).

- [ ] **Revisión de fase (opus)** vía superpowers:requesting-code-review sobre todo el diff de `feat/admin-d3`, con foco en: (1) que el alta de personal no deje cuentas huérfanas ni segundas memberships; (2) que la marca escrita se lea de vuelta consistente (write-side estricto ↔ read-side `parseBranding`); (3) que un `staff`/`device` no pueda escribir `tenant_settings` ni crear personal por ninguna vía; (4) que el snapshot/restore del e2e no ensucie el fixture `garum`.

---

## Self-Review del plan (hecho)

**1. Cobertura de la spec (criterio D3: "Un owner cambia el nombre y los colores del negocio y se reflejan en la carta; da de alta a un camarero que puede entrar al panel de comandas"):**
- Nombre + colores editables → Task 1 (`branding.name` + carta), Task 3 (parser), Task 5 (pantalla ajustes). Reflejo en la carta → Task 1 (`[mesa]/page.tsx`) + e2e Task 8. ✅
- Datos fiscales + IVA → Task 3 (`parseFiscalFields`, IVA %→fracción), Task 5 (formulario). ✅
- Alta de personal que entra al panel de comandas → Task 6 (`createStaff`, membership staff, claim verificado), Task 7 (pantalla), e2e Task 8 (el camarero inicia sesión y llega a /staff). ✅
- RLS por rol: la spec dice que `tenant_settings` ya es escritura owner/admin (existe desde D1) y `memberships` sigue sin escritura autenticada (service role) — D3 NO añade migración; se prueba el efecto (Task 2 RLS test, Task 6 service-role path, e2e staff bloqueado). ✅

**2. Placeholders:** ninguno — todo el código está escrito. Los dos `Run:` de integración usan el nombre de fichero como filtro; si el runner del repo difiere, el implementador usa el comando equivalente (todos los ficheros de test existentes se ejecutan con el mismo runner).

**3. Consistencia de tipos:** `UpdateTenantSettingsInput` (Task 2) ↔ el objeto que construye `updateSettingsAction` (Task 5) coinciden (branding/fiscal/locale/currency). `Branding.name` (Task 1) ↔ leído en `[mesa]/page.tsx` y `ajustes/page.tsx`. `CreateStaffInput`/`StaffMember` (Task 6) ↔ usados en Task 7. `parseBrandingFields` no devuelve `logoUrl` y la action lo añade — consistente con la nota de la interfaz.

**Riesgo anotado:** el e2e de ajustes muta la marca del `garum` compartido; mitigado con snapshot/restore en `afterEach` que corre pase lo que pase (mismo patrón probado en D2). El e2e de personal crea un usuario de Auth real en el stack local; se borra por email en `afterEach`.
