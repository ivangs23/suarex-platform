# Handoff — estado del proyecto

_Última actualización: 2026-07-24. Este documento es el punto de continuidad entre sesiones/máquinas.
Una conversación de Claude no transfiere sola; lee esto + `git log` + `CLAUDE.md` para retomar._

## Estado

`main` estable. Toda la suite en verde (lint · typecheck · unit · integración · e2e). Sin PRs
abiertas al cerrar esta sesión.

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

- **9. Logs a fichero + exportar diagnóstico** (recomendado el siguiente): hoy solo `console`,
  inaccesible en una app oculta en bandeja. Log rotativo en `userData` + botón "exportar".
- **7. Desplegable de impresoras** en el panel admin en vez de teclear el nombre a mano (un typo =
  la USB no casa y no imprime en silencio). El desktop ya las lista (`getPrintersAsync`).
- **8. Realtime** además del polling de 4 s (menos latencia y carga; polling como respaldo).
- **11. Guardar refresh token** en vez de la contraseña (menor superficie si se rompe DPAPI).
- **12. Estado de impresoras de red** en el desktop (probar conexión, no solo test USB).
- **13. Query duplicada por tick** (`printers` se consulta 2×: `device-orders` y `resolvePrinters`).
- **Watchdog del SISTEMA** (scheduled task / servicio Windows): la caída del propio proceso
  principal no se recupera desde dentro.

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
