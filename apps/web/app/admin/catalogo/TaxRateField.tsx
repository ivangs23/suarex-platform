/**
 * Tipo de IVA de una categoría o de un producto.
 *
 * Un desplegable y no un campo libre a propósito: en España los tipos son cuatro y están
 * tasados, así que ofrecerlos evita la errata de teclear "1O" o "0,21" y que el ticket salga mal.
 *
 * "Heredar" es el valor por defecto y significa exactamente eso: el producto toma el de su
 * categoría, y la categoría el de la casa (Ajustes). Un bar normal no toca esto nunca; uno con
 * tienda pone su categoría al 21 % y se olvida.
 */
export function TaxRateField({
  id,
  defaultValue,
  heredaDe,
  etiqueta,
}: {
  id: string;
  /** Valor guardado en tanto por uno, o `null` si hereda. */
  defaultValue?: number | null;
  /** De quién hereda, para decirlo con palabras en la opción vacía. */
  heredaDe: "la categoría" | "los ajustes del negocio";
  /**
   * Cada uso de este campo en la página necesita su propia etiqueta, y ninguna puede ser
   * subcadena de otra: `getByLabel` casa por subcadena sin distinguir mayúsculas, así que un
   * "IVA" a secas repetido en los dos formularios de alta ya casaría con dos elementos, y
   * repetido en las ediciones convertiría ese localizador en 185. De ahí los cuatro rótulos
   * distintos -- y "Tipo impositivo" en las ediciones, que no contiene "IVA" ni al revés.
   */
  etiqueta:
    | "IVA de la categoría"
    | "IVA del producto"
    | "Tipo impositivo de la categoría"
    | "Tipo impositivo del producto";
}) {
  return (
    <>
      <label htmlFor={id}>{etiqueta}</label>
      <select
        id={id}
        name="tax_rate"
        defaultValue={defaultValue == null ? "" : String(defaultValue)}
      >
        <option value="">Heredar de {heredaDe}</option>
        <option value="0.21">21 % — general</option>
        <option value="0.1">10 % — reducido (hostelería)</option>
        <option value="0.04">4 % — superreducido</option>
        <option value="0">0 % — exento</option>
      </select>
    </>
  );
}
