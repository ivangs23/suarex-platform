"use client";

import { useId, useState } from "react";
import { updateProductAction } from "./actions";

type AllergenOption = { id: number; name: string };

type Props = {
  productId: string;
  name: string;
  description: string;
  /** Precio en EUROS, como lo guarda la base (`numeric(10,2)`). */
  price: number;
  allergenIds: number[];
  allergens: AllergenOption[];
  /** Ruta de la foto actual dentro del bucket, o `null`. */
  imagePath: string | null;
  /** URL pública de la foto actual, para la vista previa. */
  imageUrl: string | null;
};

/**
 * Edición de un producto ya existente. Hasta ahora el panel solo sabía crear y borrar, así
 * que cambiar el precio de un café obligaba a borrarlo y volver a crearlo -- perdiendo por
 * el camino sus extras y su imagen con el `on delete cascade`. Eso no vale para el uso
 * diario de un restaurante.
 *
 * Va dentro de un `<details>` (lo pone la página): con 184 productos, desplegar todos los
 * formularios a la vez multiplicaría por varias veces un DOM que ya es enorme.
 *
 * NO permite mover el producto a otra categoría a propósito: eso exigiría un `<select>` con
 * las 59 categorías en CADA uno de los 184 productos (~10.800 opciones en el DOM), y además
 * mover cosas por el árbol es su propia función -- va con el reordenar/mover categorías, no
 * con "corregir el precio y el nombre". Un `category_id` ausente en la Server Action
 * significa "no cambiar", así que omitirlo aquí es seguro.
 *
 * `"use client"` por el mismo motivo que `ProductForm`: las casillas de alérgeno alimentan
 * un único campo `allergen_ids` separado por comas, que es lo que espera
 * `parseAllergenIds` en la Server Action. Aquí, además, arrancan con los alérgenos que el
 * producto YA tiene -- si empezaran vacías, guardar sin tocarlas los borraría en silencio.
 *
 * Todos los campos van prellenados con el valor actual a propósito. Los parsers de la
 * acción tratan un campo ausente como "no cambiar", así que enviar el formulario entero
 * con los valores actuales es una operación idempotente: guardar sin editar nada no
 * modifica el producto.
 */
export function ProductEditForm(props: Props) {
  const [selectedAllergenIds, setSelectedAllergenIds] = useState<number[]>(props.allergenIds);
  const formId = useId();

  function toggleAllergen(id: number) {
    setSelectedAllergenIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }

  return (
    <form action={updateProductAction} data-testid="product-edit-form">
      <input type="hidden" name="product_id" value={props.productId} />

      <label htmlFor={`${formId}-name`}>Nombre</label>
      <input id={`${formId}-name`} name="name_es" type="text" defaultValue={props.name} required />

      <label htmlFor={`${formId}-price`}>Precio (€)</label>
      <input
        id={`${formId}-price`}
        name="price"
        type="number"
        step="0.01"
        min="0"
        defaultValue={props.price}
        required
      />

      <label htmlFor={`${formId}-description`}>Descripción</label>
      {/* Vaciar este campo BORRA la descripción (ver `parseDescriptionPatch` en
          actions.ts), que es lo que espera quien la vacía a propósito. */}
      <textarea
        id={`${formId}-description`}
        name="description_es"
        defaultValue={props.description}
      />

      {/* La ruta actual viaja para poder BORRAR el objeto de Storage al quitar la foto: sin
          ella, la fila se quedaría sin referencia y el fichero huérfano ahí para siempre. */}
      {props.imagePath ? (
        <input type="hidden" name="current_image" value={props.imagePath} />
      ) : null}

      {/* Ver la foto actual antes de sustituirla: sin vista previa, "Sustituir foto" pide
          decidir a ciegas sobre algo que sí se puede mirar. */}
      {props.imageUrl ? (
        // biome-ignore lint/performance/noImgElement: miniatura de admin; next/image exigiría remotePatterns con el host de Supabase, que varía por despliegue
        <img
          data-testid="product-edit-current-image"
          src={props.imageUrl}
          alt="Foto actual del producto"
          width={72}
          height={72}
        />
      ) : null}

      {/* Sin fichero nuevo y sin marcar "quitar", la foto actual se conserva: elegir foto es
          opcional en una edición.

          "Sustituir foto" y no "Cambiar imagen": `getByLabel` hace subcadena sin distinguir
          mayúsculas, así que cualquier etiqueta que CONTENGA "Imagen" casaría también con la
          del formulario de alta -- único en la página y localizado así por sus tests -- y
          con 184 productos ese localizador pasaría de 1 a 185 elementos.

          `accept` lista los tipos EXACTOS que acepta el servidor, no `image/*`: con el
          comodín, el selector del sistema deja elegir un HEIC (el formato por defecto de las
          fotos de iPhone) y la subida muere con un error crudo tras esperar a que suba. */}
      <label htmlFor={`${formId}-image`}>Sustituir foto</label>
      <input
        id={`${formId}-image`}
        name="image"
        type="file"
        accept="image/png,image/jpeg,image/webp"
      />

      {props.imageUrl ? (
        <label>
          <input type="checkbox" name="remove_image" data-testid="remove-image" />
          Quitar la foto
        </label>
      ) : null}

      <fieldset>
        <legend>Alérgenos</legend>
        {props.allergens.map((allergen) => (
          <label key={allergen.id}>
            <input
              type="checkbox"
              checked={selectedAllergenIds.includes(allergen.id)}
              onChange={() => toggleAllergen(allergen.id)}
            />
            {allergen.name}
          </label>
        ))}
      </fieldset>
      <input type="hidden" name="allergen_ids" value={selectedAllergenIds.join(",")} />

      <button type="submit">Guardar cambios</button>
    </form>
  );
}
