"use client";

/**
 * Formulario de borrado genérico, reutilizado por categorías, productos, extras y
 * alérgenos propios del tenant (Task 5): un único `<button>` que dispara la Server
 * Action correspondiente (`deleteCategoryAction`, `deleteProductAction`, ...), pero
 * SOLO tras confirmar en un `window.confirm()` -- de ahí que este componente sea
 * "use client" (necesita `onSubmit` en el navegador) aunque la propia action siga
 * siendo un Server Action normal, importado desde un fichero "use server".
 *
 * El mensaje de confirmación lo decide quien llama (`confirmMessage`): para
 * categorías y productos incluye la advertencia de cascada -- borrar una categoría
 * borra también sus productos y extras (`on delete cascade`, ver
 * `20260721000002_catalog.sql`); borrar un producto borra sus extras.
 */
export function ConfirmDeleteForm({
  action,
  hiddenName,
  hiddenValue,
  confirmMessage,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  hiddenName: string;
  hiddenValue: string;
  confirmMessage: string;
  label: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name={hiddenName} value={hiddenValue} />
      <button type="submit" data-danger="true">
        {label}
      </button>
    </form>
  );
}
