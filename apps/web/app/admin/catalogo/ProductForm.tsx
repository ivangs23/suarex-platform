"use client";

import { useId, useState } from "react";
import { createProductAction } from "./actions";

type CategoryOption = { id: string; name: string };
type AllergenOption = { id: number; name: string };

/**
 * Alta de producto. "use client" -- a diferencia de `CategoryForm` -- SOLO porque las
 * casillas de alérgeno necesitan construir el campo `allergen_ids` que espera la Server
 * Action: `createProductAction` (`app/admin/catalogo/actions.ts`) lee un ÚNICO campo
 * `allergen_ids` con los ids separados por comas (`parseAllergenIds`, mismo fichero),
 * no una entrada de FormData por casilla marcada (que es lo que produciría un grupo de
 * checkboxes nativo con el mismo `name`, vía `formData.getAll`). En vez de reimplementar
 * ese parseo en dos sitios, este componente mantiene el conjunto de ids marcados en
 * estado y lo vuelca a un único `<input type="hidden" name="allergen_ids">` cuyo valor
 * ya es la cadena unida -- el `<form action={createProductAction}>` sigue siendo un
 * envío nativo normal, sin `preventDefault` ni FormData fabricado a mano.
 *
 * El campo `image` es un `<input type="file">` normal: los ficheros siempre viajan en
 * el FormData nativo, controlados o no, así que no necesita ningún estado de React --
 * `extractImagePath` (`actions.ts`) lo sube con `uploadProductImage` si llega no vacío.
 */
export function ProductForm({
  categories,
  allergens,
}: {
  categories: CategoryOption[];
  allergens: AllergenOption[];
}) {
  const [selectedAllergenIds, setSelectedAllergenIds] = useState<number[]>([]);
  const formId = useId();

  function toggleAllergen(id: number) {
    setSelectedAllergenIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }

  return (
    <form action={createProductAction}>
      <h3>Nuevo producto</h3>

      <label htmlFor={`${formId}-category`}>Categoría</label>
      <select id={`${formId}-category`} name="category_id" required>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <label htmlFor={`${formId}-name`}>Nombre del producto</label>
      <input id={`${formId}-name`} name="name_es" type="text" required />

      <label htmlFor={`${formId}-description`}>Descripción del producto</label>
      <textarea id={`${formId}-description`} name="description_es" />

      <label htmlFor={`${formId}-price`}>Precio del producto (€)</label>
      <input id={`${formId}-price`} name="price" type="number" step="0.01" min="0" required />

      <label htmlFor={`${formId}-image`}>Imagen</label>
      {/* Los tipos EXACTOS que acepta el servidor, no `image/*`: con el comodín, el
          selector deja elegir un HEIC (formato por defecto del iPhone) y la subida muere con
          un error crudo tras esperar a que suba. */}
      <input
        id={`${formId}-image`}
        name="image"
        type="file"
        accept="image/png,image/jpeg,image/webp"
      />

      <fieldset>
        <legend>Alérgenos</legend>
        {allergens.map((allergen) => (
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

      <button type="submit">Crear producto</button>
    </form>
  );
}
