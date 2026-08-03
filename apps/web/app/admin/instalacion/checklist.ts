/**
 * QUÉ LE FALTA A UN CLIENTE PARA ESTAR LISTO.
 *
 * El día de la instalación en un local, lo que se pierde no es tiempo escribiendo formularios: es
 * tiempo descubriendo lo que falta. Se configura todo, parece que va, y a la primera comanda
 * aparece que nadie asignó la impresora de cocina -- o que el totem tiene datáfono pero el canal
 * apagado. Esta función existe para que eso se sepa ANTES, en una lista, y no delante del cliente.
 *
 * Es PURA: recibe los hechos ya leídos y devuelve la lista. Toda la decisión de "esto está listo /
 * esto no" vive aquí, que es donde se puede probar cada combinación sin levantar nada, incluidas
 * las que casi nunca se dan y son justo las que rompen -- un cliente solo con totem, uno con dos
 * instalaciones, uno a medio configurar.
 *
 * Lo que NO comprueba, y conviene saberlo: no imprime un ticket de prueba. Desde el panel no hay
 * forma de darle una orden al agente. Verifica que la configuración está completa y que el
 * dispositivo da señales de vida; que la impresora tenga papel se comprueba imprimiendo, con el
 * botón del escritorio y delante de ella.
 */

export type CheckStatus = "ok" | "falta" | "aviso";

export type CheckItem = {
  id: string;
  /** Lo que se comprueba, en una línea y sin jerga. */
  label: string;
  status: CheckStatus;
  /** Qué pasa o qué hay que hacer. Vacío cuando está bien y no hay nada que explicar. */
  detail?: string;
  /** A dónde ir a arreglarlo. */
  href?: string;
};

export type SetupFacts = {
  channels: string[];
  venueCount: number;
  productCount: number;
  tableCount: number;
  devices: {
    id: string;
    name: string;
    roles: string[];
    paired: boolean;
    /** Milisegundos desde la última señal, o `null` si nunca dio ninguna. */
    lastSeenAgoMs: number | null;
    /** Terminal de pago asignado (el datáfono de ese totem). */
    terminalId: string | null;
  }[];
  printers: {
    id: string;
    name: string;
    destination: "cocina" | "barra" | "all" | "recibo";
    enabled: boolean;
    /** Qué instalación la saca, o `null` si no se ha asignado. */
    deviceId: string | null;
    network: boolean;
  }[];
  payment: {
    configured: boolean;
    /** Etiquetas de lo que falta por rellenar (de `missingFields`). */
    missing: string[];
    mock: boolean;
  };
  /** IVA por defecto del negocio (`tenant_settings.fiscal.taxRate`), o `null` si nadie lo puso. */
  fiscalTaxRate: number | null;
  /**
   * Credenciales de Stripe de ESTE cliente, por presencia y nunca por valor: los secretos
   * guardados no salen de la base, así que aquí solo llega si están o no.
   */
  stripe: {
    publishableKey: boolean;
    secretKey: boolean;
    /** Hay claves en el entorno como red de seguridad (camino heredado, en retirada). */
    entorno: boolean;
  };
};

/** Cuánto puede llevar un dispositivo sin dar señales antes de que sea noticia. */
const SIN_SENAL_MS = 10 * 60 * 1000;

const item = (
  id: string,
  label: string,
  status: CheckStatus,
  detail?: string,
  href?: string,
): CheckItem =>
  detail === undefined ? { id, label, status, href } : { id, label, status, detail, href };

/**
 * Los pasos, en el orden en que se hacen: primero qué contrata el cliente, luego con qué vende,
 * luego con qué imprime, y al final lo del totem -- que solo aparece si lo tiene.
 *
 * Un cliente sin canal totem NO ve los pasos del datáfono. Pedirle un terminal a quien solo tiene
 * carta por QR es la forma más rápida de que la lista deje de leerse.
 */
export function buildSetupChecklist(facts: SetupFacts): CheckItem[] {
  const tieneQr = facts.channels.includes("qr-mesa");
  const tieneTotem = facts.channels.includes("kiosko");
  const items: CheckItem[] = [];

  items.push(
    facts.channels.length === 0
      ? item(
          "canales",
          "Canales de venta",
          "falta",
          "Sin ningún canal encendido no se sirve ni la carta ni el totem.",
          "/admin/ajustes",
        )
      : item(
          "canales",
          "Canales de venta",
          "ok",
          [tieneQr ? "carta por QR" : null, tieneTotem ? "totem" : null]
            .filter(Boolean)
            .join(" y "),
          "/admin/ajustes",
        ),
  );

  items.push(
    facts.venueCount === 0
      ? item("sede", "Sede", "falta", "La carta y las mesas cuelgan de una sede.", "/admin/mesas")
      : item("sede", "Sede", "ok"),
  );

  items.push(
    facts.productCount === 0
      ? item("carta", "Carta", "falta", "Todavía no hay productos.", "/admin/catalogo")
      : item("carta", "Carta", "ok", `${facts.productCount} producto(s)`, "/admin/catalogo"),
  );

  if (tieneQr) {
    items.push(
      facts.tableCount === 0
        ? item(
            "mesas",
            "Mesas con QR",
            "falta",
            "Sin mesas no hay QR que pegar, y la carta no se puede pedir.",
            "/admin/mesas",
          )
        : item("mesas", "Mesas con QR", "ok", `${facts.tableCount} mesa(s)`, "/admin/mesas"),
    );
  }

  items.push(comprobarIva(facts));
  if (tieneQr) items.push(comprobarStripe(facts));

  items.push(...comprobarDispositivos(facts));
  items.push(...comprobarImpresoras(facts, tieneTotem));
  if (tieneTotem) items.push(...comprobarTotem(facts));

  return items;
}

/**
 * El IVA por defecto del negocio.
 *
 * Sin él, el pedido se crea asumiendo un 10 % (ver `apps/web/app/api/orders/route.ts`). Para un
 * bar que solo sirve en mesa suele acertar, y por eso es tan peligroso: nadie lo nota. El día que
 * ese cliente venda una botella para llevar -- 21 % -- el ticket sale mal, el desglose del cierre
 * sale mal, y lleva meses saliendo mal.
 *
 * Va como falta y no como aviso a propósito: un tipo impositivo se decide, no se hereda de un
 * valor por defecto que nadie eligió.
 */
function comprobarIva(facts: SetupFacts): CheckItem {
  if (facts.fiscalTaxRate === null) {
    return item(
      "iva",
      "IVA por defecto",
      "falta",
      "Sin configurar se asume un 10 % en cada pedido, acierte o no. Decídelo antes de la primera venta.",
      "/admin/ajustes",
    );
  }
  const porcentaje = `${(facts.fiscalTaxRate * 100).toFixed((facts.fiscalTaxRate * 100) % 1 === 0 ? 0 : 1)} %`;
  return item("iva", "IVA por defecto", "ok", porcentaje, "/admin/ajustes");
}

/**
 * Con qué cuenta de Stripe cobra la carta por QR.
 *
 * Solo aparece si el canal de QR está encendido: a un cliente que solo tiene totem, que cobra por
 * datáfono, pedirle claves de Stripe es ruido.
 *
 * Las tres respuestas posibles importan por motivos distintos, y la del medio es la que se
 * escapaba: sin claves propias SÍ se cobra -- con las del entorno -- así que todo parece
 * funcionar. Lo que pasa es que el dinero entra en NUESTRA cuenta y no en la del cliente. No es un
 * fallo técnico, es un problema de a quién le llega el dinero, y no se descubre mirando la
 * pantalla: se descubre cuadrando el banco a fin de mes.
 *
 * La etiqueta dice "Cobro por QR" y no "Cobro de la carta por QR" por una razón práctica: los
 * tests de punta a punta filtran los pasos por su texto, y "carta" chocaría con el paso "Carta".
 */
function comprobarStripe(facts: SetupFacts): CheckItem {
  const { publishableKey, secretKey, entorno } = facts.stripe;

  if (publishableKey && secretKey) {
    return item("stripe", "Cobro por QR", "ok", "con su propia cuenta", "/admin/pagos");
  }

  /* Una sola de las dos es el caso PEOR, peor que ninguna: la pública y la secreta identifican la
     misma cuenta, así que crear el cobro con una y montar el formulario con la otra da un cobro
     que no se puede confirmar. `pickStripeKeys` lo rechaza por eso mismo, y aquí se dice antes. */
  if (publishableKey !== secretKey) {
    return item(
      "stripe",
      "Cobro por QR",
      "falta",
      `Solo está ${publishableKey ? "la clave pública" : "la clave secreta"}. Con una sola no se cobra: hacen falta las dos, y de la misma cuenta.`,
      "/admin/pagos",
    );
  }

  return entorno
    ? item(
        "stripe",
        "Cobro por QR",
        "aviso",
        "Este cliente no tiene su cuenta de Stripe: los cobros entran en la cuenta del entorno, no en la suya.",
        "/admin/pagos",
      )
    : item(
        "stripe",
        "Cobro por QR",
        "falta",
        "Sin credenciales de Stripe no se puede pagar la carta por QR.",
        "/admin/pagos",
      );
}

function comprobarDispositivos(facts: SetupFacts): CheckItem[] {
  const emparejados = facts.devices.filter((device) => device.paired);
  if (emparejados.length === 0) {
    return [
      item(
        "dispositivo",
        "Instalación emparejada",
        "falta",
        "Da de alta un dispositivo y empareja el programa con su código.",
        "/admin/dispositivos",
      ),
    ];
  }

  /* Emparejado no es lo mismo que vivo: un PC apagado, sin red o con el programa cerrado sigue
     constando emparejado para siempre. La última señal es lo único que distingue "instalado" de
     "funcionando", y es la diferencia entre irse del local tranquilo o volver mañana. */
  const mudos = emparejados.filter(
    (device) => device.lastSeenAgoMs === null || device.lastSeenAgoMs > SIN_SENAL_MS,
  );

  return [
    mudos.length === 0
      ? item(
          "dispositivo",
          "Instalación emparejada",
          "ok",
          `${emparejados.length} en marcha`,
          "/admin/dispositivos",
        )
      : item(
          "dispositivo",
          "Instalación emparejada",
          "aviso",
          `Sin señal reciente: ${mudos.map((d) => d.name).join(", ")}. Comprueba que el programa está abierto y con red.`,
          "/admin/dispositivos",
        ),
  ];
}

function comprobarImpresoras(facts: SetupFacts, tieneTotem: boolean): CheckItem[] {
  const activas = facts.printers.filter((printer) => printer.enabled);
  const cubre = (destino: "cocina" | "barra") =>
    activas.some((printer) => printer.destination === destino || printer.destination === "all");

  const items: CheckItem[] = [];
  const sinCubrir = (["cocina", "barra"] as const).filter((destino) => !cubre(destino));
  items.push(
    sinCubrir.length === 0
      ? item("impresoras", "Impresoras de cocina y barra", "ok", undefined, "/admin/impresoras")
      : item(
          "impresoras",
          "Impresoras de cocina y barra",
          "falta",
          `Sin impresora para: ${sinCubrir.join(" y ")}. Esas comandas no salen por ningún sitio.`,
          "/admin/impresoras",
        ),
  );

  /* Con DOS instalaciones o más, una impresora de red sin dueño la sacan todas y cada ticket sale
     repetido. Con una sola no hay nada que repartir, así que no se molesta con ello. */
  const instalaciones = facts.devices.filter((device) => device.paired).length;
  const sinDuenno = activas.filter((printer) => printer.network && !printer.deviceId);
  if (instalaciones > 1 && sinDuenno.length > 0) {
    items.push(
      item(
        "reparto",
        "Reparto de impresoras",
        "falta",
        `Hay ${instalaciones} instalaciones y estas impresoras no tienen dueño: ${sinDuenno.map((p) => p.name).join(", ")}. Cada ticket saldrá repetido.`,
        "/admin/impresoras",
      ),
    );
  }

  if (tieneTotem) {
    const recibo = activas.some((printer) => printer.destination === "recibo");
    items.push(
      recibo
        ? item("recibo", "Impresora de recibos", "ok", undefined, "/admin/impresoras")
        : item(
            "recibo",
            "Impresora de recibos",
            "falta",
            "El totem no puede dar el ticket al cliente. Su código sale en pantalla, pero se pierde al terminar.",
            "/admin/impresoras",
          ),
    );
  }

  return items;
}

function comprobarTotem(facts: SetupFacts): CheckItem[] {
  const items: CheckItem[] = [];
  const totems = facts.devices.filter((device) => device.roles.includes("kiosko"));

  if (totems.length === 0) {
    items.push(
      item(
        "rol-totem",
        "Dispositivo de totem",
        "falta",
        "Ninguna instalación tiene el rol de totem, así que la pantalla no llega a abrirse.",
        "/admin/dispositivos",
      ),
    );
  } else {
    const sinTerminal = totems.filter((device) => !device.terminalId);
    items.push(
      sinTerminal.length === 0
        ? item("rol-totem", "Dispositivo de totem", "ok", undefined, "/admin/dispositivos")
        : item(
            "rol-totem",
            "Dispositivo de totem",
            "falta",
            `Sin datáfono asignado: ${sinTerminal.map((d) => d.name).join(", ")}.`,
            "/admin/dispositivos",
          ),
    );
  }

  if (!facts.payment.configured) {
    items.push(
      item(
        "pago",
        "Datos de cobro",
        "falta",
        "El totem no puede cobrar hasta que se configure un método de pago.",
        "/admin/pagos",
      ),
    );
  } else if (facts.payment.missing.length > 0) {
    items.push(
      item(
        "pago",
        "Datos de cobro",
        "falta",
        `Faltan: ${facts.payment.missing.join(", ")}.`,
        "/admin/pagos",
      ),
    );
  } else {
    items.push(item("pago", "Datos de cobro", "ok", undefined, "/admin/pagos"));
  }

  /* El modo pruebas NO es un error: es como debe estar mientras se instala, y aprueba sin cobrar.
     Pero irse del local dejándolo puesto significa un totem que regala la comida, así que sale
     como aviso hasta el final. */
  if (facts.payment.mock) {
    items.push(
      item(
        "modo-real",
        "Cobro real",
        "aviso",
        "Sigue en modo pruebas: aprueba sin cobrar. Quítalo cuando termines de probar.",
        "/admin/pagos",
      ),
    );
  }

  return items;
}

/** ¿Se puede dar la instalación por terminada? Un aviso no lo impide; una falta, sí. */
export function isSetupComplete(items: CheckItem[]): boolean {
  return items.every((item) => item.status !== "falta");
}
