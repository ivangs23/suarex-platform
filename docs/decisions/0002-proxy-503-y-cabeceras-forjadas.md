# 0002 — Fallo al resolver el tenant: 503 terminal; cabeceras de tenant forjadas fuera

**Estado:** vigente · **Fecha:** 2026-10-23 (recogida de `apps/web/proxy.ts`)

## Contexto

El tenant se resuelve UNA vez, en `apps/web/proxy.ts`, por el `Host` (`findTenantByHost`), y
viaja a las páginas en cabeceras de la petición (`x-suarex-tenant-id`, `-slug`, `x-suarex-path`)
que lee `requireTenant()`. Un cliente puede mandar esas mismas cabeceras inventadas: si alguna
llegara a una página sin pasar por el proxy, serviría la carta o el panel de OTRO tenant.

## Decisión

- **Toda respuesta que enruta a una página reescribe las cabeceras.** En el camino feliz se fijan
  las buenas; en los `rewrite` a `/not-found` (404) y `/suspended` (503) se pasan las de la
  petición SIN las de tenant (`stripForgedTenantHeaders`).
- **Si `findTenantByHost` lanza (fallo de infraestructura): `new NextResponse(…, { status: 503 })`**,
  sin `request: { headers }`, a propósito. Es una respuesta TERMINAL: no fija
  `x-middleware-rewrite`, `x-middleware-next` ni `location`, así que el router de Next devuelve
  su cuerpo tal cual sin renderizar ninguna página ni layout. Ninguna cabecera, forjada o no,
  llega a `requireTenant()` por ahí. (Su tipo, `ResponseInit`, ni siquiera admite `request`.)
  Verificado contra `resolve-routes.js` de Next y con curl.

## Consecuencias

- Ante una caída de la base, todo responde 503: nunca el tenant equivocado ni un 500 genérico.
- `requireTenant()` puede fiarse de sus cabeceras porque ninguna ruta renderizable las recibe sin
  pasar por el proxy. El layout raíz degrada a la marca por defecto en `/not-found` y
  `/suspended`, que llegan sin tenant a propósito.
- Lo que hay que vigilar: una rama nueva del proxy que haga `rewrite`/`next` con las cabeceras de
  la petición original sin pasar por `stripForgedTenantHeaders`.
