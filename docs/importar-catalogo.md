# Importar el catálogo real de un cliente

Traer a la plataforma la carta que un cliente ya tiene en su aplicación anterior, sin tocar
en ningún momento su producción.

## Principio

**Nunca se escribe en el Supabase del cliente.** El proceso tiene dos pasos separados a
propósito:

1. **Descargar** un volcado JSON — solo lectura, con su anon key (la misma que su web
   entrega a cualquier visitante).
2. **Importar** ese fichero a la plataforma — escritura, pero solo contra *nuestra* base.

Separarlos permite revisar el volcado antes de escribir nada, y repetir la importación sin
volver a tocar su servidor.

## 1. Encontrar su API

Su web es la fuente. Con las herramientas de desarrollo abiertas, o desde la consola:

```js
performance.getEntriesByType('resource')
  .map(e => e.name)
  .filter(n => n.includes('supabase'))
```

Eso revela la URL del proyecto y la forma de la consulta que hace la carta. La anon key está
en uno de los *chunks* de JavaScript que la propia web sirve.

> La anon key es **pública por diseño**: viaja al navegador de cada cliente que abre la
> carta. Usarla para leer el catálogo es exactamente lo que hace su web. Distinto sería la
> service role key, que nunca debe salir de un servidor.

## 2. Descargar el volcado

```bash
curl -sS "https://<proyecto>.supabase.co/rest/v1/categories?select=*,products(*,product_extras(*))&order=sort_order.asc" \
  -H "apikey: <anon-key>" \
  -o .import/<cliente>-catalogo.json
```

`.import/` está en `.gitignore`: son datos de negocio de un tercero y no van al repositorio.

## 3. Importar

```bash
node scripts/import-catalog.mjs .import/<cliente>-catalogo.json <slug-del-cliente> --reemplazar
```

Añade `--sin-imagenes` para saltarte la descarga de fotos mientras iteras sobre los datos.

Necesita `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno (en local salen de
`.env.test`; contra el VPS, del `.env` de la stack de Supabase).

`--reemplazar` borra antes el catálogo que el cliente tuviera. **Úsalo siempre en la primera
importación**: sin él, el catálogo de muestra del seed se mezcla con el real y la carta
enseña categorías que el cliente no tiene. Sin la bandera, el script es idempotente
(actualiza en vez de duplicar), que es lo que se quiere para reimportar tras un cambio.

## Qué se trae y qué no

| Se importa | No se importa |
|---|---|
| Árbol de categorías (`parent_id`), slug, orden, destino, emoji | `categories.image_url` |
| Productos: nombre, descripción, precio, disponibilidad, orden | Metadatos de vino (`wine_*`, notas de cata) |
| **Fotos de producto** (se descargan y se resuben) | `is_featured` |
| Extras de producto | |
| Alérgenos, solo si el origen los codifica como enteros | |

### Las fotos

Se **descargan del Storage público del cliente y se vuelven a subir al nuestro**. Copiar sus
URLs tal cual dejaría la carta dependiendo para siempre del servidor del que se está
migrando: el día que lo apague, todas las fotos desaparecen.

Descargar es leer una URL pública — exactamente lo que hace el navegador de cualquiera que
abra su carta. No se toca su base de datos.

Un producto que ya tiene foto **nuestra** se salta, así que reimportar no duplica objetos en
el bucket. Para forzar la actualización de una foto concreta, quítala desde el panel y
reimporta.

Una foto que falle (404, tipo raro, más de 5 MB) **no aborta la importación**: se listan
todas al final para poder reintentarlas. Perder una imagen es recuperable; dejar el catálogo
a medias, no.

El script **lista al final lo que ha descartado**. Un importador que calla lo que deja fuera
parece completo cuando no lo es.

Sobre los alérgenos: se copian únicamente si son enteros, como en nuestro esquema. Si el
origen usara otra codificación, copiarlos crearía alérgenos falsos — y equivocarse con un
alérgeno es un riesgo para el comensal, no un fallo cosmético.

## Resultado con Garum

184 productos y 59 categorías, en un árbol de 4 niveles:

```
VINOS (71)
  └─ RIOJA (22)
       └─ BLANCOS (10)
            └─ LAS LEVANTADAS
                 ├─ COPA      3,20 €
                 └─ BOTELLA  18,00 €
```

Los recuentos por categoría raíz coinciden exactamente con su web: CERVEZA 3, CAFÉS 18,
TAPAS 12, RACIONES 22, TOSTADAS 32, BEBIDAS 22, VINOS 71, POSTRES 4.

## Ojo con los tests

La suite e2e espera el catálogo de muestra de `supabase/seed.sql`, no el real. El orden es:

```bash
pnpm db:reset && pnpm seed:staff   # deja el seed de muestra -> los tests pasan
pnpm exec playwright test
node scripts/import-catalog.mjs ... --reemplazar   # y ahora el catálogo real
```

Importar antes de pasar los tests los rompe, y el fallo no dice por qué.
