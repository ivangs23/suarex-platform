import { AVISO_NO_FACTURA, ETIQUETA_EMISOR } from "@suarex/domain";

/**
 * IDIOMA DE LA CARTA.
 *
 * El catálogo se guarda por idioma (`name_i18n`, `description_i18n`: `{es, en, pt}`). La carta
 * enseña el idioma elegido y cae al del cliente cuando un campo no está traducido. El catálogo
 * de Manuela entró solo en español; sus traducciones al inglés y al portugués las rellena
 * `scripts/traducir-manuela.mjs` (nombres de categoría, descripciones y extras -- los nombres
 * de plato son de marca y se dejan igual). Sin más de un idioma con contenido, el selector no
 * aparece: ofrecer "EN" para acabar enseñando la carta en español es peor que no ofrecerlo.
 *
 * El idioma va en la URL (`?lang=en`) y no en una cookie: es el mismo modelo que el resto de
 * la navegación de la carta (nivel, paso de bienvenida), funciona sin JavaScript, y un enlace
 * compartido enseña lo mismo a quien lo abra. Con una cookie, la misma URL enseñaría cosas
 * distintas a cada uno.
 */

/** Idiomas que la plataforma sabe pintar. El catálogo puede traer más; se ignoran. */
export const SUPPORTED_LANGS = ["es", "en", "pt"] as const;

export type Lang = (typeof SUPPORTED_LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = { es: "ES", en: "EN", pt: "PT" };

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (SUPPORTED_LANGS as readonly string[]).includes(value);
}

/**
 * Idioma pedido en la URL, o el del cliente. Un valor desconocido o manipulado cae al del
 * cliente en vez de romper la carta.
 */
export function resolveLang(pedido: unknown, porDefecto: string | undefined): Lang {
  if (isLang(pedido)) return pedido;
  if (isLang(porDefecto)) return porDefecto;
  return "es";
}

/**
 * Texto de un campo por idioma.
 *
 * Cae al idioma del cliente y luego a cualquier traducción que exista, en vez de dejar el
 * hueco vacío: un plato sin nombre en la carta es peor que un plato con el nombre en otro
 * idioma. Es también lo que hace falta en la práctica -- de los 145 platos de Manuela solo
 * una parte están traducidos, y los que no deben seguir viéndose.
 */
export function pickI18n(
  campo: Record<string, string> | undefined,
  lang: Lang,
  porDefecto: Lang = "es",
): string {
  if (!campo) return "";
  const elegido = campo[lang]?.trim();
  if (elegido) return elegido;
  const respaldo = campo[porDefecto]?.trim();
  if (respaldo) return respaldo;
  return Object.values(campo).find((valor) => valor?.trim()) ?? "";
}

/**
 * Idiomas en los que ESTE cliente tiene carta.
 *
 * Se deducen de sus datos, no de un ajuste: ofrecer "EN" para acabar enseñando la carta en
 * español es peor que no ofrecerlo. Un idioma cuenta cuando lo tiene al menos un nombre de
 * producto o de categoría -- que es lo que el comensal va a leer.
 *
 * El idioma del cliente siempre entra, aunque su catálogo esté a medio traducir: es la carta
 * de partida.
 */
export function availableLangs(
  campos: (Record<string, string> | undefined)[],
  porDefecto: Lang,
): Lang[] {
  const presentes = new Set<Lang>([porDefecto]);
  for (const campo of campos) {
    if (!campo) continue;
    for (const clave of Object.keys(campo)) {
      if (isLang(clave) && campo[clave]?.trim()) presentes.add(clave);
    }
  }
  return SUPPORTED_LANGS.filter((lang) => presentes.has(lang));
}

/**
 * Los textos que pone la plataforma (no el cliente). Son pocos a propósito: todo lo que
 * describe la comida sale del catálogo del cliente, y traducir eso no es cosa nuestra.
 */
export type Strings = {
  enter: string;
  menuTitle: string;
  explore: string;
  backToCategories: string;
  dish: string;
  dishes: string;
  emptyMenu: string;
  addCustomize: string;
  scanToOrder: string;
  allergensTitle: string;
  allergensEmpty: string;
  allergensWarning: string;
  optionsTitle: string;
  notesTitle: string;
  notesLabel: string;
  totalPrice: string;
  addToOrder: string;
  yourOrder: string;
  viewOrder: string;
  cartEmpty: string;
  total: string;
  pay: string;
  sending: string;
  close: string;
  table: string;
  orderError: string;
  payTitle: string;
  payNow: string;
  payProcessing: string;
  payError: string;
  payBack: string;
  orderTitle: string;
  orderThanks: string;
  orderTotal: string;
  statusPending: string;
  statusPaid: string;
  statusPreparing: string;
  statusServed: string;
  statusCancelled: string;
  receiptTitle: string;
  receiptTable: string;
  receiptSubtotal: string;
  receiptTax: string;
  receiptIssuer: string;
  /** SuarEx NO es emisor de facturas (decisión D1 del spec de la Fase 1): este aviso es lo
   *  único que separa un justificante de pedido de un documento que lo parece. Se pinta
   *  SIEMPRE -- en pantalla y en el PDF, para todos los tenants y en todos los idiomas. */
  receiptNotInvoice: string;
  receiptPrint: string;
  receiptDownload: string;
  legalPrivacy: string;
  legalNotice: string;
  legalTerms: string;
  /** Consentimiento informado, junto al botón de pagar: es donde el comensal entrega sus
   *  datos, así que es donde tiene que poder leer qué se hace con ellos. */
  legalPayNote: string;
  backToMenu: string;
  // Modo totem (canal kiosko).
  totemStart: string;
  totemTakeaway: string;
  totemDineIn: string;
  totemEnterTable: string;
  totemTableNumber: string;
  totemNext: string;
  totemBack: string;
  totemDelete: string;
  totemPayAtTerminal: string;
  totemFollowTerminal: string;
  totemPaying: string;
  totemApproved: string;
  totemDeclined: string;
  totemRetry: string;
  totemCollect: string;
  totemPickupNumber: string;
  totemNewOrder: string;
  totemCancel: string;
  /** Reinicio por inactividad: el totem se queda a medias y hay que dejarlo listo para el
   *  siguiente cliente, pero sin borrarle el pedido a quien solo se ha parado a pensar. */
  totemStillThere: string;
  totemStillThereBody: string;
  totemImHere: string;
  totemStartOver: string;
  totemStartOverConfirm: string;
  /** Cobro aprobado que no se pudo registrar: el cliente ya pagó, así que jamás se le ofrece
   *  reintentar. Se le pide que avise al personal con el código de autorización a la vista. */
  totemInDoubt: string;
  totemInDoubtBody: string;
  totemAuthCode: string;
};

const ES: Strings = {
  enter: "Toca para empezar",
  menuTitle: "Menú",
  explore: "¿Qué te apetece hoy?",
  backToCategories: "← Explorar otras categorías",
  dish: "plato",
  dishes: "platos",
  emptyMenu: "La carta todavía no tiene productos.",
  addCustomize: "Añadir / Personalizar",
  scanToOrder: "Escanea el QR de tu mesa para pedir",
  allergensTitle: "Alérgenos e información",
  allergensEmpty: "No hay alérgenos declarados para este plato.",
  allergensWarning:
    "Si tienes alguna alergia severa no listada, contacta con el personal antes de pedir.",
  optionsTitle: "Personaliza tu pedido",
  notesTitle: "Notas especiales",
  notesLabel: "Notas para la cocina",
  totalPrice: "Precio total",
  addToOrder: "Añadir al pedido",
  yourOrder: "Tu pedido",
  viewOrder: "Ver pedido",
  cartEmpty: "Todavía no has añadido nada.",
  total: "Total",
  pay: "Pagar",
  sending: "Enviando…",
  close: "Cerrar",
  table: "Mesa",
  orderError: "No se pudo crear el pedido",
  payTitle: "Pago",
  payNow: "Pagar {total}",
  payProcessing: "Procesando…",
  payError: "No se pudo completar el pago. Revisa los datos de la tarjeta.",
  payBack: "Volver al pedido",
  orderTitle: "Pedido",
  orderThanks: "¡Gracias por tu pedido!",
  orderTotal: "Total",
  statusPending: "Pendiente de pago",
  statusPaid: "Pagado — preparándose",
  statusPreparing: "Preparándose",
  statusServed: "¡Servido! Que aproveche",
  statusCancelled: "Cancelado",
  receiptTitle: "Recibo",
  receiptTable: "Mesa",
  receiptSubtotal: "Base imponible",
  receiptTax: "IVA",
  receiptIssuer: ETIQUETA_EMISOR.es,
  receiptNotInvoice: AVISO_NO_FACTURA.es,
  receiptPrint: "Imprimir",
  receiptDownload: "Descargar recibo",
  legalPrivacy: "Privacidad",
  legalNotice: "Aviso legal",
  legalTerms: "Condiciones",
  legalPayNote: "Al pedir aceptas las condiciones y la política de privacidad.",
  backToMenu: "Volver a la carta",
  totemStart: "Empezar pedido",
  totemTakeaway: "Para llevar",
  totemDineIn: "Comer en mesa",
  totemEnterTable: "¿En qué mesa estás?",
  totemTableNumber: "Número de mesa",
  totemNext: "Continuar",
  totemBack: "Atrás",
  totemDelete: "Borrar",
  totemPayAtTerminal: "Pagar con tarjeta",
  totemFollowTerminal: "Sigue las instrucciones del datáfono",
  totemPaying: "Procesando el pago…",
  totemApproved: "Pago aprobado",
  totemDeclined: "Pago rechazado",
  totemRetry: "Reintentar",
  totemCollect: "Recoge tu ticket",
  totemPickupNumber: "Tu número",
  totemNewOrder: "Nuevo pedido",
  totemCancel: "Cancelar",
  totemStillThere: "¿Sigues ahí?",
  totemStillThereBody: "Si no, empezamos de nuevo para el siguiente cliente.",
  totemImHere: "Sigo aquí",
  totemStartOver: "Empezar de nuevo",
  totemStartOverConfirm: "¿Seguro que quieres empezar de nuevo? Se borrará tu pedido.",
  totemInDoubt: "Avisa al personal, por favor",
  totemInDoubtBody:
    "Tu pago se ha realizado, pero no hemos podido registrar el pedido. No vuelvas a pagar: enseña este código.",
  totemAuthCode: "Código de autorización",
};

const EN: Strings = {
  enter: "Tap to start",
  menuTitle: "Menu",
  explore: "What do you fancy today?",
  backToCategories: "← Browse other categories",
  dish: "dish",
  dishes: "dishes",
  emptyMenu: "This menu has no items yet.",
  addCustomize: "Add / Customise",
  scanToOrder: "Scan your table's QR code to order",
  allergensTitle: "Allergens and information",
  allergensEmpty: "No allergens declared for this dish.",
  allergensWarning:
    "If you have a severe allergy that is not listed, please speak to a member of staff before ordering.",
  optionsTitle: "Customise your order",
  notesTitle: "Special requests",
  notesLabel: "Notes for the kitchen",
  totalPrice: "Total price",
  addToOrder: "Add to order",
  yourOrder: "Your order",
  viewOrder: "View order",
  cartEmpty: "You haven't added anything yet.",
  total: "Total",
  pay: "Pay",
  sending: "Sending…",
  close: "Close",
  table: "Table",
  orderError: "The order could not be created",
  payTitle: "Payment",
  payNow: "Pay {total}",
  payProcessing: "Processing…",
  payError: "The payment could not be completed. Please check your card details.",
  payBack: "Back to order",
  orderTitle: "Order",
  orderThanks: "Thanks for your order!",
  orderTotal: "Total",
  statusPending: "Payment pending",
  statusPaid: "Paid — being prepared",
  statusPreparing: "Being prepared",
  statusServed: "Served! Enjoy",
  statusCancelled: "Cancelled",
  receiptTitle: "Receipt",
  receiptTable: "Table",
  receiptSubtotal: "Subtotal",
  receiptTax: "VAT",
  receiptIssuer: ETIQUETA_EMISOR.en,
  receiptNotInvoice: AVISO_NO_FACTURA.en,
  receiptPrint: "Print",
  receiptDownload: "Download receipt",
  legalPrivacy: "Privacy",
  legalNotice: "Legal notice",
  legalTerms: "Terms",
  legalPayNote: "By ordering you accept the terms and the privacy policy.",
  backToMenu: "Back to the menu",
  totemStart: "Start order",
  totemTakeaway: "Takeaway",
  totemDineIn: "Dine in",
  totemEnterTable: "Which table are you at?",
  totemTableNumber: "Table number",
  totemNext: "Continue",
  totemBack: "Back",
  totemDelete: "Delete",
  totemPayAtTerminal: "Pay by card",
  totemFollowTerminal: "Follow the instructions on the terminal",
  totemPaying: "Processing payment…",
  totemApproved: "Payment approved",
  totemDeclined: "Payment declined",
  totemRetry: "Try again",
  totemCollect: "Collect your ticket",
  totemPickupNumber: "Your number",
  totemNewOrder: "New order",
  totemCancel: "Cancel",
  totemStillThere: "Still there?",
  totemStillThereBody: "If not, we'll start over for the next customer.",
  totemImHere: "I'm still here",
  totemStartOver: "Start over",
  totemStartOverConfirm: "Start over? Your order will be cleared.",
  totemInDoubt: "Please call a member of staff",
  totemInDoubtBody:
    "Your payment went through, but we could not register the order. Do not pay again: show this code.",
  totemAuthCode: "Authorisation code",
};

const PT: Strings = {
  enter: "Toque para começar",
  menuTitle: "Menu",
  explore: "O que lhe apetece hoje?",
  backToCategories: "← Ver outras categorias",
  dish: "prato",
  dishes: "pratos",
  emptyMenu: "A carta ainda não tem produtos.",
  addCustomize: "Adicionar / Personalizar",
  scanToOrder: "Digitalize o QR da sua mesa para pedir",
  allergensTitle: "Alergénios e informação",
  allergensEmpty: "Não há alergénios declarados para este prato.",
  allergensWarning:
    "Se tiver alguma alergia grave que não esteja listada, fale com a equipa antes de pedir.",
  optionsTitle: "Personalize o seu pedido",
  notesTitle: "Notas especiais",
  notesLabel: "Notas para a cozinha",
  totalPrice: "Preço total",
  addToOrder: "Adicionar ao pedido",
  yourOrder: "O seu pedido",
  viewOrder: "Ver pedido",
  cartEmpty: "Ainda não adicionou nada.",
  total: "Total",
  pay: "Pagar",
  sending: "A enviar…",
  close: "Fechar",
  table: "Mesa",
  orderError: "Não foi possível criar o pedido",
  payTitle: "Pagamento",
  payNow: "Pagar {total}",
  payProcessing: "A processar…",
  payError: "Não foi possível concluir o pagamento. Verifique os dados do cartão.",
  payBack: "Voltar ao pedido",
  orderTitle: "Pedido",
  orderThanks: "Obrigado pelo seu pedido!",
  orderTotal: "Total",
  statusPending: "Pagamento pendente",
  statusPaid: "Pago — a preparar",
  statusPreparing: "A preparar",
  statusServed: "Servido! Bom apetite",
  statusCancelled: "Cancelado",
  receiptTitle: "Recibo",
  receiptTable: "Mesa",
  receiptSubtotal: "Base tributável",
  receiptTax: "IVA",
  receiptIssuer: ETIQUETA_EMISOR.pt,
  receiptNotInvoice: AVISO_NO_FACTURA.pt,
  receiptPrint: "Imprimir",
  receiptDownload: "Baixar recibo",
  legalPrivacy: "Privacidade",
  legalNotice: "Aviso legal",
  legalTerms: "Condições",
  legalPayNote: "Ao pedir aceitas as condições e a política de privacidade.",
  backToMenu: "Voltar à carta",
  totemStart: "Iniciar pedido",
  totemTakeaway: "Para levar",
  totemDineIn: "Comer na mesa",
  totemEnterTable: "Em que mesa está?",
  totemTableNumber: "Número da mesa",
  totemNext: "Continuar",
  totemBack: "Voltar",
  totemDelete: "Apagar",
  totemPayAtTerminal: "Pagar com cartão",
  totemFollowTerminal: "Siga as instruções do terminal",
  totemPaying: "A processar o pagamento…",
  totemApproved: "Pagamento aprovado",
  totemDeclined: "Pagamento recusado",
  totemRetry: "Tentar de novo",
  totemCollect: "Recolha o seu talão",
  totemPickupNumber: "O seu número",
  totemNewOrder: "Novo pedido",
  totemCancel: "Cancelar",
  totemStillThere: "Ainda aí?",
  totemStillThereBody: "Se não, recomeçamos para o próximo cliente.",
  totemImHere: "Continuo aqui",
  totemStartOver: "Recomeçar",
  totemStartOverConfirm: "Recomeçar? O seu pedido será apagado.",
  totemInDoubt: "Chame um funcionário, por favor",
  totemInDoubtBody:
    "O seu pagamento foi efetuado, mas não conseguimos registar o pedido. Não pague de novo: mostre este código.",
  totemAuthCode: "Código de autorização",
};

const STRINGS: Record<Lang, Strings> = { es: ES, en: EN, pt: PT };

export function strings(lang: Lang): Strings {
  return STRINGS[lang];
}

/** Etiqueta legible de un estado de pedido, en el idioma dado. Un estado desconocido cae al
 *  propio código en crudo, que es preferible a una pantalla en blanco. */
export function orderStatusLabel(status: string, t: Strings): string {
  const mapa: Record<string, string> = {
    pending: t.statusPending,
    paid: t.statusPaid,
    preparing: t.statusPreparing,
    served: t.statusServed,
    cancelled: t.statusCancelled,
  };
  return mapa[status] ?? status;
}
