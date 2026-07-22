/**
 * Muestra el código de emparejamiento en claro UNA SOLA VEZ: es el valor de retorno de
 * `createDeviceAction`/`regeneratePairingCodeAction` (`actions.ts`), que a su vez es lo
 * único que sale en claro de `createDevice`/`regeneratePairingCode`
 * (`packages/db/src/admin-devices.ts`) -- nunca se registra en logs, nunca se vuelve a
 * leer de la base (`listDevices` deliberadamente no expone `pairing_code`, solo si hay
 * uno pendiente y cuándo caduca).
 *
 * Este componente no persiste nada por su cuenta: solo renderiza las props que le pasa
 * `DeviceForm`/`DeviceRow`, cuyo estado de React (`useActionState`) vive SOLO en memoria
 * del navegador y desaparece al recargar la página -- de ahí que una recarga sea
 * suficiente para que el código deje de mostrarse en ningún sitio (ver
 * `tests/e2e/admin-d2.spec.ts`, "el código de emparejamiento es de un solo uso visual").
 */
export function PairingCodeView({
  pairingCode,
  expiresAt,
}: {
  pairingCode: string;
  expiresAt: string;
}) {
  return (
    <div data-testid="pairing-code-once" role="alert">
      <p>
        Código de emparejamiento -- se muestra UNA sola vez. No se puede volver a consultar por
        ningún otro medio: anótalo o introdúcelo ahora en la app del dispositivo. Al recargar esta
        página desaparecerá.
      </p>
      <p data-testid="pairing-code">{pairingCode}</p>
      <p>Caduca: {expiresAt}</p>
    </div>
  );
}
