/**
 * TEXTO DE LAS PÁGINAS LEGALES, parametrizado por los datos del tenant.
 *
 * Quién es quién, y por qué importa: el RESTAURANTE es el responsable del tratamiento —
 * decide qué se pide, para qué y cuánto se guarda. SuarEx es ENCARGADO: trata los datos del
 * comensal por cuenta suya, siguiendo sus instrucciones (art. 28 RGPD). Por eso estas páginas
 * se sirven bajo el host del tenant, con SUS datos, y nombran a SuarEx como proveedor.
 * Publicarlas bajo la marca de SuarEx invertiría los papeles y sería falso.
 *
 * Es CONTENIDO, no funcionalidad: por la doctrina del producto las tres páginas existen para
 * todos los clientes; lo que cambia por tenant son los datos que se interpolan.
 *
 * Los plazos de retención que declara la política (90 días las notas, 24 meses el pedido) los
 * ejecuta `purge_order_personal_data`. Cambiar uno sin el otro convierte esto en una promesa
 * falsa; `legal-content.test.ts` los ata.
 */

export const DOCUMENTOS_LEGALES = ["privacidad", "aviso-legal", "condiciones"] as const;

export type DocumentoLegal = (typeof DOCUMENTOS_LEGALES)[number];

export type DatosLegales = {
  businessName: string;
  legalName?: string;
  cif?: string;
  address?: string;
  phone?: string;
};

export type Seccion = { titulo: string; parrafos: string[] };

export function esDocumentoLegal(valor: string): valor is DocumentoLegal {
  return (DOCUMENTOS_LEGALES as readonly string[]).includes(valor);
}

/** Identificación del responsable, con los campos que falten simplemente omitidos: mejor una
 *  línea corta que un "undefined" impreso en una página legal. */
function identificacion(d: DatosLegales): string {
  return [
    d.legalName?.trim() || d.businessName,
    d.cif?.trim() ? `CIF ${d.cif.trim()}` : null,
    d.address?.trim(),
    d.phone?.trim() ? `tel. ${d.phone.trim()}` : null,
  ]
    .filter((parte): parte is string => Boolean(parte))
    .join(" · ");
}

export function documentoLegal(
  slug: DocumentoLegal,
  d: DatosLegales,
): { titulo: string; secciones: Seccion[] } {
  const quien = identificacion(d);

  if (slug === "privacidad") {
    return {
      titulo: "Política de privacidad",
      secciones: [
        {
          titulo: "Responsable del tratamiento",
          parrafos: [
            `${quien} (en adelante, “el establecimiento”) es el responsable del tratamiento de los datos que facilitas al pedir desde la carta digital.`,
            "SuarEx Soluciones Digitales presta el servicio técnico de carta, pedido y comanda, y actúa como encargado del tratamiento por cuenta del establecimiento, conforme al artículo 28 del RGPD.",
          ],
        },
        {
          titulo: "Qué datos se tratan",
          parrafos: [
            "Los del pedido: mesa, productos elegidos, notas que escribas al pedir, importe, fecha y hora, e idioma de la carta.",
            "No se te pide nombre, correo ni teléfono para pedir. Si pagas con tarjeta, los datos de la tarjeta los trata directamente Stripe Payments Europe Ltd. como proveedor de pago: ni el establecimiento ni SuarEx llegan a verlos ni a almacenarlos.",
            "Se usa una cookie técnica (“suarex_mesa”) que recuerda desde qué mesa escaneaste el QR, durante 12 horas. Sin ella no se puede pedir. No sirve para perfilar ni para publicidad.",
          ],
        },
        {
          titulo: "Para qué y con qué base",
          parrafos: [
            "Para atender tu pedido, imprimir la comanda en cocina y cobrar: base jurídica, la ejecución del contrato (art. 6.1.b RGPD).",
            "Para cumplir las obligaciones contables y fiscales del establecimiento: cumplimiento de una obligación legal (art. 6.1.c RGPD).",
          ],
        },
        {
          titulo: "Cuánto se conservan",
          parrafos: [
            "Las notas que escribes al pedir se borran a los 90 días: son texto libre y no hacen falta pasado el servicio.",
            "El resto de datos del pedido se conservan 24 meses y después se eliminan, sin perjuicio de los plazos que la normativa fiscal imponga al establecimiento sobre sus propios registros contables.",
          ],
        },
        {
          titulo: "Destinatarios",
          parrafos: [
            "SuarEx Soluciones Digitales (encargado del tratamiento) y Stripe Payments Europe Ltd. (procesamiento del pago). No se ceden datos a nadie más ni se realizan transferencias internacionales fuera de las que Stripe declara en su propia política.",
          ],
        },
        {
          titulo: "Tus derechos",
          parrafos: [
            `Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad dirigiéndote al establecimiento: ${quien}.`,
            "También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es) si consideras que el tratamiento no se ajusta a la normativa.",
          ],
        },
      ],
    };
  }

  if (slug === "aviso-legal") {
    return {
      titulo: "Aviso legal",
      secciones: [
        {
          titulo: "Titular",
          parrafos: [
            `Este sitio es la carta digital de ${quien}.`,
            "La plataforma técnica que lo sirve es propiedad de SuarEx Soluciones Digitales, que la opera como proveedor del establecimiento.",
          ],
        },
        {
          titulo: "Condiciones de uso",
          parrafos: [
            "El acceso a la carta es libre. Para realizar un pedido hay que escanear el código QR de una mesa del establecimiento: sin ese escaneo se puede consultar la carta, pero no pedir.",
            "Los precios y la disponibilidad de los productos los fija y actualiza el establecimiento.",
          ],
        },
        {
          titulo: "Propiedad intelectual",
          parrafos: [
            "Los textos, fotografías y marcas del catálogo pertenecen al establecimiento. El software de la plataforma pertenece a SuarEx Soluciones Digitales.",
          ],
        },
      ],
    };
  }

  return {
    titulo: "Condiciones del servicio",
    secciones: [
      {
        titulo: "Qué es este servicio",
        parrafos: [
          `Una carta digital que permite pedir y pagar desde la mesa de ${d.businessName}. El pedido se envía a la cocina del establecimiento, que es quien lo prepara y lo sirve.`,
        ],
      },
      {
        titulo: "Pago y justificante",
        parrafos: [
          "El pago con tarjeta se procesa a través de Stripe. Al terminar recibes un justificante de pedido con el desglose de lo que has pedido.",
          "Ese justificante no es una factura. Si necesitas factura, pídesela al establecimiento: es él quien la emite.",
        ],
      },
      {
        titulo: "Incidencias, cambios y devoluciones",
        parrafos: [
          `Cualquier incidencia con un pedido —un producto que no llega, un error en la comanda o una devolución— se resuelve directamente con el establecimiento: ${quien}. SuarEx presta el soporte técnico de la plataforma, no atiende el servicio de sala.`,
        ],
      },
    ],
  };
}
