# Migrar un cliente a la plataforma

Proceso completo para traer a un restaurante desde su aplicación anterior: su catálogo, sus
fotos y su identidad visual. Probado con dos clientes de esquemas totalmente distintos
(Garum y Manuela).

**Nunca se escribe en el sistema del cliente.** Todo lo que se lee de su web es público —lo
mismo que ve cualquiera que abra su carta— y todo lo que se escribe va a *nuestra* base.

---

## 1. Reconocer el terreno

Abre su carta y mira **de dónde saca los datos**:

```js
performance.getEntriesByType('resource')
  .map(e => e.name)
  .filter(n => !n.includes('/_next/static/'))
```

Si aparece un `*.supabase.co/rest/v1/...`, ya tienes su API y la forma de su consulta. La
anon key está en alguno de los *chunks* de JavaScript que su propia web sirve:

```js
(async () => {
  for (const s of document.querySelectorAll('script[src]')) {
    const t = await (await fetch(s.src)).text();
    const m = t.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[\w-]+\.[\w-]+/);
    if (m) return m[0];
  }
})()
```

> La anon key es **pública por diseño**: viaja al navegador de cada comensal. Usarla para
> leer su catálogo es exactamente lo que hace su web. Distinto sería la service role key,
> que nunca debe salir de un servidor.

**Si hay un banner de cookies sin opción de rechazar, no lo aceptes.** No hace falta: los
assets y su API son accesibles igualmente, y aceptar términos en nombre de otro no es tuyo.

### Mide sus colores en vez de estimarlos a ojo

```js
(() => {
  const cuenta = new Map();
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    for (const v of [cs.backgroundColor, cs.color, cs.borderColor]) {
      if (!v || /rgba\(0, 0, 0, 0\)/.test(v)) continue;
      cuenta.set(v, (cuenta.get(v) || 0) + 1);
    }
  }
  return [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 10);
})()
```

Los colores dominantes SON su marca. Con Manuela salieron `#2c1a0f`, `#c28744` y `#fff8e7`
en tres minutos, y su borde resultó ser literalmente `border-2 border-[#c28744]/40`.

Sus imágenes de marca (logo, fondos) salen del mismo listado de recursos.

---

## 2. Descargar el volcado

```bash
curl -sS "https://<proyecto>.supabase.co/rest/v1/<tabla>?select=*" \
  -H "apikey: <anon-key>" \
  -o .import/<cliente>-catalogo.json
```

`.import/` está en `.gitignore`: son datos de negocio de un tercero y no van al repositorio.

La consulta depende de su esquema. Los dos vistos hasta ahora:

| Cliente | Forma |
|---|---|
| Garum | Un array de categorías con sus productos **anidados** |
| Manuela | `categories` y `products` en **listas separadas**, unidas por `categoryId` |

Para Manuela hubo que bajar las dos tablas y combinarlas:

```bash
curl ... /categories?select=* -o /tmp/c.json
curl ... /products?select=*   -o /tmp/p.json
node -e "require('fs').writeFileSync('.import/x.json', JSON.stringify({
  categories: require('/tmp/c.json'), products: require('/tmp/p.json') }))"
```

---

## 3. Escribir su adaptador

**Aquí está el corazón del proceso.** Cada cliente trae el esquema que se inventó su
aplicación anterior, y esas diferencias no pueden vivir dentro del importador: crecerían con
cada cliente nuevo hasta hacerlo ilegible.

En su lugar, cada origen se traduce a **una forma canónica** en
[`scripts/lib/source-adapters.mjs`](../scripts/lib/source-adapters.mjs), y el importador
solo conoce esa forma.

Un adaptador son dos funciones:

```js
const adaptadorX = {
  nombre: "x",
  // Reconoce el volcado por su FORMA, no por un parámetro que hay que acordarse de pasar.
  detecta: (json) => Array.isArray(json) && "mi_campo_raro" in json[0],
  convierte(json) {
    return { categories: [...], products: [...] };  // forma canónica
  },
};
```

Y se añade a `ADAPTADORES`. **El importador no se toca.**

La forma canónica está documentada con tipos en ese mismo fichero. Lo que hay que resolver
en cada adaptador:

| En la plataforma | Qué mirar en el origen |
|---|---|
| `slug` | ¿Trae uno? Manuela usa su `id` de texto (`coffee`); Garum trae `slug` |
| `nameI18n` | ¿Columnas por idioma? Manuela tiene `name_en`, `name_pt` |
| `parentSourceId` | El id **del origen**; el importador traduce a los nuestros |
| `extras` | Garum: tabla `product_extras`. Manuela: json `modifiers` |
| `allergenIds` | **Solo si son enteros.** Manuela los tiene como texto: no se copian |
| `destination` | `cocina`/`barra`; cualquier otro valor rompe el CHECK de la base |

> **Los alérgenos no se adivinan.** Si el origen usa otra codificación, copiarlos crearía
> alérgenos falsos, y equivocarse con un alérgeno es un riesgo para el comensal, no un fallo
> cosmético. Se dejan fuera y se avisa.

---

## 4. Importar

```bash
node scripts/import-catalog.mjs .import/<cliente>-catalogo.json <slug> --reemplazar
```

Necesita `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno (en local salen de
`.env.test`).

- **`--reemplazar`**: úsalo siempre la primera vez. Sin él, el catálogo de muestra del seed
  se mezcla con el real y la carta enseña categorías que el cliente no tiene.
- **`--sin-imagenes`**: para iterar sobre los datos sin esperar a la red.

El script **detecta el formato solo** e informa de lo que ha hecho y de lo que ha
descartado. Es idempotente: reimportar actualiza, no duplica.

### Las fotos

Se **descargan del Storage del cliente y se resuben al nuestro**. Copiar sus URLs dejaría la
carta dependiendo para siempre de su servidor: el día que lo apague, desaparecen todas.

Un producto que ya tiene foto nuestra se salta, así que reimportar no acumula objetos
huérfanos. Una foto que falle no aborta la importación — se listan al final para
reintentarlas.

---

## 5. Su tema

Un cliente que no quiera diseño propio se queda con `generic`, que se pinta entero con su
branding sin escribir una línea de código. Para uno que sí lo quiera:

1. Copia `apps/web/app/[mesa]/themes/generic.{tsx,module.css}` con su nombre.
2. Pon los colores **medidos** en el paso 1, no estimados. Deja escrito en un comentario de
   dónde salieron.
3. Sus assets de marca van a `apps/web/public/brands/`.
4. Regístralo en `themes/index.ts` y pon su slug en `tenant_settings.theme`.

Un slug de tema desconocido cae al genérico, así que un cliente mal configurado nunca deja
una carta en blanco.

---

## 6. Comprobar

```bash
pnpm db:reset && pnpm seed:staff   # deja el seed de muestra -> los tests pasan
pnpm exec playwright test
node scripts/import-catalog.mjs ... --reemplazar   # y ahora el catálogo real
```

**Ese orden importa.** La suite e2e espera el catálogo de muestra, no el real: importar
antes de pasar los tests los rompe y el fallo no dice por qué.

Luego abre su carta al lado de la original y compáralas categoría por categoría. Es la única
forma de detectar lo que ningún test cubre.

> Aprendido a base de equivocarme: miré la raíz y los vinos de Garum, no vi fotos de
> producto y **afirmé que su web no las mostraba**. Sí las muestra, en tapas y raciones.
> Comprueba la sección concreta antes de generalizar.

---

## Resultado con los dos primeros

| | Garum | Manuela |
|---|---|---|
| Categorías | 59 (4 niveles) | 59 |
| Productos | 184 | 145 |
| Extras | 3 | 111 |
| Fotos migradas | 37 | 133 |
| Esquema de origen | Anidado | Listas separadas |
| Assets de marca | Logo + patrón | Firma + foto del local |

Ambos importados con **el mismo comando**, sin tocar el importador.
