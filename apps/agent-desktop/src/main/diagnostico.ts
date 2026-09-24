import { redactar } from "./log-file.js";

/**
 * EXPORTAR DIAGNÓSTICO.
 *
 * El dueño del bar no va a buscar un fichero en `%APPDATA%`, y soporte no puede entrar en su
 * PC. Un botón que deja un `.txt` en el Escritorio, listo para adjuntar a un correo, es la
 * única forma realista de que la información llegue.
 *
 * Va delante lo que soporte pregunta siempre -- versión, plataforma, si está emparejado y en
 * marcha -- para que el primer correo de vuelta no sea otra vez "¿qué versión tienes?".
 *
 * Nunca lleva credenciales: este fichero sale de la máquina, y la contraseña del dispositivo
 * vive cifrada con DPAPI en ese mismo directorio. Sacarla por un botón de ayuda sería deshacer
 * esa protección.
 */

export type DatosDiagnostico = {
  version: string;
  plataforma: string;
  emparejado: boolean;
  enMarcha: boolean;
  deviceId: string | null;
  tenantId: string | null;
  impresorasCaidas: string[];
  ultimoError: string | null;
  generadoEn: Date;
};

const si = (v: boolean): string => (v ? "sí" : "no");

export function componerDiagnostico(datos: DatosDiagnostico, log: string): string {
  const cabecera = [
    "SuarEx — diagnóstico del agente de impresión",
    `Generado:      ${datos.generadoEn.toISOString()}`,
    `Versión:       ${datos.version}`,
    `Sistema:       ${datos.plataforma}`,
    `Emparejado:    ${si(datos.emparejado)}`,
    `Agente activo: ${si(datos.enMarcha)}`,
    `Dispositivo:   ${datos.deviceId ?? "—"}`,
    `Restaurante:   ${datos.tenantId ?? "—"}`,
    `Impresoras sin responder: ${
      datos.impresorasCaidas.length > 0 ? datos.impresorasCaidas.join(", ") : "ninguna"
    }`,
    `Último error:  ${datos.ultimoError ?? "ninguno"}`,
  ].join("\n");

  // Se redacta OTRA VEZ, aunque el log del disco ya se escribió redactado: una instalación
  // actualizada puede arrastrar un fichero escrito por una versión anterior a que la
  // redacción existiera.
  const cuerpo = log.trim() === "" ? "(sin entradas)" : redactar(log);

  return `${cabecera}\n\n--- Registro ---\n\n${cuerpo}\n`;
}

/** `suarex-diagnostico-2026-09-24-1830.txt`. Con la fecha para que dos envíos no se pisen. */
export function nombreDeFicheroDiagnostico(ahora: Date): string {
  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  const fecha = `${ahora.getUTCFullYear()}-${dosDigitos(ahora.getUTCMonth() + 1)}-${dosDigitos(ahora.getUTCDate())}`;
  const hora = `${dosDigitos(ahora.getUTCHours())}${dosDigitos(ahora.getUTCMinutes())}`;
  return `suarex-diagnostico-${fecha}-${hora}.txt`;
}
