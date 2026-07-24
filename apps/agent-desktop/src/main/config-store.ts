export type StoredCredentials = {
  deviceId: string;
  email: string;
  tenantId: string;
  /**
   * Presente SOLO al leer un fichero en el formato VIEJO (con la contraseña cifrada). Es la
   * señal de que ese device hay que migrarlo (#11): un login único con esta contraseña para
   * dejar la sesión persistida, y luego reescribir el fichero sin ella. En el formato nuevo la
   * contraseña no existe en disco -- la autenticación va por el refresh token del `SessionStore`.
   */
  legacyPassword?: string;
};

export type ConfigBackend = {
  read(): string | null;
  write(raw: string): void;
  encrypt(plain: string): string;
  decrypt(enc: string): string;
};

// `passwordEnc` es OPCIONAL: solo aparece en ficheros escritos por versiones anteriores. Lo que
// se escribe de aquí en adelante nunca lo lleva.
type OnDisk = {
  deviceId: string;
  email: string;
  tenantId: string;
  passwordEnc?: string;
};

/** Guarda los metadatos del device (sin contraseña). La autenticación vive aparte, en el
 * `SessionStore` (refresh token cifrado), no aquí. */
export function saveCredentials(
  backend: ConfigBackend,
  creds: { deviceId: string; email: string; tenantId: string },
): void {
  const onDisk: OnDisk = {
    deviceId: creds.deviceId,
    email: creds.email,
    tenantId: creds.tenantId,
  };
  backend.write(JSON.stringify(onDisk));
}

/**
 * Lee los metadatos del device, o `null` si no hay fichero (no emparejado) o el JSON está
 * corrupto. Si el fichero es del formato viejo (con `passwordEnc`), descifra la contraseña y la
 * expone como `legacyPassword` para que el arranque la migre; el formato nuevo no la lleva.
 */
export function loadCredentials(backend: ConfigBackend): StoredCredentials | null {
  const raw = backend.read();
  if (raw === null) return null;
  try {
    const onDisk = JSON.parse(raw) as Partial<OnDisk>;
    if (!onDisk.deviceId || !onDisk.email || !onDisk.tenantId) return null;
    const creds: StoredCredentials = {
      deviceId: onDisk.deviceId,
      email: onDisk.email,
      tenantId: onDisk.tenantId,
    };
    if (onDisk.passwordEnc) creds.legacyPassword = backend.decrypt(onDisk.passwordEnc);
    return creds;
  } catch {
    return null;
  }
}
