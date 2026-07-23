import Image from "next/image";
import { updateSettingsAction } from "./actions";

type Props = {
  name: string;
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string };
  fonts: { display: string; body: string };
  logoUrl: string | null;
  heroUrl: string | null;
  fiscal: {
    legalName: string;
    cif: string;
    address: string;
    phone: string;
    taxRatePercent: string;
  };
  locale: string;
  currency: string;
  /** Dominio propio ya guardado, o cadena vacía si el cliente no tiene. */
  customDomain: string;
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
          <input name="name" defaultValue={props.name} maxLength={80} />
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
        {props.logoUrl ? (
          <Image src={props.logoUrl} alt="Logo actual" width={80} height={80} unoptimized />
        ) : null}
        {/* La pantalla de bienvenida la tienen todos los clientes; lo que cada uno elige es
            esta foto. Sin ella, el tema la resuelve con su marca. */}
        <label>
          Foto de bienvenida (PNG/JPG/WebP, máx 5 MB)
          <input name="hero" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        {props.heroUrl ? (
          <Image
            src={props.heroUrl}
            alt="Foto de bienvenida actual"
            width={80}
            height={80}
            unoptimized
          />
        ) : null}
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
        <legend>Dominio propio</legend>
        <label>
          Dominio propio (opcional)
          <input
            name="custom_domain"
            defaultValue={props.customDomain}
            placeholder="ejemplo.com"
            data-testid="custom-domain-input"
          />
        </label>
        <p>
          Escribe solo el nombre del dominio, sin <code>https://</code> ni rutas. Apunta su registro
          A a la IP de la plataforma: el certificado se emite solo la primera vez que alguien lo
          visita. Déjalo vacío para volver a tu subdominio.
        </p>
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
