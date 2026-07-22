export type StoredCredentials = {
  deviceId: string;
  email: string;
  password: string;
  tenantId: string;
};

export type ConfigBackend = {
  read(): string | null;
  write(raw: string): void;
  encrypt(plain: string): string;
  decrypt(enc: string): string;
};

type OnDisk = { deviceId: string; email: string; tenantId: string; passwordEnc: string };

/** Guarda las credenciales: la contraseña cifrada (`encrypt` -> `passwordEnc`), el resto en
 * claro. En producción `encrypt` es `safeStorage` (DPAPI), así que la contraseña queda
 * ligada al usuario/máquina y nunca se escribe en claro. */
export function saveCredentials(backend: ConfigBackend, creds: StoredCredentials): void {
  const onDisk: OnDisk = {
    deviceId: creds.deviceId,
    email: creds.email,
    tenantId: creds.tenantId,
    passwordEnc: backend.encrypt(creds.password),
  };
  backend.write(JSON.stringify(onDisk));
}

/** Lee y descifra las credenciales, o `null` si no hay fichero (dispositivo no emparejado)
 * o el JSON está corrupto. */
export function loadCredentials(backend: ConfigBackend): StoredCredentials | null {
  const raw = backend.read();
  if (raw === null) return null;
  try {
    const onDisk = JSON.parse(raw) as Partial<OnDisk>;
    if (!onDisk.deviceId || !onDisk.email || !onDisk.tenantId || !onDisk.passwordEnc) return null;
    return {
      deviceId: onDisk.deviceId,
      email: onDisk.email,
      tenantId: onDisk.tenantId,
      password: backend.decrypt(onDisk.passwordEnc),
    };
  } catch {
    return null;
  }
}
