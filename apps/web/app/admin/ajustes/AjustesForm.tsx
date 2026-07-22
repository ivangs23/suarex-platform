import { updateSettingsAction } from "./actions";

type Props = {
  name: string;
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  fonts: { display: string; body: string };
  logoUrl: string | null;
  fiscal: {
    legalName: string;
    cif: string;
    address: string;
    phone: string;
    taxRatePercent: string;
  };
  locale: string;
  currency: string;
};

/** Formulario funcional (sin estilos) de ajustes del negocio. `encType` multipart para
 * poder subir el logo. Cada campo prellenado con el valor actual. */
export function AjustesForm(props: Props) {
  return (
    <form action={updateSettingsAction} encType="multipart/form-data" data-testid="ajustes-form">
      <fieldset>
        <legend>Marca</legend>
        <label>
          Nombre del negocio
          <input name="name" defaultValue={props.name} />
        </label>
        <label>
          Color de fondo
          <input name="color_bg" type="color" defaultValue={props.colors.bg} />
        </label>
        <label>
          Color de texto
          <input name="color_fg" type="color" defaultValue={props.colors.fg} />
        </label>
        <label>
          Color primario
          <input name="color_primary" type="color" defaultValue={props.colors.primary} />
        </label>
        <label>
          Color de acento
          <input name="color_accent" type="color" defaultValue={props.colors.accent} />
        </label>
        <label>
          Color tenue
          <input name="color_muted" type="color" defaultValue={props.colors.muted} />
        </label>
        <label>
          Fuente de títulos
          <input name="font_display" defaultValue={props.fonts.display} />
        </label>
        <label>
          Fuente de texto
          <input name="font_body" defaultValue={props.fonts.body} />
        </label>
        <label>
          Logo (PNG/JPG/WebP, máx 5 MB)
          <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        {props.logoUrl ? <img src={props.logoUrl} alt="Logo actual" width={80} /> : null}
      </fieldset>

      <fieldset>
        <legend>Datos fiscales</legend>
        <label>
          Razón social
          <input name="legal_name" defaultValue={props.fiscal.legalName} />
        </label>
        <label>
          CIF
          <input name="cif" defaultValue={props.fiscal.cif} />
        </label>
        <label>
          Dirección
          <input name="address" defaultValue={props.fiscal.address} />
        </label>
        <label>
          Teléfono
          <input name="phone" defaultValue={props.fiscal.phone} />
        </label>
        <label>
          IVA (%)
          <input
            name="tax_rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={props.fiscal.taxRatePercent}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Regional</legend>
        <label>
          Idioma
          <input name="locale" defaultValue={props.locale} />
        </label>
        <label>
          Moneda (3 letras)
          <input name="currency" defaultValue={props.currency} maxLength={3} />
        </label>
      </fieldset>

      <button type="submit">Guardar ajustes</button>
    </form>
  );
}
