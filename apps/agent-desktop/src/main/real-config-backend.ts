import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { ConfigBackend } from "./config-store.js";

/** Backend de producción: JSON en `userData/credentials.json`, contraseña cifrada con
 * `safeStorage` (DPAPI en Windows). `encrypt`/`decrypt` usan base64 para poder guardar el
 * buffer cifrado como texto en el JSON. */
export function realConfigBackend(): ConfigBackend {
  const file = join(app.getPath("userData"), "credentials.json");
  return {
    read: () => (existsSync(file) ? readFileSync(file, "utf8") : null),
    write: (raw) => writeFileSync(file, raw, "utf8"),
    encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decrypt: (enc) => safeStorage.decryptString(Buffer.from(enc, "base64")),
  };
}
