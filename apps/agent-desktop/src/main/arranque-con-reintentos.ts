/**
 * Arranque del agente que AGUANTA la falta de red.
 *
 * Un PC de cocina arranca muchas veces antes de tener red: la wifi conecta después de iniciar
 * sesión, o un corte de luz ha reiniciado también el router. Antes, el primer fallo dejaba el
 * agente parado para siempre con un "hay que re-emparejar" falso: la sesión era buena y solo
 * faltaba volver a intentarlo. El watchdog del sistema tampoco lo salvaba, porque el proceso
 * seguía vivo. Validado en un Windows 11 real: cuatro días sin imprimir.
 *
 * Aquí se separan los dos casos. Sin red, se reintenta indefinidamente y con espera creciente.
 * Con una sesión que ya no vale (revocada, caducada), se para y se pide re-emparejar, porque
 * reintentar no lo arregla.
 *
 * Todo se inyecta para poder probarlo sin Electron, sin red y sin esperar de verdad.
 */

export type DepsArranque = {
  /** Un intento completo de arrancar el agente. Lanza si no lo consigue. */
  arrancar: () => Promise<void>;
  /** ¿Ese error es de red (se arregla esperando) y no de una sesión que ya no vale? */
  esSinConexion: (e: unknown) => boolean;
  esperar: (ms: number) => Promise<void>;
  /** ¿Sigue teniendo sentido? Deja de reintentar si se des-empareja, si alguien lo arranca por
   *  otro lado (re-emparejando) o si la app se está cerrando. */
  seguir: () => boolean;
  /** Desde el primer intento hasta que se arranca o se abandona: la ventana enseña "Conectando…"
   *  en vez de "agente parado", que mandaría a re-emparejar sin motivo. Sin red, un intento tarda
   *  sus buenos 25 s (supabase-js reintenta por dentro), así que importa desde el primero. */
  alCambiarConectando: (conectando: boolean) => void;
  avisos: {
    /** Solo el PRIMER fallo de red: un aviso por intento llenaría el registro en un corte largo. */
    sinConexion: (e: unknown) => void;
    recuperado: (intentosFallidos: number) => void;
    sesionInvalida: (e: unknown) => void;
  };
};

export type ResultadoArranque = "arrancado" | "sesion-invalida" | "abandonado";

const ESPERAS_MS = [5_000, 10_000, 30_000];
const ESPERA_MAXIMA_MS = 60_000;

/** Cuánto esperar antes del siguiente intento: 5 s, 10 s, 30 s y luego cada minuto. Pura. */
export function esperaAntesDeReintentar(intentosFallidos: number): number {
  return ESPERAS_MS[intentosFallidos - 1] ?? ESPERA_MAXIMA_MS;
}

export async function arrancarConReintentos(deps: DepsArranque): Promise<ResultadoArranque> {
  if (!deps.seguir()) return "abandonado";
  let fallidos = 0;
  deps.alCambiarConectando(true);
  try {
    for (;;) {
      try {
        await deps.arrancar();
        if (fallidos > 0) deps.avisos.recuperado(fallidos);
        return "arrancado";
      } catch (e) {
        if (!deps.esSinConexion(e)) {
          deps.avisos.sesionInvalida(e);
          return "sesion-invalida";
        }
        fallidos += 1;
        if (fallidos === 1) deps.avisos.sinConexion(e);
        await deps.esperar(esperaAntesDeReintentar(fallidos));
        if (!deps.seguir()) return "abandonado";
      }
    }
  } finally {
    deps.alCambiarConectando(false);
  }
}
