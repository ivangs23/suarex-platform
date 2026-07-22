import { createCategoryAction } from "./actions";

/**
 * Alta de categoría. Formulario de servidor puro -- sin "use client", sin estado --
 * porque no necesita nada que el navegador haga por sí solo: `action={createCategoryAction}`
 * ya basta para que Next lo envíe como Server Action (ver `app/admin/catalogo/actions.ts`,
 * envuelto en `managerAction`, así que el rol se comprueba SIEMPRE antes de crear nada).
 */
export function CategoryForm() {
  return (
    <form action={createCategoryAction}>
      <h3>Nueva categoría</h3>

      <label htmlFor="category-slug">Slug</label>
      <input id="category-slug" name="slug" type="text" required />

      <label htmlFor="category-name">Nombre de la categoría</label>
      <input id="category-name" name="name_es" type="text" required />

      <label htmlFor="category-destination">Destino</label>
      <select id="category-destination" name="destination" defaultValue="cocina">
        <option value="cocina">Cocina</option>
        <option value="barra">Barra</option>
      </select>

      <button type="submit">Crear categoría</button>
    </form>
  );
}
