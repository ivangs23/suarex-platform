# Sub-proyecto: Agente de impresión — Fase C2a (backend + núcleo, sin hardware)

Fecha: 2026-07-22
Estado: aprobado, pendiente de plan de implementación

## Contexto

El canal QR ya funciona de punta a punta en la nube: un comensal escanea, pide, paga, la comanda aparece en el panel de comandas y se marca servida. La **lógica** de impresión también está hecha y probada (fase C1): `unprintedPaidOrders` descubre qué pedidos pagados aún no se han impreso, `renderEscPos` genera el ticket, el adaptador TCP crudo (`printToPrinter`) lo entrega a una impresora de red, y `reserve_printed` marca el pedido como impreso de forma atómica y a prueba de concurrencia.

Lo que falta para que un cliente real imprima en su local es el **agente**: el proceso que corre en el PC del cliente, se autentica como dispositivo del tenant, sondea sus pedidos pendientes y los imprime. Ese agente vivirá dentro de una cáscara Electron empaquetada para Windows — pero esa cáscara, el camino de impresión USB (Windows RAW) y el instalador son la **fase C2b**, que solo puede validarse con el hardware del cliente (un PC Windows y una impresora física).

Este sub-proyecto (C2a) construye todo lo que se puede escribir **y verificar en local, sin hardware**: el núcleo del agente como módulo Node headless, el camino de datos que ese agente usa con su propio JWT (nunca el service role), y el cierre de la deuda de seguridad del dispositivo que se registró como pendiente de C2 en C1/D2. C2b (Electron + USB RAW + empaquetado) se diseñará en su propio spec cuando C2a esté cerrado; su único trabajo será *hospedar* el `@suarex/agent` que construye este sub-proyecto y añadir el adaptador USB.

## Alcance

Una app Electron, el modo por configuración: la decisión de fundación sigue en pie, pero el **papel de kiosko** (el tótem que toma pedidos en local) es un sub-proyecto posterior (sub-proyecto 4), no C2. C2 construye únicamente el papel de **agente** (imprime en el PC del cliente los pedidos QR que llegan de la nube).

**Dentro de C2a:**
- Paquete `@suarex/agent`: el bucle del agente como módulo Node headless (autenticar → sondear → render → entregar por TCP → marcar impreso), con serialización por impresora y semántica *at-least-once*.
- Camino de datos del dispositivo con **su propio JWT**: el device lee los pedidos pagados-sin-imprimir con su JWT vía PostgREST (la RLS ya se lo permite: SELECT abierto a todo el tenant en `orders`/`order_items`/`printers` desde el fencing de D2), reutilizando la MISMA función de selección pura que ya usa la ruta service-role; la marca de impreso (`reserve_printed_self`) ya existe.
- Heartbeat del dispositivo (`last_seen_at`/`app_version`) vía RPC; el panel muestra si el agente está vivo.
- Rate-limit del endpoint público `POST /api/devices/pair`.
- Acción de administración "Resetear dispositivo": revoca las sesiones del dispositivo, lo deja sin emparejar y emite un código nuevo.
- Aviso en el panel de impresoras cuando un destino (cocina/barra) no tiene ninguna impresora habilitada.

**Fuera (fase C2b u otros sub-proyectos):**
- La cáscara Electron (proceso principal, preload, bandeja, UI de introducción del código de emparejamiento, reconexión), el empaquetado y el instalador de Windows.
- El adaptador de impresión **USB (Windows RAW)** por el spooler de Windows (`winspool`). El adaptador de red TCP ya existe y se reutiliza tal cual.
- El papel de **kiosko** (tótem que toma pedidos en local).

**Éxito de C2a:** con el stack local levantado y un dispositivo sembrado, `runAgent(...)` sondea, imprime en una impresora TCP (real o falsa) los pedidos pagados de su tenant y los marca impresos, sin usar nunca el service role; un `owner` puede resetear un dispositivo robado y su token deja de servir al instante; el endpoint de emparejamiento rechaza un aluvión de intentos; el panel avisa si falta una impresora de un destino; y toda la suite (unit + integración) sigue en verde desde limpio.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Partición de C2 | C2a (backend + núcleo del agente, verificable en local) ahora; C2b (Electron + USB RAW + empaquetado) después, validado con hardware |
| Conectividad de impresora | Ambas: el adaptador de red (TCP `host:port`) ya existe y se reutiliza; el USB RAW es C2b |
| Disparo del bucle | Sondeo cada pocos segundos (por defecto ~4s). Sin Realtime en esta fase (YAGNI: para un ticket de cocina la latencia de sondeo es imperceptible y el sondeo sobrevive cortes de red sin lógica extra) |
| Datos del dispositivo | El agente lee con **su propio JWT** vía PostgREST (RLS ya lo permite) reutilizando la función de selección pura compartida, y marca con `reserve_printed_self`/`device_heartbeat` (RPCs `SECURITY DEFINER` acotadas a su JWT); nunca tiene el service role. NO se añade una RPC de lectura que duplicaría en SQL la lógica de cobertura (ya viven dos copias en sync, TS + SQL; una tercera multiplicaría el riesgo) |
| Rate-limit | Contador por ventana en Postgres (durable, sirve en serverless), por IP, sobre `POST /api/devices/pair`; sobre el límite → `429` |
| Reset de dispositivo | Un solo flujo "Resetear dispositivo": revoca sesiones (`auth.admin.signOut`) + desempareja + nuevo código. Cubre robo y recambio de PC |
| Semántica de entrega | *At-least-once*: un fallo entre "entregar" y "marcar impreso" puede producir un ticket duplicado al reintentar, nunca uno perdido |

## Arquitectura

```
packages/agent/                      NUEVO paquete @suarex/agent (headless, sin Electron)
  src/run-agent.ts                   runAgent(config): bucle autenticar→sondear→imprimir→marcar
  src/agent-client.ts                cliente Supabase del dispositivo (anon key + credenciales), llamadas RPC
  src/index.ts                       superficie pública
  bin/run-agent.ts                   CLI fino para correr el agente en local (lo que Electron hará en C2b)
packages/db/src/
  print-jobs.ts                      + extraer `selectUnprintedOrders` (función pura compartida por ambas rutas)
  device-agent.ts                    lectura del dispositivo por JWT (usa la función pura) + wrappers de las RPCs self
supabase/migrations/
  20260722000009_device_heartbeat.sql            RPC device_heartbeat (las columnas last_seen_at/app_version YA existen)
  20260722000010_pair_rate_limit.sql             tabla + RPC de rate-limit del emparejamiento
apps/web/
  app/api/devices/pair/route.ts      + comprobación de rate-limit antes de canjear
  app/admin/dispositivos/…           + acción "Resetear dispositivo" + estado en línea (last_seen_at)
  app/admin/impresoras/…             + banner de aviso si falta impresora de un destino
  lib/client-ip.ts                   resolución de la IP del cliente para el rate-limit
tests/
  integration/agent-read.test.ts     lectura del device por JWT: aislada por tenant, coincide con la ruta service-role
  integration/agent-loop.test.ts     runAgent un tick: entrega + marca; idempotente; impresora caída → reintenta
  integration/pair-rate-limit.test.ts  N+1 intentos misma IP → 429; otra IP no afectada; ventana reinicia
  integration/device-reset.test.ts   tras resetear: token viejo rechazado + código nuevo empareja
  integration/device-heartbeat.test.ts  device_heartbeat: solo su fila, solo esas columnas
```

### El bucle del agente (`@suarex/agent`)

`runAgent(config: { supabaseUrl, anonKey, email, password, pollMs, appVersion })` es un módulo Node headless, sin ninguna dependencia de Electron. Al arrancar inicia sesión con las credenciales del dispositivo (las que devolvió `pairDevice`) contra Supabase usando la anon key — nunca el service role, que el PC del cliente jamás debe poseer. Después, en bucle cada `pollMs` (por defecto ~4000 ms):

1. Llama a la RPC `unprinted_paid_orders_self()` → pedidos pagados de su tenant aún no impresos, con sus líneas agrupadas por destino y las impresoras habilitadas del tenant.
2. Por cada pedido y cada impresora de destino: renderiza el ticket (reutiliza `renderEscPos`/`@suarex/ticket` de C1) y lo entrega con el adaptador de red existente (`printToPrinter`), serializado por impresora con `enqueueByDevice`.
3. Si la entrega tiene éxito, marca ese `(pedido, impresora)` como impreso con `reserve_printed_self`.
4. Emite un heartbeat (`device_heartbeat(appVersion)`) — una vez por tick o cada N ticks.

**Semántica *at-least-once*.** El orden es entregar → marcar, nunca al revés: si el proceso muere entre ambos, al reiniciar el pedido sigue apareciendo como no impreso y se reimprime — un ticket de cocina duplicado es un mal menor frente a uno perdido. Esta elección es deliberada y se documenta en el código; no se intenta un two-phase commit contra una impresora que ni siquiera da un ACK de aplicación (ver la nota de honestidad de C1 en `packages/printing`).

**Testeable headless.** El bucle se prueba en integración contra el Supabase local (con un dispositivo y un pedido pagado sembrados) y una impresora TCP falsa (un `net.Server` local que acepta y lee el buffer) — exactamente lo que ya hace `tests/integration/print-flow.test.ts`, ahora dentro de `runAgent`. Un tick del bucle es una función invocable en un test; el `setInterval` es una cáscara fina alrededor de esa función.

### Camino de datos del dispositivo (JWT-only)

El dispositivo nunca tiene el service role. Lee con su propio JWT y solo escribe por RPCs `SECURITY DEFINER` acotadas al tenant de su JWT:

- **Lectura (PostgREST + JWT del device).** La RLS ya permite al rol `device` un SELECT abierto a todo su tenant sobre `orders`, `order_items` y `printers` (fencing de D2, `20260722000005`). Así que el device lee esas mismas filas con su JWT — igual que la ruta service-role de C1, pero autenticado como device en vez de con la service key. La lógica de "qué pedidos y qué impresoras faltan" (`targetPrinterIds` + filtrado + mapeo, hoy dentro de `unprintedPaidOrders`) se **extrae a una función pura** `selectUnprintedOrders(orderRows, printerRows)` que ambas rutas reutilizan: una sola implementación, sin una tercera copia en SQL. Deliberadamente NO se añade una RPC de lectura que reconstruyera ese cálculo de cobertura en SQL: ya conviven dos copias (la TS de `unprintedPaidOrders` y la SQL de `reserve_printed`) que un test de acuerdo obliga a mantener en sync; una tercera multiplicaría ese riesgo sin ganar nada, dado que el device ya puede leer por RLS.
- `reserve_printed_self(orderId, printerId, at)` — **ya existe** (C1/D2, `20260722000005`). Marca impreso keyed al tenant del JWT; el device lo llama con su propio JWT.
- `device_heartbeat(app_version)` — **nueva** (ver más abajo). La única escritura nueva del device, y solo sobre su propia fila.

### Heartbeat

`device_heartbeat(p_app_version text)` (`SECURITY DEFINER`) actualiza **solo** `last_seen_at = now()` y `app_version` de la fila de `devices` cuyo `auth_user_id = auth.uid()`. Es la única forma en que un dispositivo escribe su propia fila — la RLS del dispositivo es de solo lectura sobre su fila (`devices_select_own`), y un heartbeat necesita escritura acotada a esas dos columnas, algo que la RLS por fila no expresa; de ahí la RPC. Las columnas `last_seen_at timestamptz` y `app_version text` **ya existen** en `devices` (`20260722000001`), así que la migración solo añade la función y su grant a `authenticated`. El panel de dispositivos (D2) ya lee `last_seen_at` (lo muestra `DeviceRow`); el heartbeat hace que ese valor por fin se actualice, para que un `owner` sepa si su agente de impresión está vivo.

### Rate-limit del emparejamiento

`POST /api/devices/pair` es hoy público y sin límite. Los códigos ya son de 192 bits con TTL de 15 minutos, así que la fuerza bruta es inviable; el rate-limit es defensa en profundidad contra abuso de volumen. Se implementa con un contador por ventana fija en Postgres (durable y compartido entre instancias — un límite en memoria sería inútil en un despliegue serverless con varias instancias): una tabla `pair_attempts` y una RPC atómica que incrementa y decide en una sola sentencia. La clave es la IP del cliente, resuelta de la cabecera de reenvío estándar (`x-forwarded-for`, primer salto) por `apps/web/lib/client-ip.ts`. Superado el límite, el endpoint responde `429 Too Many Requests` con un mensaje genérico — esto no filtra la validez de ningún código (es cuestión de volumen, no del código en sí), así que el oráculo uniforme `404` del canje normal se conserva intacto para las respuestas que sí llegan a evaluarse.

### Resetear dispositivo

Un dispositivo ya emparejado que hay que dar de baja (robo) o sustituir (cambio de PC) necesita una acción que hoy no existe: `regeneratePairingCode` (D2) solo funciona sobre dispositivos **sin** emparejar. Se añade una Server Action `resetDevice`, envuelta en `managerAction` (owner/admin), que en un solo flujo:

1. Si el dispositivo tiene una cuenta de Auth (`auth_user_id`), **borra esa cuenta** con `auth.admin.deleteUser(userId)`. Esto revoca sus refresh tokens (el PC robado ya no puede renovar su sesión) y, en cascada, elimina su `memberships` (FK `on delete cascade`) y pone `devices.auth_user_id` a `null` (FK `on delete set null`). Usa el service role (API de administración de Auth) vía un accesor propio y estrecho; la comprobación de rol de `managerAction` es la única barrera de ese camino, obligatoria y probada.
2. Deja el dispositivo sin emparejar (`paired_at = null`) y emite un código de emparejamiento nuevo (misma generación criptográfica que `createDevice`), para que un PC de repuesto pueda emparejarse. Al emparejar de nuevo, `ensureDeviceAuthAccount` crea una cuenta fresca con el mismo email determinista (que quedó libre al borrar la anterior) y credenciales nuevas.

**Límite honesto (JWT stateless).** Los access tokens de GoTrue son JWTs autocontenidos: ninguna acción de administración invalida un access token YA emitido antes de que caduque — lo que `deleteUser` revoca de inmediato son los **refresh tokens** (no podrá renovar) y la membership (aunque pudiera renovar, el hook ya no le inyectaría tenant). El PC robado, por tanto, pierde el acceso como muy tarde al caducar su access token en curso (el TTL del proyecto), no en el mismo milisegundo. Esto se documenta en el código con la misma honestidad que el límite del ACK de impresión de C1; acortar ese TTL para dispositivos es una palanca de configuración de GoTrue, fuera del alcance de C2a. Un botón "Resetear dispositivo" en el panel de dispositivos expone esta acción, con una confirmación clara de lo que hace.

### Aviso de impresora mal configurada

Hoy, si un destino (`cocina`/`barra`) no tiene ninguna impresora habilitada, su ticket se descarta **en silencio** y el pedido parece impreso (decisión consciente de C1, con el aviso al admin diferido a C2). C2a cierra esa deuda por el lado de la lectura: el panel de impresoras calcula, por local, qué destinos usa la carta y si cada uno tiene al menos una impresora habilitada; si falta alguno, muestra un banner de aviso ("No hay impresora de cocina habilitada: esos tickets no se imprimen") en vez de dejar el fallo invisible. Es una comprobación derivada y de solo lectura sobre datos que el panel ya tiene; no cambia el comportamiento del agente, solo hace visible al `owner` una configuración que dejaría pedidos sin imprimir.

## Manejo de errores

- **Impresora caída / inalcanzable:** `printToPrinter` ya devuelve `ok:false` (no lanza); el agente no marca ese `(pedido, impresora)` como impreso, así que el siguiente tick lo reintenta. Un pedido con dos destinos donde una impresora funciona y otra no queda marcado solo para la que funcionó, y se reintenta solo la que falló (`reserve_printed` es por impresora).
- **Pérdida de sesión del agente (token caducado / red caída):** el cliente Supabase del agente refresca el token; si la red vuelve, el siguiente tick retoma sin perder pedidos (el estado "qué falta por imprimir" vive en la base, no en el agente).
- **Crash del agente entre entregar y marcar:** al reiniciar, el pedido sigue como no impreso → se reimprime (at-least-once, ver arriba).
- **Emparejamiento con código inválido/caducado bajo rate-limit:** dos respuestas distintas y ninguna filtra el código — `429` si se superó el volumen, `404` uniforme si el código simplemente no vale.
- **Reset de un dispositivo sin cuenta de Auth (nunca emparejado):** `resetDevice` omite el `signOut` (no hay sesión que revocar) y se comporta como `regeneratePairingCode`; no es un error.
- **Heartbeat de un dispositivo cuya fila no existe / no es suya:** la RPC actualiza cero filas (el `where auth_user_id = auth.uid()` no casa); no lanza ni filtra nada de otro tenant.

## Pruebas

- **Función pura de selección (`selectUnprintedOrders`):** unit test — dado un conjunto de pedidos y de impresoras, devuelve exactamente los pedidos con impresoras de destino aún no cubiertas; un pedido totalmente cubierto no aparece; una estación sin impresora se trata como trivialmente cubierta (mismo trade-off documentado de C1). Y refactor sin cambio de comportamiento: `unprintedPaidOrders` (service-role) sigue pasando sus tests tras extraer la función.
- **Lectura del dispositivo por JWT:** un dispositivo del tenant A, leyendo con SU JWT (no service role), solo ve los pedidos pagados-sin-imprimir de A, nunca de B (aislamiento por RLS); el resultado coincide con el de la ruta service-role para el mismo tenant.
- **Bucle del agente (`runAgent`, headless):** con un pedido pagado y una impresora TCP falsa sembrados, un tick entrega el ticket y marca el pedido impreso; un segundo tick no lo reimprime (idempotente); con la impresora caída, no lo marca y el siguiente tick lo reintenta; el agente nunca usa el service role (verificado estructuralmente: `@suarex/agent` no importa nada que exponga la service key).
- **Rate-limit:** N intentos dentro de la ventana pasan, el N+1 de la misma IP recibe `429`; una IP distinta no se ve afectada; pasada la ventana, el contador reinicia.
- **Reset de dispositivo:** tras `resetDevice`, la cuenta de Auth del dispositivo ya no existe (su `memberships` desaparece y `devices.auth_user_id` queda `null`), así que su refresh token ya no renueva y las credenciales viejas ya no inician sesión; el código nuevo empareja un "PC de repuesto" que obtiene credenciales frescas que sí funcionan y resuelven el tenant correcto.
- **Heartbeat:** `device_heartbeat` actualiza `last_seen_at`/`app_version` solo de la fila propia y solo esas columnas; no puede tocar la fila de otro dispositivo ni otro campo.
- **Aviso de impresora:** el panel muestra el banner cuando un destino usado por la carta no tiene impresora habilitada, y no lo muestra cuando sí la tiene.
- **Anti-fuga / allowlist:** las formas canónicas nuevas (grants de las RPCs, cualquier policy nueva) entran exactas en `tests/integration/helpers/policy-check.ts`; la suite anti-fuga sigue exigiendo que ninguna tabla tenant-scoped quede sin policy ni con `USING (true)`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El agente necesita el service role para leer/marcar | Se prohíbe estructuralmente: el agente solo usa RPCs `SECURITY DEFINER` con su JWT; `@suarex/agent` no importa el cliente service-role. Test que lo verifica |
| Duplicar tickets bajo reintentos/crash | Semántica *at-least-once* explícita y documentada; marca por impresora, así que solo se reintenta lo que falló. Un duplicado es preferible a un ticket perdido |
| Rate-limit inútil en serverless (memoria no compartida) | Contador durable en Postgres, no en memoria del proceso |
| Creer que el reset mata el access token al instante (no lo hace: JWT stateless) | Documentado con honestidad: `deleteUser` revoca refresh tokens + membership; el access token en curso vive hasta caducar (TTL del proyecto). Test: credenciales viejas ya no inician sesión, código nuevo sí |
| La lectura por JWT o `device_heartbeat` filtra/escribe datos de otro tenant | La lectura se apoya en la RLS ya probada (aislamiento A↔B con el JWT del device); `device_heartbeat` toma la fila de `auth.uid()`, nunca de un parámetro; tests de aislamiento y de "solo su fila/esas columnas" |
| Duplicar la lógica de cobertura en SQL (tercera copia) | No se hace: se extrae UNA función pura TS reutilizada por ambas rutas; el device lee por RLS, no por una RPC que reconstruya el cálculo |
| El aviso de impresora da falsos positivos/negativos | Se deriva de los destinos reales que usa la carta y de las impresoras `enabled`; test con y sin impresora del destino |

## Regla de despliegue

Como todo el proyecto, C2a se demuestra en local con dispositivos y tenants de prueba. Los repositorios y proyectos Supabase en producción no se tocan. C2b (Electron + USB RAW + empaquetado) será el primer sub-proyecto que de verdad necesite el hardware del cliente para validarse, y tendrá su propio spec.
