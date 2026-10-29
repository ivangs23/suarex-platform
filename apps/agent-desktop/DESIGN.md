# Design

Sistema visual de la app de escritorio (`src/renderer/styles.css`). Los valores exactos viven
en los tokens de `:root`; este documento explica cómo se usan.

## Visual Theme

Herramienta sobria, cercana a Linear o al panel de Stripe: neutros tranquilos, un acento, y
color fuerte solo para el estado. Sigue el tema del sistema (claro u oscuro). La cabecera es
una franja oscura en los dos temas: separa la app de la web de la plataforma incrustada, que
trae su propio fondo.

## Color Palette

Estrategia **Restrained**, en OKLCH. Los neutros llevan una pizca del índigo de marca
(hue 274), nunca gris puro.

| Rol | Token | Uso |
|---|---|---|
| Fondo, superficie, superficie 2 | `--bg`, `--surface`, `--surface-2` | Lienzo, bloques y estados hover |
| Texto | `--text`, `--text-2`, `--text-3` | Principal, secundario y terciario |
| Bordes | `--border`, `--border-strong` | Separadores y controles |
| Acento | `--accent` | Acción principal, foco y selección. Nunca decoración |
| Estado | `--ok`, `--warn`, `--danger` (+ `-bg`, `-border`) | Solo estado, siempre con su palabra |
| Cabecera | `--bar-*` | Franja oscura, igual en ambos temas |

Niveles de estado (`renderer/estado.ts`): `ok` verde, `aviso` ámbar (algo falla pero imprime,
o conectando), `error` rojo (no imprime nada), `neutro` (sin vincular).

## Typography

Una sola familia, la del sistema: `Segoe UI Variable Text` en Windows 11. Escala fija en rem,
sin tamaños fluidos.

- Título de estado: 1.375rem, 650.
- Títulos de bloque: 0.9375rem, 650.
- Cuerpo: 14px, 1.5. Botones y pestañas: 0.875rem, 500–600.
- Cifras con `tabular-nums`. Monoespaciada (`Cascadia Mono`) solo para el código de
  vinculación y las trazas del registro.

## Components

- **Pestañas** en la cabecera (Estado, Comandas, Productos, Cierre de caja, Impresoras,
  Ajustes). Activa: fondo `--bar-active` e icono en `--bar-accent`. Por debajo de 1100 px pierden
  el icono, y por debajo de 980 px la marca pierde el texto.
- **Píldora de estado**: punto y palabra; lleva a Estado.
- **Bloque de estado**: icono, título, detalle y como mucho una acción. El fondo se tiñe en
  `aviso` y `error` con borde completo, nunca con una franja lateral.
- **Filas** de impresora: estado (punto y palabra), nombre, destino y conexión, y a la derecha
  el resultado de la última prueba y su botón.
- **Botones**: `boton` (secundario), `primario`, `peligro` (texto rojo, contorno) y `fantasma`.
  34 px de alto, 38 px junto a un campo. Mientras trabajan, dicen qué hacen y no admiten otro clic.
- **Iconos**: SVG propios en línea (`index.html`), trazo de 1.75 a 16 px. Sin emojis.

## Layout

Contenido centrado a 920 px como máximo, con 2rem de margen. Los bloques se separan con
1.5rem; dentro, 0.75rem. Las listas son una sola superficie con separadores, no tarjetas
sueltas. Movimiento: 160 ms con desaceleración exponencial, y solo para cambios de estado.
