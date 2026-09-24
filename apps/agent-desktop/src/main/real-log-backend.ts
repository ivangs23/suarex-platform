import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { LogBackend } from "./log-file.js";

/**
 * Backend de producción: dos ficheros en `userData`, al lado de las credenciales.
 *
 * `agente.log` es el actual y `agente.1.log` la generación anterior. Dos y no más: con una
 * sola, rotar justo después de un fallo borraría precisamente el tramo que explica el fallo;
 * con cinco, el PC de una cocina acumularía megas de un log que nadie va a leer entero.
 */
export function realLogBackend(): LogBackend {
  // Las rutas se resuelven en CADA llamada, no al construir el backend: este se instala antes
  // de `app.whenReady()` para no perder las trazas del arranque, y así nada depende de que
  // `getPath` ya esté resuelto en ese instante.
  const actual = () => join(app.getPath("userData"), "agente.log");
  const anterior = () => join(app.getPath("userData"), "agente.1.log");

  return {
    size: () => (existsSync(actual()) ? statSync(actual()).size : 0),
    append: (linea) => appendFileSync(actual(), linea, "utf8"),
    rotate: () => {
      // `renameSync` sobre un destino existente lo reemplaza, así que no hace falta borrar
      // antes -- y evita la ventana en la que no existiría ninguna de las dos.
      if (existsSync(actual())) renameSync(actual(), anterior());
    },
    read: () => {
      const trozo = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
      return trozo(anterior()) + trozo(actual());
    },
  };
}
