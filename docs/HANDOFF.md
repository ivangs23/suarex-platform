# Handoff — estado del proyecto

_Última actualización: 2026-07-24. Este documento es el punto de continuidad entre sesiones/máquinas.
Una conversación de Claude no transfiere sola; lee esto + `git log` + `CLAUDE.md` para retomar._

## Estado

`main` estable, suite completa en verde (lint · typecheck · unit · integración 303 · e2e 72). El
**backlog de código del repaso Electron está COMPLETO** (items 7, 8, 9, 11, 12, 13 + watchdog del
sistema; ver "Pendiente — código" abajo, todos ✅). Lo único sin ejercitar: el registro real de la
tarea programada del watchdog, que solo ocurre en un build EMPAQUETADO (`app.isPackaged`), no en
dev — queda validarlo en un instalador real. `electron-vite build` sí pasa; el `package` completo
necesita `UPDATE_FEED_URL` (tarea de infra, ver abajo). Sin PRs abiertas.

### Portado a Windows (Mac -> Windows)

El proyecto se retomó en Windows. Cuatro fricciones de portabilidad resueltas (detalle en
`CLAUDE.md` -> "En Windows"):

1. **CLI de Supabase** desactualizada (scoop 2.62.10) no parseaba `config.toml`; subida a
   2.109.1.
2. **Grants perdidos**: el stack nuevo de Supabase dejó de auto-conceder DML/EXECUTE a
   anon/authenticated/service_role en objetos creados por `postgres`. Nueva migración
   `20260721000000_api_role_baseline_grants.sql` (timestamp más bajo, solo `alter default
   privileges`) restaura el baseline. **Afecta a producción**: al actualizar el stack oficial
   del VPS, esta migración es la que evita que se rompa igual.
3. **CRLF**: nuevo `.gitattributes` (`* text=auto eol=lf`) para que Biome pase en Windows.
4. **`tsc` en `tenant-filter-structural.test.ts`**: invocaba `.bin/tsc` (no existe sin
   extensión en Windows); ahora lanza el `.js` con `process.execPath`.

Paso de setup por máquina Windows: añadir `garum.localhost`/`manuela.localhost` al `hosts`
(ver CLAUDE.md); sin ello el e2e no arranca el `webServer`.

## Lo hecho recientemente (esta tanda)

Flujo del comensal, pulido a partir de pruebas en vivo sobre el tenant **manuela**:

- **Recibo del comensal descargable en PDF** (`app/pedido/[publicToken]`): el botón hacía
  `window.print()` (en móvil no abría nada) → ahora genera un PDF con jsPDF (import dinámico) y lo
  descarga. Ticket de 80 mm; lógica de composición pura y testeada. Fix de jsPDF: en `portrait`
  intercambia lados si el ancho supera al alto → se fuerza `alto >= ancho` para no cortar precios.
- **Aviso "Escanea el QR de tu mesa para pedir"** cuando `canOrder` es false (cookie ausente o
  caducada): antes la carta se quedaba muda sin explicar por qué faltaban los botones.
- **"Volver a la carta"** en la pantalla de pago aceptado: cerraba el bucle pagar → recibo → seguir
  pidiendo.
- **Idiomas de manuela**: su catálogo real entró solo en español, así que el selector no aparecía.
  Traducido a EN/PT (categorías genéricas, descripciones, extras; nombres de plato originales) con
  `scripts/traducir-manuela.mjs` (re-ejecutable, casa por texto español).

App de escritorio (Electron), repaso operativo:

- **Visibilidad de impresión + avisos de impresora caída + icono de bandeja real** (antes
  `createEmpty()`, invisible). `runAgentTick` devuelve detalle (ok/fallos con motivo y destino);
  la app lo pinta y notifica solo las transiciones (cae/vuelve).
- **Auto-update** (electron-updater, generic) + **versión de build en el heartbeat**.
- **Watchdog** (uncaughtException/unhandledRejection no tumban la app; renderer caído se recarga)
  + **confirmación al des-emparejar**.

## Pendiente — código (repaso de la app Electron)

Priorizado por valor/coste. Detalle en el hilo; resumen:

- ✅ **9. Logs a fichero + exportar diagnóstico** — HECHO (`apps/agent-desktop/src/main/logger.ts`,
  `real-log-backend.ts`, `diagnostics.ts`; botón en el card Registro). Log rotativo en
  `userData/logs/agent.log`.
- ✅ **7. Desplegable de impresoras** — HECHO. El device reporta sus impresoras en el heartbeat
  (`devices.printers`, migración `20260724000001`), y `PrinterForm` ofrece un `<select>` de esas
  impresoras (con escape "escribir a mano" si el device aún no reportó). Adiós al typo silencioso.
- ✅ **8. Realtime** además del polling de 4 s — HECHO. `runAgent` se suscribe a `orders`
  (`subscribeToOrders`) y dispara un tick al instante ante un pedido `paid`; el poll sigue de
  respaldo (at-least-once). Guard `running`/`pending` coalesce ráfagas.
- ✅ **11. Guardar refresh token** en vez de la contraseña — HECHO. El device autentica por sesión
  persistida (refresh token cifrado DPAPI en `device-session.enc`, vía `persistSession`+storage de
  supabase-js, que re-persiste la rotación solo); la contraseña ya no toca disco. Login único al
  emparejar/migrar. Devices viejos se auto-migran en el primer arranque. Si el token se revoca
  (`resetDevice`→`deleteUser`) o caduca → re-emparejar.
- ✅ **12. Estado de impresoras de red** en el desktop — HECHO. Botón "Probar impresoras de red" en
  la sección Impresoras: sondea la conexión TCP (`probeTcp`) de cada impresora de red configurada,
  con el cliente del agente en marcha (no uno nuevo, por la rotación del refresh token de #11).
- ✅ **13. Query duplicada por tick** — HECHO. `runAgentTick` lee `printers` UNA vez y la comparte
  entre `selectUnprintedOrders` y `resolvePrintersFromRows`; las 4 lecturas del tick van en
  paralelo (1 RTT, antes 2). Sin cambio de comportamiento (lo cubren los tests `agent-*`).
- ✅ **Watchdog del SISTEMA** — HECHO. La app registra al arrancar (empaquetada+win32,
  idempotente, per-user) una tarea programada `SuarEx Agente Watchdog` que cada 5 min relanza el
  proceso si murió (el single-instance lock deduplica). `build/installer.nsh` la borra al
  desinstalar. **Pendiente de validar en un build empaquetado real** (en dev no se registra).

## Pendiente — infra (tareas de Iván, no código)

- **Rotar/borrar `/root/.git-credentials`** en el VPS.
- **Dominio `suarex.app`** + token de Cloudflare.
- **Credenciales SMTP** (emails).
- **Auto-update en producción**: montar el feed estático (p. ej. `updates.suarex.app` sirviendo
  `latest.yml` + instalador), pasar `UPDATE_FEED_URL` al build de `agent-desktop`, y **firmar** el
  instalador NSIS (sin firma → aviso de SmartScreen en Windows).

## Contexto heredado (proyecto anterior de Manuela)

Existe un producto anterior — repo **público** `ivangs23/web-manuela` + `agente-impresora-v2` +
`kiosko-manuela` — con exposición viva a 2026-07-21: RLS abierta a `anon` sobre `pedidos`/
`cierres_dia`/`order_counter`, y secretos (`GH_TOKEN`, secret key de Paytef) dentro del `.exe`
porque `build.files` incluye `.env`. **La anon key es pública por diseño**: rotar claves no cierra
nada, solo acotar las policies lo hace. No confundir un problema con el otro. Es un sistema
distinto de esta plataforma; se menciona por si se retoma.
