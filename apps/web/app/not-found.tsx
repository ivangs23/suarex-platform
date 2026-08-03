/**
 * 404 de RUTA: el establecimiento existe, la dirección no.
 *
 * Lo sirve Next para cualquier camino sin página que lo atienda, en un host que SÍ resolvió a un
 * cliente. Es un caso distinto del de `app/not-found/page.tsx`, al que `proxy.ts` reescribe cuando
 * es el HOST el que no corresponde a nadie.
 *
 * Decían lo mismo, y eso mandaba a buscar donde no era: un enlace del panel con un carácter de más
 * (`/admin/dispositivos,`) contestaba "esta dirección no corresponde a ningún establecimiento", que
 * se lee como "el dominio de este cliente está mal configurado". Pasó de verdad, y se perdió un
 * rato mirando la configuración del tenant en vez de la URL.
 *
 * Sin enlace de vuelta a propósito: en un host de cliente la raíz `/` es el segmento de mesa, así
 * que "volver al inicio" llevaría a otro 404. Un enlace roto en una página de error es peor que
 * ninguno.
 */
export default function NotFound() {
  return (
    <main>
      <h1>Página no encontrada</h1>
      <p>
        Esta dirección no existe en este establecimiento. Comprueba que el enlace esté completo, o
        vuelve a escanear el QR de la mesa.
      </p>
    </main>
  );
}
