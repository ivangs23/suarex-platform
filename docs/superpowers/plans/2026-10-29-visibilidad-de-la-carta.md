# Visibilidad de la carta pública (2026-10-29): plan de implementación por fases

> **Para agentes (Antigravity / Claude):** ejecuta este plan **fase a fase y tarea a tarea**, en
> el orden dado. Cada tarea es una rama + PR pequeña contra `main` (`--repo
> ivangs23/suarex-platform`). No empieces una fase sin que la anterior esté mergeada y, en la
> Fase 0, desplegada. Las casillas (`- [ ]`) son el seguimiento: márcalas en este fichero en el
> mismo PR que cierra la tarea. Lee antes `CLAUDE.md`, `README.md` y `docs/HANDOFF.md`.

**Origen:** auditoría de búsqueda y asistentes del 2026-10-29 sobre la carta de Garum en
producción (`garum.srv1121554.hstgr.cloud`) y su web actual en Vercel (`garumvinoteca.com`).
Informe: artefacto «Visibilidad de la carta SuarEx».

**Problema:** la carta se pinta bien en el servidor, pero la plataforma no le dice a nadie qué
es:
- `GET /` de cada cliente es un 404 con `noindex`;
- ninguna página tiene `<title>`, descripción ni Open Graph;
- `robots.txt`, `sitemap.xml` y `llms.txt` caen en el catch-all `[mesa]` y dan 404;
- no hay datos públicos del local ni datos estructurados;
- el aviso legal no identifica al titular cuando faltan los datos fiscales.

Cuando un cliente apunte su dominio al VPS, su portada pasará de indexable a 404 y el dominio
saldrá del índice.

**Objetivo:** que cualquier cliente que traiga su dominio tenga, sin configurar nada:
- una portada indexable con su carta;
- títulos y vistas previas correctos;
- `robots.txt`, `sitemap.xml` y `llms.txt` propios;
- con los datos de su local rellenos, una ficha legible por máquinas (JSON-LD
  `Restaurant` + `Menu`).

**Arquitectura:** no se toca el modelo multi-tenant ni el flujo de pedido.
- La carta pasa a tener dos entradas sobre el MISMO render de servidor: `/` (consulta, sin
  mesa) y `/{mesa}` (la de siempre, que puede pedir).
- Todo lo de metadatos son funciones puras alimentadas por los datos que la carta ya carga
  (`leerCarta`, `settingsDeLaCarta`), con test unitario cada una.
- Los datos del local son columnas nuevas en `venues`, editables desde el panel.

**Stack:** Next 16.4 App Router (**webpack**) · Supabase self-hosted · TypeScript strict ·
Vitest · Playwright · Biome. Antes de escribir metadata o rutas de metadatos, lee
`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/`
(`robots.md`, `sitemap.md`) y `.../04-functions/generate-metadata.md`. Esta versión de Next
difiere de la que conoces (ver `apps/web/AGENTS.md`).

## Restricciones globales (aplican a TODAS las tareas)

- **Doctrina (no negociable):** todo lo de este plan es funcionalidad, así que se implementa
  para TODOS los clientes. Por cliente solo cambia el contenido (nombre, lema, carta, datos del
  local). `apps/web/app/[mesa]/themes/contract.test.tsx` sigue en verde en cada PR.
- **Nada inventado en la salida pública.** El JSON-LD, el `llms.txt` y los metadatos solo
  emiten datos que el cliente ha guardado y que se ven en la página. Un dato que falta se omite;
  nunca se rellena con un valor por defecto ni con «pendiente».
- **Nada de instrucciones a asistentes** en páginas, metadatos ni `llms.txt`: solo hechos.
- `packages/db`:
  - todo acceso nuevo va por `tenantScoped(tabla, tenantId)`;
  - se consume como fuente TS: imports `./x.js` -> `./x.ts`;
  - tras una migración, `pnpm db:reset && pnpm db:types`; `database.types.ts` va en git.
- El origen público (`https://dominio-propio` o el subdominio del cliente) sale SIEMPRE de una
  sola función (tarea 0.1), nunca de cabeceras leídas a mano en cada sitio.
- Textos de cara al comensal en es/en/pt (`apps/web/lib/i18n.ts`). Panel, solo es.
- Comentarios cortos. La decisión de la tarea 0.2 lleva ADR (`docs/decisions/0009-…`), y el
  código la referencia en una línea.
- Verificación antes de dar una tarea por hecha:
  - `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:integration` · `pnpm test:e2e`;
  - los dos últimos exigen Supabase local: `pnpm db:start && pnpm db:reset && pnpm db:env &&
    pnpm seed:staff`;
  - si `seed:staff` falla con «No se pudo listar usuarios existentes: {}», es Kong
    (`docker restart supabase_kong_suarex-platform`, ver `CLAUDE.md`);
  - para lanzar un solo fichero e2e: `pnpm exec playwright test tests/e2e/<fichero>`, no
    `pnpm test:e2e -- <filtro>`, que no filtra.
- Nunca levantar el dev server con bash: usa `preview_start`.
- Commits en español, imperativo, con prefijo (`feat(carta):`, `fix(seo):`, `docs:`).
- **Prohibido:** escribir en el Supabase de producción sin el «sí» de Iván en ese paso.

---

## Fase 0 — Portada, títulos y robots. BLOQUEA el cambio de DNS de Garum.

Tres PRs. Al terminar, desplegar (`./deploy/scripts/deploy.sh`) y pasar la verificación del
final de la fase **antes** de apuntar `garumvinoteca.com` al VPS.

### Tarea 0.1 — Un solo origen público por cliente

Hoy `apps/web/lib/qr-origin.ts` (`origenDeLosQr`) decide a qué origen llevan los QR. El
canonical, el sitemap, el `robots.txt` y el JSON-LD necesitan exactamente la misma regla:
dominio propio si existe y no es desarrollo; si no, el Host de la petición.

- [x] Renombrar el módulo a `apps/web/lib/origen-publico.ts`, con la función `origenPublico`.
  Misma firma y mismos tests (mover `qr-origin.test.ts` a `origen-publico.test.ts`).
- [x] Añadir `origenPublicoDeLaPeticion(tenantId)` (en `lib/origen-publico-peticion.ts`, aparte para que el módulo puro no arrastre `next/headers` ni `@suarex/db` a sus tests): lee `headers()` y
  `getTenantCustomDomain(tenantId)` y llama a `origenPublico`. Es el único sitio que lee esas
  cabeceras para esto.
- [x] `app/admin/mesas/page.tsx` pasa a usarla. `dominioPropioRespondeAqui` se queda donde está.
- [x] Sin cambio de comportamiento: `admin-d2.spec.ts` en verde tal cual.

### Tarea 0.2 — La carta de consulta en `/`

- [x] Extraer el cuerpo de `app/[mesa]/page.tsx` a un componente de servidor
  `app/[mesa]/Carta.tsx` (`renderCarta({ tenant, mesa, query })`), con `mesa: string | null`:
  - `basePath`: `/` sin mesa, `/{mesa}` con ella;
  - `welcome.href` y los `href` del selector de idioma se construyen desde `basePath`;
  - sin mesa, `canOrder` es siempre `false` y no se lee la cookie: no hay mesa que comprobar;
  - al tema se le pasa `mesa=""`, que ya es el caso del totem («Sin mesa (totem) la columna
    queda vacía», `generic.tsx`). No hace falta tocar el tema.
- [x] `app/[mesa]/page.tsx` queda como envoltorio: valida `MESA_PATTERN`, resuelve el tenant y
  llama a `renderCarta` con la mesa.
- [x] Nuevo `app/page.tsx`: mismo envoltorio sin mesa.
  - Sin el canal `qr-mesa` encendido, `notFound()`, igual que hoy `/{mesa}`. Un cliente solo
    de totem sigue sin carta pública.
  - Sin tenant resuelto (host de plataforma o desconocido), el proxy ya reescribe a
    `/not-found`: comprobar que `/` en `admin.` sigue siendo 404.
- [x] `ScanToOrderHint` («Escanea el QR de tu mesa para pedir») ya sale cuando `canOrder` es
  `false`: verificar que sale en `/`.
- [x] ADR `docs/decisions/0009-carta-publica-en-la-raiz.md`: por qué `/` es la carta de
  consulta y no una landing aparte; por qué `/{mesa}` sigue existiendo, ya que el QR impreso
  redirige ahí y la cookie designa la mesa; y por qué un cliente sin canal QR no tiene portada.
- [x] e2e nuevo `tests/e2e/carta-publica.spec.ts`:
  - `GET /` en `garum.localhost:3000` da 200, pinta el nombre y NO pinta «Mesa». *(Ajustado:
    `/` abre en la bienvenida, como `/{mesa}`; las categorías salen tras «Entrar», en
    `/?ver=carta`, y es ahí donde se comprueban.)*;
  - `/?cat=<slug>` pinta los productos de esa categoría;
  - en `/` no hay botón de pedir, y sí el aviso de escanear el QR. También con la cookie de una
    mesa escaneada;
  - `/` en un cliente sin canal `qr-mesa` da 404 (con `withChannels` de
    `helpers/totem-db.ts`, que ya existía, restaurado en `afterEach`);
  - `/` en `admin.localhost:3000` da 404.
- [x] `qr-order.spec.ts` y `totem.spec.ts` en verde sin cambios: el flujo de pedido no se toca.

### Tarea 0.3 — Títulos, descripción, canonical y vista previa

- [ ] Función pura `metadatosDeLaCarta({ businessName, tagline, lang, idiomas, categoria,
  origen, heroUrl, mesa })` en `apps/web/lib/metadatos.ts`. Devuelve el `Metadata` de Next:
  - `title`: `{nombre} · Carta`, o `{categoría} · {nombre}` dentro de una categoría;
  - `description`: el lema del cliente en el idioma de la página. Sin lema, se omite: no se
    inventa;
  - `alternates.canonical`: `{origen}/` o `{origen}/?cat={slug}`, **también desde
    `/{mesa}`**. Así 30 mesas no son 30 copias de la carta;
  - `alternates.languages`: solo los idiomas de `availableLangs`, con `?lang=`;
  - `openGraph`: `title`, `description`, `url` canónica, `type: "website"` e `images: [heroUrl]`
    si hay foto de bienvenida.
- [ ] `generateMetadata` en `app/page.tsx` y `app/[mesa]/page.tsx` usando esa función. Leen los
  mismos datos cacheados que el render: `leerCarta` y `settingsDeLaCarta` ya están en caché por
  cliente, así que no hay lectura doble.
- [ ] `app/layout.tsx`: `metadata` por defecto con `title.template: "%s · {nombre}"` para el
  resto de páginas del cliente.
- [ ] Páginas legales: `generateMetadata` con el título del documento («Aviso legal ·
  Garum Vinoteca»).
- [ ] `robots: { index: false }` en los layouts de `/admin`, `/staff`, `/pedido`, `/totem`,
  `/plataforma` y en `/m/[token]`.
- [ ] Tests unitarios de `metadatosDeLaCarta`:
  - sin lema no hay `description`;
  - el canonical de `/7?cat=tapas` es `{origen}/?cat=tapas`;
  - solo salen los idiomas disponibles;
  - sin `heroUrl` no hay `images`.
- [ ] e2e en `carta-publica.spec.ts`: `/` tiene `<title>` con el nombre, y `/1` tiene
  `<link rel="canonical">` a `/`.

### Tarea 0.4 — `robots.txt` y `sitemap.xml` por cliente

- [ ] `app/robots.ts` (dinámico: usa `headers()`):
  - **host de cliente:** `Allow: /` y `Disallow` de `/admin`, `/staff`, `/api/`, `/pedido/`,
    `/m/` y `/totem/`. `/m/` es importante porque el token de la mesa nunca debe indexarse.
    Más `Sitemap: {origen}/sitemap.xml`;
  - **host de plataforma** (`admin.`, `api.`): `Disallow: /`;
  - crawlers de asistentes (ClaudeBot, GPTBot, OAI-SearchBot, PerplexityBot, Google-Extended):
    se rigen por la regla general (permitidos). Bloquearlos es una decisión de negocio de Iván:
    si la toma, un ajuste de plataforma, no de cliente.
- [ ] `proxy.ts`: en el host de plataforma, dejar pasar `/robots.txt`, que hoy se reescribe a
  `/not-found` como todo lo que no es `/plataforma`. Solo esa ruta, sin cabeceras de tenant.
- [ ] `app/sitemap.ts`: `{origen}/`, una URL por categoría con productos visibles
  (`{origen}/?cat={slug}`) y las tres páginas legales. Sin `/{mesa}` y sin `/m/`. Usa
  `leerCarta`. Host de plataforma o tenant sin canal QR: sitemap vacío.
- [ ] Funciones puras `reglasDeRobots(...)` y `urlsDelSitemap(...)` con test unitario. Los
  ficheros de ruta solo las llaman.
- [ ] Comprobar que las rutas estáticas `robots.txt` y `sitemap.xml` ganan al catch-all
  `[mesa]`, cuyo comentario las menciona, y actualizar ese comentario.
- [ ] e2e en `carta-publica.spec.ts`:
  - `/robots.txt` de `garum.localhost:3000` contiene `Disallow: /m/` y la línea `Sitemap:`;
  - `/robots.txt` de `admin.localhost:3000` contiene `Disallow: /`;
  - `/sitemap.xml` lista `/` y al menos una `?cat=`, y ninguna URL de mesa.

### Verificación de la Fase 0 en producción (antes del DNS)

Tras desplegar, desde cualquier terminal:

```bash
H=https://garum.srv1121554.hstgr.cloud
curl -sI $H/ | head -1                                     # 200
curl -s $H/ | grep -o '<title>[^<]*'                       # <title>Garum Vinoteca · Carta
curl -s $H/1 | grep -o 'rel="canonical"[^>]*'              # apunta a /
curl -s $H/robots.txt                                      # Disallow: /m/ + Sitemap
curl -s $H/sitemap.xml | grep -c '<loc>'                   # 1 + categorías + 3 legales
curl -s https://admin.srv1121554.hstgr.cloud/robots.txt    # Disallow: /
```

Con dominio propio, el canonical y el sitemap ya dicen `https://garumvinoteca.com/...`. Es
correcto: es el origen público del cliente aunque el DNS aún no apunte aquí.

- [ ] Verificación pasada → Iván puede apuntar el DNS de Garum (Fase 3).

---

## Fase 1 — Datos del local y ficha legible por máquinas

### Tarea 1.1 — Columnas públicas en `venues`

- [ ] Migración `supabase/migrations/2026MMDD000001_venues_ficha_publica.sql`, que añade:
  - `address_street text`, `address_postal_code text`, `address_city text`,
    `address_region text`;
  - `phone text`;
  - `opening_hours jsonb`, con forma
    `{ "mo": [["13:00","16:00"],["20:00","23:30"]], ..., "su": [] }`. Ausente = no publicado;
    `[]` = cerrado ese día;
  - un `check` de forma básica en SQL. La validación fina (formato `HH:MM`, tramos ordenados)
    va en zod en el borde (1.2).
- [ ] Sin cambios de RLS: `venues` ya es por tenant. El rol `device` sigue sin leer `venues`
  (`20260722000005_device_rls_hardening.sql`): comprobar que la migración no lo abre.
- [ ] `pnpm db:reset && pnpm db:types`.
- [ ] `packages/db/src/venues.ts`: `fichaPublicaDeLaSede(tenantId)`, que devuelve la sede por
  defecto con esos campos, y `guardarFichaPublica(tenantId, venueId, ficha)`. Ambas con
  `tenantScoped("venues", tenantId)`. Test de integración: un tenant no lee ni escribe la sede
  de otro.

### Tarea 1.2 — Editar la ficha en el panel

- [ ] `app/admin/ajustes`: fieldset «Ficha pública del local». Con varias sedes, un selector de
  sede, como `TableForm`. Campos:
  - dirección, código postal, ciudad, provincia y teléfono;
  - horario por día, con uno o dos tramos y «cerrado».
- [ ] Schema zod en `apps/web/lib/settings-action-input.ts`, con estas reglas:
  - teléfono en formato español o E.164;
  - horas `HH:MM`;
  - el fin de un tramo va después de su inicio, salvo que cruce la medianoche (permitido, para
    bares);
  - como máximo dos tramos por día.
- [ ] Server action con `managerAction`; el `tenantId` sale de la sesión, nunca del formulario.
- [ ] Unit tests del schema. e2e en `admin-d3.spec.ts`: guardar la ficha y verla en la carta
  (1.3).

### Tarea 1.3 — La ficha, visible en la carta

- [ ] Componente `FichaDelLocal` montado por la PÁGINA (`Carta.tsx`) junto a `LegalFooter`, no
  por el tema, igual que `LegalFooter` y por la misma razón. Muestra dirección, teléfono y
  horario de hoy, con un enlace «Ver horario» que despliega la semana (`<details>`, sin JS).
- [ ] Sin datos guardados, no pinta nada.
- [ ] Textos es/en/pt en `lib/i18n.ts` («Horario», «Cerrado», «Hoy»). Días y horas con
  `Intl.DateTimeFormat` en la zona de la sede (`venues.timezone`).
- [ ] Unit test del cálculo de «hoy» con la zona de la sede (Canarias ≠ Madrid). e2e: con ficha
  guardada, la dirección se ve en `/` y en `/{mesa}`.

### Tarea 1.4 — JSON-LD `Restaurant` + `Menu`

- [ ] Función pura `jsonLdDeLaCarta({ businessName, tagline, origen, ficha, view, currency,
  lang })` en `apps/web/lib/json-ld.ts`. Solo emite lo que está en la página:
  - siempre: `Restaurant` con `name`, `url` (origen) y `description` si hay lema;
  - con ficha: `address` (`PostalAddress`), `telephone` y `openingHoursSpecification`;
  - `hasMenu`: en `/`, `Menu` con las secciones visibles (nombre y URL); en `/?cat=x`,
    `MenuSection` con sus `MenuItem` (nombre y `Offer` con precio y moneda);
  - productos agotados o fuera de franja: los mismos que ve el comensal, ni más ni menos;
  - nada de `aggregateRating`, `review` ni `priceRange` sin datos reales.
- [ ] Se inyecta con `<script type="application/ld+json">` en `Carta.tsx`, escapando `<` como
  `<` al serializar.
- [ ] Unit tests:
  - sin ficha no hay `address`;
  - un día con `[]` queda fuera de `openingHoursSpecification`;
  - un tramo que cruza la medianoche sale como dos;
  - el JSON no contiene `</script>` aunque un nombre de plato lo lleve.
- [ ] Validar a mano una vez con https://validator.schema.org y el «Rich Results Test» de
  Google sobre la carta de staging, y anotar el resultado en el PR.

### Tarea 1.5 — `llms.txt` por cliente

- [ ] `app/llms.txt/route.ts` (texto plano, dinámico por host). Contenido generado:
  - nombre y lema;
  - categorías con su número de platos y su URL;
  - cómo se pide: QR en mesa, la carta se consulta desde fuera;
  - la ficha (dirección, teléfono, horario) **solo si existe**.
- [ ] Host de plataforma o tenant sin canal QR: 404.
- [ ] Función pura `textoLlms(...)` con unit test. Sin ficha, el texto no contiene «Dirección».
- [ ] Añadir `llms.txt` a la exención del proxy en el host de plataforma, para que sea 404
  limpio.

---

## Fase 2 — Aviso legal y lista de instalación

### Tarea 2.1 — La lista de instalación avisa de lo que falta

- [ ] `app/admin/instalacion/checklist.ts`, paso «Datos del titular»: `falta` si no hay razón
  social, NIF o domicilio fiscal (`tenant_settings.fiscal`). Texto: «El aviso legal de tu web
  tiene que identificar al titular (LSSI, art. 10). Rellénalo en Ajustes.» Enlaza a
  `/admin/ajustes`.
- [ ] Paso «Ficha pública del local»: `aviso` (no `falta`) si la sede por defecto no tiene
  dirección u horario, porque sin ellos los buscadores no saben dónde está el local.
- [ ] Ampliar `SetupFacts` y su construcción en `instalacion/page.tsx`. Tests en
  `checklist.test.ts`, uno por estado.

### Tarea 2.2 — Aviso legal con los datos del titular

- [ ] Revisar `lib/legal-content.ts`: con datos fiscales, el aviso legal ya pinta razón social,
  NIF y domicilio. Confirmarlo con un test unitario de `documentoLegal` si no lo hay.
- [ ] Sin datos fiscales: no cambiar el texto público. Lo que cambia es que el panel lo marca
  como pendiente (2.1).

---

## Fase 3 — Garum (operación, sin código). Iván.

- [ ] Ajustes de Garum en producción: razón social, NIF y domicilio fiscal.
- [ ] Ficha pública del local (tras la Fase 1): dirección, teléfono y horario, exactamente como
  en Google Business.
- [ ] Perfil de Google Business: reclamarlo o crearlo, con la misma dirección y teléfono
  carácter a carácter, categoría «Vinoteca» o «Bar de tapas», y la web `https://garumvinoteca.com/`.
- [ ] **Cambio de DNS**, solo con la Fase 0 desplegada y verificada: registros A de
  `garumvinoteca.com` y `www` a `72.61.106.185`. Comprobar `https://garumvinoteca.com/` (200,
  título) y `https://www.garumvinoteca.com/` (308 al dominio).
- [ ] Google Search Console:
  - verificar el dominio; el registro TXT lo da Google y lo añade Iván en su registrador;
  - enviar `https://garumvinoteca.com/sitemap.xml`.
- [ ] Imprimir los QR desde `/admin/mesas` cuando el aviso de dominio desaparezca.
- [ ] Repetir las búsquedas de la auditoría 30 días después del cambio de DNS:
  - «Garum Vinoteca»;
  - «garumvinoteca.com»;
  - «vinoteca con tapas en <ciudad>».

  Anotar qué sale. Antes de 30 días no se verá nada.

---

## Fase 4 — Menores (cuando haya hueco)

- [ ] Pantalla de bienvenida (`/1`, `/` sin `?ver=carta`):
  - no tiene `<h1>`: añadirlo en `generic.tsx` y una aserción en `contract.test.tsx` («la
    bienvenida tiene un único h1 con el nombre»);
  - su imagen no tiene `alt`: `alt` con el nombre del negocio, o `alt=""` si es decorativa.
- [ ] `/?cat=<slug-desconocido>` degrada a la raíz con 200. Que su canonical apunte a `/` para
  no indexar variantes basura.

## Fuera de alcance (decisiones conscientes)

- Una landing comercial por cliente (galería, «sobre nosotros», reservas): es contenido nuevo y
  otro producto. La portada es la carta.
- Bloquear crawlers de asistentes: hoy se permiten. Si se decide lo contrario, es un ajuste de
  plataforma en `reglasDeRobots`.
- Cualquier técnica para «aparecer» en respuestas de asistentes más allá de datos correctos y
  legibles.
