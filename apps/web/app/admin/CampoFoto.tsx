"use client";

import { MAX_BYTES_IMAGEN, MAX_MB_IMAGEN } from "@suarex/domain";
import type { ChangeEvent } from "react";

/** Aviso para una foto que el servidor rechazaría por tamaño, o `""` si cabe. */
export function avisoDeTamano(bytes: number): string {
  if (bytes <= MAX_BYTES_IMAGEN) return "";
  const pesa = (bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 });
  return `La foto pesa ${pesa} MB y el máximo son ${MAX_MB_IMAGEN} MB. Elige otra o redúcela.`;
}

/**
 * Campo de foto del panel, el ÚNICO `<input type="file">` (lo vigila `CampoFoto.test.tsx`).
 *
 * Una foto demasiado grande se avisa al elegirla con la validación del navegador: el formulario
 * no se envía y nadie espera a que suba para recibir un error genérico. `accept` lista los tipos
 * EXACTOS del servidor, no `image/*`: con el comodín se puede elegir un HEIC (el formato del
 * iPhone) y la subida muere con un error crudo.
 */
export function CampoFoto({ id, name }: { id?: string; name: string }) {
  function alCambiar(evento: ChangeEvent<HTMLInputElement>) {
    const input = evento.currentTarget;
    input.setCustomValidity(avisoDeTamano(input.files?.[0]?.size ?? 0));
    input.reportValidity();
  }
  return (
    <input
      id={id}
      name={name}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      onChange={alCambiar}
    />
  );
}
