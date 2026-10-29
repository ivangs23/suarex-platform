import type { AgentActivity } from "../main/agent-activity.js";
import { mensajeDeConfigIncompleta } from "../main/config-check.js";

/** Lo que devuelve `get-status`: el estado del agente tal como lo ve el proceso principal. */
export type AgentStatus = {
  paired: boolean;
  running: boolean;
  /** Arrancando, o esperando a que vuelva la red. */
  conectando?: boolean;
  deviceId: string | null;
  platform: string;
  version?: string;
  /** Cuándo arrancó la app (ISO), para contar los tickets "desde las 19:00". */
  startedAt?: string;
  /** Variables que faltaban al generar este ejecutable. Vacío en un build sano. */
  configFaltante?: string[];
  activity: AgentActivity;
};

/**
 * - `ok`: imprime.
 * - `aviso`: imprime, pero algo falla (una impresora) o aún está conectando.
 * - `error`: no imprime nada.
 * - `neutro`: no hay nada que hacer todavía (sin vincular).
 */
export type Nivel = "ok" | "aviso" | "error" | "neutro";

export type EstadoGeneral = {
  nivel: Nivel;
  /** La píldora de la cabecera: una o dos palabras. */
  etiqueta: string;
  titulo: string;
  detalle: string;
  /** Icono propio cuando el del nivel no encaja (conectar no es una avería). */
  icono?: string;
  /** A dónde lleva el botón de la acción, si hay algo que el usuario pueda hacer. */
  accion?: { texto: string; seccion: "impresoras" | "ajustes" | "estado" };
};

/** Un corte de red breve no se anuncia: el agente reintenta solo y la alerta parpadearía. */
export const GRACIA_SIN_CONEXION_MS = 30_000;

const DESTINO: Record<string, string> = {
  cocina: "cocina",
  barra: "barra",
  all: "cocina y barra",
  recibo: "recibos",
};

export function nombreDeDestino(destino: string): string {
  return DESTINO[destino] ?? destino;
}

/** "la impresora de cocina", "las impresoras de cocina y barra". */
function impresorasCaidas(activity: AgentActivity): string {
  const destinos = [...new Set(activity.downPrinters.map((p) => nombreDeDestino(p.destination)))];
  const de = destinos.join(" y ");
  return activity.downPrinters.length === 1 ? `La impresora de ${de}` : `Las impresoras de ${de}`;
}

/**
 * EL ESTADO DE ESTE EQUIPO, en una sola función. La cabecera, la pantalla Estado y la bandeja
 * lo leen de aquí: antes la cabecera decía «Imprimiendo pedidos» en verde con la impresora de
 * cocina caída, porque cada sitio miraba un dato distinto.
 *
 * El orden es el de gravedad: lo primero que impide imprimir tapa todo lo demás. Cada estado
 * dice qué pasa con los pedidos y qué hacer, no solo qué está roto.
 *
 * `sinConexionDesde`: cuándo empezó el corte de red en curso (lo lleva quien llama, que ve
 * pasar los ticks). Pura: el reloj entra como `ahora`.
 */
export function estadoGeneral(
  status: AgentStatus,
  ahora: number,
  sinConexionDesde: number | null,
): EstadoGeneral {
  const faltante = status.configFaltante ?? [];
  if (faltante.length > 0) {
    return {
      nivel: "error",
      etiqueta: "Instalación incompleta",
      titulo: "Esta instalación está incompleta",
      detalle: mensajeDeConfigIncompleta(faltante),
    };
  }

  if (!status.paired) {
    return {
      nivel: "neutro",
      etiqueta: "Sin vincular",
      titulo: "Vincula este equipo con tu negocio",
      detalle:
        "Pega el código que genera el panel de administración, en Dispositivos. A partir de ahí, este equipo imprime los pedidos solo.",
    };
  }

  const a = status.activity;
  if (!status.running) {
    return status.conectando
      ? {
          nivel: "aviso",
          icono: "i-red",
          etiqueta: "Conectando",
          titulo: "Conectando con la plataforma",
          detalle:
            "Si no hay red, se reintenta solo. No hace falta volver a vincular ni reiniciar el equipo.",
        }
      : {
          nivel: "error",
          etiqueta: "Sin sesión",
          titulo: "Este equipo ha perdido su vinculación",
          detalle:
            "Genera un código nuevo en el panel, en Dispositivos, y vuelve a vincularlo. Hasta entonces no se imprime nada.",
          accion: { texto: "Vincular de nuevo", seccion: "ajustes" },
        };
  }

  if (
    a.lastError &&
    sinConexionDesde !== null &&
    ahora - sinConexionDesde >= GRACIA_SIN_CONEXION_MS
  ) {
    return {
      nivel: "error",
      icono: "i-red",
      etiqueta: "Sin conexión",
      titulo: "Sin conexión con la plataforma",
      detalle:
        "Los pedidos no llegan a este equipo. Se reintenta solo, y en cuanto vuelva la conexión se imprimen los que estén pendientes.",
    };
  }

  if (a.downPrinters.length > 0) {
    const quien = impresorasCaidas(a);
    const verbo = a.downPrinters.length === 1 ? "no responde" : "no responden";
    return {
      nivel: "aviso",
      etiqueta: "Atención",
      titulo: `${quien} ${verbo}`,
      detalle:
        "Comprueba que esté encendida, con papel y conectada. Sus tickets no se pierden: se imprimen en cuanto vuelva a responder.",
      accion: { texto: "Ver impresoras", seccion: "impresoras" },
    };
  }

  return {
    nivel: "ok",
    etiqueta: "Imprimiendo",
    titulo: "Imprimiendo pedidos",
    detalle: "Puedes cerrar esta ventana: sigue funcionando en segundo plano.",
  };
}

/** "42 tickets impresos desde las 19:00", o la frase de cuando aún no ha salido ninguno. */
export function resumenDeImpresion(status: AgentStatus): string {
  const a = status.activity;
  const desde = status.startedAt
    ? ` desde las ${new Date(status.startedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
    : "";
  if (a.printedTotal === 0 && a.failedTotal === 0) return `Ningún ticket impreso${desde}.`;
  const n = a.printedTotal;
  const impresos = `${n} ticket${n === 1 ? "" : "s"} impreso${n === 1 ? "" : "s"}${desde}`;
  const fallos = a.failedTotal > 0 ? `, ${a.failedTotal} con incidencias` : "";
  return `${impresos}${fallos}.`;
}
