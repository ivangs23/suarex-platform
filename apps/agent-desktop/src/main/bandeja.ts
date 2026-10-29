import type { PrintFailure } from "@suarex/agent";
import type { MenuItemConstructorOptions } from "electron";
import type { AgentActivity } from "./agent-activity.js";
import { type EstadoGeneral, nombreDeDestino } from "./estado.js";

/** Lo que el menú de la bandeja puede pedir al proceso principal. */
export type AccionesDeBandeja = {
  abrir(): void;
  irA(seccion: "pedidos" | "impresoras"): void;
  exportarDiagnostico(): void;
  salir(): void;
};

/**
 * El texto al pasar el ratón por el icono: el mismo estado que la ventana, en una línea.
 * Windows lo corta a 127 caracteres.
 */
export function textoDeBandeja(estado: EstadoGeneral): string {
  const texto = estado.nivel === "ok" ? "SuarEx: imprimiendo" : `SuarEx: ${estado.titulo}`;
  return texto.length > 127 ? `${texto.slice(0, 126)}…` : texto;
}

/**
 * El menú del clic derecho. Arriba, el estado (no se pulsa: se lee), y luego lo que se hace
 * sin abrir la ventana entera. «Exportar diagnóstico» está aquí porque es lo que se pide cuando
 * la ventana no abre.
 */
export function menuDeBandeja(
  estado: EstadoGeneral,
  a: AccionesDeBandeja,
): MenuItemConstructorOptions[] {
  return [
    { label: `${estado.etiqueta}: ${estado.titulo}`, enabled: false },
    { type: "separator" },
    { label: "Abrir SuarEx", click: () => a.abrir() },
    { label: "Comandas", click: () => a.irA("pedidos") },
    { label: "Impresoras", click: () => a.irA("impresoras") },
    { type: "separator" },
    { label: "Exportar diagnóstico…", click: () => a.exportarDiagnostico() },
    { type: "separator" },
    { label: "Salir", click: () => a.salir() },
  ];
}

/** "cocina", "cocina y barra": los destinos de unas impresoras, sin repetir. */
function destinos(lista: { destination: string }[]): string {
  return [...new Set(lista.map((p) => nombreDeDestino(p.destination)))].join(" y ");
}

export type Aviso = { titulo: string; cuerpo: string };

/** El aviso cuando una o varias impresoras dejan de responder en este tick. */
export function avisoDeCaida(caidas: PrintFailure[]): Aviso | null {
  if (caidas.length === 0) return null;
  const una = caidas.length === 1;
  return {
    titulo: una
      ? `La impresora de ${destinos(caidas)} no responde`
      : `Las impresoras de ${destinos(caidas)} no responden`,
    cuerpo:
      "Sus tickets no se pierden: se imprimen en cuanto vuelva. Comprueba que esté encendida, con papel y conectada.",
  };
}

/**
 * El aviso cuando vuelven. `recuperadas` son ids; el destino se busca en la actividad de ANTES
 * del tick, que es donde todavía constaban como caídas.
 */
export function avisoDeVuelta(recuperadas: string[], antes: AgentActivity): Aviso | null {
  const cuales = antes.downPrinters.filter((p) => recuperadas.includes(p.printerId));
  if (cuales.length === 0) return null;
  const una = cuales.length === 1;
  return {
    titulo: una
      ? `La impresora de ${destinos(cuales)} vuelve a responder`
      : `Las impresoras de ${destinos(cuales)} vuelven a responder`,
    cuerpo: "Los tickets pendientes se están imprimiendo.",
  };
}
