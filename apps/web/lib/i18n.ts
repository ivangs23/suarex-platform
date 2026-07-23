/**
 * IDIOMA DE LA CARTA.
 *
 * El catálogo ya se guarda por idioma (`name_i18n`, `description_i18n`: `{es, en, pt}`) y en
 * la migración de Manuela entraron sus traducciones al inglés y al portugués. Hasta ahora la
 * carta enseñaba `es` a pelo, así que esos datos estaban pagados y sin usar -- y un guiri en
 * la terraza leía la carta en español.
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
  receiptPrint: string;
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
  receiptPrint: "Imprimir",
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
  receiptPrint: "Print",
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
  receiptPrint: "Imprimir",
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
