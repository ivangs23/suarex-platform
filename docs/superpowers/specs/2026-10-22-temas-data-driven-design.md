# Temas de carta data-driven — inventario (tarea 2.1)

Fecha: 2026-10-22 · Plan: `docs/superpowers/plans/2026-10-22-auditoria-endurecimiento.md`, Fase 2.

Objetivo de la fase: que `generic` sea el ÚNICO componente de carta y que Garum y Manuela sean
**datos** en `tenant_settings.branding`. Este documento es la tarea 2.1: qué diferencia hoy a
los tres temas y cómo se clasifica cada diferencia. No hay código.

Fuentes leídas: `apps/web/app/[mesa]/themes/{generic,garum,manuela}.tsx` (708 líneas) y sus
`.module.css` (1.284), `types.ts`, `index.ts`, `packages/config/src/branding.ts`, el layout raíz
(fuentes) y `apps/web/public/brands/`.

## 1. Lo que ya es común (y no cambia)

Los tres temas comparten la MISMA estructura, y es la que `generic` conserva:

- **Bienvenida**: foto de fondo opcional (`branding.heroUrl`) + bloque con logo, nombre, mesa
  (solo con QR) y "Toca para empezar"; selector de idioma si hay más de uno.
- **Barra superior en tres zonas**, en rejilla `1fr auto 1fr`: mesa | marca | idiomas + pedido.
- **Navegación por niveles**: rastro de vuelta, rejilla de categorías (icono, nombre, nº de
  platos), lista de productos (nombre, precio, alérgenos, foto, `AddToCart`), estado vacío.
- Los `data-testid` del contrato y los componentes compartidos (`CartButton`, `AddToCart`,
  `AllergenBadges`), los textos de plataforma vía `strings` y las fuentes que carga el layout
  (`--font-playfair` para títulos, `--font-inter` para texto).

Las diferencias de abajo son, casi todas, CSS. El JSX de los tres temas solo se separa en cinco
puntos: la bienvenida de Manuela, la cabecera de la carta, la navegación, la tarjeta de
categoría y la tarjeta de producto.

## 2. Inventario de diferencias

Clasificación: **T** = token (color, radio, sombra, borde, imagen, tipografía) · **V** =
variante de layout · **F** = funcionalidad (violación de la doctrina: se unifica en todos) ·
**C** = contenido del cliente (un dato, no un estilo).

| # | Diferencia | generic | garum | manuela | Clase |
|---|---|---|---|---|---|
| 1 | Paleta | `branding.colors` (bg, fg, primary, accent, muted) | fija: fondo `#d6e8d2`, superficie `#fff`, primario `#7b4f96`, secundario `#4a7860`, texto `#111`, texto atenuado `#3f5548` | fija: fondo `#f9f7f2`, superficie `#fff8e7`, acento `#c28744`, texto `#2c1a0f` | T |
| 2 | Color de SUPERFICIE (tarjetas, barra) | se deriva de `muted` con `color-mix`; barra blanca | blanco | blanco / crema | T (falta en `Branding`) |
| 3 | Textura de fondo | ninguna | `garum-pattern.svg`, 150 px, repetida | `manuela-terrazo.png`, repetida | T + C (imagen) |
| 4 | Radio de tarjetas | 0,75 rem (productos 0,6) | 1 rem | 1 rem | T |
| 5 | Radio de controles (mesa, carrito, idioma) | píldora (999 px) | píldora | rectángulo redondeado 0,9 rem (mesa, carrito) | T |
| 6 | Sombra | ninguna | suave (`0 2px 16px` al 7 %) | media (`0 4px 6px -1px` al 10 %) | T |
| 7 | Borde de tarjeta | 1 px, primario al 12-14 % | 1 px, primario al 18 % | 2 px, acento al 30-40 % | T |
| 8 | Títulos (nombre de categoría y de plato) | serif, normal | serif, VERSALES | categorías sans 800 en versales; platos serif | T (transformación y peso) |
| 9 | Foto de producto | 72 px, `cover` | 88 px, `cover`, radio 14 px | franja de 9 rem a todo el ancho, `contain` | T (`imageFit`) + V |
| 10 | Logo | `branding.logoUrl` (Storage) | `/brands/garum-logo.png`, fijo en el código | `/brands/manuela-logo.png`, fijo en el código | C |
| 11 | Foto de bienvenida por defecto | ninguna (color de marca) | ninguna (patrón) | `/brands/manuela-fondo.png` si no hay `heroUrl` | C |
| 12 | Lema bajo el nombre | — | "Vinoteca & cocina de producto", **escrito en español en el JSX** | — | C (ver decisión 2) |
| 13 | Bienvenida | bloque claro translúcido sobre la foto | igual, con borde y sombra | sin bloque: firma grande, insignia ☕ en círculo verde `#1b4d3e`, saludo enorme en versales | V + C (insignia, ver decisión 3) |
| 14 | Cabecera de la carta | nombre grande centrado con línea inferior + "Explora la carta" | tarjeta blanca con nombre y lema | ninguna (el `h1` existe solo para lectores de pantalla) | V |
| 15 | Navegación por niveles | botón "Volver a categorías" + rastro | igual, con el rastro en píldora blanca | píldora con "‹ Categoría" ("Menú" en la raíz) + rastro | V |
| 16 | Tarjeta de categoría | icono | icono | foto de la categoría con el icono de respaldo; rejilla fija de 2/3/4 columnas | V |
| 17 | Tarjeta de producto | fila: texto a la izquierda, miniatura a la derecha | fila (igual, más aire) | tarjeta en rejilla 1/2/3: foto arriba con precio y alérgenos encima, nombre y botón a todo el ancho | V |
| 18 | Idiomas | código | código | bandera + código | V |
| 19 | Botón del pedido | píldora primaria | píldora primaria | rectángulo oscuro + icono de bolsa (máscara SVG) + contador en crema | T (radio, color) + V menor (icono) |
| 20 | Logo de la barra enlaza a la bienvenida | no | no | **sí** ("Volver al inicio") | **F** |
| 21 | Barra en móvil (< 30 rem) | recorta el nombre con elipsis | **oculta el logo** (sin esto, 432 px en una pantalla de 390 rompían las capas fijas del pago) | nada | **F** |
| 22 | Idioma activo | `--color-primary` | `--color-primary` del branding (no su morado: incoherente) | ídem | T (se arregla solo) |
| 23 | Fuentes del branding | `--font-display`/`--font-body` se emiten, **pero ningún tema las usa** | — | — | **F** (ajuste del panel sin efecto) |

## 3. Funcionalidad que hoy difiere (se unifica en todos, por doctrina)

- **#20 · El logo de la barra vuelve a la bienvenida solo en Manuela.** Es navegación, no
  aspecto. Propuesta: en todos.
- **#21 · La protección de la barra en móvil solo la tiene Garum.** Es un arreglo de un fallo
  (la barra desbordaba y descolocaba la hoja de pago), no una preferencia. Propuesta: la misma
  regla para todos.
- **#23 · Las fuentes del panel no hacen nada.** El formulario de ajustes pide `font_display` y
  `font_body` como texto libre, `brandingToCssVars` los emite, y ningún tema los lee. Solo se
  cargan dos familias (Playfair Display e Inter, vía `next/font`), así que un nombre cualquiera
  tampoco se vería. Propuesta para la 2.2: sustituir el texto libre por un selector entre las
  familias que se cargan, y que `generic` las use.

## 4. Ejes de layout propuestos (6, de 2-3 valores)

Cada eje es un `z.enum` en `branding.layout` y un `data-layout-<eje>` en el contenedor raíz. Los
pasos del flujo no dependen de ninguno: solo cambian dónde y cómo se pintan.

| Eje | Valores | generic | garum | manuela |
|---|---|---|---|---|
| `welcome` | `panel` · `poster` | panel | panel | poster |
| `hero` (cabecera de la carta) | `plain` · `card` · `none` | plain | card | none |
| `nav` (navegación por niveles) | `back-button` · `title-pill` | back-button | back-button | title-pill |
| `categories` | `icon-tiles` · `photo-tiles` | icon-tiles | icon-tiles | photo-tiles |
| `products` | `list` · `cards` | list | list | cards |
| `langs` | `code` · `flag` | code | code | flag |

## 5. Tokens propuestos (bloque `branding.tokens`)

- `colors.surface` (nuevo color): fondo de tarjetas y barra.
- `radius` (tarjetas) y `controlRadius` (`pill` · `rounded`).
- `shadow`: `none` · `soft` · `medium`.
- `borderWidth`: 1 · 2 (el color del borde se deriva del primario o el acento con `color-mix`,
  como hoy).
- `background`: `{ imageUrl, size }`, la textura repetida (contenido del cliente).
- `titles`: transformación (`none` · `uppercase`) y peso.
- `imageFit`: `cover` · `contain` y tamaño de miniatura.
- `cartIcon`: `none` · `bag`.

Con esto, Garum y Manuela se expresan sin código:

- **garum**: colores fijos de arriba, superficie blanca, textura de copas, radio 1 rem, sombra
  `soft`, borde 1, títulos en versales, miniatura 88 px; layout `panel / card / back-button /
  icon-tiles / list / code`.
- **manuela**: crema/dorado, terrazo, radio 1 rem, controles `rounded`, sombra `medium`, borde 2,
  `contain`, icono de bolsa; layout `poster / none / title-pill / photo-tiles / cards / flag`.

## 6. Lo que no cabe en tokens + variantes — decisiones para Iván

1. **Assets de marca versionados con la app** (`/brands/*.png|svg`). `parseBranding` solo
   admite URLs absolutas http/https para `logoUrl`/`heroUrl`, así que hoy no pueden ser datos.
   - *A (recomendada)*: admitir además rutas que empiecen por `/brands/` (lista cerrada de
     prefijo, sin `//` ni `..`). Los clientes nuevos suben sus imágenes por el panel (Storage)
     como hasta ahora; Garum y Manuela conservan sus assets sin moverlos.
   - *B*: subir esos cinco ficheros a Storage con un script, como imágenes de cada tenant. Más
     limpio a largo plazo, pero es una migración de ficheros con su propio despliegue.
2. **El lema de Garum** ("Vinoteca & cocina de producto") está escrito en español dentro del
   JSX: al cambiar a inglés sigue en español.
   - *A (recomendada)*: generalizarlo como contenido traducible, `branding.tagline` por idioma,
     opcional para cualquier cliente.
   - *B*: descartarlo. Garum pierde esa línea y la captura de antes no cuadra en ese punto.
3. **La insignia de Manuela** (☕ en un círculo verde `#1b4d3e`, único uso de ese verde).
   - *A (recomendada)*: opcional `welcome.badge = { emoji, color }`, solo en la variante
     `poster`.
   - *B*: descartarla. Es decoración pura, pero Manuela cambia de aspecto.
4. **Funcionalidad a unificar** (sección 3): el logo como enlace al inicio, la regla de la
   barra en móvil y las fuentes del panel. Recomendación: las tres en todos, en la 2.3, con su
   contrato en `contract.test.tsx`.

### Decidido (Iván, 2026-10-23)

"Sí" a los 6 ejes y al bloque de tokens, y **A en las cuatro**:

1. `logoUrl`, `heroUrl` y la textura admiten también rutas `/brands/…` (prefijo cerrado, sin
   `//` ni `..`). Va en la 2.2 (`parseBranding` y el borde de la Server Action).
2. `branding.tagline`, traducible por idioma y opcional para cualquier cliente. 2.2 (esquema y
   panel) y 2.3 (pintarlo).
3. `welcome.badge = { emoji, color }`, opcional, solo en la variante `poster`. 2.2 y 2.3.
4. En todos: el logo de la barra vuelve al inicio y la barra se protege en móvil (2.3, con su
   contrato en `contract.test.tsx`). Las fuentes pasan a un selector entre las familias que se
   cargan, y `generic` las usa (2.2 el selector, 2.3 el uso).

## 7. Riesgos para la 2.3

- **Capturas**: la aceptación exige que Garum y Manuela "se vean igual". Las diferencias que se
  descarten (decisiones 2 y 3 en B) o se unifiquen (logo enlazado, regla móvil) cambian píxeles
  a propósito: la comparación tiene que hacerse por zonas o con esas diferencias anotadas, no a
  ciegas.
- **Selectores atados a la estructura**: Manuela estila el botón de añadir con
  `[data-testid="open-product-sheet"]`. En `generic` tiene que vivir en la variante
  `products=cards`, no colgado de un `testid` suelto.
- **`contract.test.tsx`** pasa a recorrer el producto cartesiano de los ejes: 2·3·2·2·2·2 = 96
  combinaciones por estado (bienvenida y carta). Es asumible en tiempo, pero conviene medirlo.

## 8. Resultado de la 2.3 (2026-10-23)

Garum y Manuela son DATOS (`20261022000002_branding_temas_en_datos.sql`, mismos valores en el
seed) y `contract.test.tsx` recorre las 96 combinaciones × con/sin contenido de marca (192
casos, ~1,5 s). Comparación con `tests/e2e/carta-visual.spec.ts` (14 capturas, tolerancia
1 %): las 8 de Garum pasan contra las capturas de los temas antiguos. Las 6 de Manuela se
verificaron igual, dándole temporalmente su aire inferior exacto (pasaron las de carta; la
bienvenida solo difería en las banderas), y luego se regeneraron 5 por estas diferencias
DELIBERADAS:

- **Aire bajo la carta**: 4rem para todos (`.page`, fuera del alto mínimo). Manuela tenía
  4,5rem: sus páginas cortas quedan 8 px más bajas.
- **Banderas en la bienvenida de Manuela**: el eje `langs=flag` pinta banderas en TODOS los
  selectores del cliente; su tema antiguo solo las ponía en la barra de la carta. (En Windows
  las banderas emoji salen como letras, `ES`/`GB`: es del sistema, igual que antes en la barra.)

Diferencias por debajo de la tolerancia, también deliberadas: el texto sobre el color principal
(botón de volver, entrar, pedido) es la superficie propia (blanco en los dos) y el texto
secundario de Garum es el gris de la base (65 % del texto) en vez de su `#3f5548` verdoso. El
logo de la barra, que ahora enlaza a la bienvenida, se oculta por debajo de 30rem en todos.
