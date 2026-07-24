import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { LogSink } from "./logger.js";

// Un fichero activo + un rotado. Al pasar el activo de MAX_BYTES se renombra a `.1`
// (sobrescribiendo el rotado anterior): el disco queda acotado a ~2× MAX_BYTES en un agente
// que corre meses sin reiniciar. 512 KB dan de sobra para el histórico reciente que sirve para
// diagnosticar sin engordar el userData.
const MAX_BYTES = 512 * 1024;

/**
 * Sink de producción: escribe a `userData/logs/agent.log` con rotación por tamaño. Único punto
 * que toca `fs` + `app.getPath` (como `real-config-backend.ts`), para que `logger.ts` quede
 * puro. `append` además hace eco por consola: en dev se ve en la terminal, y en producción va a
 * un stdout que nadie lee (inofensivo) -- el valor real es el fichero.
 */
export function realLogSink(): LogSink {
  const dir = join(app.getPath("userData"), "logs");
  const active = join(dir, "agent.log");
  const rotated = join(dir, "agent.log.1");
  mkdirSync(dir, { recursive: true });

  return {
    append(line) {
      rotateIfNeeded(active, rotated);
      try {
        appendFileSync(active, `${line}\n`, "utf8");
      } catch (e) {
        // Si no se puede escribir el log (disco lleno, permisos), no tumbamos la app por ello:
        // la impresión importa más que su propio registro. Queda el eco por consola.
        console.error("[log] no se pudo escribir el registro:", e);
      }
      console.error(line);
    },
    read() {
      const prev = existsSync(rotated) ? readFileSync(rotated, "utf8") : "";
      const cur = existsSync(active) ? readFileSync(active, "utf8") : "";
      return prev + cur;
    },
  };
}

/** Rota el activo al `.1` si superó el tope. En Windows `renameSync` sobre un destino existente
 *  lanza, así que se borra el rotado anterior primero. Un fallo al rotar no debe perder logs:
 *  se sigue escribiendo en el activo (a lo sumo crece un poco de más). */
function rotateIfNeeded(active: string, rotated: string): void {
  try {
    if (existsSync(active) && statSync(active).size >= MAX_BYTES) {
      if (existsSync(rotated)) rmSync(rotated);
      renameSync(active, rotated);
    }
  } catch (e) {
    console.error("[log] no se pudo rotar el registro:", e);
  }
}
