import { updateCategoryAction } from "./actions";

type Props = {
  categoryId: string;
  name: string;
  slug: string;
  destination: "cocina" | "barra";
};

/**
 * Edición de una categoría. Componente de servidor (sin `"use client"`), a diferencia de
 * `ProductEditForm`: aquí no hay casillas de alérgeno que agrupar, así que un `<form>`
 * nativo con la Server Action basta.
 *
 * El `slug` SÍ es editable, pero cambiarlo rompe los enlaces que ya circulen a esa
 * categoría (`/{mesa}?cat=<slug>`): un QR impreso apuntando a una categoría concreta, o un
 * enlace compartido, dejarán de resolver y la carta caerá a la raíz -- degrada, no rompe
 * (ver `buildMenuView`). Se avisa en el propio formulario para que sea una decisión
 * consciente y no una sorpresa.
 */
export function CategoryEditForm(props: Props) {
  return (
    <form action={updateCategoryAction} data-testid="category-edit-form">
      <input type="hidden" name="category_id" value={props.categoryId} />

      {/* "Nombre" a secas, no "Nombre de la categoría": esa etiqueta la usa el formulario
          de ALTA (`CategoryForm`), único en la página, y los tests lo localizan por ella.
          Repetirla aquí en las 59 categorías rompería ese localizador (`getByLabel` casaría
          con 60 elementos). */}
      <label>
        Nombre
        <input name="name_es" type="text" defaultValue={props.name} required />
      </label>

      <label>
        Identificador en la URL
        <input name="slug" type="text" defaultValue={props.slug} required />
      </label>
      <p>Cambiarlo invalida los enlaces que ya apunten a esta categoría.</p>

      {/* "Imprime en", no "Destino": el alta (`CategoryForm`) usa "Destino" y su test lo
          localiza por esa etiqueta sin `exact`, así que repetir el prefijo aquí en las 59
          categorías rompería ese localizador. */}
      <label>
        Imprime en
        <select name="destination" defaultValue={props.destination}>
          <option value="cocina">Cocina</option>
          <option value="barra">Barra</option>
        </select>
      </label>

      <button type="submit">Guardar categoría</button>
    </form>
  );
}
