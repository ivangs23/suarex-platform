import type { AgentActivity } from "./agent-activity.js";

/** Metadatos del equipo/estado que encabezan el diagnóstico. Todo lo que un técnico necesita
 *  para situar el problema sin acceso al PC del cliente. */
export type DiagnosticsMeta = {
  generatedAt: string;
  appVersion: string;
  platform: string;
  paired: boolean;
  deviceId: string | null;
  running: boolean;
};

const DESTINO_NOMBRE: Record<string, string> = {
  cocina: "cocina",
  barra: "barra",
  all: "cocina y barra",
};

/**
 * Compone el texto exportable del diagnóstico: cabecera con metadatos, snapshot de la actividad
 * de impresión y, al final, el volcado del registro. Puro (recibe el instante, el estado y el
 * log ya leídos), así se prueba sin tocar Electron ni `fs`.
 */
export function formatDiagnostics(
  meta: DiagnosticsMeta,
  activity: AgentActivity,
  logDump: string,
): string {
  const downPrinters =
    activity.downPrinters.length === 0
      ? "(ninguna)"
      : activity.downPrinters
          .map((p) => `${DESTINO_NOMBRE[p.destination] ?? p.destination} (${p.reason})`)
          .join(", ");

  return [
    "=== SuarEx — Agente de impresión: diagnóstico ===",
    `Generado:            ${meta.generatedAt}`,
    `Versión:             ${meta.appVersion}`,
    `Plataforma:          ${meta.platform}`,
    `Emparejado:          ${meta.paired ? `sí (dispositivo ${meta.deviceId})` : "no"}`,
    `Agente en marcha:    ${meta.running ? "sí" : "no"}`,
    "",
    "--- Actividad de impresión ---",
    `Última comprobación: ${activity.lastTickAt ?? "(ninguna)"}`,
    `Tickets impresos:    ${activity.printedTotal}`,
    `Tickets con problemas: ${activity.failedTotal}`,
    `Último error de tick:  ${activity.lastError ?? "(ninguno)"}`,
    `Impresoras sin responder ahora: ${downPrinters}`,
    "",
    "--- Registro ---",
    logDump.trimEnd() || "(vacío)",
    "",
  ].join("\n");
}
