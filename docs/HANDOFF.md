# Handoff — estado del proyecto

_Última actualización: 2026-07-24. Este documento es el punto de continuidad entre sesiones/máquinas.
Una conversación de Claude no transfiere sola; lee esto + `git log` + `CLAUDE.md` para retomar._

## Estado

Rama `feat/fase1-bloque-a`: **Fase 1 del plan de viabilidad, 16 de 19 tareas**. Suite entera en
verde (89 e2e · 327 integración · 8 paquetes unit · typecheck · lint).

Lo que la Fase 1 cierra es lo que impedía **cobrarle al primer cliente**, no funcionalidad del
comensal. Origen: auditoría del 2026-09-15, en
`docs/superpowers/plans/2026-09-15-viabilidad-roadmap.md`.

| Bloque | Estado |
|---|---|
| A · Recibo sin ambigüedad fiscal | ✅ 4/4 |
| B · Marco legal | ✅ 3/3 |
| C · Correo y credenciales | ⛔ 0/3 — **bloqueado**: faltan credenciales SMTP |
| D · Suscripción y corte por impago | ✅ 4/4 |
| E · Consola de plataforma | ✅ 5/5 |

### Lo que existe ahora y antes no

- **El recibo se declara justificante, no factura** (decisión D1 del spec), con emisor y
  desglose de IVA. En pantalla y en el PDF, para todos los tenants, en es/en/pt.
- **Tres páginas legales por cliente**, con él como responsable del tratamiento y SuarEx como
  encargado. Más la retención que las hace verdad: cron que anula notas a los 90 días y borra
  pedidos a los 24 meses.
- **Suscripción con corte por impago**: webhook propio, ventana de gracia de 7 días, aviso en
  el panel del dueño y barrido diario. Un impago nunca corta en el momento.
- **Consola de plataforma** en `admin.<raíz>`: alta de clientes y suspensión desde el
  navegador, en vez de SSH con la service key.

### Lo que falta de la Fase 1

El bloque C entero, y **no es código**: hace falta contratar un proveedor SMTP (Resend,
Postmark, Brevo) y verificar el dominio con SPF+DKIM. Sin eso no se pueden probar ni la
recuperación de contraseña ni el alta de personal por invitación. Las tres tareas están
escritas y validadas en el plan, listas para ejecutar el día que haya credenciales.

Un hueco menor, anotado: el camino feliz del webhook de facturación por HTTP no se ha
ejercitado (haría falta `STRIPE_BILLING_WEBHOOK_SECRET` en `apps/web/.env.local` y
`stripe listen`). Sí están cubiertos el mapeo de estados (unit) y `applySubscriptionState`
(integración), y que el endpoint falla cerrado sin secreto (e2e).

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
