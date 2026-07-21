# Plataforma multitenant SuarEx — Sub-proyecto 1: Fundación

Fecha: 2026-07-21
Estado: aprobado, pendiente de plan de implementación

## Contexto

Hoy existen cinco repositorios independientes que resuelven el mismo dominio (hostelería: catálogo, pedido, pago, impresión de comandas) para dos negocios distintos:

| Repo | Stack | Rol | Negocio |
|---|---|---|---|
| `GARUM` | pnpm monorepo, Next 16 + React 19, `apps/web` + `apps/desktop` + `packages/shared` | Carta QR en mesa, Stripe, comanda cocina/barra, ESC/POS | Garum Vinoteca |
| `web-manuela` | Vite + React 19 SPA | Kiosko web, Stripe, cierre de día | Manuela Desayuna |
| `kiosko-manuela` | Vite + React + Electron 40 + SQLite | Kiosko físico, TPV Paytef, offline-first | Manuela Desayuna |
| `agente-impresora-v2` | Electron | Agente de impresión ESC/POS por polling | Manuela Desayuna |
| `web-prueba` | Astro 6 | Web de marketing de la agencia | SuarEx |

Problemas medidos:

- **Duplicación**: 26 de los 41 ficheros de `web-manuela/src` existen en la misma ruta en `kiosko-manuela`; 12 son byte-idénticos. No hay workspace compartido, es copy-paste entre repos.
- **Cero multitenancy**: no existe ninguna columna `tenant_id` en ningún esquema. Las policies RLS son `USING (true)` o basadas solo en rol. Los canales de realtime tienen nombre global fijo (`garum_desktop`), así que dos negocios en un mismo proyecto se pisarían.
- **Branding incrustado**: paleta en CSS, logo como fichero estático, `"GARUM VINOTECA"` y `"MANUELA DESAYUNA"` literales en los tickets, IVA 10 % fijo, datos fiscales fijos en el código del TPV.
- **Dos esquemas incompatibles para el mismo concepto**: `orders` (Garum) frente a `pedidos` (Manuela); categorías con `id uuid` frente a `id text`.
- **Tres implementaciones de impresión distintas**: TCP con `node-thermal-printer`, PowerShell RAW, y adaptadores múltiples.
- **Configuración dispersa**: localStorage, tabla `printers`, y `config.json` en userData.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Aislamiento de datos | Un único proyecto Supabase, `tenant_id` en todas las tablas, RLS por tenant |
| Escala objetivo (12–18 meses) | 20+ clientes, producto SaaS real |
| Estrategia de migración | Repos actuales siguen en producción; la plataforma nueva se construye en paralelo |
| Superficies de producto | QR en mesa y kiosko físico, como canales activables por tenant |
| Aplicaciones de escritorio | Una sola app Electron; el modo (kiosko / agente / ambos) se elige por configuración |
| Pagos | Stripe Connect por tenant + Stripe Billing para la cuota de SuarEx |
| Web de marketing | Entra en el monorepo como `apps/marketing` |
| Multi-local | Tabla `venues` desde el día 1 |
| Punto de partida | Repo nuevo, copiando de GARUM lo que ya está bien resuelto |
| Routing de tenant | Subdominio por defecto, dominio propio opcional |

## Restricción: no se tocan los repos en producción

Todo el trabajo ocurre exclusivamente dentro de `suarex-platform`. Los cinco repositorios actuales quedan intactos:

- No se modifica ningún fichero de `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2` ni `web-prueba`.
- No se aplican migraciones a los proyectos Supabase existentes (`<proyecto-garum>` de Garum, `<proyecto-manuela>` de Manuela). La plataforma usa un proyecto Supabase nuevo y vacío.
- El código que se reutiliza de GARUM se **copia** al repo nuevo y se adapta ahí. No se extrae a un paquete compartido entre repos, no se enlaza por symlink ni por workspace.
- `web-prueba` se copiará a `apps/marketing` en el sub-proyecto 6; el repo original sigue existiendo hasta entonces.

Los negocios actuales siguen operando sobre su código actual sin interrupción. La desactivación de los repos antiguos ocurre solo cuando su tenant equivalente esté migrado y verificado en producción, y es un paso explícito al final de cada sub-proyecto de migración (2, 3, 4 y 6), nunca antes.

Cambios permitidos en los repos antiguos, y únicamente estos: correcciones de fallos que afecten a un negocio en producción, y la rotación de credenciales descrita en la sección de trabajo previo.

## Arquitectura general

Repositorio nuevo `suarex-platform`, pnpm workspaces + Turborepo.

```
apps/
  web        Next 16 App Router, multi-tenant por Host
             rutas: /{mesa} carta QR · /kiosko · /staff · /admin · /superadmin
  desktop    Electron único, modo por configuración
  marketing  Astro (SuarEx) + pricing + signup + páginas legales
packages/
  db         migraciones, tipos generados, cliente acotado por tenant
  domain     lógica pura: carrito, precios, IVA, enrutado cocina/barra
  ticket     constructor de tickets ESC/POS
  printing   adaptadores de impresora: escpos-tcp, escpos-usb, windows RAW, driver
  ui         componentes y tokens; el tema se inyecta como variables CSS
  config     resolución de tenant, esquemas zod, feature flags
```

Se copia de GARUM como base: `packages/shared/src/order-routing.ts`, `packages/shared/src/ticket/build.ts`, los adaptadores de impresión de `apps/desktop/src/main/printer/`, y las migraciones existentes únicamente como referencia de dominio. El esquema y las policies se reescriben desde cero.

## Alcance del sub-proyecto 1

**Dentro:**

1. Esqueleto del monorepo (pnpm + Turborepo + TypeScript strict + Biome + Vitest + Playwright).
2. Proyecto Supabase nuevo.
3. Esquema multitenant: `tenants`, `venues`, `tenant_settings`, `memberships` y el catálogo.
4. Custom access token hook que inyecta `tenant_id` y `role` en el JWT.
5. RLS en todas las tablas, sin ninguna policy `USING (true)`.
6. Resolución de tenant por `Host` en el middleware de Next.
7. Theming desde base de datos mediante variables CSS.
8. Ruta demo de carta que renderiza el catálogo del tenant con su marca.
9. Suite de pruebas anti-fuga entre tenants.

**Fuera** (sub-proyectos posteriores): pedidos, pagos, impresión, aplicación de escritorio, CRUD de administración, billing, canal kiosko.

**Criterio de éxito:** dos tenants demo (`garum.localhost` y `manuela.localhost`) sirven catálogos y marcas distintos desde el mismo build, y la suite anti-fuga pasa en verde.

## Modelo de datos

```
tenants          id uuid PK, slug text UNIQUE, custom_domain text UNIQUE NULL,
                 name text, status text CHECK (active|suspended),
                 plan text, stripe_account_id text NULL,
                 stripe_customer_id text NULL, created_at timestamptz

venues           id uuid PK, tenant_id uuid FK, name text, slug text,
                 is_default boolean, timezone text,
                 UNIQUE (tenant_id, slug)

tenant_settings  tenant_id uuid PK FK,
                 branding jsonb,   -- { colors, logo_url, fonts }
                 fiscal   jsonb,   -- { legal_name, cif, address, phone, tax_rate }
                 locale text, currency text,
                 channels text[],  -- ['qr-mesa','kiosko']
                 features jsonb

memberships      user_id uuid FK auth.users, tenant_id uuid FK,
                 role text CHECK (owner|admin|staff),
                 PRIMARY KEY (user_id, tenant_id)

categories       id uuid PK, tenant_id uuid FK, parent_id uuid NULL FK,
                 slug text, name_i18n jsonb, destination text CHECK (cocina|barra),
                 image_url text, sort_order int,
                 UNIQUE (tenant_id, slug)

products         id uuid PK, tenant_id uuid FK, category_id uuid FK,
                 name_i18n jsonb, description_i18n jsonb,
                 price numeric(10,2), image_url text,
                 allergen_ids int[], is_available boolean, sort_order int

allergens        id serial PK, tenant_id uuid NULL FK, name_i18n jsonb, icon text
                 -- tenant_id NULL = alérgeno global (los 14 de la UE)

product_extras   id uuid PK, tenant_id uuid FK, product_id uuid FK,
                 name_i18n jsonb, price numeric(10,2)
```

Notas de diseño:

- `venue_id` aparecerá en pedidos, impresoras y dispositivos (sub-proyectos 2 y 3), **no** en el catálogo. Un tenant tiene una carta. Si más adelante una cadena necesita precios o disponibilidad por local, se añade `product_venue_overrides` sin tocar lo existente.
- Los textos van en `jsonb` con forma `{"es": "...", "en": "..."}` en lugar de columnas `name_en` / `name_pt` como hoy en Manuela. Añadir un idioma no debe requerir una migración.
- Todas las tablas de dominio llevan `tenant_id NOT NULL` con índice, y las claves únicas de negocio se componen con `tenant_id`.

## Autenticación y aislamiento

Tres tipos de acceso, tres mecanismos:

| Quién | Cómo entra | Qué puede ver |
|---|---|---|
| Comensal (QR, anónimo) | No habla con Supabase. Los Server Components de Next leen con service role ya acotado al tenant resuelto por Host | Solo el catálogo de ese tenant |
| Staff / admin | Supabase Auth. El custom access token hook inyecta `tenant_id` y `role` en el JWT | Filas de su tenant |
| Dispositivo (kiosko / agente) | Cuenta de servicio por dispositivo, con `tenant_id` en `app_metadata` | Filas de su tenant |

Todas las policies RLS tienen la forma:

```sql
create policy tenant_isolation on <tabla>
  for all
  using (tenant_id = auth.tenant_id())
  with check (tenant_id = auth.tenant_id());
```

donde `auth.tenant_id()` es una función `stable` que lee el claim del JWT.

Única excepción: `allergens` admite `tenant_id NULL` para los 14 alérgenos globales de la UE, así que su policy de lectura es `tenant_id is null or tenant_id = auth.tenant_id()`, mientras que la de escritura exige `tenant_id = auth.tenant_id()` — nadie puede modificar los globales salvo el service role. La suite anti-fuga trata esta tabla como caso especial declarado, no como excepción implícita.

Razón para que el comensal anónimo no toque Supabase directamente: hoy tanto Garum como Manuela reparten la anon key al navegador con políticas de lectura pública, de modo que cualquiera con esa clave puede leer la base entera. Con Server Components el catálogo se sirve ya filtrado desde el servidor y la clave nunca sale.

Los canales de realtime pasarán a nombrarse `tenant:{id}:orders` en lugar de nombres globales fijos, para evitar que dos tenants compartan canal.

## Resolución de tenant y theming

El middleware (`proxy.ts` en Next 16) lee la cabecera `Host`, busca el tenant por `custom_domain` o por subdominio, lo cachea en Runtime Cache con la etiqueta `tenant:{slug}` y lo propaga por contexto. Un Host desconocido devuelve 404; no hay tenant por defecto.

El layout raíz lee `tenant_settings.branding` y emite las variables CSS en el elemento raíz:

```html
<html style="--color-bg:…; --color-primary:…; --font-display:…">
```

Los componentes de `packages/ui` usan exclusivamente variables CSS, nunca valores hexadecimales literales. Hoy Manuela tiene alrededor de 1100 hex incrustados y Garum una paleta fija en `globals.css`, lo que hace que rebrandear cueste días.

Logos y fuentes se almacenan en Supabase Storage bajo `tenant/{id}/`.

## Estrategia de pruebas

1. **Anti-fuga entre tenants (crítica).** Para cada tabla con `tenant_id`, un test de integración contra una base real que, autenticado como tenant A, intenta `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre filas del tenant B y exige cero filas o error. Los casos se generan recorriendo el catálogo de tablas, no se escriben a mano, de modo que una tabla nueva sin policy rompe el build.
2. **Unitarias.** Resolución de Host a tenant, mezcla de branding con los valores por defecto, validación zod de `tenant_settings`.
3. **End-to-end.** Dos hosts, dos marcas, dos catálogos, sin que el contenido de uno aparezca en el otro.

## Manejo de errores

- Host no reconocido: 404 sin filtrar información sobre qué tenants existen.
- Tenant con `status = 'suspended'`: página de servicio suspendido, HTTP 503.
- `tenant_settings` ausente o inválido: se aplican los valores por defecto de la plataforma y se registra el error; la carta no debe caerse por un color mal puesto.
- Fallo de la resolución de tenant en el middleware: se responde 503 en lugar de servir el tenant equivocado.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un fallo en una policy RLS filtra datos entre clientes | Suite anti-fuga generada por tabla, que falla el build ante una tabla sin policy |
| El service role en Server Components se usa sin acotar por tenant | Un único módulo exporta el cliente ya acotado; regla de lint que prohíbe importar el cliente crudo fuera de `packages/db` |
| Divergencia entre la plataforma nueva y los repos en producción | Los repos actuales entran en modo mantenimiento: solo correcciones, nada de features |
| Se toca por descuido un repo en producción | Restricción declarada arriba; el trabajo se hace con `suarex-platform` como único directorio de escritura |

## Trabajo previo no relacionado con este diseño

Estos puntos son independientes del refactor y conviene resolverlos antes:

1. `kiosko-manuela/.env` está versionado en git y contiene un `GH_TOKEN` y la anon key de Supabase. Además `package.json` incluye `.env` en `build.files`, por lo que ese token se distribuye dentro del instalador `.exe`.
2. `web-manuela/.env.production` está versionado en git (anon key de Supabase y clave publicable de Stripe).
3. La secret key de Paytef está en texto plano en `kiosko-manuela/electron/paytef-cloud-service.cjs`, junto con accessKey, pinpadID y companyID.

Acción recomendada: rotar el `GH_TOKEN` y las credenciales de Paytef, retirar los `.env` del historial de git, y excluir `.env` del empaquetado.

## Hoja de ruta

Los sub-proyectos se nombran por **canal o capacidad**, nunca por cliente. No existe ni existirá código específico de un cliente: un tenant activa un canal poniéndolo en `tenant_settings.channels`. Garum y Manuela se mencionan abajo solo como los primeros tenants que ejercitarán cada canal, no como destinatarios de desarrollo a medida.

| # | Sub-proyecto | Entregable verificable en local |
|---|---|---|
| 1 | Fundación multitenant | Este documento |
| 2 | Canal QR en mesa | Un tenant con el canal `qr-mesa` completa el flujo carta → carrito → pago → comanda |
| 3 | App de escritorio unificada | Un solo binario Electron imprime comandas para dos tenants distintos |
| 4 | Canal kiosko | Un tenant con el canal `kiosko` opera en pantalla táctil, con TPV y modo offline |
| 5 | Billing y onboarding | Alta self-service de un tenant nuevo, con Stripe Connect y suscripción |
| 6 | Marketing | Astro en el monorepo, pricing, páginas legales |

Cada sub-proyecto tendrá su propio ciclo de spec, plan e implementación.

## Regla de despliegue: primero local, y demostrado

Ningún sub-proyecto tiene como entregable "migrar un cliente a producción". El entregable es siempre que la capacidad quede **demostrada en local**, con tenants de prueba.

La migración de un negocio real es un paso posterior y separado, que ocurre solo cuando la plataforma está más que probada, y que decide el propietario del proyecto — no un sub-proyecto de desarrollo. Hasta entonces:

- Los repos `GARUM`, `web-manuela`, `kiosko-manuela` y `agente-impresora-v2` siguen dando servicio y **no se tocan**.
- Sus proyectos Supabase de producción **no se tocan**, ni siquiera para corregir políticas RLS. Cualquier corrección se redacta y se entrega para que la aplique el propietario.
- Los datos reales de esos negocios no se copian a la plataforma hasta ese momento.
