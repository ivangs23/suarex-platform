/**
 * BARRERA EN LA FIRMA, NO EN LA MEMORIA.
 *
 * Este proyecto ya cerró esta brecha una vez para las Server Actions de administración (ver
 * el docstring de `managerAction`): que cada action empiece por `await requireX()` a mano es
 * correcto hoy y se rompe el día que alguien escriba la siguiente sin acordarse. La barrera
 * tiene que vivir donde no se pueda omitir.
 *
 * `guardedAction` generaliza ese patrón a cualquier guard. De él salen `managerAction` (panel
 * del cliente) y `platformAction` (consola de plataforma): un solo concepto en vez de dos
 * envoltorios paralelos que divergirían con el primer cambio.
 *
 * El segundo parámetro `check` es inyectable EXCLUSIVAMENTE para poder probar la composición
 * del envoltorio sin simular cookies ni headers de una request de Next (ver
 * `require-manager.test.ts`). Ninguna action de producción lo pasa.
 */
export function guardedAction<S>(guardPorDefecto: () => Promise<S>) {
  return <Args extends unknown[], R = void>(
    fn: (session: S, ...args: Args) => Promise<R>,
    check: () => Promise<S> = guardPorDefecto,
  ): ((...args: Args) => Promise<R>) =>
    async (...args: Args) => {
      const session = await check();
      return fn(session, ...args);
    };
}
