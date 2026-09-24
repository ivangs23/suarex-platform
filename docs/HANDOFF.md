# Handoff — estado del proyecto

_Última actualización: 2026-09-24. Este documento es el punto de continuidad entre sesiones/máquinas.
Una conversación de Claude no transfiere sola; lee esto + `git log` + `CLAUDE.md` para retomar._

## Estado

Tres fases del plan de viabilidad, apiladas en ramas sucesivas. **Nada está en `main` todavía**:
la rama `feat/fase3-producto` contiene las tres, y las dos primeras esperan revisión como PR.

| Fase | Rama | PR | Estado |
|---|---|---|---|
| 1 · Poder cobrarle al primer cliente | `feat/fase1-bloque-a` | [#38](https://github.com/ivangs23/suarex-platform/pull/38) | 16/19 — bloque C bloqueado por SMTP |
| 2 · Supervivencia operativa | `feat/fase2-operativa` | [#39](https://github.com/ivangs23/suarex-platform/pull/39) | ✅ |
| 3 · Producto para el hostelero | `feat/fase3-producto` | — | ✅ cerrada el 2026-09-24 |

Suite entera en verde sobre `feat/fase3-producto`: **97 e2e · 383 integración (60 ficheros) ·
7 paquetes unit · typecheck 9/9 · lint**.

Origen de todo: la auditoría del 2026-09-15, en
`docs/superpowers/plans/2026-09-15-viabilidad-roadmap.md`. Cada fase tiene su spec con las
decisiones y su razón en `docs/superpowers/specs/`.

### Fase 1 — lo que impedía cobrar

| Bloque | Estado |
|---|---|
| A · Recibo sin ambigüedad fiscal | ✅ 4/4 |
| B · Marco legal | ✅ 3/3 |
| C · Correo y credenciales | ⛔ 0/3 — **bloqueado**: faltan credenciales SMTP |
| D · Suscripción y corte por impago | ✅ 4/4 |
| E · Consola de plataforma | ✅ 5/5 |

- **El recibo se declara justificante, no factura** (decisión D1 del spec), con emisor y
  desglose de IVA. En pantalla y en el PDF, para todos los tenants, en es/en/pt.
- **Tres páginas legales por cliente**, con él como responsable del tratamiento y SuarEx como
  encargado. Más la retención que las hace verdad: cron que anula notas a los 90 días y borra
  pedidos a los 24 meses.
- **Suscripción con corte por impago**: webhook propio, ventana de gracia de 7 días, aviso en
  el panel del dueño y barrido diario. Un impago nunca corta en el momento.
- **Consola de plataforma** en `admin.<raíz>`: alta de clientes y suspensión desde el
  navegador, en vez de SSH con la service key.

**Lo que falta, y no es código**: contratar proveedor SMTP (Resend, Postmark, Brevo) y verificar
el dominio con SPF+DKIM. Sin eso no se pueden probar la recuperación de contraseña ni el alta de
personal por invitación. Las tres tareas están escritas y validadas en el plan.

Un hueco menor, anotado: el camino feliz del webhook de facturación por HTTP no se ha
ejercitado (haría falta `STRIPE_BILLING_WEBHOOK_SECRET` en `apps/web/.env.local` y
`stripe listen`). Sí están cubiertos el mapeo de estados (unit) y `applySubscriptionState`
(integración), y que el endpoint falla cerrado sin secreto (e2e).

### Fase 2 — que el servicio sobreviva a un día malo

Log estructurado con redacción por nombre de clave, avisos de dispositivo caído y recuperado,
reembolsos y disputas de Stripe registrados, watchdog del sistema en Windows.

**La revisión de esta fase encontró producción rota en silencio**: faltaban dos variables de
entorno en `deploy/docker-compose.app.yml`, así que el webhook de facturación devolvía 500
siempre y los cuatro crons 503. Invisible para las tres suites, que corren en desarrollo. Y el
backup **no se podía restaurar**: tres fallos encadenados que solo aparecieron al hacer un
simulacro de verdad. Los pasos de despliegue pendientes están en el cuerpo del PR #39.

### Fase 3 — producto para el hostelero

Informe de ventas del día (por producto y por franja, con CSV), histórico de pedidos,
"se acabó hoy" que se repone solo, franjas horarias de carta y analítica de conversión del QR.

Dos decisiones que conviene conocer antes de tocar nada de esto:

- **Las franjas van en la CATEGORÍA**, no en el plato, y se heredan hacia abajo. Cruzan
  medianoche y se calculan en la zona de la sede. Ver D4 del spec de Fase 3.
- **La analítica usa contadores agregados, nunca un registro de eventos.** Medir qué fichas se
  abren exigiría una baliza y una fila por visita: un tratamiento de datos nuevo que obligaría a
  reescribir la política de privacidad. Ver D5.

La propina se descartó (D2): no compensa el riesgo fiscal para lo que aporta.

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
- **Watchdog de Windows: validar en el PC de un cliente.** No se puede probar fuera de
  Windows; el procedimiento está en `docs/agent-desktop-validacion.md`. Hasta que se haga, la
  recuperación ante caída del proceso está implementada pero NO verificada.
## Contexto heredado (proyecto anterior de Manuela)

Existe un producto anterior — repo **público** `ivangs23/web-manuela` + `agente-impresora-v2` +
`kiosko-manuela` — con exposición viva a 2026-07-21: RLS abierta a `anon` sobre `pedidos`/
`cierres_dia`/`order_counter`, y secretos (`GH_TOKEN`, secret key de Paytef) dentro del `.exe`
porque `build.files` incluye `.env`. **La anon key es pública por diseño**: rotar claves no cierra
nada, solo acotar las policies lo hace. No confundir un problema con el otro. Es un sistema
distinto de esta plataforma; se menciona por si se retoma.
