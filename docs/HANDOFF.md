# Handoff — estado del proyecto

_Última actualización: 2026-09-24. Este documento es el punto de continuidad entre sesiones/máquinas.
Una conversación de Claude no transfiere sola; lee esto + `git log` + `CLAUDE.md` para retomar._

## Estado

`main` con las **fases 1-3 del plan de viabilidad ya integradas**. Suite completa en verde tras un
`db:reset` desde cero: lint · typecheck 9/9 · unit (7 paquetes) · **integración 411** (66 ficheros)
· **e2e 112**.

### Aviso a quien retome esto: rebasa antes de empezar

Las fases 1-3 se desarrollaron en una rama cortada de `4b3060b` (24 jul) que **nunca se rebasó**.
Mientras tanto `main` acumuló 44 commits — el modo totem entero y todo el backlog del repaso
Electron. Resultado: **tres piezas se construyeron dos veces** (logs a fichero + diagnóstico,
watchdog del sistema, desplegable de impresoras), y las dos ramas añadieron a `devices` la misma
columna con nombre distinto.

La auditoría del 15 de septiembre corrió contra esa rama obsoleta, así que parte de lo que reportó
como "falta" ya existía aquí. Antes de auditar o planificar nada: `git fetch && git log HEAD..origin/main`.

En la integración se conservó la versión de `main` en todo lo duplicado, y la columna se quedó en
`devices.printers` (NOT NULL, default `{}` — "todavía no ha reportado" es lista VACÍA, no null).

### Lo que aportan las fases 1-3

| Fase | Qué cierra |
|---|---|
| 1 | Poder cobrarle al primer cliente: recibo declarado justificante con desglose de IVA, tres páginas legales por tenant con su retención de datos, suscripción con corte por impago y ventana de gracia de 7 días, consola de plataforma en `admin.<raíz>` |
| 2 | Sobrevivir a un día malo: log estructurado con redacción por nombre de clave, avisos de dispositivo caído y recuperado, reembolsos y disputas de Stripe registrados |
| 3 | Producto para el hostelero: informe de ventas del día con CSV, histórico de pedidos, "se acabó hoy" que se repone solo, franjas horarias de carta, analítica de conversión del QR |

Tres decisiones que conviene conocer antes de tocar esas zonas:

- **Las franjas horarias van en la CATEGORÍA**, no en el plato, y se heredan hacia abajo. Cruzan
  medianoche y se calculan en la zona de la sede. Ver D4 del spec de Fase 3.
- **La analítica usa contadores agregados, nunca un registro de eventos.** Medir qué fichas se
  abren exigiría una baliza y una fila por visita: un tratamiento de datos nuevo que obligaría a
  reescribir la política de privacidad. Ver D5.
- **`packages/db` no exporta `serviceClient`.** Toda consulta pasa por `tenantScoped(tabla, id)`;
  las excepciones son 19, numeradas y justificadas una a una en `client.ts`. Un test estructural
  descubre las tablas con `tenant_id` por su cuenta y exige policy canónica y `revoke` de `anon`
  para cada una nueva.

### Lo único que falta de la Fase 1

El **bloque C** entero (recuperación de contraseña y alta de personal por invitación), y **no es
código**: hace falta contratar un proveedor SMTP y verificar el dominio con SPF+DKIM. Las tres
tareas están escritas y validadas en el plan, listas para ejecutar el día que haya credenciales.

Un hueco menor, anotado: el camino feliz del webhook de facturación por HTTP no se ha ejercitado
(haría falta `STRIPE_BILLING_WEBHOOK_SECRET` y `stripe listen`). Sí están cubiertos el mapeo de
estados, `applySubscriptionState` y que el endpoint falla cerrado sin secreto.

### Al desplegar las fases 1-3

1. Añadir `STRIPE_BILLING_WEBHOOK_SECRET` y `CRON_SECRET` a `deploy/docker-compose.app.yml`.
   **Sin esto el webhook de facturación devuelve 500 siempre y los cuatro crons 503**, en
   silencio: es exactamente el fallo que la revisión de la Fase 2 encontró en producción.
   Ya está en el fichero; lo que falta es tener los valores en `.env.app`.
1b. **RECONSTRUIR la imagen**, no solo reiniciar: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` no
   llegaba al build, así que cualquier imagen anterior tiene el formulario de pago muerto
   (el comensal ve "no se pudo cobrar"). Las `NEXT_PUBLIC_*` se hornean en el bundle.
2. Registrar en Stripe los eventos de suscripción, reembolso y disputa.
3. Instalar los tres crons nuevos apuntando al host de plataforma, y comprobar el `APP_URL` del
   `expire-orders` que ya existía.
4. Sembrar el primer superadmin: `node scripts/seed-platform-admin.mjs --email ...`.

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

## Pendiente — seguridad (auditoría del 2026-09-25)

Auditoría corrida contra la IMAGEN DE PRODUCCIÓN, no solo en desarrollo: se construyó, se
arrancó contra la Supabase local y se le mandó tráfico. Lo que salió y sigue abierto:

- **Electron 33 está fuera de soporte.** Los avisos de seguridad piden >= 38.8.6 (varios
  use-after-free). Subir cinco majors es un proyecto, no un parche, pero conviene planificarlo:
  el agente corre desatendido en el PC de cada cliente.
- **Sin protección contra clickjacking.** `deploy/Caddyfile` pone HSTS, `X-Content-Type-Options`
  y `Referrer-Policy`, pero NO `X-Frame-Options` ni CSP: `/admin` se puede meter en un iframe.
  Comprobado que el panel incrustado del agente usa `WebContentsView` y no un iframe, así que
  añadir la cabecera no rompería la app de escritorio.
- **`tar` (crítica) entra por electron-builder**: es de build del instalador, no de ejecución.

Comprobado y descartado, para que nadie lo vuelva a mirar: no hay ningún secreto en el
historial de git (solo se versionaron `.env.example`), la imagen de producción no contiene la
service role key ni la clave secreta de Stripe ni el `CRON_SECRET`, y ninguno de ellos viaja al
navegador.

### Manuela (producto anterior, otros repos)

Ramas locales preparadas y **sin pushear**, en `../web-manuela` y `../kiosko-manuela`:

- **Rotar el `GH_TOKEN` es lo urgente y no lo puede hacer nadie más.** Viajaba dentro de cada
  instalador del kiosko (`.env` estaba en `build.files`) y sigue en el historial de git. Quitarlo
  del build no deshace nada de lo ya distribuido.
- `web-manuela/supabase/migrations/007_rls_acotar_lectura_publica.sql`, escrita y **sin
  aplicar**: `order_counter` es hoy `FOR ALL USING(true)` y `pedidos`/`cierres_dia` tienen
  `SELECT USING(true)`. `cierres_dia` guarda `usuario_email`, que es dato personal.
- Lo que esa migración no cierra: el INSERT anónimo sigue abierto, así que cualquiera puede
  inyectar un pedido que la cocina imprime. Necesita credenciales propias para agente y kiosko,
  como el rol `device` de este producto.

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
