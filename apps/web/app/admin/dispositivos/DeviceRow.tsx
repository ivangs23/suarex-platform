"use client";

import type { DeviceRow as DeviceRecord } from "@suarex/db";
import { useActionState } from "react";
import { ConfirmDeleteForm } from "../catalogo/ConfirmDeleteForm";
import { deleteDeviceAction, regeneratePairingCodeAction, resetDeviceAction } from "./actions";
import { PairingCodeView } from "./PairingCodeView";

type PairingState = { pairingCode: string; expiresAt: string } | null;

/** Mismo envoltorio que `DeviceForm.submitCreateDevice`, para `regeneratePairingCodeAction`. */
async function submitRegenerate(
  _prevState: PairingState,
  formData: FormData,
): Promise<PairingState> {
  return await regeneratePairingCodeAction(formData);
}

function formatStatus(device: DeviceRecord): string {
  if (device.pairedAt) {
    return `Emparejado (última actividad: ${device.lastSeenAt ?? "todavía sin registrar"})`;
  }
  if (device.hasPendingPairingCode) {
    return `Código de emparejamiento pendiente -- caduca ${device.pairingExpiresAt ?? "?"}`;
  }
  return "Sin código de emparejamiento activo";
}

/**
 * Fila de un dispositivo: nombre, local, estado, y sus dos acciones. "Regenerar código"
 * SOLO se ofrece si `!device.pairedAt` -- `regeneratePairingCode` (`packages/db/src/
 * admin-devices.ts`) rechaza (lanza) intentar regenerar el código de un dispositivo YA
 * emparejado, por diseño (ver su docstring: reabrir el emparejamiento de un dispositivo
 * activo es una cuestión de revocación de sesión diferida a una fase posterior), así que
 * mostrar el botón en ese caso solo invitaría a un fallo seguro.
 *
 * Borrar un dispositivo NO borra sus impresoras: `printers.device_id` referencia
 * `devices` con `on delete set null` (`20260722000001_devices_printers.sql`) -- el
 * mensaje de confirmación lo dice explícitamente, para que quien gestiona sepa que esas
 * impresoras quedarán sin dispositivo asignado, no borradas.
 */
export function DeviceRow({ device, venueName }: { device: DeviceRecord; venueName: string }) {
  const [pairing, regenerateAction, isPending] = useActionState(submitRegenerate, null);
  const [resetPairing, resetAction, isResetting] = useActionState(
    async (_prev: PairingState, formData: FormData): Promise<PairingState> =>
      resetDeviceAction(formData),
    null,
  );

  return (
    <article data-testid="admin-device" data-device-id={device.id}>
      <h3>{device.name}</h3>
      <p>Local: {venueName}</p>
      <p>Estado: {formatStatus(device)}</p>

      {pairing ? (
        <PairingCodeView pairingCode={pairing.pairingCode} expiresAt={pairing.expiresAt} />
      ) : null}

      {device.pairedAt ? null : (
        <form action={regenerateAction}>
          <input type="hidden" name="device_id" value={device.id} />
          <button type="submit" disabled={isPending}>
            Regenerar código
          </button>
        </form>
      )}

      {device.pairedAt ? (
        <>
          {resetPairing ? (
            <PairingCodeView
              pairingCode={resetPairing.pairingCode}
              expiresAt={resetPairing.expiresAt}
            />
          ) : null}
          <form action={resetAction}>
            <input type="hidden" name="device_id" value={device.id} />
            <button
              type="submit"
              disabled={isResetting}
              onClick={(e) => {
                if (
                  !window.confirm(
                    `Resetear "${device.name}" revoca el acceso del PC actual (deja de poder renovar su sesión) y genera un código nuevo para emparejar otro PC. Úsalo si el equipo se ha perdido o se sustituye. ¿Continuar?`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              Resetear dispositivo
            </button>
          </form>
        </>
      ) : null}

      <ConfirmDeleteForm
        action={deleteDeviceAction}
        hiddenName="device_id"
        hiddenValue={device.id}
        confirmMessage={`Borrar el dispositivo "${device.name}" desvincula TAMBIÉN cualquier impresora que tuviera asignada (queda sin dispositivo, no se borra -- ver packages/db/src/admin-devices.ts). Esta acción no se puede deshacer. ¿Continuar?`}
        label="Borrar dispositivo"
      />
    </article>
  );
}
