# 0003 — `api/tls-check` queda fuera del matcher del proxy

**Estado:** vigente · **Fecha:** 2026-10-23 (recogida de `apps/web/proxy.ts`)

## Contexto

Caddy emite certificados bajo demanda para los dominios propios de los clientes y, antes de
pedir uno, pregunta a la web (`ask`) si el dominio es de un cliente activo:
`/api/tls-check?domain=…`. Lo llama Caddy, no un navegador, y por la red de Docker: con
`Host: web:3000`, que no es ningún tenant.

## Decisión

`api/tls-check` se excluye del `matcher` de `apps/web/proxy.ts`. La ruta no necesita tenant ni
lo usa: solo responde sí o no sobre `tenants.custom_domain`.

## Consecuencias

- Pasando por el proxy, `findTenantByHost("web:3000")` no encontraba nada y reescribía a
  `/not-found` (404) ANTES de ejecutar la ruta: Caddy recibía siempre 404, no autorizaba ningún
  certificado y ningún cliente con dominio propio podía servirse por HTTPS. Los tests locales
  pasaban porque llamaban con el Host de un tenant real; se vio en el VPS.
- Es la única ruta pública sin resolución de tenant, y está diseñada para ser alcanzable desde
  internet: falla cerrado (sin `domain`, o desconocido, deniega) y sus negativas son
  indistinguibles entre sí. Por eso la usa también `deploy/scripts/uptime-check.sh`.
- Lo que hay que vigilar: cualquier ruta nueva que llame un servicio interno con un Host que no
  es de tenant tiene el mismo problema y necesita su propia exclusión, razonada.
