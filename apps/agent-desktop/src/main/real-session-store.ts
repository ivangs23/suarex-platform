import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionStore } from "@suarex/agent";
import { app, safeStorage } from "electron";

/**
 * Almacén de la sesión del device respaldado por DPAPI (`safeStorage`), en
 * `userData/device-session.enc`. supabase-js guarda aquí la sesión (access + refresh token) bajo
 * una única clave, y re-persiste sola el refresh token cada vez que rota. Se ignora la `key`
 * porque solo hay una sesión.
 *
 * Es lo único sensible que queda en disco tras #11 -- y a diferencia de la contraseña que se
 * guardaba antes (acceso indefinido si DPAPI se filtra), un refresh token se puede REVOCAR
 * (`resetDevice` -> `deleteUser`) y CADUCA.
 */
export function realSessionStore(): SessionStore {
  const file = join(app.getPath("userData"), "device-session.enc");
  return {
    getItem: () => (existsSync(file) ? safeStorage.decryptString(readFileSync(file)) : null),
    setItem: (_key, value) => {
      writeFileSync(file, safeStorage.encryptString(value));
    },
    removeItem: () => {
      if (existsSync(file)) rmSync(file);
    },
  };
}
