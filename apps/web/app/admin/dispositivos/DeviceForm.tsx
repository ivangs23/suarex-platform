"use client";

import { useActionState } from "react";
import { createDeviceAction } from "./actions";
import { PairingCodeView } from "./PairingCodeView";

type PairingState = { pairingCode: string; expiresAt: string } | null;

/**
 * `useActionState` exige `action(prevState, formData)`; `createDeviceAction`
 * (`managerAction(async (session, formData) => ...)`, ver `actions.ts`) solo acepta
 * `formData`. Este envoltorio SOLO reordena el paso de argumentos -- descarta
 * `prevState` y reenvía `formData` tal cual -- para que la comprobación de rol
 * (`managerAction`) y la creación real sigan viviendo enteramente en el Server Action;
 * este componente nunca toca `session.tenantId` ni ninguna lógica de negocio.
 */
async function submitCreateDevice(
  _prevState: PairingState,
  formData: FormData,
): Promise<PairingState> {
  return await createDeviceAction(formData);
}

/**
 * Alta de dispositivo. "use client" -- a diferencia de `TableForm`/`CategoryForm` --
 * porque `createDeviceAction` es de las dos únicas Server Actions de todo el panel que
 * DEVUELVEN algo (el código de emparejamiento en claro, ver el docstring de
 * `managerAction` en `apps/web/lib/require-manager.ts`): capturar ese valor de retorno
 * para mostrarlo con `PairingCodeView` requiere `useActionState`, que solo existe en un
 * Client Component. El estado (`pairing`) vive SOLO en memoria de React: no se persiste
 * en ningún sitio, así que desaparece al recargar la página -- es precisamente el
 * mecanismo de "se muestra una vez" (ver `PairingCodeView`).
 */
export function DeviceForm({ venueId }: { venueId: string }) {
  const [pairing, formAction, isPending] = useActionState(submitCreateDevice, null);

  return (
    <div>
      <form action={formAction}>
        <h3>Nuevo dispositivo</h3>
        <input type="hidden" name="venue_id" value={venueId} />

        <label htmlFor="device-name">Nombre</label>
        <input id="device-name" name="name" type="text" required />

        <button type="submit" disabled={isPending}>
          Dar de alta
        </button>
      </form>

      {pairing ? (
        <PairingCodeView pairingCode={pairing.pairingCode} expiresAt={pairing.expiresAt} />
      ) : null}
    </div>
  );
}
