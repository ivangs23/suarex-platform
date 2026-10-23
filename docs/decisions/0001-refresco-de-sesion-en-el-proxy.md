# 0001 — El proxy refresca la sesión del personal sin autorizar

**Estado:** vigente · **Fecha:** 2026-10-23 (recogida de `apps/web/proxy.ts`)

## Contexto

El personal (`/staff`) entra con Supabase Auth. Su access token dura una hora; sin refrescarlo
en cada petición, la sesión caduca a mitad de turno. `apps/web/proxy.ts` es el único sitio que
ve todas las peticiones a `/staff` con sus cookies y puede reescribirlas en la respuesta.

## Decisión

`refreshStaffSession` (en `proxy.ts`), solo para `/staff` y DESPUÉS de resolver el tenant:

- **No autoriza nada.** Solo mantiene viva la sesión. Quién puede qué lo decide
  `getStaffSession()` (`apps/web/lib/supabase-server.ts`) con el claim `tenant_id` ya verificado.
- **Primero `getSession()`** (lee la cookie, 0 ms) y solo si `necesitaRefresco` dice que el token
  está cerca de caducar, `getUser()` (ida y vuelta a Auth: 32 ms medidos, picos de 579 ms).
- **Envuelto en `try/catch`.** `@supabase/auth-js` (v2.110.7) ya devuelve los fallos de red como
  `{ error }` en vez de lanzarlos, pero solo los que reconoce como `AuthError`. Cualquier otra
  excepción (el adaptador de cookies, una versión futura de la librería) se propagaría.

## Consecuencias

- Ningún fallo al refrescar puede convertirse en un 500 para CADA petición a `/staff/*`,
  incluido `/staff/login`: eso impediría hasta volver a entrar.
- Si el refresco falla, la petición se sirve igual y la sesión no se renueva en esa petición:
  con el token ya caducado, el usuario tendrá que volver a entrar.
- No relaja ninguna autorización: `getStaffSession()` sigue fallando cerrado con un JWT
  inválido. Verificado apuntando `NEXT_PUBLIC_SUPABASE_URL` a un host inexistente con el dev
  server corriendo: ningún throw sin capturar.
- Descartado: refrescar en cada Server Component (una ida a Auth por cada uno) o dejar que
  caduque (el camarero perdería la sesión en mitad del servicio).
