/**
 * Icono de la bandeja, embebido como PNG en base64. La app arranca OCULTA en la bandeja al
 * iniciar sesión en Windows; antes usaba `nativeImage.createEmpty()` (un icono invisible), así
 * que el owner no tenía forma de encontrarla para abrirla. Se embebe en vez de leer un fichero
 * para no depender de rutas distintas en dev y en el empaquetado.
 *
 * 32×32, cuadrado redondeado oscuro con una "S" blanca. Se regenera con sharp a partir de un
 * SVG si hace falta rehacerlo.
 */
const TRAY_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACfUlEQVR4nGNgGGxAT5xbTEeSv0VHku+8thTfFx0p/v+UYLAZknzndCT5m0Fm47VcV5o/VEeK7xOlluLGfJ+0pPlD8FjO/492lsPxPwxH6IGCnaY+xwiJjwYSPKJwB4DjnG6WQ9OGJH8TkgP4LtDbAaCEiXCAFN9nYjXqSgv8j/J2/t/dWP1/7pT+/7Mn9f5vKMv/726hR3KCRHIAcZpcTbX/Xzhz8j828Pfv3/9rly36bygvSrQjSHKAnqzQ/1vXr8It/PXr5/+njx/9f/fmNYpDls2fRRsHpEUGwi3Zu33Lf2stBbhccXrC/79//oDlfv/+hSJHNQc0lOXDHdBWU4Yhv33j2v+PHtz7f/Xi+f8hrjbUd0ByqC/cAd++fgUnwFB3O3CiJDcnkJYGZAT/Xzx7CiPxvXn18v/mNSv+F6bG/jeQE6GdA3Sk+P/b6an837Nt839c4MnDB/+jfFxo5wAdKAbF8ayJPSi5AgY+fnj/38lIg7YO0EHCjgbq/+tLcv8/f/oE7ojJnS3Ud8CGVcv+X7lw7v/jB/f/myhLYMhnxITAHbB13SrqO+Dgnh1wC1qrSzHkmyuK4PKrFs2jvgMKU2PhFvz8+eP/nMl94KyZEOz1f3JXKzhrwkB2XDht0sCOTev+EwK7tmwkumwg2QH6csL/+1rq/r98/gzDYlAinNDeSLvKSAcNe1jq/4/2dQVXzaBakhwzqJINKcHIDRI6tgdhmO8jcpPs/MA2yST5m+ntAG1J/ka4A+jdLNeW5PugJskjAncACIA6C/TqmGhL8AehWI7qCL6PtPQ5TssZoADUYwF1GrSl+M6S0lzHjfk+g8wCxTlGsA8GAAAqfHc5fodH2wAAAABJRU5ErkJggg==";

export const TRAY_ICON_DATA_URL = `data:image/png;base64,${TRAY_ICON_PNG_BASE64}`;
