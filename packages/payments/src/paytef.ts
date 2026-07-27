import type { PaymentProviderInfo } from "./provider-info.js";

/**
 * PAYTEF, descrito. Nada de cómo cobra -- eso vive en el agente, que es quien tiene el datáfono
 * delante. Esto es solo lo que hay que preguntarle al dueño para que funcione.
 */
export const PAYTEF_INFO: PaymentProviderInfo = {
  id: "paytef",
  label: "Paytef (datáfono por la nube)",
  // Paytef devuelve una sesión al iniciar la operación y deja volver a preguntar por ella. Eso es
  // lo que permite que un cobro interrumpido por un corte de luz se resuelva solo al arrancar.
  canPollSession: true,
  configFields: [
    {
      name: "accessKey",
      label: "Clave de acceso",
      type: "text",
      required: true,
      help: "Te la da Paytef al dar de alta la cuenta.",
    },
    {
      name: "secretKey",
      label: "Clave secreta",
      type: "secret",
      required: true,
      help: "Se guarda aparte y no vuelve a mostrarse. Para cambiarla, escribe una nueva.",
    },
    {
      name: "companyId",
      label: "Identificador de comercio",
      type: "text",
      required: false,
    },
    {
      name: "pinpad",
      label: "Datáfono de este totem",
      type: "terminal",
      required: true,
      help: "El número del aparato físico. Si tienes varios totems, cada uno lleva el suyo.",
    },
  ],
};
