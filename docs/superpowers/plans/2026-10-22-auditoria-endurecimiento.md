# Endurecimiento post-auditoría (2026-10-22): plan de implementación por fases

> **Para agentes (Antigravity / Claude):** ejecuta este plan **fase a fase y tarea a tarea**, en
> el orden dado. Cada tarea es una rama + PR pequeña contra `main` (`--repo
> ivangs23/suarex-platform`). No empieces una fase sin que la anterior esté mergeada. Las
> casillas (`- [ ]`) son el seguimiento: márcalas en este fichero en el mismo PR que cierra la
> tarea. Lee antes `CLAUDE.md`, `README.md` y `docs/HANDOFF.md`.

**Origen:** auditoría completa del repo el 2026-10-22 (415 commits, 606 ficheros, suite 411
integración + 112 e2e en verde según `HANDOFF.md`). El código está bien; lo que falta es el
proceso alrededor (CI, actualizaciones, backups completos) y tres puntos de deuda que van a
doler al tercer cliente (temas en código, tipos de BD a mano, validación en el borde).

**Objetivo:** que dar de alta un cliente nuevo sea una operación y no un desarrollo, que una
regresión no pueda llegar a `main` sin que lo diga una máquina, y que un VPS perdido se
recupere entero (fotos incluidas).

**Arquitectura:** NO se toca el modelo multi-tenant (`tenantScoped`, exenciones de `client.ts`,
RLS) ni el flujo del comensal. Se añade proceso (CI, Renovate), se endurece el borde (zod,
cabeceras, webhook), se generan tipos desde las migraciones, y los temas de carta pasan de
componentes por cliente a UN componente con variantes de layout + tokens en
`tenant_settings.branding`.

**Stack:** pnpm 10.33 · Turborepo · Next 16 App Router (**webpack**) · Supabase self-hosted ·
TypeScript strict · Vitest · Playwright · Biome · Electron (electron-vite + electron-builder).

## Restricciones globales (aplican a TODAS las tareas)

- **Doctrina (no negociable):** todo lo que no sean estilos se implementa para TODOS los
  clientes. Por tenant solo cambian aspecto y contenido. `apps/web/app/[mesa]/themes/contract.test.tsx`
  tiene que seguir en verde en cada PR.
- `packages/db` se consume como fuente TS sin compilar: imports NodeNext (`./x.js` -> `./x.ts`).
- Todo acceso nuevo a BD desde `packages/db` va por `tenantScoped(tabla, tenantId)` o por una
  exención **nueva, nombrada y numerada** en `packages/db/src/client.ts`. Nunca reutilizar una
  exención para un caso distinto.
- Ningún secreto (service role, Stripe secret, `CRON_SECRET`) llega al navegador, al agente ni
  a un `ARG` de build.
- Textos de cara al comensal en es/en/pt (`apps/web/lib/i18n.ts`). Panel y consola, solo es.
- Verificación antes de dar una tarea por hecha: `pnpm lint` · `pnpm typecheck` · `pnpm test` ·
  `pnpm test:integration` · `pnpm test:e2e` (los dos últimos exigen Supabase local:
  `pnpm db:start && pnpm db:reset && pnpm db:env && pnpm seed:staff`).
- Nunca levantar el dev server con bash: usa `preview_start`.
- Windows: `*.localhost` necesita las entradas de `hosts` que lista `CLAUDE.md`; tras subir
  Playwright, `pnpm exec playwright install chromium`.
- Comentarios en código: **cortos**. La justificación larga de una decisión va a
  `docs/decisions/NNNN-titulo.md` (Fase 5) y el código la referencia en una línea.
- Commits en español, imperativo, con prefijo (`feat(scope):`, `fix(scope):`, `chore(ci):`,
  `docs:`), como en `git log`.
- **Prohibido:** tocar los proyectos Supabase de producción; que el agente tenga la service
  role key; levantar el dev server con bash.

---

## Fase 0 — Red de seguridad (1 tarde). Cierra riesgos baratos ANTES de tocar código.

### Tarea 0.1 — CI en GitHub Actions: lint + typecheck + unit en cada PR

- [x] Crear `.github/workflows/ci.yml`:
  - Disparo: `pull_request` y `push` a `main`.
  - Job `verificar` en `ubuntu-latest`: `actions/checkout@v4`, `pnpm/action-setup@v4`
    (versión de `packageManager` del `package.json` raíz), `actions/setup-node@v4` con
    `node-version-file` apuntando a un `.nvmrc` nuevo (`22.12.0`, coherente con `engines`),
    cache de pnpm, `pnpm install --frozen-lockfile`, luego `pnpm lint`, `pnpm typecheck`,
    `pnpm test`.
  - `concurrency` por rama con `cancel-in-progress: true`.
  - `koffi`, `electron` y `esbuild` están en `onlyBuiltDependencies`: en CI **no** hace falta
    que compilen; si `pnpm install` intenta descargar Electron, fijar
    `ELECTRON_SKIP_BINARY_DOWNLOAD=1` en `env` del job.
- [x] Añadir `.nvmrc` con `22.12.0`.
- [ ] En GitHub, marcar `verificar` como check obligatorio para mergear en `main` (lo hace
  Iván en Settings → Branches; dejarlo anotado en el PR).
- [x] Documentar en `README.md` → "Verificación": qué corre en CI y qué sigue siendo local
  (integración y e2e hasta la Tarea 0.2).

**Aceptación:** un PR con un `any` explícito o un fallo de `tsc` sale en rojo. El workflow
termina en < 10 min.

### Tarea 0.2 — CI: integración contra Supabase en el runner (job aparte, no bloqueante al inicio)

- [x] Job `integracion` en el mismo workflow, `needs: verificar`, `continue-on-error: true`
  durante las dos primeras semanas (se quita cuando lleve 10 ejecuciones verdes seguidas).
- [x] Pasos: `supabase/setup-cli@v1` (fijar `version` a la que use Iván, ver
  `docs/HANDOFF.md` → "Portado a Windows": 2.109.1 o superior), `supabase start`,
  `pnpm db:env`, `pnpm seed:staff`, `pnpm test:integration`.
- [x] Subir `test-results/` como artefacto solo si falla (`if: failure()`). Vitest no escribe
  ahí: se vuelcan los `docker logs` del stack (acordado con Iván).
- [x] Si `AuthRetryableFetchError` aparece en el runner igual que en local tras el reset
  (gotcha de Kong en `CLAUDE.md`), añadir un paso `docker restart supabase_kong_*` entre
  `supabase start` y los tests, y dejarlo comentado con el porqué en una línea. No aparece:
  en CI no hay `db reset`, así que Kong no se queda con la IP vieja de Auth.

**Aceptación:** la suite de integración (66 ficheros) pasa en CI en < 25 min.

### Tarea 0.3 — Cabeceras anti-clickjacking y CSP en Caddy

- [x] `deploy/Caddyfile`: en los DOS bloques `header { ... }` añadir
  `X-Frame-Options "DENY"` y
  `Content-Security-Policy "frame-ancestors 'none'"`.
  El panel incrustado del agente usa `WebContentsView` (ver
  `apps/agent-desktop/src/main/web-panel.ts`), que NO es un iframe: no se rompe. El
  `TotemFlow` tampoco se incrusta. Verificar ambos leyendo el código antes de tocar nada.
- [x] No añadir una CSP completa (`script-src`, etc.) en esta tarea: Next 16 con webpack
  inyecta scripts inline y exigiría nonces; es trabajo de otra fase y no es el riesgo
  señalado.
- [x] Añadir a `tests/integration/custom-domain.test.ts` o a un test nuevo
  `tests/integration/security-headers.test.ts` una comprobación que lea `deploy/Caddyfile` y
  exija las dos cabeceras en los dos bloques (test estructural, sin levantar Caddy; sigue el
  patrón de `apps/web/lib/deploy-env.test.ts`).
- [x] `deploy/README.md`: una línea en la sección de despliegue: "tras cambiar el Caddyfile,
  `docker compose -f docker-compose.app.yml restart caddy`".

**Aceptación:** `curl -I https://<tenant>.<dominio>/admin` devuelve ambas cabeceras (lo
verifica Iván en el VPS; el test estructural lo cubre en CI).

### Tarea 0.4 — Backup: incluir los ficheros de Storage (fotos)

Hoy `deploy/scripts/backup-db.sh` vuelca `public/auth/storage` de Postgres, pero el esquema
`storage` son solo metadatos: los ficheros viven en el volumen del contenedor de Storage del
stack de Supabase (`/opt/suarex-supabase/volumes/storage` según el layout de
`deploy/README.md` §"Supabase"). Un restore hoy deja una carta sin fotos.

- [x] Localizar el volumen real leyendo `deploy/supabase-override.yml` y el `docker-compose.yml`
  oficial de `supabase/docker` (clave `storage` → `volumes`). No asumir la ruta: dejarla en
  una variable `STORAGE_DIR` del script con valor por defecto y comentario de dónde sale.
- [x] `backup-db.sh`: tras el volcado de la BD, `tar -czf "${outfile%.sql.gz}.storage.tgz" -C
  "$STORAGE_DIR" .` con el mismo `chmod 600`, misma retención (`RETENTION_DAYS`) y mismo
  `rclone copy` si `RCLONE_REMOTE` está definido. Tres ficheros por copia: datos, roles,
  storage. Con `--xattrs`: Storage guarda el tipo de cada foto en xattr y sin ellos responde
  500 (acordado con Iván tras el simulacro).
- [x] `restore-db.sh`: paso opcional que, si existe el `.storage.tgz` junto al `.sql.gz`,
  lo extrae en `STORAGE_DIR` (con confirmación explícita, igual que el resto del script).
  Se extrae con `docker cp` al contenedor de Storage: el volumen es de root y el `tar` del
  contenedor no escribe xattr (acordado con Iván).
- [x] `deploy/README.md` → "Backups": actualizar la tabla RPO/RTO y el simulacro de restore
  para que incluya las fotos; añadir la comprobación "abre la carta restaurada y ve una foto".

**Aceptación:** el simulacro de restore documentado produce una carta con fotos.

### Tarea 0.5 — Renovate para dependencias

- [x] `renovate.json` en la raíz: `extends: ["config:recommended"]`, `schedule` semanal
  (lunes madrugada Europe/Madrid), `rangeStrategy: "bump"`, agrupar `@types/*` y agrupar
  `vitest`+`@vitest/*`; **`electron` y `electron-builder` en un grupo aparte con
  `enabled: false`** hasta cerrar la Fase 4 (la subida es un proyecto, no un PR automático).
  `stripe` y `@supabase/*` con `minimumReleaseAge: "7 days"`.
- [x] Unificar `@types/node` en todos los `package.json` del workspace a la misma major (hoy
  conviven `^25` y `^26`): elegir `^26` (la del root) y correr `pnpm install`.
- [x] Documentar en `README.md` que Renovate abre PRs y que CI (Tarea 0.1) es quien los valida.

**Aceptación:** Renovate abre el issue "Dependency Dashboard" y sus PRs pasan el CI. (Con
`renovate.json` ya en `main`, Renovate se salta el PR de "Configure Renovate": acordado con
Iván.)

---

## Fase 1 — El compilador defiende el núcleo (2 días)

### Tarea 1.1 — Tipos de Supabase generados desde las migraciones

Hoy `packages/db/src/types.ts` se mantiene a mano y `createClient(url, key)` no lleva el
genérico `Database`; de ahí los `as unknown as Row[]` repartidos por `packages/db/src`
(`printer-coverage.ts`, `orders.ts`, `admin-catalog.ts`, `staff-orders.ts`, `reports.ts`,
`print-jobs.ts`, `catalog.ts`, `analytics.ts`).

- [x] Script `pnpm db:types` en el `package.json` raíz: `supabase gen types typescript --local
  --schema public > packages/db/src/database.types.ts`. Commitear el fichero generado (va en
  git: CI no debe depender de generar).
- [x] `packages/db/src/client.ts`: `createClient<Database>(...)` en `serviceClient()`. Ajustar
  los tipos de `tenantScoped` para que `table: TenantScopedTable` se tipe contra
  `Database["public"]["Tables"]` (mantener la unión explícita como `satisfies` sobre
  `keyof Database["public"]["Tables"]` para que una tabla nueva con `tenant_id` siga
  obligando a tocar la lista a propósito).
- [x] Eliminar los `as unknown as` de `packages/db/src/*.ts` uno a uno, sustituyéndolos por
  tipos derivados de `Database` (`Tables<"orders">`, etc.). Donde postgrest-js no pueda
  inferir un `select` con relaciones anidadas, dejar un cast **estrecho** (`as Row[]`, nunca
  `unknown`) con una línea de comentario.
- [x] Mantener `packages/db/src/types.ts` como capa de **dominio** (camelCase, lo que consume
  `apps/web`); solo las filas crudas pasan a `database.types.ts`. No exportar
  `database.types.ts` desde `index.ts`.
- [x] Test estructural `tests/integration/db-types-sync.test.ts`: regenera los tipos a un
  fichero temporal con el mismo comando y falla si difiere del commiteado (mensaje: "corre
  `pnpm db:types`"). Sigue el patrón de `tenant-filter-structural.test.ts`, que ya lanza
  procesos con `process.execPath` para que funcione en Windows.
- [x] `biome.json`: excluir `packages/db/src/database.types.ts` del formateador.
- [x] Añadir `pnpm db:types` al flujo de migraciones en `README.md` y `CLAUDE.md` ("tras
  añadir una migración, `pnpm db:reset && pnpm db:types`").

**Aceptación:** `grep -rn "as unknown as" packages/db/src` devuelve 0 (o cada resto está
justificado en una línea). Renombrar una columna en una migración sin regenerar tipos pone
rojo `typecheck` o `db-types-sync`.

### Tarea 1.2 — Validación con zod en el borde de las rutas API

`zod` ya está en `packages/config` (`settings.schema.ts`, `branding.ts`). Las tres rutas que
hacen `request.json()` confían en el cast: `apps/web/app/api/orders/route.ts`,
`apps/web/app/api/kiosko/orders/route.ts`, `apps/web/app/api/devices/pair/route.ts`.

- [ ] Crear `apps/web/lib/api-input.ts` con los esquemas: `orderLinesSchema` (`lines`:
  array no vacío, máx 100; `productId` uuid; `quantity` entero 1..99; `extraIds` array de
  uuid máx 20; `notes` string máx 280 o null), `kioskoOrderSchema`, `pairDeviceSchema`.
  Reusar las reglas que YA aplica `createPendingOrder` (`packages/db/src/orders.ts` →
  `OrderCartError`) para no tener dos verdades: los límites numéricos van a constantes en
  `@suarex/domain` y los importan ambos.
- [ ] Helper `parseJsonBody(request, schema)` que devuelve `{ ok, data } | { ok: false,
  response: 400 }` con el mismo texto genérico que ya usa la ruta (no filtrar detalles del
  esquema al cliente: el mensaje para el comensal sigue siendo "Petición inválida").
- [ ] Aplicar en las tres rutas. `createPendingOrder` conserva sus comprobaciones de
  dominio (producto disponible, opciones obligatorias): zod valida FORMA, el dominio valida
  NEGOCIO.
- [ ] Tests unitarios `apps/web/lib/api-input.test.ts` (forma válida, cada rechazo) y un
  caso en `tests/integration/orders.test.ts` con body malformado → 400 sin tocar la BD
  (comprobar que no se creó ninguna `orders` en estado `pending`).

**Aceptación:** un `POST /api/orders` con `quantity: "2"` o `lines: {}` devuelve 400 antes
de llegar a `findTableByToken`.

### Tarea 1.3 — Webhook de Stripe: comprobar importe y registrar eventos

`apps/web/app/api/webhook/stripe/route.ts` y `.../stripe/[slug]/route.ts` marcan `paid` por
`payment_intent_id` sin comparar `amount_received` con `orders.total`, y no guardan
`event.id` (la idempotencia se apoya en `status = 'pending'`).

- [ ] Migración `supabase/migrations/20261022000001_stripe_events.sql`: tabla
  `stripe_events (id text primary key, tenant_id uuid null, type text not null, received_at
  timestamptz not null default now())`. Sin RLS para `authenticated` ni `anon`: `revoke all`
  a ambos; solo service role escribe. Como NO lleva `tenant_id not null`, documentar en la
  propia migración por qué (es un registro técnico de plataforma, no dato de tenant) y
  comprobar que `tests/integration/tenant-isolation.test.ts` la excluye o la acepta
  (leer `helpers/policy-check.ts` antes).
- [ ] `packages/db/src/orders.ts` → `markOrderPaid(paymentIntentId, amountCents, currency,
  tenantId?)`: solo pasa a `paid` si `total_cents = amountCents` y la moneda coincide; si no,
  devuelve `"amount-mismatch"` (nuevo miembro de `MarkPaidOutcome`) y NO cambia estado.
  Revisar cómo se guarda el total (`total` numérico vs céntimos) y convertir en un solo
  sitio, con test.
- [ ] `packages/db/src/billing.ts` o fichero nuevo `stripe-events.ts`: `recordStripeEvent
  (event)` con `insert ... on conflict do nothing` y devuelve `"new" | "duplicate"`. Añadir
  la exención correspondiente en `client.ts` (tabla sin `tenant_id`), numerada y con
  docstring corto.
- [ ] En las dos rutas de webhook: tras verificar la firma, `recordStripeEvent`; si
  `duplicate`, responder 200 sin procesar. En `payment_intent.succeeded`, pasar
  `amount_received` y `currency`; si `amount-mismatch`, `log.error("stripe.importe_no_coincide",
  {...})` y responder 200 (Stripe no debe reintentar; el pedido queda `pending` y lo expira
  el cron).
- [ ] Tests: `tests/integration/stripe-webhook.test.ts` → caso duplicado (segundo envío del
  mismo `event.id` no vuelve a tocar el pedido) y caso importe distinto (pedido sigue
  `pending`, log emitido). Hay helpers de firma ya en ese fichero: reutilizarlos.
- [ ] Añadir `stripe_events` a la retención: `apps/web/app/api/internal/purge-orders/route.ts`
  borra eventos de más de 90 días.

**Aceptación:** reenviar un evento desde el dashboard de Stripe no produce efectos; un PI
cuyo importe no cuadra no marca el pedido como pagado.

---

## Fase 2 — Temas de carta data-driven (2-3 días). Dar de alta un cliente sin tocar código.

Hoy `apps/web/app/[mesa]/themes/` tiene `generic.tsx`, `garum.tsx` y `manuela.tsx` (+ tres
`.module.css`, 1.284 líneas de CSS). Cada cliente con aspecto propio = PR + deploy +
`contract.test.tsx`. El objetivo es que `generic` sea el ÚNICO componente y que Garum y
Manuela sean **datos** en `tenant_settings.branding`.

### Tarea 2.1 — Inventario de qué diferencia a cada tema (sin código)

- [ ] Leer los tres `.tsx` y los tres `.module.css`. Producir
  `docs/superpowers/specs/2026-10-22-temas-data-driven-design.md` con una tabla: para cada
  diferencia entre temas, clasificarla como **token** (color, fuente, radio, espaciado,
  imagen), **variante de layout** (p. ej. "tarjetas en rejilla vs lista", "bienvenida a
  pantalla completa vs cabecera", "categorías en pestañas vs acordeón") o **funcionalidad**
  (si aparece alguna: es una violación de la doctrina y hay que unificarla en todos).
- [ ] Listar las variantes resultantes (objetivo: ≤ 6 ejes, cada uno con 2-3 valores). Si
  un tema necesita algo que no cabe en tokens+variantes, decidir con Iván si se generaliza
  o se descarta. **Parar aquí y pedir el "sí" de Iván antes de la 2.2.**

### Tarea 2.2 — Extender `Branding` con tokens y variantes

- [ ] `packages/config/src/branding.ts`: añadir a `Branding` un bloque `tokens` (radios,
  espaciado base, sombras, `imageFit`) y un bloque `layout` con los ejes de la 2.1, cada
  uno un `z.enum`. `DEFAULT_BRANDING` = lo que hoy pinta `generic`. `parseBranding` sigue
  degradando campo a campo (un valor desconocido cae al default, nunca rompe la carta).
- [ ] `brandingToCssVars` emite también los tokens nuevos como variables CSS.
- [ ] `apps/web/lib/settings-action-input.ts` + formulario de `apps/web/app/admin/ajustes`:
  exponer los campos nuevos (selects para las variantes, inputs para tokens). Solo es.
- [ ] Tests: `packages/config/src/branding.test.ts` (parse, defaults, degradación) y
  `apps/web/lib/settings-action-input.test.ts`.

### Tarea 2.3 — Un solo componente con variantes

- [ ] `generic.tsx` y `generic.module.css`: implementar los ejes de layout con
  `data-layout-<eje>="<valor>"` en el contenedor raíz y selectores CSS por atributo; nada
  de un componente por valor. Los pasos del flujo (bienvenida, ficha, botón de pedido,
  conteo, alérgenos, selector de idioma) NO dependen de ninguna variante.
- [ ] Portar Garum y Manuela: reproducir su aspecto con tokens+variantes. Comparar con
  capturas de antes (Playwright `toHaveScreenshot` en un test nuevo
  `tests/e2e/carta-visual.spec.ts`, tolerancia baja; las capturas base se generan desde los
  temas ANTIGUOS antes de borrarlos y se commitean).
- [ ] Migración `20261022000002_branding_temas_en_datos.sql`: `update tenant_settings set
  branding = branding || '{...}'` para los tenants `garum` y `manuela` con sus tokens y
  variantes; `theme = 'generic'` para ambos. Actualizar `supabase/seed.sql` igual.
- [ ] Borrar `garum.tsx`, `manuela.tsx` y sus CSS. `themes/index.ts` queda con `generic`
  (mantener el registro y `resolveTheme` por si algún día hace falta un tema de código, pero
  el default y el único registrado es `generic`). `contract.test.tsx` pasa a recorrer
  **todas las combinaciones de variantes** (producto cartesiano de los enums), no una lista
  de temas: es la nueva garantía de la doctrina.
- [ ] `scripts/create-tenant.mjs` y `docs/dar-de-alta-un-cliente.md`: el alta acepta un
  JSON de branding (o un preset `--preset clasico|moderno`) y ya no menciona temas de código.

**Aceptación:** `garum.localhost:3000/5` y `manuela.localhost:3000/2` se ven igual que antes
(capturas), no existe ningún `.tsx` con nombre de cliente, y crear un tenant con aspecto
propio es rellenar el formulario de ajustes.

---

## Fase 3 — Rendimiento y operación (1-2 días)

### Tarea 3.1 — Caché de la carta por tenant

`apps/web/app/[mesa]/page.tsx` hace 4 lecturas a PostgREST por petición (categorías,
productos, settings, alérgenos) porque lee la cookie y es dinámica. Con 1 vCPU asignada a la
web (`deploy/docker-compose.app.yml`), un sábado de 40 mesas lo nota.

- [ ] Envolver las cuatro lecturas en `unstable_cache` (o `"use cache"` si Next 16.3 lo
  tiene estable en webpack; comprobar en la doc instalada, no de memoria) con clave por
  `tenant.id` y tag `carta:<tenantId>`. TTL 60 s como red de seguridad.
- [ ] En todas las server actions que hoy llaman `revalidatePath("/", "layout")`
  (`apps/web/app/admin/catalogo/actions.ts`, `apps/web/app/admin/ajustes/actions.ts`, y las de
  "agotado hoy" y franjas si las tienen), sustituir/añadir `revalidateTag("carta:<tenantId>")`.
  El cron de reposición de "agotado hoy" y las franjas horarias también deben invalidar:
  localizar dónde cambian y añadir la invalidación.
- [ ] La cookie de mesa y `canOrder` quedan FUERA de la caché (siguen por petición).
- [ ] Test e2e en `tests/e2e/admin-catalogo.spec.ts`: crear producto en el panel → aparece en
  la carta en la siguiente carga (ya existe un caso así; asegurarse de que sigue pasando con
  caché, es la prueba de que la invalidación funciona).

**Aceptación:** con `DEBUG` de postgrest o contando peticiones en el log, dos cargas
seguidas de la carta hacen 4 lecturas la primera y 0 la segunda; editar el catálogo
invalida.

### Tarea 3.2 — Alertas por log sin terceros

Decisión D2 de la Fase 2 (no añadir Sentry ni SaaS) se respeta: los `log.error` JSON de la
web son la única observabilidad.

- [ ] `deploy/scripts/alertas-log.sh`: lee `docker logs suarex-web-1 --since 24h`, filtra
  líneas con `"level":"error"`, agrupa por campo `msg` con conteo, y si hay alguna manda un
  correo con `mail` (misma convención que `uptime-check.sh`: `AVISO_A`, degrada a stdout si
  no hay `mail`). Prioridad alta visible arriba: `stripe.cobro_sin_pedido`,
  `stripe.importe_no_coincide`, `stripe.disputa_abierta`, `dispositivo.caido`.
- [ ] Cron diario en `deploy/README.md` junto al de backup.
- [ ] Test del parseo con un fixture de log en `deploy/scripts/` si el script crece; si cabe
  en 40 líneas de shell, basta con probarlo a mano y documentarlo.

### Tarea 3.3 — Medir la flakiness que absorbe `retry: 2`

- [ ] Vitest: reporter que cuente tests que pasaron solo en reintento (vitest expone
  `result.retryCount`; un reporter custom de 30 líneas en `tests/helpers/`). Imprimir al
  final "N tests necesitaron reintento: lista".
- [ ] Playwright: `reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]]` y
  un script `scripts/flaky-e2e.mjs` que lista los `flaky`.
- [ ] Anotar en `README.md` → "Verificación" que si un test aparece 3 veces en esa lista se
  abre issue: `retry` es para el entorno, no para bugs.

---

## Fase 4 — Electron 38+ (proyecto; 2-4 días + validación en PC real)

Electron 33.4.11 está fuera de soporte; el agente corre desatendido en el PC de cada
cliente y abre `WebContentsView` contra la web. `electron-builder` 25 → 26 y `electron-vite`
se revisan a la vez.

### Tarea 4.1 — Preparación

- [ ] Leer las notas de ruptura de Electron 34→38 (buscar en la doc oficial, no de memoria)
  y listar en un issue las que tocan al proyecto. Candidatos conocidos: cambios en
  `WebContentsView`/`BaseWindow`, `utilityProcess`, deprecaciones de `systemPreferences`, y
  el requisito de Node ABI para `koffi` (comprobar que la versión de `koffi` publica binario
  para el Node que embebe Electron 38).
- [ ] Comprobar `apps/agent-desktop/src/main/usb-sink-winspool.ts` (koffi + winspool) y
  `tray-icon.ts`, `watchdog.ts`, `web-panel.ts`, `totem-window.ts`, `updater.ts`
  (`electron-updater` 6.x compatible).

### Tarea 4.2 — Subida

- [ ] Rama `chore/electron-38`. Subir `electron`, `electron-builder`, `electron-vite`, `vite`
  en `apps/agent-desktop/package.json`; `pnpm install`; `pnpm --filter @suarex/agent-desktop
  typecheck test build`.
- [ ] Corregir lo que rompa manteniendo el comportamiento cubierto por los tests de
  `apps/agent-desktop/src/main/*.test.ts` (son unit con backends falsos: deben pasar sin
  Windows).
- [ ] Reactivar el grupo `electron` en `renovate.json` (Tarea 0.5) con `minimumReleaseAge:
  "14 days"`.

### Tarea 4.3 — Validación en Windows (Iván)

- [ ] `pnpm --filter @suarex/agent-desktop package` en Windows, instalar en un PC de prueba
  y seguir `docs/agent-desktop-validacion.md` entero: emparejar, imprimir USB y red, tótem
  con cobro, auto-update desde un feed local, watchdog (matar el proceso y ver que vuelve),
  des-emparejar.
- [ ] Solo tras eso, mergear.

---

## Fase 5 — Mantenibilidad de la base (continuo; 1 día de arranque)

### Tarea 5.1 — ADRs en vez de comentarios-ensayo

~23 % de las líneas de `apps/web` y `packages/*` son comentarios, muchos narrativos ("verificado
con curl, ver informe"). Son valiosos pero se desincronizan.

- [ ] Crear `docs/decisions/README.md` (formato: contexto / decisión / consecuencias, 20-40
  líneas) y mover ahí, numerados, los bloques largos de: `apps/web/proxy.ts` (cabeceras
  forjadas, 503 sin override, tls-check fuera del matcher), `packages/db/src/client.ts`
  (exenciones), `deploy/docker-compose.app.yml` (env que llega al proceso),
  `apps/web/next.config.ts` (webpack, `images.unoptimized`, standalone), `vitest.config.ts`
  (retry), `apps/agent-desktop/src/main/web-panel.ts` (sandbox).
- [ ] En el código dejar 1-2 líneas + `Ver docs/decisions/0007-....md`.
- [ ] Regla nueva en `CLAUDE.md`: "comentario > 8 líneas → ADR".

### Tarea 5.2 — Documentación al día

- [ ] `docs/HANDOFF.md`: actualizar con lo mergeado desde el 24-sep (PRs #50-#55: sesiones
  del panel, watchdog en Windows, login explicativo, tablero solo pagados, pago sin Link) y
  con el estado de este plan.
- [ ] Mover `docs/superpowers/plans/*` y `specs/*` anteriores a 2026-10 a
  `docs/superpowers/archivo/` con un `README.md` de una línea; dejar en `plans/` solo lo
  vivo.
- [ ] `README.md`: la sección "Verificación" referencia CI; quitar la nota de que `pnpm test`
  y `pnpm --filter @suarex/config test` son lo mismo si ya no lo son (hoy 7 paquetes tienen
  `test`).

### Tarea 5.3 — Hooks locales (opcional, si Iván quiere)

- [ ] `simple-git-hooks` + `lint-staged` con `biome check --write` en pre-commit. Nada de
  `typecheck` en el hook (lento); eso es CI.

---

## Orden y dependencias

```
Fase 0 (0.1 → 0.2 → 0.3 → 0.4 → 0.5)   una tarde; 0.3/0.4/0.5 pueden ir en paralelo tras 0.1
Fase 1 (1.1 → 1.2 → 1.3)               2 días; 1.2 y 1.3 pueden ir en paralelo tras 1.1
Fase 2 (2.1 [parar: OK de Iván] → 2.2 → 2.3)   2-3 días
Fase 3 (3.1, 3.2, 3.3 independientes)  1-2 días
Fase 4 (4.1 → 4.2 → 4.3 [Iván, Windows])        proyecto aparte, puede solaparse con 3
Fase 5 (continuo)                      arrancar tras Fase 1
```

## Definición de hecho (cada tarea)

1. Casilla marcada en este fichero, en el mismo PR.
2. `pnpm lint && pnpm typecheck && pnpm test` en verde en CI; integración y e2e en verde en
   local (o en CI cuando la 0.2 esté activa).
3. `contract.test.tsx` en verde.
4. PR pequeña, con descripción de qué cambia y qué NO cambia, y `Co-Authored-By` del agente.
5. Docs tocadas si cambia un comando, una variable de entorno o un paso operativo.
