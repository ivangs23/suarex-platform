import {
  type Branding,
  FONT_FAMILIES,
  type LAYOUT_OPTIONS,
  type TOKEN_OPTIONS,
} from "@suarex/config";
import { MAX_MB_IMAGEN } from "@suarex/domain";
import Image from "next/image";
import { SUPPORTED_LANGS } from "@/lib/i18n";
import { CampoFoto } from "../CampoFoto";
import { updateSettingsAction } from "./actions";

/* Cómo se llama en el panel cada valor de los selects. Las claves son los valores que guarda
   `branding` (ver `@suarex/config`): un valor nuevo sin etiqueta aquí no compila. */
const FONT_LABELS: Record<(typeof FONT_FAMILIES)[number], string> = {
  playfair: "Playfair Display (con remate)",
  inter: "Inter (sin remate)",
  system: "La del sistema",
};

const LAYOUT_FIELDS: {
  [K in keyof typeof LAYOUT_OPTIONS]: {
    label: string;
    values: Record<(typeof LAYOUT_OPTIONS)[K][number], string>;
  };
} = {
  welcome: {
    label: "Pantalla de bienvenida",
    values: { panel: "Recuadro sobre la foto", poster: "Cartel a pantalla completa" },
  },
  hero: {
    label: "Cabecera de la carta",
    values: { plain: "Nombre grande", card: "Nombre en tarjeta", none: "Sin cabecera" },
  },
  nav: {
    label: "Navegación entre categorías",
    values: { "back-button": "Botón de volver", "title-pill": "Píldora con el nombre" },
  },
  categories: {
    label: "Tarjetas de categoría",
    values: { "icon-tiles": "Con icono", "photo-tiles": "Con foto" },
  },
  products: {
    label: "Platos",
    values: { list: "En lista", cards: "En tarjetas con foto" },
  },
  langs: {
    label: "Selector de idioma",
    values: { code: "Código (ES, EN)", flag: "Bandera y código" },
  },
};

const TOKEN_FIELDS: {
  [K in keyof typeof TOKEN_OPTIONS]: {
    name: string;
    label: string;
    values: Record<(typeof TOKEN_OPTIONS)[K][number], string>;
  };
} = {
  radius: {
    name: "token_radius",
    label: "Esquinas de las tarjetas",
    values: { md: "Suaves", lg: "Muy redondeadas" },
  },
  controlRadius: {
    name: "token_control_radius",
    label: "Forma de los botones",
    values: { pill: "Píldora", rounded: "Rectángulo redondeado" },
  },
  shadow: {
    name: "token_shadow",
    label: "Sombra de las tarjetas",
    values: { none: "Sin sombra", soft: "Suave", medium: "Marcada" },
  },
  border: {
    name: "token_border",
    label: "Borde de las tarjetas",
    values: { thin: "Fino", thick: "Grueso" },
  },
  spacing: {
    name: "token_spacing",
    label: "Aire dentro de las tarjetas",
    values: { compact: "Compacto", comfortable: "Holgado" },
  },
  titles: {
    name: "token_titles",
    label: "Nombres de categorías y platos",
    values: { normal: "Normales", uppercase: "En mayúsculas" },
  },
  imageFit: {
    name: "token_image_fit",
    label: "Fotos de los platos",
    values: { cover: "Recortadas a la tarjeta", contain: "Enteras" },
  },
  thumb: {
    name: "token_thumb",
    label: "Tamaño de la miniatura",
    values: { sm: "Pequeña", md: "Mediana" },
  },
  cartIcon: {
    name: "token_cart_icon",
    label: "Icono del botón del pedido",
    values: { none: "Sin icono", bag: "Bolsa" },
  },
};

type Props = {
  branding: Branding;
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
  channels: string[];
};

/** Formulario funcional (sin estilos) de ajustes del negocio. `encType` multipart para
 * poder subir las imágenes. Cada campo prellenado con el valor actual: el formulario manda la
 * marca ENTERA, así que un campo que faltara aquí se borraría al guardar. */
export function AjustesForm(props: Props) {
  const { branding } = props;
  return (
    <form action={updateSettingsAction} encType="multipart/form-data" data-testid="ajustes-form">
      <fieldset>
        <legend>Marca</legend>
        <label>
          Nombre del negocio
          <input name="name" defaultValue={branding.name ?? ""} maxLength={80} />
        </label>
        <label>
          Color de fondo
          <input name="color_bg" type="color" defaultValue={branding.colors.bg} />
        </label>
        <label>
          Color de texto
          <input name="color_fg" type="color" defaultValue={branding.colors.fg} />
        </label>
        <label>
          Color primario
          <input name="color_primary" type="color" defaultValue={branding.colors.primary} />
        </label>
        <label>
          Color de acento
          <input name="color_accent" type="color" defaultValue={branding.colors.accent} />
        </label>
        <label>
          Color tenue
          <input name="color_muted" type="color" defaultValue={branding.colors.muted} />
        </label>
        <label>
          Fuente de títulos
          <select name="font_display" defaultValue={branding.fonts.display}>
            {FONT_FAMILIES.map((familia) => (
              <option key={familia} value={familia}>
                {FONT_LABELS[familia]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fuente de texto
          <select name="font_body" defaultValue={branding.fonts.body}>
            {FONT_FAMILIES.map((familia) => (
              <option key={familia} value={familia}>
                {FONT_LABELS[familia]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="ajustes-logo">
          Logo (PNG/JPG/WebP, máx {MAX_MB_IMAGEN} MB)
          <CampoFoto id="ajustes-logo" name="logo" />
        </label>
        {branding.logoUrl ? (
          <Image src={branding.logoUrl} alt="Logo actual" width={80} height={80} unoptimized />
        ) : null}
        {/* La pantalla de bienvenida la tienen todos los clientes; lo que cada uno elige es
            esta foto. Sin ella, la carta la resuelve con su marca. */}
        <label htmlFor="ajustes-hero">
          Foto de bienvenida (PNG/JPG/WebP, máx {MAX_MB_IMAGEN} MB)
          <CampoFoto id="ajustes-hero" name="hero" />
        </label>
        {branding.heroUrl ? (
          <Image
            src={branding.heroUrl}
            alt="Foto de bienvenida actual"
            width={80}
            height={80}
            unoptimized
          />
        ) : null}
        {/* El lema es contenido: va por idioma, como la carta. Vacío = sin lema en ese idioma. */}
        {SUPPORTED_LANGS.map((lang) => (
          <label key={lang}>
            Lema ({lang.toUpperCase()})
            <input
              name={`tagline_${lang}`}
              defaultValue={branding.tagline[lang] ?? ""}
              maxLength={120}
            />
          </label>
        ))}
      </fieldset>

      {/* Cómo se ve la carta. Cambia el aspecto y dónde cae cada cosa, nunca qué puede hacer el
          comensal: los pasos del pedido son los mismos con cualquier combinación. */}
      <fieldset>
        <legend>Disposición de la carta</legend>
        {(Object.keys(LAYOUT_FIELDS) as (keyof typeof LAYOUT_FIELDS)[]).map((eje) => {
          const campo = LAYOUT_FIELDS[eje];
          return (
            <label key={eje}>
              {campo.label}
              <select name={`layout_${eje}`} defaultValue={branding.layout[eje]}>
                {Object.entries(campo.values).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </fieldset>

      <fieldset>
        <legend>Estilo</legend>
        <label>
          Color de las tarjetas (vacío = automático, a partir del color tenue)
          <input
            name="token_surface"
            defaultValue={branding.tokens.surface ?? ""}
            placeholder="#ffffff"
            pattern="#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?"
          />
        </label>
        {(Object.keys(TOKEN_FIELDS) as (keyof typeof TOKEN_FIELDS)[]).map((token) => {
          const campo = TOKEN_FIELDS[token];
          return (
            <label key={token}>
              {campo.label}
              <select name={campo.name} defaultValue={branding.tokens[token]}>
                {Object.entries(campo.values).map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <label htmlFor="ajustes-textura">
          Textura de fondo (PNG/JPG/WebP, máx {MAX_MB_IMAGEN} MB; se repite por toda la carta)
          <CampoFoto id="ajustes-textura" name="textura" />
        </label>
        {branding.background.imageUrl ? (
          <Image
            src={branding.background.imageUrl}
            alt="Textura actual"
            width={80}
            height={80}
            unoptimized
          />
        ) : null}
        <label>
          Tamaño de la textura (px)
          <input
            name="background_size"
            type="number"
            min={40}
            max={1200}
            step={1}
            defaultValue={branding.background.sizePx}
          />
        </label>
        {/* Solo se ve en la bienvenida tipo cartel. Sin emoji no hay insignia. */}
        <label>
          Insignia de la bienvenida (un emoji; vacío = sin insignia)
          <input name="badge_emoji" defaultValue={branding.badge?.emoji ?? ""} maxLength={8} />
        </label>
        <label>
          Color de la insignia
          <input
            name="badge_color"
            type="color"
            defaultValue={branding.badge?.color ?? branding.colors.primary}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Datos fiscales</legend>
        <label>
          Razón social
          <input name="legal_name" defaultValue={props.fiscal.legalName} />
        </label>
        <label>
          NIF
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

      {/* Qué canales tiene contratados este negocio. Es la traducción literal de la regla del
          producto: la funcionalidad es la misma para todos y lo que cambia es qué se enciende.
          Un canal apagado no se esconde en el panel -- se apaga de cara al comensal. */}
      <fieldset>
        <legend>Canales de venta</legend>
        <label>
          <input
            type="checkbox"
            name="channel_qr"
            defaultChecked={props.channels.includes("qr-mesa")}
            data-testid="channel-qr"
          />
          Carta por QR en las mesas
        </label>
        <label>
          <input
            type="checkbox"
            name="channel_kiosko"
            defaultChecked={props.channels.includes("kiosko")}
            data-testid="channel-kiosko"
          />
          Totem de autopedido
        </label>
        <p>
          Lo que quede desmarcado deja de servirse: la carta o el totem dejan de abrir para el
          cliente, aunque el resto de la configuración siga guardada.
        </p>
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
