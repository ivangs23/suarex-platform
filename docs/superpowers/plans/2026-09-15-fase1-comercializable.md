# Fase 1 — Comercializable: plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar este plan tarea a tarea. Los
> pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** cerrar los cinco huecos que impiden cobrar al primer cliente — recibo sin
ambigüedad fiscal, marco legal, correo y credenciales, suscripción con corte por impago, y
alta de cliente desde el navegador.

**Arquitectura:** nada de esto toca el flujo del comensal ni el aislamiento multi-tenant
existente. Se añaden: dos columnas de estado de suscripción en `tenants`, una superficie
nueva (`/plataforma`) en un host propio con su propia tabla de autorización
(`platform_admins`), y dos exenciones documentadas más en `packages/db/src/client.ts`. El
recibo y las páginas legales son datos que ya existen (`tenant_settings.fiscal`) puestos en
pantalla.

**Stack:** Next 16 App Router (webpack) · Supabase self-hosted · Stripe (Billing + Connect) ·
TypeScript strict · Vitest + happy-dom · Playwright · Biome.

**Spec:** [`../specs/2026-09-15-viabilidad-fase1-design.md`](../specs/2026-09-15-viabilidad-fase1-design.md)

## Restricciones globales

- **Doctrina del producto (no negociable):** todo lo que no sean estilos se implementa para
  TODOS los clientes. Por tenant solo cambian aspecto y contenido. Al tocar la carta o el
  recibo, `apps/web/app/[mesa]/themes/contract.test.tsx` tiene que seguir en verde.
- Node >= 22.12 · pnpm 10.33.0 · TypeScript strict · Biome (`pnpm lint:fix` antes de commitear).
- `packages/db` se consume como fuente TS sin compilar: imports NodeNext, `./x.js` -> `./x.ts`.
- Migraciones: `supabase/migrations/YYYYMMDDNNNNNN_nombre.sql`. Toda tabla nueva con
  `tenant_id` lleva RLS o `tests/integration/tenant-isolation.test.ts` falla.
- Todo acceso nuevo desde `packages/db` va por `tenantScoped(tabla, tenantId)`, o por una
  exención **nueva, con nombre propio y docstring numerado** en `client.ts`. Reutilizar una
  exención existente para un caso distinto es un fallo de revisión.
- Ningún secreto de service role llega al navegador ni al PC del cliente.
- Textos de cara al comensal en es/en/pt. Panel y consola, solo es.
- Comandos de verificación: `pnpm lint` · `pnpm typecheck` · `pnpm test` ·
  `pnpm test:integration` · `pnpm test:e2e`.
- Nunca levantar el dev server con bash: usa `preview_start`.
- El e2e y la integración necesitan Supabase local: `pnpm db:start && pnpm db:reset &&
  pnpm db:env && pnpm seed:staff`.

## Cómo se ejecuta esto: EN SERIE

Verificado contra la configuración real del repo, no supuesto. **Las tareas no se pueden
repartir entre agentes en paralelo**, y el motivo no son los ficheros (eso lo arreglarían
worktrees) sino tres *singletons* compartidos:

1. **Una sola base de datos.** `vitest.config.ts:12` fija `fileParallelism: false` a propósito.
   Varias tareas mandan `pnpm db:reset`, que destruye la base para todos. Y 15 de las llamadas
   a `createTenantFixture` del repo usan slug fijo sin `nonce()`: colisionan entre ejecuciones
   concurrentes.
2. **Un solo dev server en el puerto 3000.** `playwright.config.ts:79` fija `workers: 1`, y su
   comentario documenta que incluso el paralelismo por defecto *entre ficheros* produce fallos
   intermitentes por contención sobre el dev server y el consumidor de Realtime — verificado
   empíricamente, tres veces, con diagnóstico caro cada una.
3. **Un solo catálogo sembrado.** Los 17 specs de `tests/e2e` mutan el catálogo de
   `garum`/`manuela` y lo restauran al final. Dos agentes a la vez se lo pisan.

**Regla:** un agente, una tarea, de principio a fin, con revisión antes de empezar la
siguiente. Mientras una tarea corre `test:integration` o `test:e2e`, **nadie más ejecuta tests**.

### Ficheros que tocan varias tareas

`packages/db/src/index.ts` es el peor: lo modifican **cinco** tareas (7, 12, 16, 17, 18), es un
único fichero de 117 líneas con re-exports en orden alfabético, y cada tarea inserta en un
punto distinto. Otros compartidos:

| Fichero | Tareas |
|---|---|
| `packages/db/src/index.ts` | 7 · 12 · 16 · 17 · 18 |
| `packages/db/src/client.ts` | 7 · 12 · 16 · 17 |
| `packages/db/src/tenants.ts` | 11 · 14 · 18 |
| `packages/db/src/types.ts` | 1 · 11 |
| `packages/db/src/platform.ts` | 16 · 17 · 18 |
| `packages/config/src/tenant-host.ts` | 15 · 18 |
| `apps/web/proxy.ts` | 15 |
| `apps/web/lib/i18n.ts` | 2 · 6 |

Todas esas parejas ya están en orden de dependencia dentro de su bloque, así que en serie no
hay conflicto. La tabla está aquí para que nadie "optimice" lanzando dos a la vez.

## Estructura de ficheros

| Fichero | Responsabilidad | Bloque |
|---|---|---|
| `packages/db/src/types.ts` (mod) | `OrderReceipt` gana `subtotalCents`/`taxCents` | A |
| `packages/db/src/orders.ts` (mod) | `getOrderReceipt` los lee de la fila | A |
| `apps/web/lib/i18n.ts` (mod) | Cadenas del bloque fiscal del recibo, es/en/pt | A |
| `apps/web/app/pedido/[publicToken]/receipt-pdf.ts` (mod) | Composición del PDF con emisor, desglose y aviso | A |
| `apps/web/app/pedido/[publicToken]/Receipt.tsx` (mod) | Lo mismo en pantalla | A |
| `apps/web/lib/legal-content.ts` (nuevo) | Texto de las páginas legales, parametrizado por tenant | B |
| `apps/web/app/legal/[documento]/page.tsx` (nuevo) | Render de las tres páginas legales | B |
| `supabase/migrations/20260915000001_purge_order_personal_data.sql` (nuevo) | RPC de retención | B |
| `apps/web/app/api/internal/purge-orders/route.ts` (nuevo) | Cron de retención | B |
| `apps/web/app/staff/recuperar/page.tsx` (nuevo) | Pedir enlace de recuperación | C |
| `apps/web/app/staff/nueva-clave/page.tsx` (nuevo) | Fijar contraseña nueva | C |
| `packages/db/src/admin-staff.ts` (mod) | Alta por invitación, sin contraseña tecleada | C |
| `supabase/migrations/20260915000002_tenant_subscription.sql` (nuevo) | Columnas de suscripción | D |
| `packages/db/src/billing.ts` (nuevo) | Estado de suscripción -> estado del tenant | D |
| `apps/web/app/api/webhook/stripe/billing/route.ts` (nuevo) | Webhook de facturación | D |
| `apps/web/app/api/internal/suspend-overdue/route.ts` (nuevo) | Barrido de gracia vencida | D |
| `packages/config/src/tenant-host.ts` (mod) | `isPlatformHost` | E |
| `apps/web/proxy.ts` (mod) | Enrutado del host de plataforma, en ambas direcciones | E |
| `supabase/migrations/20260915000003_platform_admins.sql` (nuevo) | Tabla de superadmins | E |
| `packages/db/src/platform.ts` (nuevo) | Listado y alta de tenants (exención #15) | E |
| `apps/web/lib/require-platform-admin.ts` (nuevo) | Guard de la consola | E |
| `apps/web/app/plataforma/**` (nuevo) | Consola: listado y alta | E |

---

## Bloque A — Recibo sin ambigüedad fiscal

Cierra el hueco 5 del spec. Independiente del resto de bloques.

### Task 1: El recibo trae base imponible e IVA

`orders` ya guarda `subtotal` y `tax_amount` (ver
`supabase/migrations/20260721000005_orders.sql`), pero `getOrderReceipt` no los selecciona,
así que el recibo solo puede pintar el total. Sin base e IVA no hay desglose informativo.

**Ficheros:**
- Modificar: `packages/db/src/types.ts:106-113` (`OrderReceipt`)
- Modificar: `packages/db/src/orders.ts:394-450` (`getOrderReceipt`)
- Test: `tests/integration/order-receipt.test.ts`

**Interfaces:**
- Consume: nada de tareas anteriores.
- Produce: `OrderReceipt` gana `subtotalCents: number` y `taxCents: number`. Las tareas 3 y 4
  los pintan.

- [ ] **Paso 1: escribir el test que falla**

Primero amplía los imports del fichero: añade `createPendingOrder` al import de `@suarex/db`
(:1, hoy solo trae `getOrderReceipt`) y `seedCatalog` al import de `./helpers/tenants.js`
(:3-9, hoy trae `admin, createTenantFixture, deleteTenantFixture, nonce, type TenantFixture`).

Luego añade el test al final, con **fixture propia dentro de un `try/finally`**. No reuses la
fixture de módulo `tenant`: `seedCatalog` siembra un tenant DESDE CERO —sede por defecto,
`tenant_settings`, catálogo, mesas, contador— y aplicarlo sobre un tenant que ya tiene sede
revienta contra `venues_single_default_per_tenant`. El `finally` no es opcional: con
`retry: 2`, un fallo a medias deja tenants huérfanos y el reintento choca contra las claves
que dejó el intento anterior (se ve como `duplicate key ... categories_tenant_id_slug_key`,
que despista del fallo real).

```ts
it("devuelve base imponible e IVA, no solo el total", async () => {
  const propio = await createTenantFixture(`recibo-iva-${nonce()}`);
  try {
    const seed = await seedCatalog(propio.tenantId, "iva");
    // `createPendingOrder` exige `tableId: string` y `SeedResult` no expone mesa.
    const { data: mesa } = await admin
      .from("tables")
      .insert({ tenant_id: propio.tenantId, venue_id: seed.venueId, label: "iva-pedido" })
      .select("id")
      .single();

    const { publicToken } = await createPendingOrder({
      tenantId: propio.tenantId,
      venueId: seed.venueId,
      tableId: mesa?.id as string,
      lines: [{ productId: seed.productId, quantity: 2, extraIds: [], notes: null }],
      taxRate: 0.1,
    });

    const receipt = await getOrderReceipt(publicToken);
    // Lanzar en vez de `!`: estrecha el tipo Y evita cuatro warnings de
    // `lint/style/noNonNullAssertion`, que en este repo salen a cero.
    if (!receipt) throw new Error("getOrderReceipt devolvió null para un pedido recién creado");

    // base + IVA tiene que cuadrar con el total al céntimo: si no cuadra, el desglose
    // que se enseña al comensal estaría mintiendo.
    expect(receipt.subtotalCents + receipt.taxCents).toBe(receipt.totalCents);
    expect(receipt.taxCents).toBeGreaterThan(0);
  } finally {
    await deleteTenantFixture(propio);
  }
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/order-receipt.test.ts
```

Esperado: FAIL. Ojo al mensaje: **vitest no typechequea**, transpila y ejecuta, así que
`receipt!.subtotalCents` es `undefined` en tiempo de ejecución y el fallo real es
`expected NaN to be 1100`, no un error de TypeScript. El error de tipos sale aparte, en
`pnpm typecheck`.

- [ ] **Paso 3: ampliar el tipo**

En `packages/db/src/types.ts`, dentro de `OrderReceipt`, justo antes de `totalCents`:

```ts
  /** Base imponible en céntimos (`orders.subtotal`). Informativa: este recibo NO es una
   *  factura (ver el aviso que pinta `filasRecibo`), pero enseñar total sin desglose en
   *  hostelería se lee como si lo fuera. */
  subtotalCents: number;
  /** Cuota de IVA en céntimos (`orders.tax_amount`). `subtotalCents + taxCents` cuadra
   *  siempre con `totalCents`: los tres salen de la MISMA fila, congelados en la compra. */
  taxCents: number;
```

- [ ] **Paso 4: leerlos en la consulta**

En `packages/db/src/orders.ts`, en `getOrderReceipt`, cambia el `.select(...)`:

```ts
    .select(
      "order_number, created_at, subtotal, tax_amount, total, currency, tables(label), " +
        "order_items(id, name_snapshot, quantity, line_total, notes, " +
        "order_item_extras(name_snapshot, price))",
    )
```

Añade los dos campos al cast de `row` (junto a `total: number;`):

```ts
    subtotal: number;
    tax_amount: number;
```

Y al objeto devuelto, antes de `totalCents`:

```ts
    subtotalCents: eurosToCents(Number(row.subtotal)),
    taxCents: eurosToCents(Number(row.tax_amount)),
```

- [ ] **Paso 5: arreglar el fixture que este cambio rompe**

Hacer `subtotalCents`/`taxCents` obligatorios rompe el ÚNICO literal de `OrderReceipt`
construido a mano fuera de `packages/db`: `apps/web/app/pedido/[publicToken]/receipt-pdf.test.ts:6-23`.
Sin esto, `pnpm typecheck` de `@suarex/web` falla. Añade las dos claves a ese fixture, en el
mismo commit (1000 = 900 + 100, para que cuadren con `totalCents`):

```ts
  tableLabel: "1",
  subtotalCents: 900,
  taxCents: 100,
  totalCents: 1000,
```

- [ ] **Paso 6: ejecutar y ver que pasa**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/order-receipt.test.ts
pnpm --filter @suarex/web exec vitest run "app/pedido/[publicToken]/receipt-pdf.test.ts"
pnpm typecheck
```

Esperado: PASS los tres.

- [ ] **Paso 7: commit**

```bash
git add packages/db/src/types.ts packages/db/src/orders.ts tests/integration/order-receipt.test.ts "apps/web/app/pedido/[publicToken]/receipt-pdf.test.ts"
git commit -m "feat(recibo): base imponible e IVA en OrderReceipt

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Cadenas del bloque fiscal, en los tres idiomas

**Ficheros:**
- Modificar: `apps/web/lib/i18n.ts` (el tipo `Strings` en :87-132, y los tres objetos, que se
  llaman en MAYÚSCULAS: `const ES` :134, `const EN` :182, `const PT` :230 — `es`/`en`/`pt` son
  solo las claves del `Record<Lang, Strings>` de :278)
- Test: `apps/web/lib/i18n.test.ts`

**Interfaces:**
- Produce: `Strings` gana `receiptSubtotal`, `receiptTax`, `receiptIssuer`, `receiptNotInvoice`.
  Las tareas 3 y 4 las consumen.

- [ ] **Paso 1: escribir el test que falla**

En `apps/web/lib/i18n.test.ts`:

```ts
it("las cuatro cadenas del bloque fiscal existen en los tres idiomas", () => {
  // El aviso de "no es factura" es la razón de ser de este bloque: si falta en un
  // idioma, ese comensal recibe un documento que parece una factura y no lo es.
  for (const lang of SUPPORTED_LANGS) {
    const t = strings(lang);
    expect(t.receiptSubtotal.trim(), `receiptSubtotal vacío en ${lang}`).not.toBe("");
    expect(t.receiptTax.trim(), `receiptTax vacío en ${lang}`).not.toBe("");
    expect(t.receiptIssuer.trim(), `receiptIssuer vacío en ${lang}`).not.toBe("");
    expect(t.receiptNotInvoice.trim(), `receiptNotInvoice vacío en ${lang}`).not.toBe("");
  }
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm --filter @suarex/web exec vitest run lib/i18n.test.ts
```

Esperado: FAIL — `Property 'receiptSubtotal' does not exist on type 'Strings'`.

- [ ] **Paso 3: añadir las cadenas**

En el tipo `Strings`, junto a `receiptTitle`/`receiptTable`:

```ts
  receiptSubtotal: string;
  receiptTax: string;
  receiptIssuer: string;
  /** SuarEx no es emisor de facturas (decisión D1 del spec de la fase 1): este aviso es lo
   *  que separa un justificante de pedido de un documento que parece una factura y no lo
   *  es. Se pinta SIEMPRE, en pantalla y en el PDF, para todos los tenants. */
  receiptNotInvoice: string;
```

En `ES`:

```ts
  receiptSubtotal: "Base imponible",
  receiptTax: "IVA",
  receiptIssuer: "Emitido por",
  receiptNotInvoice:
    "Justificante de pedido. No válido como factura. Si necesitas factura, pídela al establecimiento.",
```

En `EN`:

```ts
  receiptSubtotal: "Subtotal",
  receiptTax: "VAT",
  receiptIssuer: "Issued by",
  receiptNotInvoice:
    "Order receipt. Not valid as an invoice. Ask the venue if you need a tax invoice.",
```

En `PT`:

```ts
  receiptSubtotal: "Base tributável",
  receiptTax: "IVA",
  receiptIssuer: "Emitido por",
  receiptNotInvoice:
    "Comprovativo de pedido. Não válido como fatura. Peça a fatura ao estabelecimento.",
```

- [ ] **Paso 4: ejecutar y ver que pasa**

```bash
pnpm --filter @suarex/web exec vitest run lib/i18n.test.ts
```

Esperado: PASS.

- [ ] **Paso 5: commit**

```bash
git add apps/web/lib/i18n.ts apps/web/lib/i18n.test.ts
git commit -m "feat(recibo): cadenas del bloque fiscal en es/en/pt

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: El PDF lleva emisor, desglose y aviso

**Ficheros:**
- Modificar: `apps/web/app/pedido/[publicToken]/receipt-pdf.ts` (`filasRecibo`, `descargarReciboPdf`)
- Test: `apps/web/app/pedido/[publicToken]/receipt-pdf.test.ts`

**Interfaces:**
- Consume: `OrderReceipt.subtotalCents`/`taxCents` (Task 1), las cuatro cadenas (Task 2).
- Produce: `filasRecibo(receipt, opts)` donde `opts` gana `fiscal?: ReciboFiscal` —
  **opcional**, no obligatorio. Dos motivos: el `opts` compartido de `receipt-pdf.test.ts:25-30`
  se usa en el cuerpo del `describe` y con `fiscal` obligatorio los cuatro tests existentes
  petarían al recolectar el fichero; y `Receipt.tsx` es el único llamante, así que obligarlo
  dejaría `typecheck` en rojo entre esta tarea y la 4. Dentro: `const fiscal = opts.fiscal ?? {}`.
  `descargarReciboPdf` acepta el mismo `opts`. La Task 4 se lo pasa.

- [ ] **Paso 1: escribir el test que falla**

En `apps/web/app/pedido/[publicToken]/receipt-pdf.test.ts`:

```ts
it("pinta emisor, desglose de IVA y el aviso de que no es factura", () => {
  const receipt: OrderReceipt = {
    orderNumber: 7,
    createdAt: "2026-09-15T12:00:00.000Z",
    tableLabel: "4",
    subtotalCents: 1000,
    taxCents: 100,
    totalCents: 1100,
    currency: "EUR",
    lines: [
      { id: "l1", name: "Croquetas", quantity: 1, lineTotalCents: 1100, notes: null, extras: [] },
    ],
  };

  const filas = filasRecibo(receipt, {
    businessName: "Bar Paco",
    fecha: "15/09/2026",
    strings: strings("es"),
    formatearDinero: (c) => `${(c / 100).toFixed(2)} €`,
    fiscal: { legalName: "Paco SL", cif: "B12345678", address: "Calle Falsa 1", phone: "600111222" },
  });

  const texto = JSON.stringify(filas);
  expect(texto).toContain("Paco SL");
  expect(texto).toContain("B12345678");
  expect(texto).toContain("Calle Falsa 1");
  expect(texto).toContain("Base imponible");
  expect(texto).toContain("No válido como factura");
});

it("el aviso de que no es factura se pinta aunque el tenant no tenga datos fiscales", () => {
  // La doctrina: el aviso NO es opcional por cliente. Un tenant sin CIF configurado no
  // puede acabar con un recibo que parezca una factura.
  const receipt: OrderReceipt = {
    orderNumber: 8,
    createdAt: "2026-09-15T12:00:00.000Z",
    tableLabel: null,
    subtotalCents: 1000,
    taxCents: 0,
    totalCents: 1000,
    currency: "EUR",
    lines: [
      { id: "l1", name: "Café", quantity: 1, lineTotalCents: 1000, notes: null, extras: [] },
    ],
  };

  const filas = filasRecibo(receipt, {
    businessName: "Bar Paco",
    fecha: "15/09/2026",
    strings: strings("es"),
    formatearDinero: (c) => `${(c / 100).toFixed(2)} €`,
    fiscal: {},
  });

  expect(JSON.stringify(filas)).toContain("No válido como factura");
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm --filter @suarex/web exec vitest run "app/pedido/[publicToken]/receipt-pdf.test.ts"
```

Esperado: FAIL — `Object literal may only specify known properties, and 'fiscal' does not exist`.

- [ ] **Paso 3: implementar**

En `receipt-pdf.ts`, define el tipo del bloque fiscal encima de `filasRecibo`:

```ts
/** Datos del emisor, tal cual los guarda `tenant_settings.fiscal` (ver `tenantSettingsSchema`
 *  en @suarex/config). Todos opcionales: un tenant recién dado de alta aún no los tiene, y el
 *  recibo tiene que seguir saliendo — lo único que NO es opcional es el aviso de que esto no
 *  es una factura. */
export type ReciboFiscal = {
  legalName?: string;
  cif?: string;
  address?: string;
  phone?: string;
};
```

Amplía la firma de `filasRecibo` con `fiscal: ReciboFiscal` dentro de `opts`, y desestructúralo:

```ts
  const { businessName, fecha, strings: t, formatearDinero, fiscal } = opts;
```

Después del `filas.push({ tipo: "centro", texto: businessName... })` y antes de
`filas.push({ tipo: "centro", texto: t.receiptTitle, tam: 11 })`, mete el emisor:

```ts
  // Emisor: solo las líneas que el tenant tenga rellenas. No se inventan huecos ni se
  // escribe "—": un recibo con campos vacíos parece un formulario a medio hacer.
  const emisor = [
    fiscal.legalName?.trim(),
    fiscal.cif?.trim() ? `CIF ${fiscal.cif.trim()}` : null,
    fiscal.address?.trim(),
    fiscal.phone?.trim(),
  ].filter((linea): linea is string => Boolean(linea));
  if (emisor.length > 0) {
    filas.push({ tipo: "centro", texto: `${t.receiptIssuer}: ${emisor.join(" · ")}`, tam: 8 });
  }
```

Y el desglose **ANTES** del `filas.push` del total (un recibo se lee base → IVA → TOTAL, y el
total tiene que quedar como línea de cierre: ponerlo después rompe el test existente "cierra con
el total en negrita", y con razón). El aviso, al final de todo:

```ts
  // Desglose informativo. Solo si hay cuota: un tenant con taxRate 0 no gana nada con una
  // línea de "IVA 0,00 €", y sí gana confusión.
  if (receipt.taxCents > 0) {
    filas.push({ tipo: "partida", izq: t.receiptSubtotal, der: formatearDinero(receipt.subtotalCents), tam: 8.5 });
    filas.push({ tipo: "partida", izq: t.receiptTax, der: formatearDinero(receipt.taxCents), tam: 8.5 });
  }

  // INCONDICIONAL, para todos los tenants (decisión D1 del spec). `centro` ya envuelve el
  // texto con splitTextToSize, así que una frase larga no se sale de los 80 mm.
  filas.push({ tipo: "hueco" });
  filas.push({ tipo: "centro", texto: t.receiptNotInvoice, tam: 7.5 });
```

Amplía también `descargarReciboPdf` para que su `opts` incluya `fiscal: ReciboFiscal` (lo
pasa tal cual a `filasRecibo`, no hace nada más con él).

- [ ] **Paso 4: ejecutar y ver que pasa**

```bash
pnpm --filter @suarex/web exec vitest run "app/pedido/[publicToken]/receipt-pdf.test.ts"
```

Esperado: PASS. **Un test existente necesita ajuste legítimo**: "pone cada línea con su precio"
cuenta `partida` y esperaba 3 (dos platos + total); con el desglose son 5. No lo aflojes,
corrige el número y el comentario — el recibo tiene más filas de verdad.

- [ ] **Paso 5: commit**

```bash
git add "apps/web/app/pedido/[publicToken]/receipt-pdf.ts" "apps/web/app/pedido/[publicToken]/receipt-pdf.test.ts"
git commit -m "feat(recibo): emisor, desglose de IVA y aviso de no-factura en el PDF

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Lo mismo en pantalla, no solo al descargar

El comensal que no descarga el PDF también tiene que ver el aviso. Hoy `Receipt.tsx` pinta
líneas y total, nada más.

**Ficheros:**
- Modificar: `apps/web/app/pedido/[publicToken]/Receipt.tsx`
- Modificar: `apps/web/app/pedido/[publicToken]/page.tsx:26-33` (pasar `fiscal`)
- Modificar: `apps/web/app/pedido/[publicToken]/pedido.module.css` (clases nuevas)
- Test: `tests/e2e/pago.spec.ts`

**Interfaces:**
- Consume: `ReciboFiscal` y `filasRecibo`/`descargarReciboPdf` con `fiscal` (Task 3).
- Produce: nada que consuman tareas posteriores.

- [ ] **Paso 1: escribir el test que falla**

En `tests/e2e/pago.spec.ts`, dentro del test que ya llega a la pantalla de recibo (busca el
que usa `data-testid="receipt"`), añade al final:

```ts
  // El aviso se lee SIN descargar nada: el comensal que solo mira la pantalla también
  // tiene que saber que esto no es una factura.
  await expect(page.getByTestId("receipt-not-invoice")).toContainText("No válido como factura");
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm test:e2e tests/e2e/pago.spec.ts
```

Esperado: FAIL — timeout esperando `receipt-not-invoice`.

- [ ] **Paso 3: implementar**

En `page.tsx`, pasa el bloque fiscal ya resuelto al componente (las `settings` ya se cargan
ahí, no hace falta consulta nueva):

```tsx
        <Receipt
          receipt={receipt}
          businessName={businessName}
          fiscal={(settings?.fiscal ?? {}) as ReciboFiscal}
          locale={locale}
          strings={t}
        />
```

con `import type { ReciboFiscal } from "./receipt-pdf";` arriba.

En `Receipt.tsx`, añade `fiscal: ReciboFiscal` a las props, pásalo en la llamada a
`descargarReciboPdf`, y debajo del `<p className={styles.receiptTotal}>` añade:

```tsx
      {receipt.taxCents > 0 ? (
        <p className={styles.receiptTaxBreakdown}>
          <span>
            {t.receiptSubtotal}: {formatCents(receipt.subtotalCents, locale, receipt.currency)}
          </span>
          <span>
            {t.receiptTax}: {formatCents(receipt.taxCents, locale, receipt.currency)}
          </span>
        </p>
      ) : null}

      {/* Incondicional para todos los tenants: ver decisión D1 del spec. */}
      <p className={styles.receiptNotInvoice} data-testid="receipt-not-invoice">
        {t.receiptNotInvoice}
      </p>
```

En `pedido.module.css`:

```css
.receiptTaxBreakdown {
	display: flex;
	justify-content: space-between;
	margin: 0.25rem 0 0;
	font-size: 0.8rem;
	color: var(--color-muted, #6b7280);
}

.receiptNotInvoice {
	margin: 0.75rem 0 0;
	font-size: 0.72rem;
	line-height: 1.35;
	text-align: center;
	color: var(--color-muted, #6b7280);
}
```

- [ ] **Paso 4: ejecutar y ver que pasa**

```bash
pnpm test:e2e tests/e2e/pago.spec.ts
pnpm --filter @suarex/web exec vitest run
pnpm typecheck
```

Esperado: PASS los tres.

- [ ] **Paso 5: commit**

```bash
git add "apps/web/app/pedido/[publicToken]" tests/e2e/pago.spec.ts
git commit -m "feat(recibo): desglose y aviso de no-factura también en pantalla

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Bloque B — Marco legal

Cierra el hueco 4 del spec. Independiente de A, C, D y E.

> **Antes de ejecutar este bloque:** el texto que se escribe aquí es una plantilla operativa,
> no asesoramiento jurídico. Que un abogado revise los tres documentos y el anexo de encargo
> de tratamiento **antes** de que se publiquen con un cliente real detrás. El código de las
> tareas 5-7 no cambia por esa revisión; el contenido de `legal-content.ts` sí puede.

### Task 5: Tres páginas legales, servidas bajo el host de cada tenant

El responsable del tratamiento es el **restaurante** (decide para qué se usan los datos del
comensal); SuarEx es **encargado** (los trata por cuenta de él). Por eso las páginas viven
bajo el host del tenant y llevan SUS datos fiscales, con SuarEx nombrado como encargado.

**Ficheros:**
- Crear: `apps/web/lib/legal-content.ts`
- Crear: `apps/web/lib/legal-content.test.ts`
- Crear: `apps/web/app/legal/[documento]/page.tsx`
- Crear: `apps/web/app/legal/legal.module.css`

**Interfaces:**
- Consume: `getTenantSettings` (ya existe), `requireTenant` (ya existe).
- Produce: `DOCUMENTOS_LEGALES` (array de slugs), `esDocumentoLegal(slug)`,
  `documentoLegal(slug, datos)` que devuelve `{ titulo: string; secciones: Seccion[] }`.
  La Task 6 usa `DOCUMENTOS_LEGALES` para construir los enlaces.

- [ ] **Paso 1: escribir el test que falla**

`apps/web/lib/legal-content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { documentoLegal, DOCUMENTOS_LEGALES, esDocumentoLegal } from "./legal-content";

const DATOS = {
  businessName: "Bar Paco",
  legalName: "Paco SL",
  cif: "B12345678",
  address: "Calle Falsa 1, Madrid",
  phone: "600111222",
};

describe("documentos legales", () => {
  it("solo reconoce los tres slugs publicados", () => {
    expect(DOCUMENTOS_LEGALES).toEqual(["privacidad", "aviso-legal", "condiciones"]);
    expect(esDocumentoLegal("privacidad")).toBe(true);
    // Un slug manipulado en la URL no puede convertirse en una página vacía servida con 200.
    expect(esDocumentoLegal("../../etc/passwd")).toBe(false);
    expect(esDocumentoLegal("politica")).toBe(false);
  });

  it("nombra al restaurante como responsable y a SuarEx como encargado", () => {
    const doc = documentoLegal("privacidad", DATOS);
    const texto = JSON.stringify(doc);
    expect(texto).toContain("Paco SL");
    expect(texto).toContain("B12345678");
    expect(texto).toContain("responsable");
    expect(texto).toContain("SuarEx");
    expect(texto).toContain("encargado");
  });

  it("sigue siendo publicable si el tenant no ha rellenado sus datos fiscales", () => {
    // Un tenant recién dado de alta no tiene CIF. La página no puede romperse ni quedarse
    // con un "undefined" impreso: cae al nombre comercial y omite lo que no hay.
    const doc = documentoLegal("privacidad", { businessName: "Bar Paco" });
    const texto = JSON.stringify(doc);
    expect(texto).toContain("Bar Paco");
    expect(texto).not.toContain("undefined");
  });
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm --filter @suarex/web exec vitest run lib/legal-content.test.ts
```

Esperado: FAIL — `Cannot find module './legal-content'`.

- [ ] **Paso 3: escribir el contenido**

`apps/web/lib/legal-content.ts`:

```ts
/**
 * TEXTO DE LAS PÁGINAS LEGALES, parametrizado por los datos del tenant.
 *
 * Quién es quién (y por qué importa): el RESTAURANTE es el responsable del tratamiento —
 * decide qué se pide, para qué y cuánto se guarda. SuarEx es ENCARGADO: trata los datos del
 * comensal por cuenta suya, siguiendo sus instrucciones. Por eso estas páginas se sirven bajo
 * el host del tenant, con SUS datos, y nombran a SuarEx como proveedor. Publicarlas bajo la
 * marca de SuarEx invertiría los papeles y sería falso.
 *
 * Es contenido, no funcionalidad: por la doctrina del producto, las TRES páginas existen para
 * todos los clientes; lo que cambia por tenant son los datos que se interpolan.
 */

export const DOCUMENTOS_LEGALES = ["privacidad", "aviso-legal", "condiciones"] as const;

export type DocumentoLegal = (typeof DOCUMENTOS_LEGALES)[number];

export type DatosLegales = {
  businessName: string;
  legalName?: string;
  cif?: string;
  address?: string;
  phone?: string;
};

export type Seccion = { titulo: string; parrafos: string[] };

export function esDocumentoLegal(valor: string): valor is DocumentoLegal {
  return (DOCUMENTOS_LEGALES as readonly string[]).includes(valor);
}

/** Identificación del responsable, con los campos que falten simplemente omitidos: mejor una
 *  línea corta que un "undefined" impreso en una página legal. */
function identificacion(d: DatosLegales): string {
  const partes = [
    d.legalName?.trim() || d.businessName,
    d.cif?.trim() ? `CIF ${d.cif.trim()}` : null,
    d.address?.trim(),
    d.phone?.trim() ? `tel. ${d.phone.trim()}` : null,
  ].filter((p): p is string => Boolean(p));
  return partes.join(" · ");
}

export function documentoLegal(
  slug: DocumentoLegal,
  d: DatosLegales,
): { titulo: string; secciones: Seccion[] } {
  const quien = identificacion(d);

  if (slug === "privacidad") {
    return {
      titulo: "Política de privacidad",
      secciones: [
        {
          titulo: "Responsable del tratamiento",
          parrafos: [
            `${quien} (en adelante, “el establecimiento”) es el responsable del tratamiento de los datos que facilitas al pedir desde la carta digital.`,
            "SuarEx Soluciones Digitales presta el servicio técnico de carta, pedido y comanda, y actúa como encargado del tratamiento por cuenta del establecimiento, conforme al artículo 28 del RGPD.",
          ],
        },
        {
          titulo: "Qué datos se tratan",
          parrafos: [
            "Los del pedido: mesa, productos elegidos, notas que escribas al pedir, importe, fecha y hora, e idioma de la carta.",
            "No se te pide nombre, correo ni teléfono para pedir. Si pagas con tarjeta, los datos de la tarjeta los trata directamente Stripe Payments Europe Ltd. como proveedor de pago: ni el establecimiento ni SuarEx llegan a verlos ni a almacenarlos.",
            "Se usa una cookie técnica (“suarex_mesa”) que recuerda desde qué mesa escaneaste el QR, durante 12 horas. Sin ella no se puede pedir. No sirve para perfilar ni para publicidad.",
          ],
        },
        {
          titulo: "Para qué y con qué base",
          parrafos: [
            "Para atender tu pedido, imprimir la comanda en cocina y cobrar: base jurídica, la ejecución del contrato (art. 6.1.b RGPD).",
            "Para cumplir las obligaciones contables y fiscales del establecimiento: cumplimiento de una obligación legal (art. 6.1.c RGPD).",
          ],
        },
        {
          titulo: "Cuánto se conservan",
          parrafos: [
            "Las notas que escribes al pedir se borran a los 90 días: son texto libre y no hacen falta pasado el servicio.",
            "El resto de datos del pedido se conservan 24 meses y después se eliminan, sin perjuicio de los plazos que la normativa fiscal imponga al establecimiento sobre sus propios registros contables.",
          ],
        },
        {
          titulo: "Destinatarios",
          parrafos: [
            "SuarEx Soluciones Digitales (encargado del tratamiento) y Stripe Payments Europe Ltd. (procesamiento del pago). No se ceden datos a nadie más ni se realizan transferencias internacionales fuera de las que Stripe declara en su propia política.",
          ],
        },
        {
          titulo: "Tus derechos",
          parrafos: [
            `Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad dirigiéndote al establecimiento: ${quien}.`,
            "También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es) si consideras que el tratamiento no se ajusta a la normativa.",
          ],
        },
      ],
    };
  }

  if (slug === "aviso-legal") {
    return {
      titulo: "Aviso legal",
      secciones: [
        {
          titulo: "Titular",
          parrafos: [
            `Este sitio es la carta digital de ${quien}.`,
            "La plataforma técnica que lo sirve es propiedad de SuarEx Soluciones Digitales, que la opera como proveedor del establecimiento.",
          ],
        },
        {
          titulo: "Condiciones de uso",
          parrafos: [
            "El acceso a la carta es libre. Para realizar un pedido hay que escanear el código QR de una mesa del establecimiento: sin ese escaneo se puede consultar la carta, pero no pedir.",
            "Los precios y la disponibilidad de los productos los fija y actualiza el establecimiento.",
          ],
        },
        {
          titulo: "Propiedad intelectual",
          parrafos: [
            "Los textos, fotografías y marcas del catálogo pertenecen al establecimiento. El software de la plataforma pertenece a SuarEx Soluciones Digitales.",
          ],
        },
      ],
    };
  }

  return {
    titulo: "Condiciones del servicio",
    secciones: [
      {
        titulo: "Qué es este servicio",
        parrafos: [
          `Una carta digital que permite pedir y pagar desde la mesa de ${d.businessName}. El pedido se envía a la cocina del establecimiento, que es quien lo prepara y lo sirve.`,
        ],
      },
      {
        titulo: "Pago y justificante",
        parrafos: [
          "El pago con tarjeta se procesa a través de Stripe. Al terminar recibes un justificante de pedido con el desglose de lo que has pedido.",
          "Ese justificante no es una factura. Si necesitas factura, pídesela al establecimiento: es él quien la emite.",
        ],
      },
      {
        titulo: "Incidencias, cambios y devoluciones",
        parrafos: [
          `Cualquier incidencia con un pedido —un producto que no llega, un error en la comanda o una devolución— se resuelve directamente con el establecimiento: ${quien}. SuarEx presta el soporte técnico de la plataforma, no atiende el servicio de sala.`,
        ],
      },
    ],
  };
}
```

- [ ] **Paso 4: ejecutar y ver que pasa**

```bash
pnpm --filter @suarex/web exec vitest run lib/legal-content.test.ts
```

Esperado: PASS los tres.

- [ ] **Paso 5: la página que las sirve**

`apps/web/app/legal/[documento]/page.tsx`:

```tsx
import { parseBranding } from "@suarex/config";
import { getTenantSettings } from "@suarex/db";
import { notFound } from "next/navigation";
import { documentoLegal, esDocumentoLegal } from "@/lib/legal-content";
import { requireTenant } from "@/lib/tenant-context";
import styles from "../legal.module.css";

/**
 * Las tres páginas legales del tenant, en una sola ruta. El slug se valida contra la lista
 * cerrada de `esDocumentoLegal` ANTES de tocar nada: un slug desconocido es 404, nunca una
 * página vacía servida con 200.
 */
export default async function LegalPage({ params }: { params: Promise<{ documento: string }> }) {
  const { documento } = await params;
  if (!esDocumentoLegal(documento)) notFound();

  const tenant = await requireTenant();
  const settings = await getTenantSettings(tenant.id).catch(() => null);
  const fiscal = (settings?.fiscal ?? {}) as {
    legalName?: string;
    cif?: string;
    address?: string;
    phone?: string;
  };

  const doc = documentoLegal(documento, {
    // `requireTenant()` devuelve solo `{ id, slug }` (apps/web/lib/tenant-context.ts:3): el
    // proxy no propaga el nombre en cabeceras. Mismo respaldo que la carta, page.tsx:78-79.
    businessName: parseBranding(settings?.branding).name ?? tenant.slug,
    legalName: fiscal.legalName,
    cif: fiscal.cif,
    address: fiscal.address,
    phone: fiscal.phone,
  });

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{doc.titulo}</h1>
      {doc.secciones.map((seccion) => (
        <section key={seccion.titulo} className={styles.section}>
          <h2 className={styles.sectionTitle}>{seccion.titulo}</h2>
          {seccion.parrafos.map((parrafo) => (
            <p key={parrafo} className={styles.paragraph}>
              {parrafo}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
```

`apps/web/app/legal/legal.module.css`:

```css
.page {
	max-width: 44rem;
	margin: 0 auto;
	padding: 2rem 1.25rem 4rem;
	line-height: 1.6;
}

.title {
	font-size: 1.6rem;
	margin: 0 0 1.5rem;
}

.section {
	margin: 0 0 1.75rem;
}

.sectionTitle {
	font-size: 1.05rem;
	margin: 0 0 0.5rem;
}

.paragraph {
	margin: 0 0 0.75rem;
	font-size: 0.95rem;
}
```

- [ ] **Paso 6: comprobar en el navegador**

Levanta el servidor con `preview_start` (nunca con bash) y abre
`http://garum.localhost:3000/legal/privacidad`, `/legal/aviso-legal`, `/legal/condiciones`.
Comprueba que `/legal/inventado` responde 404.

- [ ] **Paso 7: commit**

```bash
pnpm lint:fix && pnpm typecheck
git add apps/web/lib/legal-content.ts apps/web/lib/legal-content.test.ts apps/web/app/legal
git commit -m "feat(legal): privacidad, aviso legal y condiciones por tenant

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Los enlaces, donde el comensal los tiene que ver

Una página legal que nadie enlaza no cumple nada. Dos sitios: el pie de la carta y el paso
de pago (donde se entregan los datos).

> **Decisión de diseño (tomada, no la re-abras).** El pie va en `app/[mesa]/page.tsx`, junto a
> `<CartPanelHost />` y `<ScanToOrderHint />`, **no dentro de cada tema y no en
> `contract.test.tsx`**. Dos razones:
>
> 1. Es el precedente que ya existe en el fichero: el panel del carrito lo monta la página
>    precisamente porque «un tema que se lo saltara dejaría a ese cliente sin forma de pagar»
>    (page.tsx:154-156). El acceso a la política de privacidad es del mismo tipo.
> 2. Montado ahí, ningún tema **puede** saltárselo — garantía estructural, más fuerte que un
>    test. Y el contrato no podría verlo aunque quisiéramos: su helper `render` monta
>    exclusivamente `<CartProvider>{Theme(p)}</CartProvider>` (contract.test.tsx:100-110), así
>    que nada pintado fuera del tema entra en ese HTML.
>
> La garantía se comprueba con e2e, que sí renderiza la página entera.

**Ficheros:**
- Crear: `apps/web/app/[mesa]/LegalFooter.tsx`, `apps/web/app/[mesa]/legal-footer.module.css`
- Modificar: `apps/web/app/[mesa]/page.tsx` (montar el pie dentro de `<CartProvider>`, junto a
  `<CartPanelHost />`, línea ~175)
- Modificar: `apps/web/lib/i18n.ts` (etiquetas del pie y aviso del paso de pago, es/en/pt)
- Modificar: `apps/web/app/[mesa]/cart/CartPanel.tsx` y `apps/web/app/[mesa]/cart/cart.module.css`
- Test: `tests/e2e/legal.spec.ts` (nuevo)

**Interfaces:**
- Consume: `DOCUMENTOS_LEGALES` (Task 5), `Strings` (Task 2 ya lo amplió).
- Produce: `<LegalFooter strings={t} />`. Nada que consuman tareas posteriores.

- [ ] **Paso 1: las cadenas, primero**

Son textos de plataforma de cara al comensal, así que van en `Strings` (es/en/pt) como el
resto — el propio contrato de temas vigila que no se escriba castellano a pelo
(contract.test.tsx:249-260, «no escribe en español los textos de la plataforma»).

En el tipo `Strings` (apps/web/lib/i18n.ts:87-132):

```ts
  legalPrivacy: string;
  legalNotice: string;
  legalTerms: string;
  /** Aviso de consentimiento informado, junto al botón de pagar. */
  legalPayNote: string;
```

En `ES`:

```ts
  legalPrivacy: "Privacidad",
  legalNotice: "Aviso legal",
  legalTerms: "Condiciones",
  legalPayNote: "Al pedir aceptas las condiciones y la política de privacidad.",
```

En `EN`:

```ts
  legalPrivacy: "Privacy",
  legalNotice: "Legal notice",
  legalTerms: "Terms",
  legalPayNote: "By ordering you accept the terms and the privacy policy.",
```

En `PT`:

```ts
  legalPrivacy: "Privacidade",
  legalNotice: "Aviso legal",
  legalTerms: "Condições",
  legalPayNote: "Ao pedir aceitas as condições e a política de privacidade.",
```

- [ ] **Paso 2: escribir el test que falla**

`tests/e2e/legal.spec.ts` (nuevo). El e2e es quien puede ver el pie, porque renderiza la
página entera:

```ts
import { expect, test } from "@playwright/test";

test("la carta enlaza las tres páginas legales", async ({ page }) => {
  await page.goto("/1");
  const pie = page.getByTestId("legal-footer");
  await expect(pie).toBeVisible();
  await expect(pie.getByRole("link", { name: "Privacidad" })).toHaveAttribute(
    "href",
    "/legal/privacidad",
  );
});

test("cada página legal se sirve bajo el host del tenant, y un slug inventado es 404", async ({
  page,
  request,
}) => {
  for (const slug of ["privacidad", "aviso-legal", "condiciones"]) {
    await page.goto(\`/legal/\${slug}\`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  const res = await request.get("http://garum.localhost:3000/legal/inventado", {
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(404);
});
```

- [ ] **Paso 3: ejecutarlo y ver que falla**

```bash
pnpm test:e2e tests/e2e/legal.spec.ts
```

Esperado: FAIL — timeout esperando `legal-footer`.

- [ ] **Paso 4: implementar el pie**

`apps/web/app/[mesa]/LegalFooter.tsx`:

```tsx
import type { Strings } from "@/lib/i18n";
import { DOCUMENTOS_LEGALES } from "@/lib/legal-content";
import styles from "./legal-footer.module.css";

/**
 * Pie legal de la carta. Lo monta `page.tsx`, NO cada tema: mismo criterio que
 * `<CartPanelHost />` (ver page.tsx:154-156). Un tema decide cómo se ve la carta; nunca si el
 * comensal puede llegar a la política de privacidad de su restaurante.
 */
export function LegalFooter({ strings: t }: { strings: Strings }) {
  const etiquetas: Record<(typeof DOCUMENTOS_LEGALES)[number], string> = {
    privacidad: t.legalPrivacy,
    "aviso-legal": t.legalNotice,
    condiciones: t.legalTerms,
  };

  return (
    <footer className={styles.footer} data-testid="legal-footer">
      {DOCUMENTOS_LEGALES.map((slug) => (
        <a key={slug} className={styles.link} href={\`/legal/\${slug}\`}>
          {etiquetas[slug]}
        </a>
      ))}
    </footer>
  );
}
```

`apps/web/app/[mesa]/legal-footer.module.css`:

```css
.footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  justify-content: center;
  padding: 2rem 1rem 1.5rem;
  font-size: 0.75rem;
}

.link {
  color: inherit;
  opacity: 0.65;
  text-decoration: underline;
}
```

En `apps/web/app/[mesa]/page.tsx`, dentro de `<CartProvider>` y **fuera** de `<Theme />`:

```tsx
      <CartPanelHost />
      <ScanToOrderHint />
      <LegalFooter strings={strings(lang)} />
```

- [ ] **Paso 5: el aviso en el paso de pago**

El botón de pagar vive en `apps/web/app/[mesa]/cart/CartPanel.tsx:151-171`
(`data-testid="cart-pay"` en :164). Añade debajo del botón, dentro del `<footer>`:

```tsx
        <p className={styles.payLegalNote}>
          <a href="/legal/condiciones">{t.legalTerms}</a>
          {" · "}
          <a href="/legal/privacidad">{t.legalPrivacy}</a>
          <span className={styles.payLegalText}>{t.legalPayNote}</span>
        </p>
```

y la clase a `apps/web/app/[mesa]/cart/cart.module.css` (no existe hoy):

```css
.payLegalNote {
  margin: 0.5rem 0 0;
  font-size: 0.7rem;
  line-height: 1.35;
  text-align: center;
  color: color-mix(in srgb, var(--color-fg) 60%, transparent);
}

.payLegalText {
  display: block;
}
```

- [ ] **Paso 6: ejecutar y ver que pasa**

```bash
pnpm test:e2e tests/e2e/legal.spec.ts
pnpm --filter @suarex/web exec vitest run
pnpm typecheck
```

Esperado: PASS. El contrato de temas (`contract.test.tsx`) sigue verde SIN tocarlo: el pie no
es suyo. Si algún e2e falla por el cambio de layout, ajusta su selector — no escondas el pie.

- [ ] **Paso 7: commit**

```bash
pnpm lint:fix
git add "apps/web/app/[mesa]" apps/web/lib/i18n.ts tests/e2e/legal.spec.ts
git commit -m "feat(legal): pie legal en la carta y aviso en el paso de pago

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Retención — borrar lo que ya no hace falta

La política de privacidad promete 90 días para las notas y 24 meses para el pedido. Una
promesa que nadie ejecuta es peor que no hacerla.

**Ficheros:**
- Crear: `supabase/migrations/20260915000001_purge_order_personal_data.sql`
- Modificar: `packages/db/src/client.ts` (RPC), `packages/db/src/orders.ts`, `packages/db/src/index.ts`
- Crear: `apps/web/app/api/internal/purge-orders/route.ts`
- Crear: `deploy/scripts/purge-orders.sh`
- Test: `tests/integration/purge-orders.test.ts`

**Interfaces:**
- Consume: nada de tareas anteriores.
- Produce: `purgeOrderPersonalData(notesDays?: number, ordersMonths?: number):
  Promise<{ notasBorradas: number; pedidosBorrados: number }>`, exportada desde `@suarex/db`.

- [ ] **Paso 1: escribir la migración**

`supabase/migrations/20260915000001_purge_order_personal_data.sql`:

```sql
-- RETENCIÓN DE DATOS DEL COMENSAL.
--
-- La política de privacidad que se publica al comensal (ver apps/web/lib/legal-content.ts)
-- promete dos plazos. Esta función los ejecuta; sin ella la promesa es falsa.
--
--   1. `order_items.notes` a los 90 días. Es el ÚNICO campo de texto libre que escribe el
--      comensal, y por tanto el único donde puede acabar un dato personal que nadie pidió
--      ("para la alérgica", "mesa de Marta"). Se anula el campo, no se borra la línea: el
--      restaurante conserva qué se vendió.
--   2. El pedido entero a los 24 meses. `on delete cascade` de order_items/order_item_extras
--      se encarga del resto.
--
-- SECURITY DEFINER y concedida SOLO a service_role: es mantenimiento de la plataforma, no
-- una operación de negocio de ningún tenant, y por eso no filtra por tenant_id -- barre
-- TODOS por igual, que es justo lo que la retención exige.
create or replace function public.purge_order_personal_data(
  p_notes_days int default 90,
  p_orders_months int default 24
)
returns table (notas_borradas int, pedidos_borrados int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notas int;
  v_pedidos int;
begin
  if p_notes_days < 1 or p_orders_months < 1 then
    raise exception 'Los plazos de retención deben ser positivos (dias=%, meses=%)',
      p_notes_days, p_orders_months;
  end if;

  update public.order_items oi
     set notes = null
    from public.orders o
   where oi.order_id = o.id
     and oi.notes is not null
     and o.created_at < now() - make_interval(days => p_notes_days);
  get diagnostics v_notas = row_count;

  delete from public.orders
   where created_at < now() - make_interval(months => p_orders_months);
  get diagnostics v_pedidos = row_count;

  return query select v_notas, v_pedidos;
end;
$$;

revoke execute on function public.purge_order_personal_data (int, int) from public, anon, authenticated;
grant execute on function public.purge_order_personal_data (int, int) to service_role;
```

- [ ] **Paso 2: escribir el test que falla**

`tests/integration/purge-orders.test.ts`:

```ts
import { purgeOrderPersonalData } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce, seedCatalog } from "./helpers/tenants.js";

describe("purgeOrderPersonalData", () => {
  it("anula las notas viejas y conserva la línea de venta", async () => {
    const fixture = await createTenantFixture(`purga-${nonce()}`);
    // `seedCatalog(tenantId, label)` — dos strings, no la fixture (helpers/tenants.ts:227).
    const seed = await seedCatalog(fixture.tenantId, "purga");

    // Envejecer el pedido sembrado 200 días: por encima de los 90 de las notas, por debajo
    // de los 24 meses del borrado completo.
    await admin
      .from("orders")
      .update({ created_at: new Date(Date.now() - 200 * 86400_000).toISOString() })
      .eq("id", seed.orderId);
    await admin.from("order_items").update({ notes: "para la alérgica" }).eq("id", seed.orderItemId);

    await purgeOrderPersonalData();

    const { data } = await admin
      .from("order_items")
      .select("id, notes")
      .eq("id", seed.orderItemId)
      .maybeSingle();

    expect(data?.notes, "la nota debía anularse a los 90 días").toBeNull();
    expect(data?.id, "la línea de venta NO debe borrarse: el restaurante la necesita").toBe(
      seed.orderItemId,
    );

    await deleteTenantFixture(fixture);
  });

  it("rechaza un plazo no positivo en vez de barrerlo todo", async () => {
    // Un 0 por descuido en el cron borraría la base entera. Falla cerrado.
    await expect(purgeOrderPersonalData(0, 24)).rejects.toThrow(/positivos/);
  });
});
```

- [ ] **Paso 3: ejecutarlo y ver que falla**

```bash
pnpm db:reset
pnpm vitest run --config vitest.config.ts tests/integration/purge-orders.test.ts
```

Esperado: FAIL — `purgeOrderPersonalData is not exported`.

- [ ] **Paso 4: implementar el repositorio**

En `packages/db/src/client.ts`, junto a `expirePendingOrdersRpc`:

```ts
/**
 * MISMA EXENCIÓN QUE `expirePendingOrdersRpc`. `purge_order_personal_data` es SECURITY
 * DEFINER, es mantenimiento de retención (no una operación de negocio de ningún tenant) y se
 * concede solo a `service_role`. Acotado por firma a `purgeOrderPersonalData` (`src/orders.ts`),
 * que lo llama el endpoint de cron.
 */
export function purgeOrderPersonalDataRpc(notesDays: number, ordersMonths: number) {
  return serviceClient().rpc("purge_order_personal_data", {
    p_notes_days: notesDays,
    p_orders_months: ordersMonths,
  });
}
```

En `packages/db/src/orders.ts`:

```ts
/**
 * Ejecuta los plazos de retención que la política de privacidad promete al comensal (90 días
 * las notas, 24 meses el pedido). Lo dispara el cron del sistema vía
 * `/api/internal/purge-orders`, igual que `expirePendingOrders`.
 */
export async function purgeOrderPersonalData(
  notesDays = 90,
  ordersMonths = 24,
): Promise<{ notasBorradas: number; pedidosBorrados: number }> {
  const { data, error } = await purgeOrderPersonalDataRpc(notesDays, ordersMonths);
  if (error) throw error;
  const fila = (data as { notas_borradas: number; pedidos_borrados: number }[] | null)?.[0];
  return {
    notasBorradas: fila?.notas_borradas ?? 0,
    pedidosBorrados: fila?.pedidos_borrados ?? 0,
  };
}
```

Añade `purgeOrderPersonalDataRpc` al import de `./client.js` en `orders.ts`, y
`purgeOrderPersonalData` al bloque `export { ... } from "./orders.js"` de `index.ts`
(en orden alfabético, que es como está el resto).

- [ ] **Paso 5: ejecutar y ver que pasa**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/purge-orders.test.ts
```

Esperado: PASS los dos.

- [ ] **Paso 6: el endpoint de cron**

`apps/web/app/api/internal/purge-orders/route.ts` — copia literal del patrón de
`apps/web/app/api/internal/expire-orders/route.ts` (mismo `CRON_SECRET`, misma comparación
con `timingSafeEqualStr`, mismo fallo cerrado a 503 sin secreto), cambiando solo la llamada:

```ts
  try {
    const resultado = await purgeOrderPersonalData();
    return NextResponse.json(resultado);
  } catch (error) {
    console.error("[cron:purge-orders] Error aplicando la retención:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
```

Y `deploy/scripts/purge-orders.sh`, copia de `expire-orders.sh` apuntando a
`/api/internal/purge-orders`, con el cron sugerido en su cabecera:

```bash
#   15 4 * * * CRON_SECRET=xxx APP_URL=https://<host-de-un-tenant> /ruta/deploy/scripts/purge-orders.sh
```

> **Ojo con `APP_URL`:** el proxy resuelve tenant por Host para TODAS las rutas salvo
> `api/tls-check` (ver el `matcher` al final de `apps/web/proxy.ts`). Un `APP_URL` que sea el
> dominio raíz (`suarex.app`) hace que `findTenantByHost` devuelva `null` y el endpoint
> responda 404 sin ejecutar nada, en silencio. Usa el host de un tenant, o espera a la Task 15
> (host de plataforma) y apunta ahí. **Verifica lo mismo en el cron de `expire-orders` que ya
> está instalado en el VPS**: si está apuntando al dominio raíz, lleva tiempo sin barrer nada.

- [ ] **Paso 7: commit**

```bash
pnpm lint:fix && pnpm typecheck
git add supabase/migrations/20260915000001_purge_order_personal_data.sql packages/db/src apps/web/app/api/internal/purge-orders deploy/scripts/purge-orders.sh tests/integration/purge-orders.test.ts
git commit -m "feat(legal): retención de datos del comensal (90 días notas, 24 meses pedido)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Bloque C — Correo y credenciales

Cierra el hueco 3 del spec. La Task 8 es prerrequisito de la 9 y la 10.

### Task 8: SMTP, y la lista de redirecciones que lo hace multi-tenant

Sin SMTP, Supabase Auth no manda ni invitaciones ni recuperaciones: las tareas 9 y 10 no
tienen forma de entregar nada. Y en una plataforma multi-tenant hay un segundo requisito que
se olvida siempre: GoTrue solo redirige a URLs de su lista blanca, y aquí cada cliente vive
en un host distinto.

**Ficheros:**
- Modificar: `deploy/supabase-override.yml` (variables de GoTrue)
- Modificar: `deploy/.env.app.example` y el `.env` de la stack de Supabase en el VPS
- Modificar: `deploy/README.md` (sección nueva de correo)

**Interfaces:**
- Produce: un GoTrue capaz de enviar correo y de redirigir a `https://<slug>.<raíz>/staff/*`.
  Las tareas 9 y 10 dependen de ambas cosas.

- [ ] **Paso 1: elegir proveedor y obtener credenciales**

Resend, Postmark o Brevo. Verifica el dominio (SPF + DKIM) antes de seguir: un correo de
recuperación que cae en spam es indistinguible, para el camarero, de uno que no se envió.

- [ ] **Paso 2: configurar GoTrue**

En el `.env` de la stack de Supabase del VPS:

```bash
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=<clave-del-proveedor>
SMTP_ADMIN_EMAIL=no-reply@suarex.app
SMTP_SENDER_NAME=SuarEx

# CRÍTICO EN MULTI-TENANT: cada cliente vive en su propio subdominio, así que el enlace de
# recuperación apunta a un host distinto para cada uno. Sin el comodín aquí, GoTrue descarta
# el `redirectTo` y manda a todo el mundo a SITE_URL -- el host equivocado, donde la sesión
# no vale.
#
# OJO CON LOS NOMBRES: son SITE_URL y ADDITIONAL_REDIRECT_URLS, **no** GOTRUE_SITE_URL ni
# GOTRUE_URI_ALLOW_LIST. El compose oficial solo propaga al contenedor de auth la lista de
# GOTRUE_* que él conoce: un GOTRUE_* suelto en el .env se ignora SIN ERROR. Ya está
# documentado en deploy/README.md:175 y deploy/supabase-override.yml:40-43 ("Comprobado en la
# instalación real").
SITE_URL=https://suarex.app
ADDITIONAL_REDIRECT_URLS=https://*.suarex.app/**
```

Y el equivalente LOCAL, que es contra el que corren los tests de las tareas 9 y 10. Hoy
`supabase/config.toml:154-158` tiene `site_url = "http://127.0.0.1:3000"` y
`additional_redirect_urls = ["https://127.0.0.1:3000"]`, así que el `redirectTo` a
`http://garum.localhost:3000/staff/nueva-clave` se descarta y GoTrue cae a `site_url`:

```toml
additional_redirect_urls = ["https://127.0.0.1:3000", "http://garum.localhost:3000/**", "http://manuela.localhost:3000/**"]
```

- [ ] **Paso 3: levantar y verificar con un envío real**

En el VPS el override no se llama `supabase-override.yml`: se copia como
`docker-compose.override.yml` y `COMPOSE_FILE` ya lo carga (deploy/README.md:135-140). El
`-p supabase` no es opcional — fija el nombre de la red (deploy/README.md:184):

```bash
cd /opt/suarex-supabase
docker compose -p supabase up -d --force-recreate auth
docker compose -p supabase logs --tail=100 -f auth
```

Comprueba que las variables llegaron de verdad al contenedor, que es donde se ve si el
compose las propagó o las tragó:

```bash
docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -iE 'URI_ALLOW|SITE_URL|SMTP_HOST'
```

Desde el navegador, en `/staff/login` de un tenant real, provoca una recuperación (tras la
Task 9) o usa la Admin API para invitar a una dirección tuya. **Verificación: el correo llega
a la bandeja, no a spam, y su enlace apunta al host del tenant, no a `suarex.app`.**

- [ ] **Paso 4: documentarlo**

**No añadas una sección nueva**: `deploy/README.md` ya documenta esto con los nombres
correctos — el proveedor SMTP como prerrequisito (:24), los seis `SMTP_*` (:157-162) y la nota
del comodín (:152-155). Añadir el bloque del plan como sección aparte dejaría dos bloques
contradictorios en el mismo documento. Revisa y completa la sección `Editar .env` existente, y
añade ahí la línea de `docker inspect` del paso 3 como verificación.

- [ ] **Paso 5: commit**

```bash
git add deploy/
git commit -m "chore(deploy): SMTP y lista de redirecciones multi-tenant para Auth

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Recuperación de contraseña para el personal

**Ficheros:**
- Crear: `apps/web/app/staff/recuperar/page.tsx` y `actions.ts`
- Crear: `apps/web/app/staff/nueva-clave/page.tsx`
- Modificar: `apps/web/app/staff/login/page.tsx` (enlace)
- Test: `tests/e2e/staff-recuperar.spec.ts`

**Interfaces:**
- Consume: GoTrue con SMTP y comodín de redirección (Task 8).
- Produce: rutas `/staff/recuperar` y `/staff/nueva-clave`. La Task 10 reutiliza
  `/staff/nueva-clave` como destino de la invitación.

- [ ] **Paso 1: escribir el test que falla**

`tests/e2e/staff-recuperar.spec.ts`. **La CLI 2.98.1 ya no arranca Inbucket sino Mailpit**
(imagen `public.ecr.aws/supabase/mailpit:v1.22.3`, contenedor `supabase_inbucket_<proyecto>`,
puerto 54324 — comprobado contra el servicio vivo). La API de Inbucket
(`/api/v1/mailbox/<buzon>`) devuelve **404**; hay que usar la de Mailpit, cuyo
`/api/v1/messages` responde un OBJETO `{total, messages: [...]}`, no un array:

```ts
import { expect, test } from "@playwright/test";

const INBUCKET = process.env.INBUCKET_URL ?? "http://127.0.0.1:54324";

test("el camarero pide un enlace de recuperación y recibe el correo", async ({ page, request }) => {
  const email = "staff@garum.local"; // sembrado por `pnpm seed:staff`
  const buzon = email.split("@")[0];

  // Vaciar el buzón antes, para no leer un correo de una ejecución anterior.
  // Mailpit: DELETE sin cuerpo borra todo.
  await request.delete(`${INBUCKET}/api/v1/messages`);

  await page.goto("http://garum.localhost:3000/staff/recuperar");
  await page.getByLabel("Correo").fill(email);
  await page.getByRole("button", { name: "Enviar enlace" }).click();

  // Mensaje idéntico exista o no la cuenta: lo contrario convierte esta página en un
  // comprobador de qué correos tienen cuenta en este restaurante.
  await expect(page.getByTestId("recuperar-enviado")).toBeVisible();

  await expect
    .poll(
      async () =>
        (await (await request.get(`${INBUCKET}/api/v1/search?query=to:${email}`)).json())
          .messages.length,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
});

test("un correo sin cuenta recibe exactamente la misma respuesta", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/staff/recuperar");
  await page.getByLabel("Correo").fill("nadie-aqui@example.com");
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByTestId("recuperar-enviado")).toBeVisible();
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm test:e2e tests/e2e/staff-recuperar.spec.ts
```

Esperado: FAIL — 404 en `/staff/recuperar`.

- [ ] **Paso 3: implementar la petición**

`apps/web/app/staff/recuperar/actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { staffServerClient } from "@/lib/supabase-server";
import { requireTenant } from "@/lib/tenant-context";

/**
 * Envía el enlace de recuperación. SIEMPRE devuelve el mismo resultado, exista la cuenta o
 * no: distinguirlos convertiría esta página en un comprobador de qué correos tienen cuenta
 * en este restaurante. Mismo criterio que `resolveStaffSession`, que no distingue entre sus
 * cinco motivos de fallo.
 *
 * `redirectTo` se construye con el HOST DE ESTA PETICIÓN, no con una URL de configuración: el
 * camarero tiene que volver al subdominio de SU restaurante, porque la sesión que abre el
 * enlace solo vale ahí. Requiere el comodín de `GOTRUE_URI_ALLOW_LIST` (Task 8).
 */
export async function pedirRecuperacion(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;

  const tenant = await requireTenant();
  const host = (await headers()).get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";

  const client = await staffServerClient();
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${proto}://${host}/staff/nueva-clave`,
  });

  // El error NO se propaga a la UI (revelaría si la cuenta existe), pero sí al log: un SMTP
  // caído tiene que ser diagnosticable desde el servidor.
  if (error) console.error(`[staff:recuperar] Fallo enviando a tenant ${tenant.slug}:`, error);
}
```

`apps/web/app/staff/recuperar/page.tsx`: formulario con `<label>Correo</label>`, un
`<input name="email" type="email" required>`, un botón "Enviar enlace" con
`action={pedirRecuperacion}`, y — tras enviar — un bloque
`data-testid="recuperar-enviado"` con el texto "Si esa dirección tiene cuenta, te hemos
enviado un enlace. Revisa también la carpeta de spam." (usa `useActionState` o un
`?enviado=1` en la URL; lo segundo funciona sin JavaScript, que es el patrón del resto de la
app).

- [ ] **Paso 4: implementar la pantalla de nueva contraseña**

`apps/web/app/staff/nueva-clave/page.tsx`: client component. El formulario pide la contraseña
dos veces, rechaza antes de llamar si no coinciden o si tiene menos de 8 caracteres, llama a
`supabase.auth.updateUser({ password })` y termina en `router.replace("/staff")`.

**Esta pantalla sirve a DOS flujos distintos y no puede tratarlos igual** (esto vale también
para la Task 10, que la reutiliza):

- **Recuperación** (`resetPasswordForEmail`) usa PKCE: el enlace trae `?code=` y el cliente de
  navegador lo canjea solo... pero solo si encuentra el *code verifier* que guardó al pedirlo,
  y ese verificador vive en una cookie **del navegador que rellenó el formulario**
  (`_isPKCECallback` exige `params.code` Y el contenido de storage). Si el camarero pide el
  enlace en el ordenador de la caja y abre el correo en el móvil — el caso normal en
  hostelería — no hay sesión y la pantalla no puede hacer nada.
- **Invitación** (`inviteUserByEmail`) **no soporta PKCE** — está escrito en el propio
  `GoTrueAdminApi.d.ts`: «Note that PKCE is not supported when using inviteUserByEmail». GoTrue
  devuelve los tokens en el fragmento (`#access_token=…&type=invite`), pero el cliente de
  `@supabase/ssr` fuerza `flowType: "pkce"` y auth-js lanza `AuthPKCEGrantCodeExchangeError`
  ("Not a valid PKCE flow url") ante un callback implícito. Resultado: la página monta sin
  sesión y `updateUser` falla con "Auth session missing".

Camino robusto para los dos: **no dependas del canje automático**. Lee `token_hash` y `type`
de la URL y canjea explícitamente con `supabase.auth.verifyOtp({ token_hash, type })`, con
`type` = `"invite"` o `"recovery"` según venga. Y si no hay ni `token_hash` ni sesión, pinta
un error explícito ("Este enlace ha caducado o se abrió en otro navegador; pide uno nuevo"),
nunca una pantalla muda.

Añade en `/staff/login/page.tsx` el enlace: `<a href="/staff/recuperar">¿Olvidaste tu contraseña?</a>`.

- [ ] **Paso 5: ejecutar y ver que pasa**

```bash
pnpm test:e2e tests/e2e/staff-recuperar.spec.ts tests/e2e/staff-auth.spec.ts
```

Esperado: PASS los tres tests.

- [ ] **Paso 6: commit**

```bash
pnpm lint:fix && pnpm typecheck
git add apps/web/app/staff tests/e2e/staff-recuperar.spec.ts
git commit -m "feat(staff): recuperación de contraseña por correo

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Alta de personal por invitación, no por contraseña tecleada

Hoy `createStaff` recibe `{ email, password }` y el gestor tiene que inventar una contraseña,
escribirla en un formulario y dictársela al camarero. Tres sitios donde una contraseña en
claro viaja sin necesidad.

**Ficheros:**
- Modificar: `packages/db/src/admin-staff.ts:3-72`
- Modificar: `apps/web/app/admin/personal/actions.ts` y su formulario
- **Borrar**: `apps/web/lib/staff-action-input.ts` y `apps/web/lib/staff-action-input.test.ts`
  (su única exportación es `parseStaffPassword`; sin contraseña el módulo queda vacío y el test
  no resuelve el import)
- Modificar: `apps/web/app/admin/personal/actions.ts` (quitar el import de `parseStaffPassword`)
- Test: `tests/integration/admin-staff.test.ts`

**Interfaces:**
- Consume: GoTrue con SMTP (Task 8), ruta `/staff/nueva-clave` (Task 9).
- Produce: `createStaff(tenantId, { email, redirectTo })` — `CreateStaffInput` pierde
  `password` y gana `redirectTo: string`. `CreateStaffResult` no cambia.

- [ ] **Paso 1: escribir el test que falla**

En `tests/integration/admin-staff.test.ts`:

```ts
it("crea al camarero SIN contraseña y le deja la cuenta pendiente de invitación", async () => {
  const fixture = await createTenantFixture(`invita-${nonce()}`);
  const email = `camarero-${nonce()}@example.com`;

  const resultado = await createStaff(fixture.tenantId, {
    email,
    redirectTo: "http://garum.localhost:3000/staff/nueva-clave",
  });

  expect(resultado.email).toBe(email);

  // La cuenta existe y tiene su membership de staff, pero aún no ha confirmado: hasta que
  // el camarero abra el enlace no hay contraseña que nadie haya tecleado ni dictado.
  const { data: membership } = await admin
    .from("memberships")
    .select("role")
    .eq("user_id", resultado.userId)
    .eq("tenant_id", fixture.tenantId)
    .maybeSingle();
  expect(membership?.role).toBe("staff");

  await deleteTenantFixture(fixture);
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/admin-staff.test.ts
```

Esperado: FAIL — `Property 'redirectTo' does not exist on type 'CreateStaffInput'`.

- [ ] **Paso 3: implementar**

En `packages/db/src/admin-staff.ts`:

```ts
export type CreateStaffInput = {
  email: string;
  /** A dónde vuelve el camarero al abrir el enlace de la invitación: el host de SU
   *  restaurante + `/staff/nueva-clave`. Lo construye la Server Action a partir del Host de
   *  la petición, no de una constante: la sesión que abre ese enlace solo vale en ese host. */
  redirectTo: string;
};
```

y dentro de `createStaff`, sustituye la llamada a `createUser({ email, password, ... })` por:

```ts
  // `inviteUserByEmail` crea la cuenta Y manda el correo en una sola llamada. La cuenta
  // queda sin contraseña hasta que el camarero abre el enlace y fija la suya: ninguna
  // contraseña se teclea en un formulario del gestor, se dicta por teléfono ni se apunta en
  // un papel detrás de la barra.
  const { data, error } = await authAdminForStaffCreation().inviteUserByEmail(input.email, {
    redirectTo: input.redirectTo,
  });
```

El resto de `createStaff` (crear la `membership` con rol `staff`, y su manejo del caso
"ya existía la cuenta") se mantiene igual, atado a `data.user.id`.

- [ ] **Paso 4: quitar la contraseña del formulario**

Borra `apps/web/lib/staff-action-input.ts` y `apps/web/lib/staff-action-input.test.ts` enteros
(su única exportación es `parseStaffPassword`) y quita su import de
`apps/web/app/admin/personal/actions.ts`. Ahí, construye el `redirectTo` igual que en la Task 9
(`headers().get("host")`) y pásalo. En el formulario de `/admin/personal`, quita el campo de
contraseña y cambia el texto del botón a "Invitar", con la nota: "Le llegará un correo para
que ponga su propia contraseña."

**Migra los cuatro tests que ya viven en `tests/integration/admin-staff.test.ts`** (líneas 29,
46, 60, 64 y 78 pasan `password`): sin eso no compilan y `pnpm typecheck` falla. Uno no se
arregla borrando el campo — el de :27-42 hace `signInWithPassword` de verdad con esa
contraseña para comprobar que el JWT trae `tenant_id`/`tenant_role=staff`. Con una cuenta
invitada no hay contraseña: fija una con `admin.auth.admin.updateUserById(userId, { password })`
justo después de invitar, y deja esa aserción de claims intacta.

- [ ] **Paso 5: ejecutar y ver que pasa**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/admin-staff.test.ts
pnpm --filter @suarex/web exec vitest run lib/staff-action-input.test.ts
pnpm test:e2e tests/e2e/admin-d3.spec.ts
pnpm typecheck
```

Esperado: PASS. `tests/e2e/admin-d3.spec.ts` es más que un `fill` de más: en :97 rellena
"Contraseña (mín. 8)" y en :103-106 borra las cookies e **inicia sesión como el camarero recién
creado** con esa contraseña para comprobar que aterriza en `/staff`. Con alta por invitación esa
contraseña no existe. Decide y déjalo escrito: lo más barato es terminar el test en la fila
`staff-member` visible y mover la cobertura del login del camarero a un test de integración que
fije la contraseña con `updateUserById`. Extenderlo con el flujo real (leer Mailpit + completar
`/staff/nueva-clave`) es trabajo aparte y depende del paso 4 de la Task 9.

- [ ] **Paso 6: commit**

```bash
pnpm lint:fix
git add packages/db/src/admin-staff.ts apps/web/lib/staff-action-input.ts apps/web/app/admin/personal tests/
git commit -m "feat(personal): alta por invitación por correo, sin contraseña tecleada

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Bloque D — Suscripción y corte por impago

Cierra el hueco 1 del spec. Independiente de A, B y C. Se engancha con E en la Task 18.

### Task 11: Las columnas que sostienen el estado de la suscripción

**Ficheros:**
- Crear: `supabase/migrations/20260915000002_tenant_subscription.sql`
- Modificar: `packages/db/src/types.ts` (`Tenant`, `PlanStatus`)
- Modificar: `packages/db/src/tenants.ts` (`findTenantByHost`: `.select` :18 y objeto :27-32)
- Test: `tests/integration/tenant-subscription.test.ts`

**Interfaces:**
- Produce: `tenants` gana `stripe_subscription_id`, `plan_status`, `trial_ends_at`,
  `grace_until`. `Tenant` gana `planStatus: PlanStatus`. Las tareas 12-14 y 18 las usan.

- [ ] **Paso 1: escribir la migración**

`supabase/migrations/20260915000002_tenant_subscription.sql`:

```sql
-- ESTADO DE LA SUSCRIPCIÓN DEL RESTAURANTE (lo que SuarEx le cobra a él, no lo que el
-- comensal paga por su comida -- eso vive en `orders.stripe_payment_intent_id`).
--
-- `tenants.plan` ya existía sin que nada lo leyera. Se conserva (es el NOMBRE del plan
-- contratado: 'free', 'basico', 'pro') y se le añade al lado el ESTADO de ese plan, que es
-- lo que decide si el servicio se sirve o se corta.
-- `stripe_customer_id` ya existía (20260721000001_core_tenancy.sql:13) pero SIN unicidad ni
-- índice. `applySubscriptionState` localiza el tenant por esa columna con `.maybeSingle()`,
-- que lanza PGRST116 si hubiera dos filas: la unicidad es la que hace correcto ese camino, no
-- una comodidad. Parcial porque hoy casi todos los tenants la tienen a NULL.
create unique index tenants_stripe_customer_id_idx on public.tenants (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.tenants
  add column stripe_subscription_id text unique,
  add column plan_status text not null default 'trialing'
    check (plan_status in ('trialing', 'active', 'past_due', 'canceled')),
  add column trial_ends_at timestamptz,
  -- Hasta cuándo se sigue sirviendo a un tenant que ha dejado de pagar. NUNCA se corta en el
  -- momento del impago: un rechazo de tarjeta a las 14:30 dejaría sin carta a un comedor
  -- lleno, y el coste de eso es muy superior al de una semana de servicio regalado. El
  -- webhook abre la ventana; el barrido diario (`/api/internal/suspend-overdue`) la cierra.
  add column grace_until timestamptz;

-- El barrido de gracia vencida busca exactamente por este predicado.
create index tenants_grace_expiring_idx on public.tenants (grace_until)
  where grace_until is not null and status = 'active';

comment on column public.tenants.plan_status is
  'Estado de la suscripción en Stripe. Lo escribe SOLO el webhook de facturación; nadie lo edita a mano.';
```

- [ ] **Paso 2: escribir el test que falla**

`tests/integration/tenant-subscription.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

describe("columnas de suscripción", () => {
  it("un tenant nuevo nace en trialing y activo", async () => {
    const fixture = await createTenantFixture(`sub-${nonce()}`);
    const { data } = await admin
      .from("tenants")
      .select("plan_status, status, grace_until")
      .eq("id", fixture.tenantId)
      .single();

    expect(data?.plan_status).toBe("trialing");
    expect(data?.status).toBe("active");
    expect(data?.grace_until).toBeNull();
    await deleteTenantFixture(fixture);
  });

  it("rechaza un plan_status que no sea uno de los cuatro", async () => {
    const fixture = await createTenantFixture(`sub-malo-${nonce()}`);
    const { error } = await admin
      .from("tenants")
      .update({ plan_status: "inventado" })
      .eq("id", fixture.tenantId);

    expect(error, "el CHECK debía rechazar un estado desconocido").not.toBeNull();
    await deleteTenantFixture(fixture);
  });
});
```

- [ ] **Paso 3: aplicar y ejecutar**

```bash
pnpm db:reset && pnpm db:env && pnpm seed:staff
pnpm vitest run --config vitest.config.ts tests/integration/tenant-subscription.test.ts
```

Esperado: PASS los dos.

- [ ] **Paso 4: ampliar el tipo**

En `packages/db/src/types.ts`:

```ts
/** Estado de la suscripción del restaurante, tal cual lo dicta Stripe. No confundir con
 *  `Tenant.status`, que es si el servicio se sirve o no: el primero es la causa, el segundo
 *  el efecto, y entre ambos hay una ventana de gracia deliberada. */
export type PlanStatus = "trialing" | "active" | "past_due" | "canceled";
```

y añade `planStatus: PlanStatus;` a `Tenant`, más la columna al `.select(...)` de
`findTenantByHost` (`"id, slug, name, status, plan_status"`) y al objeto que devuelve
(`planStatus: data.plan_status as PlanStatus`).

- [ ] **Paso 5: verificar que nada se rompió**

```bash
pnpm typecheck && pnpm vitest run --config vitest.config.ts tests/integration/tenant-isolation.test.ts
```

- [ ] **Paso 6: commit**

```bash
git add supabase/migrations/20260915000002_tenant_subscription.sql packages/db/src tests/integration/tenant-subscription.test.ts
git commit -m "feat(billing): columnas de estado de suscripción en tenants

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: La regla que traduce estado de Stripe a servicio servido o cortado

Toda la política de corte vive en UNA función pura, testeable sin Stripe y sin base de datos.
El webhook solo la invoca.

**Ficheros:**
- Crear: `packages/db/src/billing.ts`
- Crear: `packages/db/src/billing.test.ts`
- Modificar: `packages/db/src/client.ts` (exención #14), `packages/db/src/index.ts`
- Modificar: `packages/db/package.json` (script `test`, si aún no lo tiene)

**Interfaces:**
- Consume: `PlanStatus` (Task 11).
- Produce:
  - `decidirEstado(planStatus: PlanStatus, ahora: Date, graceUntil: Date | null):
     { status: "active" | "suspended"; graceUntil: Date | null }` — pura.
  - `applySubscriptionState(stripeCustomerId: string, planStatus: PlanStatus,
     subscriptionId: string | null): Promise<"aplicado" | "tenant-no-encontrado">`
  - `suspendExpiredGrace(): Promise<number>`
  Las tareas 13 y 14 las consumen.

- [ ] **Paso 1: escribir el test que falla**

`packages/db/src/billing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decidirEstado, DIAS_DE_GRACIA } from "./billing.js";

const AHORA = new Date("2026-09-15T12:00:00Z");

describe("decidirEstado", () => {
  it("sirve durante el trial y estando al corriente", () => {
    expect(decidirEstado("trialing", AHORA, null).status).toBe("active");
    expect(decidirEstado("active", AHORA, null).status).toBe("active");
  });

  it("un impago NO corta: abre la ventana de gracia", () => {
    // Cortar la carta en hora de comida por un rechazo de tarjeta cuesta más que una
    // semana de servicio regalado. Esta es la decisión D2 del spec, hecha código.
    const decision = decidirEstado("past_due", AHORA, null);
    expect(decision.status).toBe("active");
    expect(decision.graceUntil?.getTime()).toBe(
      AHORA.getTime() + DIAS_DE_GRACIA * 86400_000,
    );
  });

  it("un segundo impago no reinicia la ventana ya abierta", () => {
    // Stripe reintenta varias veces un recibo impagado. Si cada reintento fallido
    // extendiera la gracia, la ventana no vencería nunca.
    const yaAbierta = new Date("2026-09-18T12:00:00Z");
    expect(decidirEstado("past_due", AHORA, yaAbierta).graceUntil).toEqual(yaAbierta);
  });

  it("la gracia vencida sí corta", () => {
    const vencida = new Date("2026-09-01T12:00:00Z");
    expect(decidirEstado("past_due", AHORA, vencida).status).toBe("suspended");
  });

  it("una baja corta de inmediato y cierra la ventana", () => {
    const decision = decidirEstado("canceled", AHORA, null);
    expect(decision.status).toBe("suspended");
    expect(decision.graceUntil).toBeNull();
  });

  it("volver a estar al corriente reabre el servicio y borra la ventana", () => {
    const decision = decidirEstado("active", AHORA, new Date("2026-09-18T12:00:00Z"));
    expect(decision.status).toBe("active");
    expect(decision.graceUntil).toBeNull();
  });
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm --filter @suarex/db exec vitest run src/billing.test.ts
```

Esperado: FAIL — `Cannot find module './billing.js'`. Si `@suarex/db` no tiene script `test`,
añádele `"test": "vitest run"` y `vitest` a sus devDependencies.

- [ ] **Paso 3: implementar**

`packages/db/src/billing.ts`:

```ts
import { tenantsTableForBilling } from "./client.js";
import type { PlanStatus } from "./types.js";

/** Días que se sigue sirviendo a un tenant que ha dejado de pagar. Ver decisión D2 del spec:
 *  el corte inmediato es técnicamente más simple y comercialmente ruinoso. */
export const DIAS_DE_GRACIA = 7;

export type DecisionServicio = {
  status: "active" | "suspended";
  graceUntil: Date | null;
};

/**
 * ÚNICA fuente de verdad sobre si un tenant se sirve o se corta. Pura a propósito: la
 * política de impagos es la parte de este bloque que más se va a discutir y a cambiar, así
 * que vive donde se puede probar exhaustivamente sin Stripe, sin red y sin base de datos.
 *
 * `graceUntil` ENTRA y SALE: una ventana ya abierta no se reinicia con cada reintento fallido
 * de Stripe (si lo hiciera, nunca vencería), y se cierra en cuanto el tenant vuelve a estar
 * al corriente.
 */
export function decidirEstado(
  planStatus: PlanStatus,
  ahora: Date,
  graceUntil: Date | null,
): DecisionServicio {
  if (planStatus === "canceled") return { status: "suspended", graceUntil: null };
  if (planStatus === "trialing" || planStatus === "active") {
    return { status: "active", graceUntil: null };
  }

  // past_due
  const ventana = graceUntil ?? new Date(ahora.getTime() + DIAS_DE_GRACIA * 86400_000);
  return { status: ventana > ahora ? "active" : "suspended", graceUntil: ventana };
}

/**
 * Aplica a la base el estado que Stripe acaba de comunicar. El tenant se localiza por
 * `stripe_customer_id` porque es el único identificador que Stripe conoce: sus webhooks no
 * saben nada de tenants.
 */
export async function applySubscriptionState(
  stripeCustomerId: string,
  planStatus: PlanStatus,
  subscriptionId: string | null,
): Promise<"aplicado" | "tenant-no-encontrado"> {
  const { data: tenant, error: leer } = await tenantsTableForBilling()
    .select("id, grace_until")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (leer) throw leer;
  if (!tenant) return "tenant-no-encontrado";

  const graceActual = (tenant as { grace_until: string | null }).grace_until;
  const decision = decidirEstado(
    planStatus,
    new Date(),
    graceActual ? new Date(graceActual) : null,
  );

  const { error } = await tenantsTableForBilling()
    .update({
      plan_status: planStatus,
      status: decision.status,
      grace_until: decision.graceUntil?.toISOString() ?? null,
      ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
    })
    .eq("id", (tenant as { id: string }).id);
  if (error) throw error;

  return "aplicado";
}

/**
 * Cierra las ventanas de gracia vencidas. Lo dispara el cron diario: el webhook abre la
 * ventana, pero nadie vuelve a llamar cuando vence -- Stripe no manda un evento "han pasado
 * siete días".
 */
export async function suspendExpiredGrace(): Promise<number> {
  const { data, error } = await tenantsTableForBilling()
    .update({ status: "suspended" })
    .eq("status", "active")
    .lt("grace_until", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return (data as unknown[] | null)?.length ?? 0;
}
```

En `packages/db/src/client.ts`, junto a las otras exenciones de `tenants`:

```ts
/**
 * DECIMOCUARTA EXENCIÓN DELIBERADA, hermana de `tenantsTableForCustomDomainWrite` y separada
 * de ella por el mismo motivo por el que aquella se separó de la de lectura: cada escritura a
 * `tenants` declara qué columnas puede tocar y quién la llama.
 *
 * Único uso legítimo: `./billing.js` (`applySubscriptionState`, `suspendExpiredGrace`), que
 * escribe `plan_status`, `status`, `grace_until` y `stripe_subscription_id` a partir de lo
 * que comunica el webhook de facturación de Stripe. `tenants` no admite `tenantScoped` porque
 * no tiene columna `tenant_id` (se identifica por su propia `id`).
 *
 * Es la ÚNICA exención de este fichero cuyo filtro no es la `id` del tenant: localiza por
 * `stripe_customer_id` (columna única) porque los webhooks de Stripe no saben nada de
 * tenants -- ese identificador es todo lo que traen. Sigue siendo una fila por clave única,
 * nunca un barrido; la excepción es `suspendExpiredGrace`, que actualiza por predicado de
 * fecha a propósito (es un barrido de mantenimiento, no una operación de negocio de nadie).
 */
export function tenantsTableForBilling() {
  return serviceClient().from("tenants");
}
```

Exporta desde `index.ts`: `export { applySubscriptionState, decidirEstado, DIAS_DE_GRACIA,
suspendExpiredGrace } from "./billing.js";` y el tipo `PlanStatus` desde `./types.js`.

- [ ] **Paso 4: ejecutar y ver que pasa**

```bash
pnpm --filter @suarex/db exec vitest run src/billing.test.ts
pnpm typecheck
```

Esperado: PASS los seis.

- [ ] **Paso 5: commit**

```bash
pnpm lint:fix
git add packages/db
git commit -m "feat(billing): política de corte con ventana de gracia de 7 días

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: El webhook de facturación

Endpoint **separado** del webhook de pagos del comensal, con su propio secreto: son dos
fuentes distintas (la cuenta de plataforma y las cuentas conectadas) y mezclarlas hace que un
secreto filtrado comprometa las dos.

**Ficheros:**
- Crear: `apps/web/app/api/webhook/stripe/billing/route.ts`
- Modificar: `.env.example`, `deploy/.env.app.example`
- Test: `tests/integration/billing-webhook.test.ts`

**Interfaces:**
- Consume: `applySubscriptionState` (Task 12).
- Produce: ruta `POST /api/webhook/stripe/billing`, variable `STRIPE_BILLING_WEBHOOK_SECRET`.

- [ ] **Paso 1: escribir el test que falla**

`tests/integration/billing-webhook.test.ts`:

```ts
import { applySubscriptionState } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

describe("applySubscriptionState", () => {
  it("un impago deja el servicio en pie y abre la ventana de gracia", async () => {
    const fixture = await createTenantFixture(`wh-${nonce()}`);
    const customerId = `cus_${nonce()}`;
    await admin.from("tenants").update({ stripe_customer_id: customerId }).eq("id", fixture.tenantId);

    expect(await applySubscriptionState(customerId, "past_due", "sub_1")).toBe("aplicado");

    const { data } = await admin
      .from("tenants")
      .select("status, plan_status, grace_until")
      .eq("id", fixture.tenantId)
      .single();

    expect(data?.status, "el impago NO corta en el momento").toBe("active");
    expect(data?.plan_status).toBe("past_due");
    expect(data?.grace_until).not.toBeNull();

    await deleteTenantFixture(fixture);
  });

  it("una baja corta de inmediato", async () => {
    const fixture = await createTenantFixture(`wh-baja-${nonce()}`);
    const customerId = `cus_${nonce()}`;
    await admin.from("tenants").update({ stripe_customer_id: customerId }).eq("id", fixture.tenantId);

    await applySubscriptionState(customerId, "canceled", "sub_2");

    const { data } = await admin.from("tenants").select("status").eq("id", fixture.tenantId).single();
    expect(data?.status).toBe("suspended");
    await deleteTenantFixture(fixture);
  });

  it("distingue un cliente de Stripe sin tenant asociado", async () => {
    // No es benigno: significa que se está cobrando una suscripción de la que este sistema
    // no tiene registro, o que el webhook apunta al entorno equivocado.
    expect(await applySubscriptionState(`cus_fantasma_${nonce()}`, "active", null)).toBe(
      "tenant-no-encontrado",
    );
  });
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla o pasa**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/billing-webhook.test.ts
```

Si la Task 12 está bien hecha, estos PASAN ya: son el contrato de `applySubscriptionState`
contra la base real. Si fallan, arregla la Task 12 antes de seguir.

- [ ] **Paso 3: escribir la ruta**

`apps/web/app/api/webhook/stripe/billing/route.ts`:

```ts
import { applySubscriptionState, type PlanStatus } from "@suarex/db";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeClient } from "@/lib/stripe";

// `constructEvent` usa criptografía de Node; el runtime edge no sirve aquí.
export const runtime = "nodejs";

/**
 * WEBHOOK DE LA SUSCRIPCIÓN DEL RESTAURANTE. Endpoint y secreto SEPARADOS del webhook de
 * pagos del comensal (`../route.ts`): son dos fuentes distintas de eventos, y un secreto
 * filtrado no debe servir para falsificar los de la otra.
 *
 * Cuatro eventos, no más. `invoice.payment_failed` no se escucha: Stripe ya mueve la
 * suscripción a `past_due` y eso llega por `customer.subscription.updated`. Escuchar los dos
 * sería aplicar la misma decisión dos veces, con el riesgo de que cada camino la interprete
 * distinto.
 */
const ESTADOS: Record<string, PlanStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete_expired: "canceled",
  // `incomplete` (tarjeta pendiente de confirmar en el alta) NO se mapea: aún no ha pasado
  // nada que cambie el servicio, y tratarlo como impago cortaría a un cliente que está
  // justo terminando de darse de alta.
};

export async function POST(request: Request) {
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Sin configurar" }, { status: 500 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sin firma" }, { status: 400 });

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const planStatus =
      event.type === "customer.subscription.deleted"
        ? "canceled"
        : ESTADOS[sub.status];

    if (!planStatus) {
      // Estado que no cambia el servicio (p. ej. `incomplete`): se registra y se ignora.
      console.info(`[billing-webhook] Estado ignorado '${sub.status}' para ${sub.id}`);
      return NextResponse.json({ received: true });
    }

    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const outcome = await applySubscriptionState(customerId, planStatus, sub.id);

    // 200 en los dos casos: devolver error haría que Stripe reintentara indefinidamente algo
    // que no va a cambiar. Pero un cliente sin tenant no es benigno -- se está cobrando una
    // suscripción de la que este sistema no tiene registro, o el webhook apunta al entorno
    // equivocado -- así que se registra de forma distinguible. Mismo criterio que el webhook
    // de pagos del comensal.
    if (outcome === "tenant-no-encontrado") {
      console.error(`[billing-webhook] Cliente de Stripe sin tenant asociado: ${customerId}`);
    }
  }

  return NextResponse.json({ received: true });
}
```

Añade `STRIPE_BILLING_WEBHOOK_SECRET=` a `.env.example` y a `deploy/.env.app.example`.

- [ ] **Paso 4: probarlo contra Stripe de verdad**

```bash
stripe listen --forward-to http://garum.localhost:3000/api/webhook/stripe/billing
stripe trigger customer.subscription.updated
```

Esperado: la ruta responde 200 y el log muestra el cliente sin tenant asociado (correcto: el
cliente de prueba de Stripe no existe en tu base).

- [ ] **Paso 5: commit**

```bash
pnpm lint:fix && pnpm typecheck
git add apps/web/app/api/webhook/stripe/billing .env.example deploy/.env.app.example tests/integration/billing-webhook.test.ts
git commit -m "feat(billing): webhook de suscripción con secreto propio

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Cerrar la ventana, y avisar antes de cerrarla

Dos mitades de la misma idea: el barrido que suspende lo vencido, y el aviso en el panel para
que el cliente lo arregle antes de que le pase.

**Ficheros:**
- Crear: `apps/web/app/api/internal/suspend-overdue/route.ts`
- Crear: `deploy/scripts/suspend-overdue.sh`
- Crear: `apps/web/app/admin/BillingBanner.tsx`
- Modificar: `apps/web/app/admin/layout.tsx`
- Modificar: `packages/db/src/tenants.ts` (añadir `getTenantBillingState`)
- Modificar: `packages/db/src/index.ts` (**obligatorio**: el paquete solo expone
  `"." -> "./src/index.ts"`, sin subrutas, así que sin reexportar ahí el import de
  `apps/web` no compila; va en orden alfabético entre `findTenantByHost` y
  `getTenantCustomDomain`)
- Test: `tests/integration/suspend-overdue.test.ts`

**Interfaces:**
- Consume: `suspendExpiredGrace` (Task 12), `Tenant.planStatus` (Task 11), `requireManager`
  (ya existe).
- Produce: ruta de cron y banner. Nada que consuman tareas posteriores.

- [ ] **Paso 1: escribir el test que falla**

`tests/integration/suspend-overdue.test.ts`:

```ts
import { suspendExpiredGrace } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

describe("suspendExpiredGrace", () => {
  it("suspende al de gracia vencida y no toca al que aún está dentro", async () => {
    const vencido = await createTenantFixture(`gracia-fuera-${nonce()}`);
    const dentro = await createTenantFixture(`gracia-dentro-${nonce()}`);

    await admin
      .from("tenants")
      .update({ plan_status: "past_due", grace_until: new Date(Date.now() - 86400_000).toISOString() })
      .eq("id", vencido.tenantId);
    await admin
      .from("tenants")
      .update({ plan_status: "past_due", grace_until: new Date(Date.now() + 86400_000).toISOString() })
      .eq("id", dentro.tenantId);

    await suspendExpiredGrace();

    const { data: a } = await admin.from("tenants").select("status").eq("id", vencido.tenantId).single();
    const { data: b } = await admin.from("tenants").select("status").eq("id", dentro.tenantId).single();

    expect(a?.status).toBe("suspended");
    expect(b?.status, "un tenant todavía en gracia NO se puede cortar").toBe("active");

    await deleteTenantFixture(vencido);
    await deleteTenantFixture(dentro);
  });
});
```

- [ ] **Paso 2: ejecutarlo y ver que pasa**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/suspend-overdue.test.ts
```

Debería PASAR con la Task 12 ya hecha. Si no, arregla `suspendExpiredGrace` antes de seguir.

- [ ] **Paso 3: el endpoint de cron**

`apps/web/app/api/internal/suspend-overdue/route.ts`: mismo patrón exacto que
`expire-orders` (CRON_SECRET, `timingSafeEqualStr`, 503 sin secreto), llamando a
`suspendExpiredGrace()` y devolviendo `{ suspendidos }`. Y `deploy/scripts/suspend-overdue.sh`
copiado de `expire-orders.sh`, con el cron sugerido:

```bash
#   0 5 * * * CRON_SECRET=xxx APP_URL=https://<host-de-un-tenant> /ruta/deploy/scripts/suspend-overdue.sh
```

Aplica aquí la MISMA advertencia sobre `APP_URL` de la Task 7, **y una peor que solo afecta a
este cron**: el proxy reescribe a `/suspended` con 503 cualquier petición cuyo tenant esté
suspendido (proxy.ts:117-122), y el matcher cubre `/api/internal/*`. Si `APP_URL` apunta al
host de un tenant y ese tenant acaba suspendido — justo lo que este barrido provoca — el
endpoint deja de responder 200, el `curl -fsS` del script devuelve error y **el cron muere en
silencio para todos los demás clientes**. Se autodestruye. Usa el host de plataforma (Task 15),
o un tenant que nunca se suspenda, y déjalo escrito en la cabecera del script.

- [ ] **Paso 4: el aviso en el panel**

`apps/web/app/admin/BillingBanner.tsx`:

```tsx
/**
 * Aviso de impago en el panel del gestor. Existe porque la ventana de gracia solo sirve si el
 * cliente se entera de que está dentro de ella: siete días de silencio seguidos de un corte
 * sorpresa son peores que un corte inmediato.
 *
 * Solo se pinta en `past_due`. `trialing` no lleva aviso: un cliente en periodo de prueba no
 * debe ver una alarma roja cada vez que entra en su panel.
 */
export function BillingBanner({
  planStatus,
  graceUntil,
}: {
  planStatus: string;
  graceUntil: string | null;
}) {
  if (planStatus !== "past_due") return null;

  const fecha = graceUntil ? new Date(graceUntil).toLocaleDateString("es-ES") : null;

  return (
    <div role="alert" data-testid="billing-banner">
      <strong>No hemos podido cobrar tu suscripción.</strong>{" "}
      {fecha
        ? `Actualiza tu método de pago antes del ${fecha} para que el servicio no se interrumpa.`
        : "Actualiza tu método de pago para que el servicio no se interrumpa."}
    </div>
  );
}
```

En `apps/web/app/admin/layout.tsx`, tras `requireManager()`, lee el tenant y pinta el banner
encima de `{children}`. `findTenantByHost` ya devuelve `planStatus` desde la Task 11; para
`graceUntil` añade una lectura acotada en `packages/db/src/tenants.ts`
(`getTenantBillingState(tenantId)`, usando `tenantsTableForHostResolution()`, que ya cubre la
lectura de una fila de `tenants` por su `id`).

- [ ] **Paso 5: verificar de punta a punta**

```bash
pnpm typecheck && pnpm test:integration && pnpm test:e2e
```

Manual: pon a mano `plan_status='past_due'` y `grace_until` a mañana en un tenant local, entra
en su `/admin`, y comprueba que el aviso sale con la fecha correcta.

- [ ] **Paso 6: commit**

```bash
pnpm lint:fix
git add apps/web/app/api/internal/suspend-overdue apps/web/app/admin deploy/scripts/suspend-overdue.sh packages/db/src/tenants.ts tests/integration/suspend-overdue.test.ts
git commit -m "feat(billing): barrido de gracia vencida y aviso de impago en el panel

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Bloque E — Consola de plataforma

Cierra el hueco 2 del spec. **Las dos fronteras de seguridad de esta fase viven aquí** (F1 y
F2 del spec): léelas antes de empezar. Las tareas van en orden estricto: 15 → 16 → 17 → 18 → 19.

### Task 15: El host de plataforma, y el 404 en las dos direcciones

`admin` ya está en `RESERVED_SUBDOMAINS` (`packages/config/src/tenant-host.ts:5`), así que hoy
`parseTenantHost("admin.suarex.app", ...)` devuelve `null` y el proxy reescribe a `/not-found`.
Hay que servir ese host — y, a la vez, garantizar que `/plataforma` no se sirve jamás bajo el
host de un cliente.

**Ficheros:**
- Modificar: `packages/config/src/tenant-host.ts`, `packages/config/src/index.ts`
- Modificar: `packages/config/src/tenant-host.test.ts`
- Modificar: `apps/web/proxy.ts`
- Test: `tests/e2e/plataforma-host.spec.ts`

**Interfaces:**
- Produce: `isPlatformHost(host: string, rootDomains: string[]): boolean`, exportada desde
  `@suarex/config`. El proxy la usa; la Task 16 y siguientes dan por hecho que
  `/plataforma/*` solo se alcanza por el host de plataforma.

- [ ] **Paso 1: escribir el test que falla**

En `packages/config/src/tenant-host.test.ts`:

```ts
describe("isPlatformHost", () => {
  const RAICES = ["suarex.app", "localhost"];

  it("reconoce admin.<raíz>, con y sin puerto", () => {
    expect(isPlatformHost("admin.suarex.app", RAICES)).toBe(true);
    expect(isPlatformHost("admin.localhost:3000", RAICES)).toBe(true);
    expect(isPlatformHost("ADMIN.SuarEx.app", RAICES)).toBe(true);
  });

  it("no confunde un host de cliente con el de plataforma", () => {
    expect(isPlatformHost("garum.suarex.app", RAICES)).toBe(false);
    expect(isPlatformHost("suarex.app", RAICES)).toBe(false);
    // Un cliente con dominio propio NO puede llegar a la consola llamándose así.
    expect(isPlatformHost("admin.garum.com", RAICES)).toBe(false);
    // Ni anidando etiquetas bajo la raíz.
    expect(isPlatformHost("admin.garum.suarex.app", RAICES)).toBe(false);
    // Ni con un sufijo que solo se PAREZCA a la raíz.
    expect(isPlatformHost("admin.suarex.app.evil.com", RAICES)).toBe(false);
  });
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm --filter @suarex/config exec vitest run src/tenant-host.test.ts
```

Esperado: FAIL — `isPlatformHost is not exported`.

- [ ] **Paso 3: implementar**

En `packages/config/src/tenant-host.ts`:

```ts
/** Subdominio único de la consola de plataforma. Ya está en `RESERVED_SUBDOMAINS`, así que
 *  ningún cliente puede tener este slug: la reserva y esta constante tienen que seguir
 *  diciendo lo mismo. */
const PLATFORM_SUBDOMAIN = "admin";

/**
 * ¿Es este Host el de la consola de plataforma (`admin.<raíz>`)?
 *
 * Se compara contra las MISMAS raíces que usa `parseTenantHost`, y de forma exacta (`===`
 * sobre el host completo reconstruido), no con `startsWith` ni `includes`: un cliente con
 * dominio propio `admin.loquesea.com`, o un host `admin.suarex.app.evil.com`, no puede
 * acabar entrando en la consola por parecerse.
 */
export function isPlatformHost(host: string, rootDomains: string[]): boolean {
  const clean = host.trim().toLowerCase().split(":")[0];
  if (!clean) return false;
  return rootDomains.some(
    (root) => clean === `${PLATFORM_SUBDOMAIN}.${root.trim().toLowerCase()}`,
  );
}
```

Expórtala desde `packages/config/src/index.ts`.

- [ ] **Paso 4: enrutar en el proxy**

En `apps/web/proxy.ts`, al principio de `proxy()`, **antes** de `findTenantByHost`:

```ts
  const pathname = request.nextUrl.pathname;
  const esRutaDePlataforma = pathname === "/plataforma" || pathname.startsWith("/plataforma/");
  // El cron del sistema llega a /api/internal/* sin tenant: ni lo necesita ni lo usa. Se
  // permite por los dos hosts -- por el de plataforma (lo natural) y por el de un tenant
  // (como está instalado hoy en el VPS) -- para no romper el cron ya desplegado.
  const esRutaDeCron = pathname.startsWith("/api/internal/");

  if (isPlatformHost(host, ROOT_DOMAINS)) {
    // Bajo el host de plataforma NO se resuelve ningún tenant, y cualquier otra ruta es 404:
    // la carta, el panel del cliente y el tablero de staff no existen aquí.
    if (!esRutaDePlataforma && !esRutaDeCron) {
      return NextResponse.rewrite(new URL("/not-found", request.url), {
        status: 404,
        request: { headers: stripForgedTenantHeaders(request) },
      });
    }
    const response = NextResponse.next({ request: { headers: stripForgedTenantHeaders(request) } });
    if (esRutaDePlataforma) await refreshStaffSession(request, response);
    return response;
  }

  // LA OTRA DIRECCIÓN, y es la que importa: la consola no se sirve NUNCA bajo el host de un
  // cliente. Sin esto, `garum.suarex.app/plataforma` llegaría a la página con el tenant
  // resuelto, y toda la defensa quedaría en manos del guard de rol -- una sola barrera.
  if (esRutaDePlataforma) {
    return NextResponse.rewrite(new URL("/not-found", request.url), {
      status: 404,
      request: { headers: stripForgedTenantHeaders(request) },
    });
  }
```

- [ ] **Paso 5: el e2e de las dos direcciones**

`tests/e2e/plataforma-host.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("la consola no existe bajo el host de un cliente", async ({ request }) => {
  const res = await request.get("http://garum.localhost:3000/plataforma", {
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(res.status(), "un host de tenant NUNCA puede servir /plataforma").toBe(404);
});

test("la carta no existe bajo el host de plataforma", async ({ request }) => {
  const res = await request.get("http://admin.localhost:3000/5", { failOnStatusCode: false });
  expect(res.status()).toBe(404);
});
```

- [ ] **Paso 6: ejecutar y ver que pasa**

```bash
pnpm --filter @suarex/config exec vitest run
pnpm test:e2e tests/e2e/plataforma-host.spec.ts tests/e2e/two-tenants.spec.ts tests/e2e/cron-expire.spec.ts
```

Esperado: PASS. `two-tenants` y `cron-expire` son la red que detecta si el cambio del proxy
rompió el enrutado normal.

- [ ] **Paso 7: commit**

```bash
pnpm lint:fix && pnpm typecheck
git add packages/config apps/web/proxy.ts tests/e2e/plataforma-host.spec.ts
git commit -m "feat(plataforma): host propio para la consola, 404 en ambas direcciones

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Quién es superadmin — tabla aparte, no un rol más

**Ficheros:**
- Crear: `supabase/migrations/20260915000003_platform_admins.sql`
- Modificar: `packages/db/src/client.ts` (exención #15), `packages/db/src/index.ts`, crear
  `packages/db/src/platform.ts`
- Crear: `apps/web/lib/require-platform-admin.ts`
- Crear: `scripts/seed-platform-admin.mjs`
- Modificar: `biome.json` (**obligatorio**: `style/noRestrictedImports` prohíbe
  `@supabase/supabase-js` en nivel *error* salvo en una allowlist que enumera los scripts uno a
  uno, biome.json:25-31 y :49-58. Sin añadir el fichero nuevo ahí, `pnpm lint` falla con error
  —no es autofixable— y corta el `&&` de cualquier paso que lo encadene)
- Test: `tests/integration/platform-admins.test.ts`

**Interfaces:**
- Consume: nada de tareas anteriores.
- Produce: `isPlatformAdmin(userId: string): Promise<boolean>` desde `@suarex/db`;
  `requirePlatformAdmin(): Promise<{ userId: string }>` desde
  `@/lib/require-platform-admin`. Las tareas 17 y 18 las usan.

- [ ] **Paso 1: escribir la migración**

`supabase/migrations/20260915000003_platform_admins.sql`:

```sql
-- SUPERADMINS DE LA PLATAFORMA (el equipo de SuarEx), separados a propósito de `memberships`.
--
-- Por qué no un rol 'platform' dentro de memberships: el `custom_access_token_hook` inyecta
-- `tenant_id` y `tenant_role` en el access token a partir de la PRIMERA membership del
-- usuario. Un rol de plataforma metido ahí viajaría dentro del mismo claim que los roles de
-- tenant, y quedaría a un `if` mal escrito de distancia de confundirse con uno. Con la tabla
-- separada, un superadmin NO tiene ninguna membership, así que su JWT no lleva `tenant_id` en
-- absoluto: `resolveStaffSession` lo rechaza por construcción en cualquier superficie de
-- cliente, sin depender de ninguna comprobación añadida.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- RLS activada y SIN NINGUNA POLICY: ni `anon` ni `authenticated` pueden leer ni escribir
-- filas por PostgREST bajo ninguna circunstancia. El único acceso es `service_role`, desde
-- `packages/db/src/platform.ts`, detrás de `requirePlatformAdmin`. Que esta tabla sea
-- inaccesible desde fuera es justamente lo que impide que alguien se añada a sí mismo.
alter table public.platform_admins enable row level security;

-- El revoke NO es redundante con la RLS de arriba, y por eso lo lleva TODA tabla de este
-- esquema (core_tenancy:152, catalog:118, tables:113, orders:88, devices_printers:138...):
-- los privilegios por defecto del stack conceden `arwdDxtm` sobre cada tabla nueva de
-- `public` a anon y authenticated (verificable en `pg_default_acl`). RLS filtra filas; el
-- GRANT es lo que decide si el rol puede siquiera nombrar la tabla. Mismo patrón que
-- `pair_attempts`/`rate_limit_hits`, las otras dos tablas sin dueño de tenant.
revoke all on public.platform_admins from anon, authenticated;
```

- [ ] **Paso 2: escribir el test que falla**

`tests/integration/platform-admins.test.ts`:

```ts
import { isPlatformAdmin } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, anonClient, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

describe("platform_admins", () => {
  it("un usuario de tenant no es superadmin", async () => {
    const fixture = await createTenantFixture(`noadmin-${nonce()}`);
    expect(await isPlatformAdmin(fixture.userId)).toBe(false);
    await deleteTenantFixture(fixture);
  });

  it("la tabla es invisible para un usuario autenticado de un tenant", async () => {
    // Un owner con sesión válida no puede ni enumerar quién es superadmin, ni mucho menos
    // añadirse. RLS sin policies: no hay fila que devolver para nadie que no sea service_role.
    const fixture = await createTenantFixture(`rls-admin-${nonce()}`);
    const { data, error } = await fixture.client.from("platform_admins").select("user_id");
    expect(data ?? []).toHaveLength(0);

    const { error: escritura } = await fixture.client
      .from("platform_admins")
      .insert({ user_id: fixture.userId, email: fixture.email });
    expect(escritura, "un owner NO puede añadirse como superadmin").not.toBeNull();

    await deleteTenantFixture(fixture);
  });

  it("reconoce a quien está en la tabla", async () => {
    const email = `super-${nonce()}@suarex.app`;
    const { data: user } = await admin.auth.admin.createUser({
      email,
      password: `pw-${nonce()}`,
      email_confirm: true,
    });
    const userId = user.user!.id;
    await admin.from("platform_admins").insert({ user_id: userId, email });

    expect(await isPlatformAdmin(userId)).toBe(true);

    await admin.auth.admin.deleteUser(userId);
  });
});
```

- [ ] **Paso 3: aplicar la migración y ver que falla**

```bash
pnpm db:reset && pnpm db:env && pnpm seed:staff
pnpm vitest run --config vitest.config.ts tests/integration/platform-admins.test.ts
```

Esperado: FAIL — `isPlatformAdmin is not exported`.

- [ ] **Paso 4: implementar**

En `packages/db/src/client.ts`:

```ts
/**
 * DECIMOQUINTA EXENCIÓN DELIBERADA. `platform_admins` no tiene `tenant_id` y no puede tenerlo:
 * un superadmin no pertenece a ningún cliente, esa es toda su razón de ser (ver
 * `20260915000003_platform_admins.sql`). Acotado por firma a esa única tabla y a un único
 * llamante: `isPlatformAdmin` (`src/platform.ts`), que es una búsqueda por clave primaria --
 * una fila o ninguna, nunca un barrido.
 */
export function platformAdminsTable() {
  return serviceClient().from("platform_admins");
}
```

`packages/db/src/platform.ts`:

```ts
import { platformAdminsTable } from "./client.js";

/**
 * ¿Es este usuario del equipo de SuarEx? Búsqueda por clave primaria contra
 * `platform_admins`, que es inaccesible desde PostgREST (RLS sin policies): la única forma de
 * entrar en esa tabla es el `service_role`, y la única forma de añadirse es tener acceso al
 * servidor. Deliberado: si un superadmin pudiera darse de alta a sí mismo desde la consola,
 * comprometer una sola cuenta comprometería la plataforma entera.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data, error } = await platformAdminsTable()
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
```

Expórtala desde `index.ts`.

`apps/web/lib/require-platform-admin.ts`:

```ts
import { isPlatformAdmin } from "@suarex/db";
import { redirect } from "next/navigation";
import { staffServerClient } from "./supabase-server";

export type PlatformSession = { userId: string };

/**
 * Guard de la consola de plataforma, hermano de `requireManager` pero SIN tenant: aquí no hay
 * `hostTenant` que casar, porque el host de plataforma no resuelve ninguno (ver `proxy.ts`).
 *
 * Dos hechos independientes, los dos obligatorios: hay una sesión de Auth válida, Y ese
 * usuario está en `platform_admins`. Los dos fallos redirigen al MISMO sitio, sin
 * distinguirse: quien no es del equipo no debe poder deducir si la consola existe.
 *
 * Esta comprobación NO tiene una segunda barrera de RLS detrás: `packages/db/src/platform.ts`
 * escribe con el service role, que salta RLS por diseño. Igual que en `requireManager`, lo que
 * mantiene cerrada la consola es estructural -- este guard más el 404 del proxy bajo hosts de
 * cliente (Task 15) -- no RLS. Son dos barreras para dos amenazas distintas, ninguna es
 * backstop de la otra.
 */
export async function requirePlatformAdmin(): Promise<PlatformSession> {
  const client = await staffServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/plataforma/login");

  if (!(await isPlatformAdmin(data.user.id))) redirect("/plataforma/login");

  return { userId: data.user.id };
}
```

- [ ] **Paso 5: el script de siembra del primer superadmin**

`scripts/seed-platform-admin.mjs`. Copia el patrón de `seed-staff.mjs`, no el de
`create-tenant.mjs`: `seed-staff.mjs` NO lee `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` del
entorno, las saca de `execFileSync("supabase", ["status", "-o", "json"])` (:57-64)
«para no depender de que exista/esté actualizado .env.test», y además sabe escribir en
`.env.test` (`persistPasswordToEnvTest`, :30-43) — que es justo lo que la Task 18 necesita
para que Playwright encuentre `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_PASSWORD`. Idempotente:

```
node scripts/seed-platform-admin.mjs --email ivan@suarex.app
```

Crea la cuenta de Auth si no existe, la inserta en `platform_admins` si no está, e imprime la
contraseña generada. **Es el único camino para crear un superadmin**, a propósito: exige
acceso al servidor, no basta con una sesión en la consola.

- [ ] **Paso 6: ejecutar y ver que pasa**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/platform-admins.test.ts
pnpm vitest run --config vitest.config.ts tests/integration/tenant-isolation.test.ts
```

Esperado: PASS los tres. **Pero no te fíes de la suite de aislamiento para esta tabla**: no
comprueba «toda tabla nueva», itera lo que devuelve `list_tenant_scoped_tables()`, que solo
lista tablas de `public` **con columna `tenant_id`** (20260721000003_test_introspection.sql:19-28).
`platform_admins` no la tiene, así que queda fuera del descubrimiento y esa suite pasará sin
verificar nada de ella. Quien la cubre es `platform-admins.test.ts`, y por eso su test de
"invisible para un usuario autenticado" no es opcional.

- [ ] **Paso 7: commit**

```bash
pnpm lint:fix && pnpm typecheck
git add supabase/migrations/20260915000003_platform_admins.sql packages/db/src apps/web/lib/require-platform-admin.ts scripts/seed-platform-admin.mjs tests/integration/platform-admins.test.ts
git commit -m "feat(plataforma): tabla de superadmins y guard de la consola

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: El repositorio que sí barre entre tenants

**Ficheros:**
- Modificar: `packages/db/src/client.ts` (exenciones #16 y #17)
- Modificar: `packages/db/src/platform.ts`, `packages/db/src/index.ts`
- Test: `tests/integration/platform-tenants.test.ts`

**Interfaces:**
- Consume: `isPlatformAdmin` (Task 16), `PlanStatus` (Task 11).
- Produce:
  - `listPlatformTenants(): Promise<PlatformTenantRow[]>` con
    `{ id, slug, name, status, plan, planStatus, graceUntil, customDomain, createdAt }`
  - `createTenantWithOwner(input: { slug, name, ownerEmail, theme, locale, currency, redirectTo }):
     Promise<{ tenantId: string; ownerUserId: string }>`
  - `setTenantStatus(tenantId: string, status: "active" | "suspended"): Promise<void>`
  La Task 18 las consume.

- [ ] **Paso 1: escribir el test que falla**

`tests/integration/platform-tenants.test.ts`:

```ts
import { createTenantWithOwner, listPlatformTenants, setTenantStatus } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, nonce } from "./helpers/tenants.js";

describe("consola de plataforma", () => {
  it("da de alta un cliente completo: tenant, sede por defecto, ajustes y owner", async () => {
    const slug = `alta-${nonce()}`;
    const email = `dueno-${nonce()}@example.com`;

    const { tenantId, ownerUserId } = await createTenantWithOwner({
      slug,
      name: "Bar de Prueba",
      ownerEmail: email,
      theme: "generic",
      locale: "es",
      currency: "EUR",
      redirectTo: `http://${slug}.localhost:3000/staff/nueva-clave`,
    });

    const { data: venue } = await admin
      .from("venues")
      .select("is_default, timezone")
      .eq("tenant_id", tenantId)
      .single();
    expect(venue?.is_default, "sin sede por defecto no se puede crear un pedido").toBe(true);

    const { data: settings } = await admin
      .from("tenant_settings")
      .select("theme, locale")
      .eq("tenant_id", tenantId)
      .single();
    expect(settings?.theme).toBe("generic");

    const { data: membership } = await admin
      .from("memberships")
      .select("role")
      .eq("user_id", ownerUserId)
      .eq("tenant_id", tenantId)
      .single();
    expect(membership?.role).toBe("owner");

    await admin.auth.admin.deleteUser(ownerUserId);
    await admin.from("tenants").delete().eq("id", tenantId);
  });

  it("es idempotente por slug: un reintento no duplica ni revienta", async () => {
    const slug = `idem-${nonce()}`;
    const email = `dueno-${nonce()}@example.com`;
    const entrada = {
      slug,
      name: "Bar Idempotente",
      ownerEmail: email,
      theme: "generic",
      locale: "es",
      currency: "EUR",
      redirectTo: `http://${slug}.localhost:3000/staff/nueva-clave`,
    };

    const primero = await createTenantWithOwner(entrada);
    const segundo = await createTenantWithOwner(entrada);
    expect(segundo.tenantId).toBe(primero.tenantId);

    await admin.auth.admin.deleteUser(primero.ownerUserId);
    await admin.from("tenants").delete().eq("id", primero.tenantId);
  });

  it("lista todos los tenants, no los de uno", async () => {
    const filas = await listPlatformTenants();
    expect(Array.isArray(filas)).toBe(true);
    // El seed trae garum y manuela: la consola tiene que verlos a los dos.
    expect(filas.length).toBeGreaterThanOrEqual(2);
    expect(filas.map((f) => f.slug)).toContain("garum");
  });

  it("suspende y reactiva", async () => {
    // NUNCA sobre `garum`: es el tenant del que cuelga TODA la suite e2e
    // (playwright.config.ts fija `baseURL: http://garum.localhost:3000` y lo usa como URL de
    // readiness del webServer). Si este test abortara entre el suspend y el reactivate, el
    // proxy pasaría a responder 503 para ese host (proxy.ts:117-122) y la suite e2e entera
    // caería apuntando a otro sitio -- y con `retry: 2` el reintento arrancaría ya suspendido.
    // Fixture propia y try/finally.
    const fixture = await createTenantFixture(`estado-${nonce()}`);
    try {
      await setTenantStatus(fixture.tenantId, "suspended");
      const { data } = await admin
        .from("tenants")
        .select("status")
        .eq("id", fixture.tenantId)
        .single();
      expect(data?.status).toBe("suspended");

      await setTenantStatus(fixture.tenantId, "active");
      const { data: tras } = await admin
        .from("tenants")
        .select("status")
        .eq("id", fixture.tenantId)
        .single();
      expect(tras?.status).toBe("active");
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});
```

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/platform-tenants.test.ts
```

Esperado: FAIL — `createTenantWithOwner is not exported`.

- [ ] **Paso 3: las dos exenciones**

En `packages/db/src/client.ts`:

```ts
/**
 * DECIMOSEXTA EXENCIÓN DELIBERADA, y la ÚNICA de todo el paquete que barre de verdad: devuelve
 * `tenants` sin filtro de ninguna clase, para leer TODAS las filas y para insertar una nueva.
 *
 * Es inevitable y es el punto: la consola de plataforma es, por definición, la superficie que
 * mira por encima de todos los clientes. No hay forma de expresarla sin esto, y fingir lo
 * contrario (p. ej. pidiendo un `tenantId` que luego se ignora) sería peor: escondería en una
 * firma tranquilizadora lo que aquí está escrito a la vista.
 *
 * Lo que la mantiene acotada NO es la firma, entonces, sino su único llamante: `src/platform.ts`,
 * consumido exclusivamente desde `app/plataforma/**`, que a su vez está detrás de DOS barreras
 * independientes -- el 404 del proxy para cualquier host que no sea el de plataforma
 * (`apps/web/proxy.ts`, Task 15) y `requirePlatformAdmin()` (Task 16). Cualquier llamante nuevo
 * a esta función es un fallo de revisión: si hace falta tocar `tenants` desde otro sitio, se
 * declara su propia exención estrecha, como `tenantsTableForBilling`.
 */
export function tenantsTableForPlatformConsole() {
  return serviceClient().from("tenants");
}

/**
 * DECIMOSÉPTIMA EXENCIÓN DELIBERADA, mismo razonamiento que `authAdminForStaffCreation`: el
 * alta de un cliente crea la cuenta de Auth de su PRIMER owner -- el huevo y la gallina que el
 * panel no puede resolver, porque para crear personal ya hace falta un owner. No hay tabla que
 * filtrar (es la Admin API de Auth). Acotado por firma a `createTenantWithOwner`
 * (`src/platform.ts`); no se reutiliza la de staff para que cada punto que crea cuentas sea
 * rastreable a un único llamante.
 */
export function authAdminForPlatformConsole() {
  return serviceClient().auth.admin;
}
```

- [ ] **Paso 4: implementar el repositorio**

Añade a `packages/db/src/platform.ts`:

```ts
export type PlatformTenantRow = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  plan: string;
  planStatus: PlanStatus;
  graceUntil: string | null;
  customDomain: string | null;
  createdAt: string;
};

export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  const { data, error } = await tenantsTableForPlatformConsole()
    .select("id, slug, name, status, plan, plan_status, grace_until, custom_domain, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((f) => ({
    id: f.id as string,
    slug: f.slug as string,
    name: f.name as string,
    status: f.status as "active" | "suspended",
    plan: f.plan as string,
    planStatus: f.plan_status as PlanStatus,
    graceUntil: (f.grace_until as string | null) ?? null,
    customDomain: (f.custom_domain as string | null) ?? null,
    createdAt: f.created_at as string,
  }));
}

export async function setTenantStatus(
  tenantId: string,
  status: "active" | "suspended",
): Promise<void> {
  const { error } = await tenantsTableForPlatformConsole()
    .update({ status })
    .eq("id", tenantId);
  if (error) throw error;
}

export type CreateTenantInput = {
  slug: string;
  name: string;
  ownerEmail: string;
  theme: string;
  locale: string;
  currency: string;
  /** Host del nuevo cliente + `/staff/nueva-clave`: a donde vuelve el dueño al abrir la
   *  invitación. Lo construye la Server Action a partir del slug y de la raíz configurada. */
  redirectTo: string;
};

/**
 * Alta completa de un cliente: tenant, sede por defecto, ajustes y primer owner invitado.
 *
 * IDEMPOTENTE por `slug` y por correo, igual que `scripts/create-tenant.mjs` (al que sustituye):
 * un reintento tras un fallo a mitad reutiliza lo que ya exista y crea lo que falte, en vez de
 * reventar contra la unicidad y dejar un alta a medias que hay que limpiar a mano.
 *
 * El orden importa: la sede por defecto se crea SIEMPRE, porque sin `venues.is_default` no se
 * puede crear ningún pedido (`createPendingOrder` la exige) y el cliente tendría una carta que
 * no deja pedir.
 */
export async function createTenantWithOwner(
  input: CreateTenantInput,
): Promise<{ tenantId: string; ownerUserId: string }> {
  const existente = await tenantsTableForPlatformConsole()
    .select("id")
    .eq("slug", input.slug)
    .maybeSingle();
  if (existente.error) throw existente.error;

  let tenantId = (existente.data as { id: string } | null)?.id ?? null;
  if (!tenantId) {
    const { data, error } = await tenantsTableForPlatformConsole()
      .insert({ slug: input.slug, name: input.name })
      .select("id")
      .single();
    if (error) throw error;
    tenantId = (data as { id: string }).id;
  }

  // A partir de aquí ya hay tenantId, así que TODO lo demás va por `tenantScoped`: la consola
  // no tiene ningún privilegio extra sobre las tablas del cliente.
  //
  // LEER-ENTONCES-CREAR, no upsert: `tenantScoped(...).upsert` es un INSERT ... ON CONFLICT DO
  // UPDATE sobre TODAS las columnas del payload (client.ts:109-113), así que un segundo intento
  // con el mismo slug reescribiría `branding` y `fiscal` a `{}` y borraría lo que el dueño haya
  // editado en /admin/ajustes. Idempotente significa "no duplica ni rompe", no "restablece".
  // `create-tenant.mjs` hace exactamente esto y por el mismo motivo.
  const { data: sedes } = await tenantScoped("venues", tenantId).select("id");
  if (!sedes || sedes.length === 0) {
    await tenantScoped("venues", tenantId).insert({
      name: input.name,
      slug: "principal",
      is_default: true,
      timezone: "Europe/Madrid",
    });
  }

  const { data: ajustes } = await tenantScoped("tenant_settings", tenantId).select("tenant_id");
  if (!ajustes || ajustes.length === 0) {
    await tenantScoped("tenant_settings", tenantId).insert({
      // `branding.name` NO es decorativo: la carta y el recibo pintan
      // `parseBranding(branding).name ?? tenant.slug` ([mesa]/page.tsx:79,
      // pedido/[publicToken]/page.tsx:35). Con `{}` el cliente enseñaría "bar-de-prueba" en
      // vez de "Bar de Prueba" hasta que alguien entre en ajustes. create-tenant.mjs:89 lo
      // siembra por esto mismo.
      branding: { name: input.name },
      fiscal: {},
      locale: input.locale,
      currency: input.currency,
      theme: input.theme,
      channels: ["qr-mesa"],
      updated_at: new Date().toISOString(),
    });
  }

  const invitacion = await authAdminForPlatformConsole().inviteUserByEmail(input.ownerEmail, {
    redirectTo: input.redirectTo,
  });

  // Si el correo ya tenía cuenta (reintento, o el dueño ya es cliente de otro local), la
  // invitación falla pero la cuenta existe: se recupera en vez de abortar el alta.
  // `listUsers()` sin argumentos pagina a 50 por created_at DESC: una cuenta antigua -- que es
  // EXACTAMENTE este caso, "el dueño ya es cliente de otro local" -- no sale en la primera
  // página, `ownerUserId` quedaría null y la función lanzaría DESPUÉS de haber creado ya
  // tenant + sede + ajustes, dejando un alta a medias. auth-js 2.110.7 no tiene
  // `getUserByEmail`, así que paginar es la única vía por SDK.
  let ownerUserId = invitacion.data?.user?.id ?? null;
  const buscado = input.ownerEmail.toLowerCase();
  for (let page = 1; !ownerUserId; page++) {
    const { data: lista, error } = await authAdminForPlatformConsole().listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    if (lista.users.length === 0) break;
    ownerUserId = lista.users.find((u) => u.email?.toLowerCase() === buscado)?.id ?? null;
  }
  if (!ownerUserId) throw new Error(`No se pudo crear ni recuperar la cuenta de ${input.ownerEmail}`);

  await tenantScoped("memberships", tenantId).upsert(
    { user_id: ownerUserId, role: "owner" },
    "user_id,tenant_id",
  );

  return { tenantId, ownerUserId };
}
```

Añade los imports que faltan (`tenantScoped`, `tenantsTableForPlatformConsole`,
`authAdminForPlatformConsole`, `PlanStatus`) y exporta todo desde `index.ts`.

- [ ] **Paso 5: ejecutar y ver que pasa**

```bash
pnpm vitest run --config vitest.config.ts tests/integration/platform-tenants.test.ts
pnpm vitest run --config vitest.config.ts tests/integration/tenant-filter-structural.test.ts
pnpm typecheck
```

Esperado: PASS los cuatro, y la prueba estructural sigue verde (`serviceClient` sigue sin
exportarse; las exenciones nuevas están en `client.ts`, que es donde pueden estar).

- [ ] **Paso 6: commit**

```bash
pnpm lint:fix
git add packages/db tests/integration/platform-tenants.test.ts
git commit -m "feat(plataforma): repositorio de alta y listado de clientes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: La consola: ver los clientes y dar uno de alta

**Ficheros:**
- Crear: `apps/web/app/plataforma/layout.tsx` (solo cáscara visual, SIN guard), `page.tsx`
  (empieza por `requirePlatformAdmin()`), `actions.ts`, `NuevoClienteForm.tsx`,
  `plataforma.module.css`
- Modificar: `packages/db/src/platform.ts` y `packages/db/src/index.ts`
  (`setTenantStripeCustomer`: créala y expórtala ANTES de escribir la action que la importa)
- Modificar: `packages/config/src/tenant-host.ts`, `index.ts` y `tenant-host.test.ts`
  (`validarSlugPlataforma`)
- Crear: `apps/web/app/plataforma/login/page.tsx`
- Crear: `apps/web/lib/platform-action-input.ts` y su test
- Test: `tests/e2e/plataforma.spec.ts`

**Interfaces:**
- Consume: `requirePlatformAdmin` (Task 16), `listPlatformTenants`/`createTenantWithOwner`/
  `setTenantStatus` (Task 17), `stripeClient` (ya existe), `resolveRootDomains` (ya existe).
- Produce: la consola. La Task 19 la documenta.

- [ ] **Paso 1: escribir el test que falla**

`tests/e2e/plataforma.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const BASE = "http://admin.localhost:3000";

test("sin sesión, la consola redirige al login y no filtra nada", async ({ page }) => {
  await page.goto(`${BASE}/plataforma`);
  await expect(page).toHaveURL(/\/plataforma\/login/);
  // Ni un slug de cliente puede asomar antes del guard.
  await expect(page.locator("body")).not.toContainText("garum");
});

test("con sesión de superadmin, lista los clientes", async ({ page }) => {
  await page.goto(`${BASE}/plataforma/login`);
  await page.getByLabel("Correo").fill(process.env.PLATFORM_ADMIN_EMAIL!);
  await page.getByLabel("Contraseña").fill(process.env.PLATFORM_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByTestId("tenant-row")).not.toHaveCount(0);
  await expect(page.locator("body")).toContainText("garum");
});
```

`scripts/seed-platform-admin.mjs` (Task 16) debe escribir `PLATFORM_ADMIN_EMAIL` y
`PLATFORM_ADMIN_PASSWORD` en `.env.test`, igual que `seed-staff.mjs` hace con
`STAFF_SEED_PASSWORD`, para que Playwright los encuentre.

- [ ] **Paso 2: ejecutarlo y ver que falla**

```bash
node scripts/seed-platform-admin.mjs --email super@suarex.local
pnpm test:e2e tests/e2e/plataforma.spec.ts
```

Esperado: FAIL — 404 en `/plataforma`.

- [ ] **Paso 3: validación de entrada, primero**

`apps/web/lib/platform-action-input.ts`, encima de `form-parse.ts` igual que
`settings-action-input.ts`:

```ts
import { validarSlugPlataforma } from "@suarex/config";
import { InvalidFormFieldError, requiredString } from "./form-parse";

/**
 * Entrada del alta de cliente. Se RECHAZA en el borde, no se degrada: el `slug` acaba siendo
 * el subdominio por el que se sirve ese cliente para siempre, y un valor inválido no se
 * arregla después sin migrar QRs impresos.
 */
export function parseNuevoCliente(formData: FormData): {
  slug: string;
  name: string;
  ownerEmail: string;
  theme: string;
  locale: string;
  currency: string;
} {
  const slug = requiredString(formData, "slug").trim().toLowerCase();
  if (!validarSlugPlataforma(slug)) {
    throw new InvalidFormFieldError(
      `Slug inválido: ${JSON.stringify(slug)}. Solo minúsculas, números y guiones, ` +
        "entre 3 y 40 caracteres, y no puede ser un subdominio reservado (www, api, admin, app).",
    );
  }
  const ownerEmail = requiredString(formData, "owner_email").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new InvalidFormFieldError(`Correo inválido: ${JSON.stringify(ownerEmail)}`);
  }
  return {
    slug,
    name: requiredString(formData, "name").trim(),
    ownerEmail,
    theme: requiredString(formData, "theme"),
    locale: requiredString(formData, "locale"),
    currency: requiredString(formData, "currency").toUpperCase(),
  };
}
```

`validarSlugPlataforma` va en `packages/config/src/tenant-host.ts` y **reutiliza el mismo
`RESERVED_SUBDOMAINS`** que `parseTenantHost`, no una copia: dos listas que tienen que decir
lo mismo acaban divergiendo.

```ts
export function validarSlugPlataforma(slug: string): boolean {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return false;
  return !RESERVED_SUBDOMAINS.has(slug);
}
```

Escribe su test en `packages/config/src/tenant-host.test.ts`: acepta `bar-paco`, rechaza
`Bar Paco`, `ad`, `-x`, `admin`, `api` y una cadena de 50 caracteres.

- [ ] **Paso 4: la Server Action del alta**

`apps/web/app/plataforma/actions.ts`:

```ts
"use server";

import { resolveRootDomains } from "@suarex/config";
import { createTenantWithOwner, setTenantStatus } from "@suarex/db";
import { revalidatePath } from "next/cache";
import { parseNuevoCliente } from "@/lib/platform-action-input";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { stripeClient } from "@/lib/stripe";

/**
 * Alta de cliente. TODA action de esta superficie empieza por `requirePlatformAdmin()`: aquí
 * no hay `managerAction` que lo garantice estructuralmente porque son pocas y no comparten
 * forma, pero la regla es la misma y no tiene excepciones.
 *
 * El cliente de Stripe se crea DESPUÉS del tenant, y su fallo no aborta el alta: un tenant sin
 * `stripe_customer_id` se sirve igual (nace en `trialing`) y el identificador se puede
 * enganchar luego. Al revés -- abortar el alta porque Stripe no respondió -- dejaría al cliente
 * sin carta por un problema de facturación, que es exactamente lo que la ventana de gracia
 * existe para evitar.
 */
export async function altaClienteAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const entrada = parseNuevoCliente(formData);
  const raiz = resolveRootDomains(process.env)[0];
  const proto = raiz.includes("localhost") ? "http" : "https";
  const puerto = raiz.includes("localhost") ? ":3000" : "";

  const { tenantId } = await createTenantWithOwner({
    ...entrada,
    redirectTo: `${proto}://${entrada.slug}.${raiz}${puerto}/staff/nueva-clave`,
  });

  try {
    const customer = await stripeClient().customers.create({
      email: entrada.ownerEmail,
      name: entrada.name,
      metadata: { tenant_id: tenantId, slug: entrada.slug },
    });
    await setTenantStripeCustomer(tenantId, customer.id);
  } catch (error) {
    console.error(`[plataforma] Alta de ${entrada.slug} sin cliente de Stripe:`, error);
  }

  revalidatePath("/plataforma");
}

export async function cambiarEstadoAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();
  const tenantId = String(formData.get("tenant_id") ?? "");
  const estado = String(formData.get("estado") ?? "");
  if (estado !== "active" && estado !== "suspended") return;
  await setTenantStatus(tenantId, estado);
  revalidatePath("/plataforma");
}
```

`setTenantStripeCustomer(tenantId, customerId)` va en `packages/db/src/platform.ts`, usando
`tenantsTableForPlatformConsole()`; expórtala desde `index.ts`.

- [ ] **Paso 5: las pantallas**

- `plataforma/login/page.tsx`: correo + contraseña contra Supabase Auth (mismo patrón que
  `/staff/login`), redirige a `/plataforma`.
- **El guard va en `plataforma/page.tsx`, NO en `plataforma/layout.tsx`.** En el App Router un
  `layout.tsx` envuelve todas las rutas anidadas, `/plataforma/login` incluida: con el guard ahí,
  el login redirige a sí mismo en bucle. `plataforma/layout.tsx` existe solo para la cáscara
  visual (cabecera, estilos), sin ninguna comprobación. Cada `page.tsx` de la consola que no sea
  el login empieza por `await requirePlatformAdmin()`, igual que cada Server Action.
- `plataforma/page.tsx`: tabla de `listPlatformTenants()`, una fila
  `data-testid="tenant-row"` por cliente, con slug, nombre, estado, plan, `plan_status`, fin
  de gracia y dominio propio; botón de suspender/reactivar por fila; y el formulario de alta
  (`NuevoClienteForm`) arriba.

- [ ] **Paso 6: ejecutar y ver que pasa**

```bash
pnpm --filter @suarex/config exec vitest run
pnpm --filter @suarex/web exec vitest run lib/platform-action-input.test.ts
pnpm test:e2e tests/e2e/plataforma.spec.ts tests/e2e/plataforma-host.spec.ts
```

Esperado: PASS.

- [ ] **Paso 7: commit**

```bash
pnpm lint:fix && pnpm typecheck
git add apps/web/app/plataforma apps/web/lib/platform-action-input.ts packages/config packages/db tests/
git commit -m "feat(plataforma): consola de alta y estado de clientes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Jubilar el alta por SSH y dejarlo escrito

Mientras `create-tenant.mjs` siga siendo la vía documentada, se seguirá usando — y con ella
la service key en una sesión SSH.

**Ficheros:**
- Modificar: `scripts/create-tenant.mjs` (aviso de obsolescencia)
- Modificar: `docs/migrar-un-cliente.md`, `deploy/README.md`, `CLAUDE.md`, `docs/HANDOFF.md`
- Crear: `docs/dar-de-alta-un-cliente.md`

**Interfaces:**
- Consume: la consola (Task 18).
- Produce: documentación. Nada de código.

- [ ] **Paso 1: marcar el script**

Al principio de `scripts/create-tenant.mjs`, tras el docstring:

```js
console.warn(
  "[obsoleto] El alta de clientes se hace desde la consola de plataforma: " +
    "https://admin.<tu-dominio>/plataforma. Este script se mantiene solo para la primera " +
    "instalación (cuando aún no hay superadmin) y para recuperación ante desastres.",
);
```

- [ ] **Paso 2: escribir el procedimiento**

`docs/dar-de-alta-un-cliente.md`, con: los datos que hay que pedirle al cliente antes de
empezar (razón social, CIF, dirección y teléfono para el recibo y las páginas legales), el
alta en la consola paso a paso, qué correo recibe el dueño y qué tiene que hacer con él, y los
pasos que siguen (catálogo, mesas, impresoras, emparejar el PC). Enlaza
`docs/importar-catalogo.md` y `docs/agent-desktop-validacion.md` en vez de repetirlos.

- [ ] **Paso 3: actualizar lo que quedó desfasado**

- `deploy/README.md`: sección de la consola (`admin.<dominio>`), el registro DNS que necesita
  — ya lo cubre el comodín `*` del paso 2 de ese README, confírmalo — y
  `seed-platform-admin.mjs` como paso de instalación.
- `CLAUDE.md`: en "Patrones clave", la superficie de plataforma y la separación
  `platform_admins` / `memberships`; en "Comandos", `seed-platform-admin`.
- `docs/HANDOFF.md`: estado tras la Fase 1 y qué queda (apunta al roadmap).
- `docs/migrar-un-cliente.md`: sustituye el alta manual por el enlace al documento nuevo.

- [ ] **Paso 4: verificación completa**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e
```

Esperado: las cinco en verde. **No cierres la fase con ninguna en rojo ni "en rojo por
flakiness":** el `retry:2` de la suite está para absorber ruido de entorno (WAL de Realtime,
sockets de impresora falsa, compilación en frío de Next), no para tapar un fallo real.

- [ ] **Paso 5: commit**

```bash
git add scripts/create-tenant.mjs docs deploy/README.md CLAUDE.md
git commit -m "docs: alta de clientes desde la consola, create-tenant.mjs obsoleto

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Estado de validación

Este plan pasó un pre-vuelo de validación contra el código real (2026-09-18): 6 revisores en
paralelo, un hallazgo por afirmación comprobable, y cada hallazgo sometido a tres verificadores
adversariales independientes (literal / corrección / impacto) con descarte por mayoría.

- **274 agentes, 0 errores.** 159 afirmaciones del plan confirmadas correctas.
- **73 hallazgos** sobrevivieron: 20 bloqueantes, 24 importantes, 29 menores. 16 más fueron
  descartados por los verificadores (severidad inflada, o el plan ya lo contemplaba).
- Todos los bloqueantes e importantes están corregidos en el texto de arriba.

Lo que el pre-vuelo cambió de fondo, no de forma:

- **Task 6 tenía una contradicción irresoluble**: mandaba montar el pie fuera del tema Y
  verificarlo en `contract.test.tsx`, que solo renderiza el tema. Resuelta con una decisión
  explícita (pie en `page.tsx`, garantía estructural, verificación por e2e).
- **Task 9 daba por hecho un flujo de sesión que no ocurre**: `inviteUserByEmail` no soporta
  PKCE y el cliente de `@supabase/ssr` lo fuerza, así que la pantalla de nueva clave montaba sin
  sesión. Reescrita sobre `verifyOtp`.
- **Task 17 prometía idempotencia y hacía lo contrario**: el upsert habría borrado el branding y
  los datos fiscales que el dueño hubiera editado. Cambiado a leer-entonces-crear.
- **El entorno local ya no es el que el plan suponía**: la CLI arranca Mailpit, no Inbucket, con
  otra API.

## Autorrevisión del plan

**Cobertura del spec.** Los cinco huecos tienen tareas: hueco 5 (fiscal) → tareas 1-4; hueco 4
(legal) → 5-7; hueco 3 (credenciales) → 8-10; hueco 1 (monetización) → 11-14; hueco 2
(onboarding) → 15-19. Las decisiones D1-D4 están implementadas, no solo citadas: D1 en la
tarea 3 (aviso incondicional), D2 en la 12 (`decidirEstado`, con test de que un impago no
corta), D3 en la 15-16 (host propio + tabla aparte), D4 en el alcance del documento.

Las dos fronteras de seguridad del spec están cubiertas con test propio: F1 en la tarea 15
(e2e en las dos direcciones), F2 en la 16-17 (RLS sin policies con test de que un owner no
puede leerse ni añadirse la tabla, y exenciones numeradas y documentadas).

**Riesgos conocidos, escritos donde se tropieza con ellos:**
- `APP_URL` de los crons contra el dominio raíz devuelve 404 en silencio (tareas 7 y 14).
  Revisa el cron de `expire-orders` ya instalado en el VPS.
- El texto legal de la tarea 5 es plantilla operativa, no asesoramiento jurídico: revisión de
  abogado antes de publicar con un cliente real detrás.
- La tarea 8 (SMTP) bloquea a la 9 y la 10, y depende de credenciales de un proveedor externo:
  si se retrasa, haz los bloques A, B, D y E mientras.
- La tarea 18 crea el cliente de Stripe pero **no** la suscripción: el alta deja al tenant en
  `trialing` y la suscripción se crea a mano en Stripe al firmar. Crear la suscripción desde
  la consola es la continuación natural, y no bloquea cobrar.

**Consistencia de tipos.** `PlanStatus` se define en la tarea 11 y se consume con ese nombre
en la 12, 13, 17 y 18. `ReciboFiscal` en la 3, consumido en la 4. `DatosLegales`/`Seccion` en
la 5, consumidos en la 5 y la 6. `CreateStaffInput` cambia de forma en la 10 y no lo consume
ninguna tarea posterior. `PlatformTenantRow` en la 17, consumido en la 18.

---

## Ejecución

Plan completo y guardado en `docs/superpowers/plans/2026-09-15-fase1-comercializable.md`.
Dos formas de ejecutarlo:

1. **Por subagentes (recomendada)** — un subagente nuevo por tarea, con revisión entre tareas.
   SUB-SKILL: `superpowers:subagent-driven-development`.
2. **En línea** — ejecutar las tareas en esta sesión, por lotes con puntos de revisión.
   SUB-SKILL: `superpowers:executing-plans`.
