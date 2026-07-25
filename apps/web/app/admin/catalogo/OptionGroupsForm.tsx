import type { AdminOptionGroup } from "@suarex/db";
import { createOptionGroupAction, deleteOptionGroupAction } from "./actions";

/**
 * GRUPOS DE OPCIONES de un producto (#16): "Punto de la carne" (elige 1), "Guarnición" (elige 2),
 * "Salsas" (hasta 2, opcional).
 *
 * Vive DENTRO del bloque de cada producto y no en un formulario global como el de extras: un
 * grupo no tiene sentido sin su producto, y con 184 productos un desplegable de "¿a cuál?" sería
 * una lista de 184 opciones que hay que buscar a mano cada vez.
 *
 * Componente de servidor: dos `<form>` nativos con sus Server Actions bastan, sin estado.
 *
 * Borrar un grupo NO borra sus opciones (`on delete set null`, ver la migración): se quedan como
 * añadidos sueltos. Se dice aquí para que el gestor no lo descubra al borrarlo -- ni deje de
 * borrarlo por miedo a perder lo que escribió.
 */
export function OptionGroupsForm({
  productId,
  groups,
}: {
  productId: string;
  groups: AdminOptionGroup[];
}) {
  return (
    <div data-testid="option-groups">
      {groups.length > 0 ? (
        <ul>
          {groups.map((group) => (
            <li key={group.id} data-testid="option-group-row">
              <span>{group.nameI18n.es ?? ""}</span>{" "}
              <span>
                (mín. {group.minSelect}, máx. {group.maxSelect})
              </span>
              <form action={deleteOptionGroupAction}>
                <input type="hidden" name="group_id" value={group.id} />
                <button type="submit" data-testid="delete-option-group">
                  Borrar grupo
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p>Este producto no tiene grupos de opciones.</p>
      )}

      <form action={createOptionGroupAction} data-testid="option-group-form">
        <input type="hidden" name="product_id" value={productId} />

        <label htmlFor={`group-name-${productId}`}>Nombre del grupo</label>
        <input id={`group-name-${productId}`} name="name_es" type="text" required />

        {/* Mínimo 1 = obligatorio, que es el caso que motiva todo esto; 0 = solo agrupa. */}
        <label htmlFor={`group-min-${productId}`}>Elegir como mínimo</label>
        <input
          id={`group-min-${productId}`}
          name="min_select"
          type="number"
          min="0"
          step="1"
          defaultValue={1}
          required
        />

        <label htmlFor={`group-max-${productId}`}>Elegir como máximo</label>
        <input
          id={`group-max-${productId}`}
          name="max_select"
          type="number"
          min="1"
          step="1"
          defaultValue={1}
          required
        />

        <button type="submit">Crear grupo</button>
      </form>

      <p>
        Las opciones se crean abajo, en «Nuevo extra», eligiendo este grupo. Al borrar un grupo, sus
        opciones se conservan como extras sueltos.
      </p>
    </div>
  );
}
