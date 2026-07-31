/**
 * ¿ESTE EJECUTABLE ESTÁ COMPLETO?
 *
 * Los tres valores de `baked-config.ts` se hornean en el build a partir de variables de entorno.
 * Si al compilar no estaban, quedan como cadena vacía y la app arranca IGUAL: ventana normal,
 * menú normal, botones normales. Solo que nada de lo que hagas funciona, y cada parte falla por
 * su lado con un error distinto -- el emparejamiento con "código inválido", el panel con un
 * recuadro en blanco, el agente con "no hay sesión guardada". Ninguno de esos mensajes apunta a
 * la causa real, así que se busca donde no es. Pasó, y costó media hora.
 *
 * Esto lo dice de una vez y por su nombre. No repara nada: un ejecutable incompleto hay que
 * volver a generarlo. Lo que evita es buscar el fallo en el sitio equivocado.
 *
 * Puro y sin `import` de Electron para poder probarlo: los valores llegan como argumento en vez
 * de leerse de `baked-config.ts`, que se resuelve en tiempo de build.
 */

/** Los valores sin los que la app no puede hacer su trabajo. */
export type ConfigHorneada = {
  /** Host de la API de Supabase. Sin él el agente no puede ni autenticarse. */
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Origin de la web de la plataforma: emparejamiento y panel incrustado. */
  PLATFORM_WEB_ORIGIN: string;
};

/**
 * Qué falta, por su nombre de variable.
 *
 * El nombre exacto es lo importante: quien lea esto va a tener que volver a generar el
 * ejecutable, y lo que necesita saber es qué pasarle al build, no que "hay un problema de
 * configuración". Solo se comprueba que haya algo -- un valor equivocado (un origin de otro
 * cliente) es otro problema, y este chequeo no puede distinguirlo.
 *
 * `UPDATE_FEED_URL` NO entra: sin él la app funciona perfectamente, solo que no se
 * autoactualiza. Meterlo aquí sería dar la alarma por algo que no la merece, y una alarma que
 * salta cuando no pasa nada acaba ignorándose cuando sí.
 */
export function faltaEnConfigHorneada(config: ConfigHorneada): string[] {
  return (Object.keys(config) as (keyof ConfigHorneada)[]).filter(
    (nombre) => config[nombre].trim() === "",
  );
}

/** Lo que se le enseña a la persona que tiene el equipo delante. */
export function mensajeDeConfigIncompleta(faltantes: string[]): string {
  return (
    `Este ejecutable se generó sin ${faltantes.join(", ")}, así que no puede conectarse a ` +
    "nada. No es un problema de este equipo ni de tu contraseña: hay que volver a generar la " +
    "aplicación con esos valores."
  );
}
