"use client";

import { useState } from "react";

/**
 * Dispara la descarga del CSV en el navegador.
 *
 * Client component porque una Server Action no puede devolver un `Response` con
 * `Content-Disposition` — eso exigiría una ruta de API, y entonces el guard de rol volvería a
 * depender de que quien la escriba se acuerde de ponerlo. Así la acción sigue protegida por
 * `managerAction` y solo el paso final (crear el enlace y pulsarlo) vive en el cliente.
 */
export function DescargarCsv({
  accion,
}: {
  accion: () => Promise<{ nombre: string; contenido: string }>;
}) {
  const [generando, setGenerando] = useState(false);

  async function descargar() {
    setGenerando(true);
    try {
      const { nombre, contenido } = await accion();
      // BOM inicial: sin él, Excel en Windows abre el CSV en ANSI y destroza los acentos de
      // los nombres de plato.
      const blob = new Blob([`﻿${contenido}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <button type="button" onClick={descargar} disabled={generando} data-testid="informe-csv">
      {generando ? "Generando…" : "Descargar CSV"}
    </button>
  );
}
