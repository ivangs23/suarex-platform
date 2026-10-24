# Handoff — estado del proyecto

_Última actualización: 2026-10-23. Punto de continuidad entre sesiones y máquinas: una
conversación de Claude no se transfiere sola. Para retomar, lee esto, `git log` y `CLAUDE.md`._

> **Si retomas desde otra máquina, empieza por [`RETOMAR-EN-WINDOWS.md`](RETOMAR-EN-WINDOWS.md).**

## Estado

`main` tiene integradas las fases 1-3 del plan de viabilidad y las fases 0-3 del
[plan de endurecimiento](superpowers/plans/2026-10-22-auditoria-endurecimiento.md), más la 5.1 y
dos arreglos de seguridad de dependencias.

Suite en verde:

| Comprobación | Resultado |
|---|---|
| lint | ok |
| typecheck | 10/10 + tests |
| unit | 9 paquetes; web: 3.959 |
| integración | 494 (73 ficheros) |
| e2e | 149, en Windows, incluidas 14 capturas visuales de la carta |

**CI** (`.github/workflows/ci.yml`), en cada PR:
- `verificar`: lint, typecheck y unit.
- `integracion`: contra Supabase en el runner. Todavía no bloquea el merge.

El e2e sigue siendo local.

Por qué el código es como es: [`docs/decisions/`](decisions/README.md) (ADRs).

## Lo primero al desplegar (Iván)

1. **URGENTE, seguridad.** Reconstruye la imagen de la web con `deploy/scripts/deploy.sh`. Hasta entonces, producción lleva versiones vulnerables:
   - **#75**: next 16.4.3 (DoS por Server Actions; RCE y SSRF de imagen, no explotables aquí por `images.unoptimized`), sharp 0.35.5 (procesa las fotos subidas) y dompurify;
   - **#76**: zod 4.6.7 (agotamiento de memoria en `/api/orders`).

   En la misma reconstrucción va **#78**: el cierre y el informe de ventas, en la hora del local. **Antes del 25 de octubre**, cuando acaba el horario de verano.

   No hay variables de entorno nuevas.
2. **Migraciones de octubre:**
   - `20261022000001_stripe_events.sql`: tabla nueva.
   - `20261022000002_branding_temas_en_datos.sql`: **reescribe la marca de Garum y Manuela**, incluidos `colors` y `logoUrl`. Antes, mira qué hay en producción:

     ```sql
     select t.slug, s.theme, s.branding from tenant_settings s
       join tenants t on t.id = s.tenant_id where t.slug in ('garum','manuela');
     ```
3. **Caddy (#59):** recarga el `Caddyfile` y comprueba con `curl -I` que salen `X-Frame-Options: DENY` y `frame-ancestors 'none'` (tarea 0.3).
4. **Copias (#60):** el backup ya lleva las fotos. Haz el simulacro de restauración de `deploy/README.md` (tarea 0.4).
5. **Cron diario de errores (#69):** añade `alertas-log.sh` al `crontab` con tu `AVISO_A` (`deploy/README.md` §8).

## Plan de endurecimiento (2026-10-22): dónde está

| Tarea | PR | Estado |
|---|---|---|
| 0.1 CI | #57 | Hecho. **Falta marcar `verificar` como check obligatorio** (main no tiene protección) |
| 0.2 Integración en CI | #58 | Hecho |
| 0.3 Clickjacking | #59 | Hecho; falta el `curl -I` en el VPS |
| 0.4 Backup con fotos | #60 | Hecho; falta el simulacro en el VPS |
| 0.5 Renovate | #61 | Hecho; **falta instalar la app de Renovate** en el repo |
| 1.1 Cliente tipado | #62 | Hecho |
| 1.2 zod en el borde | #63 | Hecho |
| 1.3 Webhook: importe e idempotencia | #64 | Hecho |
| 2.1-2.3 Temas como datos | #65-#67 | Hecho: una sola carta; Garum y Manuela son branding |
| 3.1 Caché de la carta | #68 | Hecho |
| 3.2 Alertas por log | #69 | Hecho; falta el `crontab` |
| 3.3 Flakiness | #70 | Hecho |
| 4.1-4.3 Electron 44 | #73 | Hecho. Validado en el PC de Iván (instalar, emparejar, pedido, watchdog, auto-update); falta en hardware real: ESC/POS USB, tótem con cobro y reinicio de Windows |
| 5.1 ADRs | #74, #80 | Hecho: ADRs 0001-0008 |
| 5.2 Docs al día | #77 | Hecho |
| 5.3 Hooks pre-commit | #79 | Hecho |

Fuera del plan:

- **#71**: pool de hilos en la integración. En Windows se colgaba con `forks`.
- **#75 y #76**: seguridad de dependencias.
- **#78**: el cierre y el informe de ventas cortan el día en la zona de la sede, con el desfase real (`limitesDelDia` en `@suarex/domain`). Antes:
  - el cierre usaba `+02:00` fijo, que falla desde el fin del horario de verano;
  - el informe usaba la hora del servidor (UTC) todo el año.

## Pendiente — decisiones abiertas (fuera del plan)

- **Validar el agente en hardware real (resto de la 4.3).** En el PC de Iván no hay impresora ESC/POS USB ni datáfono: queda imprimir por USB, el tótem con cobro, reiniciar Windows y ver a ojo que el watchdog no abre ventanas. Hacerlo en la próxima instalación con ese hardware, con `docs/agent-desktop-validacion.md`.
- **La hora de la sede en tickets y analítica.** El cierre y el informe de ventas ya usan la zona de la sede (`zonaHorariaDelTenant`) con su desfase real, también el día del cambio de hora. Quedan dos restos, sin el problema del cambio de hora:
  - los tickets y el recibo (`packages/ticket`) formatean la hora con `Europe/Madrid` fijo, así que en Canarias saldría la hora peninsular;
  - `analiticaDeCarta` empieza su ventana de 30 días a la medianoche del servidor.
- **Tamaño del cuerpo de las peticiones.** Ni Caddy ni Next lo limitan en `/api/*`, así que `request.json()` lee entero lo que llegue. Propuesta: `request_body { max_size … }` en `deploy/Caddyfile`.
- **Impresora de red que cierra limpio sin imprimir.** Una impresora que acepta la conexión y la cierra con FIN se da por entregada (`packages/printing/src/print-order.ts`): TCP no lo distingue de un envío correcto. Cerrarlo exige consultar el estado ESC/POS tras enviar.
- **Avisos de dependencias que solo actúan en build.** Quedan anotados sin tocar:
  - `nanoid` 3.3.16 y `source-map-js` 1.2.1, vía el `postcss` que fija next;
  - la cadena de electron-builder.
- **Ramas remotas ya mergeadas sin borrar.** `gh pr merge --delete-branch` no se permitió en la sesión.

## Lo mergeado el 15 de octubre (#50-#55)

- **#50:** lo que faltaba para levantar el proyecto en Windows (`RETOMAR-EN-WINDOWS.md`).
- **#51:** el tablero de staff solo enseña pedidos pagados.
- **#52:** el formulario de pago ya no pide el correo (sin Link).
- **#53:** el login de staff explica por qué pide otra cuenta.
- **#54:** lo que salió al validar el agente empaquetado en un Windows 11 real:
  - el instalador vuelve a construirse;
  - watchdog por XML sin consola;
  - arranque en segundo plano;
  - reintento solo cuando no hay red.
- **#55:** en el agente, Comandas recuerda la sesión; Productos y Cierre la piden cada vez.

## Decisiones que conviene conocer antes de tocar estas zonas

- **Una sola carta para todos** (`themes/generic.tsx`). El aspecto de cada cliente es su `branding`: tokens y seis ejes de layout. `contract.test.tsx` recorre todas las combinaciones. Ver la doctrina en `CLAUDE.md`.
- **Acceso a datos.** `packages/db` no exporta `serviceClient`: todo pasa por `tenantScoped(tabla, id)` o por una exención numerada. Hay 27, registradas con sus llamantes en el [ADR 0007](decisions/0007-tenantscoped-y-sus-exenciones.md).
- **La carta está cacheada por tenant** (`apps/web/lib/carta-cache.ts`):
  - lo que escribe el panel la invalida al momento;
  - lo que escribe la base sin pasar por la app (import, SQL) espera 60 s, o usa `POST /api/internal/revalidar-carta`;
  - las franjas y el "agotado hoy" se filtran por petición.
- **Las franjas horarias van en la categoría** y se heredan hacia abajo. Cruzan medianoche y se calculan en la zona de la sede.
- **La analítica usa contadores agregados, nunca un registro de eventos.** Un registro sería un tratamiento de datos nuevo que obligaría a reescribir la política de privacidad.

## Fase 1 (viabilidad): lo único que falta

- **El bloque C:** recuperación de contraseña y alta de personal por invitación. **No es código.** Hace falta contratar un proveedor SMTP y verificar el dominio con SPF+DKIM. Las tareas están escritas en el plan de la Fase 1 ([archivo](superpowers/archivo/plans/2026-09-15-fase1-comercializable.md)).
- **Sin ejercitar:** el camino feliz del webhook de facturación por HTTP. Haría falta `STRIPE_BILLING_WEBHOOK_SECRET` y `stripe listen`.

## Pendiente — infra (Iván, no código)

- Rotar o borrar `/root/.git-credentials` en el VPS.
- Dominio `suarex.app` y token de Cloudflare.
- Credenciales SMTP.
- **Auto-update en producción:**
  - montar el feed estático, por ejemplo `updates.suarex.app` sirviendo `latest.yml` y el instalador;
  - pasar `UPDATE_FEED_URL` al build del agente (opcional: sin él no hay auto-update; con él, desde #73 ya no se cae al arrancar);
  - **firmar** el instalador NSIS. Sin firma, Windows muestra el aviso de SmartScreen.

## Seguridad: auditoría de producción del 2026-09-25

Se hizo sobre la imagen de producción construida y con tráfico. Estado de lo que salió:

- **Electron 33 fuera de soporte:** subido a 44.9.3 en #73.
- **Clickjacking:** resuelto en #59. `WebContentsView` no usa iframe, así que el agente no se ve afectado.
- **`tar` crítico vía electron-builder:** desaparece con electron-builder 26 (#73).

Comprobado y descartado, para que nadie lo vuelva a mirar:
- no hay ningún secreto en el historial de git;
- la imagen no contiene la service role key, la clave secreta de Stripe ni el `CRON_SECRET`;
- ninguno de ellos viaja al navegador.

## Manuela: producto anterior, en otros repos

Hay ramas locales preparadas y **sin subir**, en `../web-manuela` y `../kiosko-manuela`:

- **Rotar el `GH_TOKEN` es lo urgente, y solo puede hacerlo Iván.** Viajaba dentro de cada instalador del kiosko y sigue en el historial de git.
- `web-manuela/supabase/migrations/007_rls_acotar_lectura_publica.sql` está escrita y **sin aplicar**. Hoy:
  - `order_counter` es `FOR ALL USING(true)`;
  - `pedidos` y `cierres_dia` tienen `SELECT USING(true)`, y `cierres_dia` guarda `usuario_email`.
- **Sigue abierto el INSERT anónimo:** cualquiera puede inyectar un pedido que la cocina imprime. Hace falta un rol propio para el agente y el kiosko, como el `device` de este producto.

El repo `ivangs23/web-manuela` es **público**. La anon key es pública por diseño: rotar claves no cierra nada, solo acotar las policies.

## Historia que conviene saber

- **Las fases 1-3 de viabilidad (septiembre) se desarrollaron en una rama sin rebasar.** Tres piezas se construyeron dos veces; en la integración (#42) se conservó la versión de `main`. Moraleja: `git fetch && git log HEAD..origin/main` antes de auditar o planificar.
- **El proyecto pasó de Mac a Windows.** Hubo que ajustar:
  - el CLI de Supabase;
  - grants base (`20260721000000_api_role_baseline_grants.sql`, que **afecta a producción** al actualizar el stack);
  - `.gitattributes` para LF;
  - `tsc` en tests.

  El setup por máquina está en `CLAUDE.md` → "En Windows".
- **Planes y especificaciones anteriores a octubre** están en [`superpowers/archivo/`](superpowers/archivo/README.md).
