# Sub-proyecto: Sistema de temas de la carta pública

Fecha: 2026-07-22
Estado: aprobado, pendiente de plan de implementación

## Contexto

La carta pública multi-tenant (`apps/web/app/[mesa]/page.tsx`) es hoy un placeholder pelado: un `<h1>` con el nombre y una lista sin estilo. El layout raíz ya inyecta las variables CSS de la marca (`--color-bg/fg/primary/accent/muted`, `--font-display/body`) desde `tenant_settings.branding`, pero ninguna página las consume en un diseño real. Cada marca que migró de sus apps antiguas (garum, manuela) tenía su propio diseño hecho a medida en el frontend; ese diseño no se portó.

Este sub-proyecto da a la plataforma un **sistema de temas** para la carta pública: una plantilla **genérica** pulida, tematizada por completo con el branding del tenant (para clientes que no quieren nada específico, cero código), y **temas a medida codificados** (garum, manuela) para clientes que quieren su propio diseño de marca. Un solo proyecto, un solo data layer; solo cambia la presentación.

## Decisión de enfoque (tomada en brainstorming)

**Registro de temas codificados + `tenant_settings.theme`** (frente a "solo config + CSS custom" o "subapp por marca"). El campo `theme` (slug, por defecto `generic`) elige qué componente renderiza la carta. `generic` se pinta al 100% con el branding; los temas a medida son componentes/CSS codificados con libertad total de diseño, alimentados por el mismo catálogo. Un cliente nuevo solo pone su branding (sin código); un cliente premium con diseño propio recibe un tema codificado. "A medida" = código, que es lo que da fidelidad real; inyectar CSS de tenant se descarta por seguridad y mantenimiento.

## Alcance

**Dentro:**
- Campo `tenant_settings.theme` (`text not null default 'generic'`), leído por `getTenantSettings` y validado por `tenantSettingsSchema`. Migración nueva.
- Contrato de tema único (`MenuTheme`) y un **registro** con `resolveTheme(slug)` que cae a `generic` si el slug no existe.
- **Tema genérico**: plantilla responsive pulida, tematizada por branding (hero con logo+nombre, secciones por categoría, tarjetas de producto con precio y alérgenos).
- **Temas a medida `garum` y `manuela`**: componentes codificados que replican el look de cada marca (garum verde/morado, serif Playfair, tarjetas blancas; manuela crema/dorado, tiles redondeados).
- **Carga de fuentes** en el layout raíz (Playfair Display + Inter vía `next/font`) expuestas como variables CSS; el genérico usa `branding.fonts`, los temas a medida fijan las suyas.
- **Seed**: `garum.theme='garum'`, `manuela.theme='manuela'`, el branding real de cada marca (colores/fuentes/logo/nombre), y un catálogo de muestra más rico para que los temas tengan contenido que mostrar. Un tenant demo `generic` (opcional) para ver la plantilla por defecto.

**Fuera (follow-ups):**
- Selector de tema en el panel de administración (por ahora lo fija el seed).
- Traer los **datos reales** de la carta desde los Supabase de producción (sub-proyecto aparte ya acordado).
- Subir los **logos reales** al Storage (por ahora, el nombre en la fuente de display sirve de marca; el `logoUrl` real se cablea cuando los logos estén en Storage).

## Arquitectura

```
supabase/migrations/
  20260722000011_tenant_theme.sql        columna tenant_settings.theme
packages/config/src/
  settings.schema.ts                      + theme en tenantSettingsSchema
packages/db/src/
  types.ts / tenants.ts                   + theme en TenantSettingsRow / getTenantSettings
apps/web/app/
  layout.tsx                              carga de fuentes (next/font) + vars
  [mesa]/page.tsx                         carga tenant+branding+theme+catálogo, resuelve y renderiza el tema
  [mesa]/themes/
    types.ts                              MenuTheme + MenuThemeProps (contrato de props compartido)
    index.ts                              registro { generic, garum, manuela } + resolveTheme(slug)
    generic.tsx / generic.module.css      plantilla genérica tokenizada por branding
    garum.tsx   / garum.module.css        tema a medida garum
    manuela.tsx / manuela.module.css      tema a medida manuela
  public/brands/                          (logos, cuando se suban)
tests/
  e2e/carta-temas.spec.ts                 garum→tema garum, manuela→tema manuela, genérico→plantilla genérica
apps/web/app/[mesa]/themes/index.test.ts  resolveTheme: correcto + fallback a generic
```

### Contrato de tema

Un tema es una función de presentación pura sobre un contrato de props compartido:

```ts
export type MenuThemeProps = {
  tenant: { slug: string; name: string };
  branding: Branding;               // de @suarex/config (name, colors, fonts, logoUrl)
  mesa: string;                     // etiqueta de la mesa (p. ej. "5")
  categories: {
    id: string;
    name: string;
    products: { id: string; name: string; price: number; allergens?: string[] }[];
  }[];
};
export type MenuTheme = (props: MenuThemeProps) => ReactNode;
```

Todos los temas reciben lo mismo; la página los alimenta con una sola carga de datos. Un tema nunca hace I/O ni conoce el tenant salvo por sus props.

### Registro y resolución

`themes/index.ts` mantiene un mapa `{ generic, garum, manuela }`. `resolveTheme(slug: string): MenuTheme` devuelve `registry[slug] ?? registry.generic`. Un slug desconocido (o `null`) cae al genérico, así que un tenant sin tema configurado siempre renderiza algo válido.

### La página

`[mesa]/page.tsx` conserva su comportamiento actual (validación del patrón de mesa numérica, `requireTenant().catch(() => null)` → `notFound()`, carga de catálogo). Añade la carga de `tenant_settings` (branding + theme) y del catálogo mapeado al contrato, resuelve el tema y lo renderiza. El layout raíz sigue inyectando las CSS vars de branding (base del genérico); la carga de fuentes se hace ahí para que estén disponibles a todos los temas.

### El tema genérico

100% tokenizado: usa `var(--color-bg/fg/primary/accent/muted)` y `var(--font-display/body)` más `branding.name`/`branding.logoUrl`. Estructura: hero (logo o nombre en la fuente de display + "Mesa X"), una sección por categoría con su título, y tarjetas de producto (nombre, precio formateado, chips de alérgenos). Responsive (una columna en móvil, rejilla en ancho). Un cliente nuevo pone su branding y obtiene una carta digna sin escribir código.

### Los temas a medida (garum, manuela)

Componentes codificados con su CSS module propio, con libertad total. **Garum**: fondo verde `#d6e8d2` con textura, cabecera serif (Playfair) en morado `#7b4f96`, tarjetas blancas con sombra suave, acentos verde `#4a7860`. **Manuela**: fondo crema `#F9F7F2`, dorado `#c28744` y marrón `#2C1A0F`, tarjetas crema redondeadas. No dependen de `branding.colors` (fijan los suyos), pero sí reciben el mismo catálogo y el nombre. Son la referencia de "qué puede hacer un tema a medida".

## Manejo de errores

- **Slug de tema desconocido / `null`**: `resolveTheme` cae a `generic`. Nunca una página en blanco.
- **Sin branding**: `parseBranding` ya degrada campo a campo a los defaults; el genérico sale con la paleta por defecto.
- **Sin logo** (`logoUrl` nulo): el hero muestra el nombre en la fuente de display, no una imagen rota.
- **Fallo de datos / tenant no resuelto**: igual que hoy — `notFound()` en la página, antes de elegir tema.
- **Fuente de branding no cargada**: si `branding.fonts` nombra una fuente que el layout no cargó, el navegador cae a la fuente de sistema del `font-family`; el genérico usa una lista con fallback a `system-ui`.

## Pruebas

- **Unit (`resolveTheme`)**: devuelve el componente correcto para `generic`/`garum`/`manuela`; un slug desconocido y `null`/`""` caen a `generic`.
- **E2E**: con el host `garum.localhost` la carta renderiza el tema garum (marcador `data-theme="garum"` + un rasgo visual propio, p. ej. la cabecera serif); con `manuela.localhost` el tema manuela (`data-theme="manuela"`); con un tenant de tema `generic`, la plantilla genérica (`data-theme="generic"`). La resolución de tenant y el `notFound()` de `[mesa]` siguen intactos (test de regresión de que una ruta no numérica sigue dando 404).
- **Regresión**: la suite existente sigue en verde; el layout con la carga de fuentes no rompe el `dangerouslySetInnerHTML` de branding (las fuentes van por `next/font`, no por el string de branding sin sanear).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un tema a medida diverge del contrato de props y rompe en runtime | Un solo tipo `MenuThemeProps` que todos los temas consumen; TypeScript lo verifica en compilación |
| El branding de un tenant nombra una fuente no cargada | El genérico usa `font-family` con fallback a `system-ui`; los temas a medida fijan fuentes que el layout sí carga |
| Añadir temas a medida infla el bundle de la carta | Los temas son componentes de servidor; se pueden cargar de forma diferida (`next/dynamic`) por slug si el número crece. Con tres, no hace falta aún |
| El campo `theme` sin selector en admin deja a los tenants sin poder cambiarlo | Aceptado en esta fase: lo fija el seed/SQL; el selector en el panel es un follow-up explícito |
| Confundir "copiar estilos" con clonar pixel-perfect cada sitio bespoke | El alcance es UNA plantilla adaptable + temas a medida de fidelidad razonable, no réplicas exactas de dos frontends enteros — decisión registrada |

## Regla de despliegue

Como todo el proyecto, se demuestra en local con los tenants de prueba (garum, manuela, y un demo genérico). Los repositorios y el proyecto Supabase de producción no se tocan. Los datos reales de la carta y los logos de producción son sub-proyectos aparte.
