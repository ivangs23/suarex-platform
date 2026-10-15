import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * No se pudo hablar con la plataforma: sin red, router reiniciándose, servidor caído. La sesión
 * guardada sigue siendo buena, así que esto se arregla REINTENTANDO, nunca re-emparejando.
 */
export class SinConexionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SinConexionError";
  }
}

/** La sesión guardada ya no vale (revocada con `resetDevice`, caducada) o no hay ninguna: solo
 *  se arregla re-emparejando con un código nuevo. */
export class SesionInvalidaError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SesionInvalidaError";
  }
}

/**
 * ¿Es un fallo de red, que se arregla esperando? Reconoce el error propio y el de supabase-js tal
 * cual (el login con contraseña al emparejar o migrar lo lanza sin envolver).
 */
export function esSinConexion(e: unknown): boolean {
  return e instanceof SinConexionError || isAuthRetryableFetchError(e);
}

/**
 * Almacén de la sesión de Supabase (interfaz `storage` de supabase-js). En producción lo
 * respalda la cáscara Electron con un fichero cifrado por DPAPI (`safeStorage`); en los tests,
 * un `Map` en memoria. Al delegar en supabase-js la persistencia (`persistSession: true`), la
 * ROTACIÓN del refresh token (config: `enable_refresh_token_rotation`) se re-persiste sola en
 * cada renovación -- que es justo la parte fácil de romper si se hace a mano.
 */
export type SessionStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Clave única bajo la que se guarda la sesión del device en el `SessionStore`. */
export const DEVICE_SESSION_STORAGE_KEY = "suarex-device-session";

export type AgentCredentials = {
  supabaseUrl: string;
  anonKey: string;
  /** Tenant del dispositivo. Solo lo usa `runAgent` para nombrar el canal de Realtime; el
   *  aislamiento real lo da RLS, no el nombre. Opcional: los tests que crean el cliente para
   *  llamar a `runAgentTick` directamente no lo necesitan. */
  tenantId?: string;
  /**
   * Autenticación. Se da UNA de dos rutas:
   *  - `sessionStore`: arranque normal del desktop. La sesión (con el refresh token) se
   *    restaura del almacén; la CONTRASEÑA nunca toca disco (#11).
   *  - `email` + `password`: login con contraseña -- lo usan los tests (que llaman a
   *    `createDeviceClient` directo) y el login ÚNICO que hace el desktop al emparejar/migrar
   *    (vía `signInAndPersistSession`), tras el cual la contraseña se descarta.
   */
  sessionStore?: SessionStore;
  email?: string;
  password?: string;
};

/**
 * Cliente Supabase del DISPOSITIVO. NUNCA la service key -- el PC del cliente jamás debe
 * poseerla, y este paquete no la importa por ningún lado. A partir de aquí toda lectura pasa
 * por la RLS del rol `device`, y toda escritura por las RPCs `SECURITY DEFINER` acotadas al JWT.
 *
 * Dos rutas de autenticación (ver `AgentCredentials`):
 *  - Con `sessionStore`: restaura la sesión guardada y la REFRESCA para validar el refresh token
 *    en el acto. Si está revocado/caducado lanza `SesionInvalidaError` (hay que re-emparejar); si
 *    no hay red, `SinConexionError` (hay que reintentar). El token rotado lo re-persiste
 *    supabase-js solo.
 *  - Con `email`+`password`: `signInWithPassword` clásico.
 */
export async function createDeviceClient(creds: AgentCredentials): Promise<SupabaseClient> {
  if (creds.sessionStore) {
    // Que haya sesión se mira en el ALMACÉN, no con `getSession()`: con el token de acceso
    // caducado, `getSession()` intenta renovarlo por dentro y, sin red, devuelve `session: null`
    // aunque la sesión siga en disco. Leerlo así confundía "sin red" con "no hay sesión": un PC
    // apagado unos días que arrancaba sin red mandaba re-emparejar.
    if (creds.sessionStore.getItem(DEVICE_SESSION_STORAGE_KEY) === null) {
      throw new SesionInvalidaError("No hay sesión de dispositivo guardada: hay que re-emparejar.");
    }
    const client = createClient(creds.supabaseUrl, creds.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: creds.sessionStore,
        storageKey: DEVICE_SESSION_STORAGE_KEY,
      },
    });
    // `refreshSession` valida el refresh token contra el servidor (falla si se revocó con
    // `resetDevice`/`deleteUser`) y rota+persiste uno nuevo, antes de dar el cliente por bueno.
    const { data, error } = await client.auth.refreshSession();
    if (error || !data.session) {
      // Un cliente que se descarta no puede seguir renovando por su cuenta: en Node su
      // temporizador corre siempre, y con la red de vuelta renovaría el MISMO refresh token que el
      // cliente del siguiente intento. Dos renovaciones a la vez y Supabase da el token por
      // reutilizado: la sesión del dispositivo se pierde de verdad.
      await client.auth.stopAutoRefresh();
      if (isAuthRetryableFetchError(error)) {
        throw new SinConexionError(`Sin conexión con la plataforma: ${error.message}`, {
          cause: error,
        });
      }
      throw new SesionInvalidaError(
        `La sesión del dispositivo ya no vale (hay que re-emparejar): ${error?.message ?? "sin sesión"}`,
        { cause: error },
      );
    }
    return client;
  }

  if (creds.email && creds.password) {
    const client = createClient(creds.supabaseUrl, creds.anonKey, {
      auth: { autoRefreshToken: true, persistSession: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (error) throw error;
    return client;
  }

  throw new Error("createDeviceClient necesita `sessionStore` o `email`+`password`.");
}

/**
 * Login con contraseña que PERSISTE la sesión resultante en `store` (con su refresh token) y
 * nada más. Lo usa el desktop UNA vez -- al emparejar (con la contraseña que devuelve el pairing)
 * y al migrar un device viejo (con la contraseña que aún tenía guardada) -- para dejar la sesión
 * lista en el almacén y poder DESCARTAR la contraseña. Los arranques siguientes ya van por la
 * ruta `sessionStore` de `createDeviceClient`, sin contraseña en disco.
 */
export async function signInAndPersistSession(
  supabaseUrl: string,
  anonKey: string,
  store: SessionStore,
  email: string,
  password: string,
): Promise<void> {
  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      storage: store,
      storageKey: DEVICE_SESSION_STORAGE_KEY,
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // supabase-js ya escribió la sesión (access + refresh token) en `store`. La contraseña se
  // queda en memoria en el caller y se descarta al terminar; nunca se persiste.
}
