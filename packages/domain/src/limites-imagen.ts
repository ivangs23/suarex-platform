/**
 * Límite de una foto subida (producto y marca). Una sola verdad para quien lo aplica:
 * `storage.ts` (`@suarex/db`) al recibirla y el campo de foto del panel, que avisa ANTES de
 * enviar para que nadie espere a que suba una foto que se va a rechazar.
 *
 * Es el tope de lo que se ACEPTA, no de lo que se guarda: lo guardado lo decide `optimizeImage`
 * (900 px, WebP). 15 MB caben las fotos de un móvil moderno; con 5 se rechazaban. El tope del
 * cuerpo de `apps/web/next.config.ts` tiene que ir por encima.
 */
export const MAX_MB_IMAGEN = 15;

export const MAX_BYTES_IMAGEN = MAX_MB_IMAGEN * 1024 * 1024;
