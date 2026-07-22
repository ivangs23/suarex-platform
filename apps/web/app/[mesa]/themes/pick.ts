/**
 * Resolución de un tema dentro de un registro, extraída como función PURA y sin JSX a
 * propósito: es la parte con lógica real (el fallback que impide que un tenant mal
 * configurado se quede sin carta) y así se puede probar en vitest sin importar los
 * componentes `.tsx` -- el tsconfig de Next usa `jsx: "preserve"`, que vitest no parsea.
 *
 * `resolveTheme` (ver `./index.ts`) es este mismo `pickFromRegistry` atado al registro real.
 */
export function pickFromRegistry<T>(
  registry: Record<string, T>,
  slug: string | null | undefined,
  fallbackKey: string,
): T {
  const fallback = registry[fallbackKey] as T;
  if (!slug) return fallback;
  return registry[slug] ?? fallback;
}
