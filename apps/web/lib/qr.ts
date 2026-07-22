import QRCode from "qrcode";

/**
 * SVG del QR de la URL de una mesa. Se genera en el servidor; el cliente solo lo
 * muestra (`<div dangerouslySetInnerHTML>` o similar en Task 5) -- nunca se genera en
 * el navegador ni depende de una librería cliente. La URL que recibe ya viene compuesta
 * por quien llama (Host de la petición + token de la mesa, ver
 * `apps/web/app/admin/mesas/actions.ts`); esta función no conoce ni el Host ni el
 * token por separado, así que no puede componer una URL con datos del cliente aunque
 * quisiera -- solo puede dibujar el QR de la cadena que se le pasa.
 */
export async function tableQrSvg(url: string): Promise<string> {
  if (!url) throw new Error("URL vacía");
  return QRCode.toString(url, { type: "svg", margin: 1, width: 240 });
}
