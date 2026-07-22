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
- Camino de datos del dispositivo con **su propio JWT**: una RPC `SECURITY DEFINER` que devuelve los pedidos pagados-sin-imprimir del tenant del JWT; la marca de impreso (`reserve_printed_self`) ya existe.
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
| Datos del dispositivo | El agente lee y marca con **su propio JWT** vía RPCs `SECURITY DEFINER` acotadas a `current_tenant_id()`; nunca tiene el service role |
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
  device-agent.ts                    lecturas/escrituras del dispositivo por JWT (envuelven las RPCs self)
supabase/migrations/
  20260722000009_agent_read_and_heartbeat.sql   RPC unprinted_paid_orders_self + device_heartbeat + columnas
  20260722000010_pair_rate_limit.sql            tabla + RPC de rate-limit del emparejamiento
apps/web/
  app/api/devices/pair/route.ts      + comprobación de rate-limit antes de canjear
  app/admin/dispositivos/…           + acción "Resetear dispositivo" + estado en línea (last_seen_at)
  app/admin/impresoras/…             + banner de aviso si falta impresora de un destino
  lib/client-ip.ts                   resolución de la IP del cliente para el rate-limit
tests/
  integration/agent-read.test.ts     unprinted_paid_orders_self: aislada por tenant, forma correcta
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

El dispositivo nunca tiene el service role. Todo lo que hace pasa por RPCs `SECURITY DEFINER` acotadas al tenant de su JWT:

- `unprinted_paid_orders_self()` — **nueva**. Espejo de `unprintedPaidOrders` (la versión service-role de C1), pero sin recibir el tenant como parámetro: lo toma de `current_tenant_id()` (el claim verificado del JWT). Devuelve los pedidos pagados-sin-imprimir del tenant del llamante con sus líneas y las impresoras habilitadas, de modo que el agente no necesita leer varias tablas por separado ni conocer el `tenant_id`. `grant execute to authenticated`; el aislamiento vive dentro de la función (usa `current_tenant_id()`, nunca un parámetro del llamante), igual que `reserve_printed_self`.
- `reserve_printed_self(orderId, printerId, at)` — **ya existe** (C1/D2, `20260722000005`). Marca impreso keyed al tenant del JWT.
- `device_heartbeat(app_version)` — **nueva** (ver más abajo).

Que la lectura sea una RPC y no PostgREST directo mantiene la lógica de "qué pedidos faltan por imprimir" en un solo sitio (server-side), evita que el agente tenga que replicar el cálculo de `printed_targets` en el cliente, y deja la superficie del dispositivo reducida a tres RPCs bien acotadas.

### Heartbeat

`device_heartbeat(p_app_version text)` (`SECURITY DEFINER`) actualiza **solo** `last_seen_at = now()` y `app_version` de la fila de `devices` cuyo `auth_user_id = auth.uid()`. Es la única forma en que un dispositivo escribe su propia fila — la RLS del dispositivo es de solo lectura sobre su fila (`devices_select_own`), y un heartbeat necesita escritura acotada a esas dos columnas, algo que la RLS por fila no expresa; de ahí la RPC. Se añaden las columnas `last_seen_at timestamptz` y `app_version text` a `devices`. El panel de dispositivos (D2) muestra "en línea" / "visto por última vez hace X" a partir de `last_seen_at`, para que un `owner` sepa si su agente de impresión está vivo.

### Rate-limit del emparejamiento

`POST /api/devices/pair` es hoy público y sin límite. Los códigos ya son de 192 bits con TTL de 15 minutos, así que la fuerza bruta es inviable; el rate-limit es defensa en profundidad contra abuso de volumen. Se implementa con un contador por ventana fija en Postgres (durable y compartido entre instancias — un límite en memoria sería inútil en un despliegue serverless con varias instancias): una tabla `pair_attempts` y una RPC atómica que incrementa y decide en una sola sentencia. La clave es la IP del cliente, resuelta de la cabecera de reenvío estándar (`x-forwarded-for`, primer salto) por `apps/web/lib/client-ip.ts`. Superado el límite, el endpoint responde `429 Too Many Requests` con un mensaje genérico — esto no filtra la validez de ningún código (es cuestión de volumen, no del código en sí), así que el oráculo uniforme `404` del canje normal se conserva intacto para las respuestas que sí llegan a evaluarse.

### Resetear dispositivo

Un dispositivo ya emparejado que hay que dar de baja (robo) o sustituir (cambio de PC) necesita una acción que hoy no existe: `regeneratePairingCode` (D2) solo funciona sobre dispositivos **sin** emparejar. Se añade una Server Action `resetDevice`, envuelta en `managerAction` (owner/admin), que en un solo flujo:

1. Si el dispositivo tiene una cuenta de Auth (`auth_user_id`), revoca **todas** sus sesiones con `auth.admin.signOut(userId)` — el PC robado deja de operar al instante, sin esperar a que caduque su access token. Esto usa el service role (la API de administración de Auth), vía un accesor propio y estrecho como los ya existentes; la comprobación de rol de `managerAction` es la única barrera de ese camino, obligatoria y probada.
2. Deja el dispositivo sin emparejar (`paired_at = null`) y emite un código de emparejamiento nuevo (misma generación criptográfica que `createDevice`), para que un PC de repuesto pueda emparejarse.

La cuenta de Auth determinista del dispositivo (`device-{id}@devices.local`) se conserva: al emparejar de nuevo, `ensureDeviceAuthAccount` la recupera y le resetea la contraseña, así que el PC de repuesto obtiene credenciales nuevas y el robado, cuya sesión ya se revocó, no puede volver con las viejas. Un botón "Resetear dispositivo" en el panel de dispositivos expone esta acción, con una confirmación clara de lo que hace.

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

- **RPC de lectura (`unprinted_paid_orders_self`):** un dispositivo del tenant A solo ve los pedidos pagados-sin-imprimir de A, nunca de B; la forma devuelta reúne líneas por destino e impresoras habilitadas; un pedido ya impreso no aparece. Control positivo (los pedidos propios sí salen) y de aislamiento (los de otro tenant no).
- **Bucle del agente (`runAgent`, headless):** con un pedido pagado y una impresora TCP falsa sembrados, un tick entrega el ticket y marca el pedido impreso; un segundo tick no lo reimprime (idempotente); con la impresora caída, no lo marca y el siguiente tick lo reintenta; el agente nunca usa el service role (verificado estructuralmente: `@suarex/agent` no importa nada que exponga la service key).
- **Rate-limit:** N intentos dentro de la ventana pasan, el N+1 de la misma IP recibe `429`; una IP distinta no se ve afectada; pasada la ventana, el contador reinicia.
- **Reset de dispositivo:** tras `resetDevice`, un cliente que tenía la sesión del dispositivo ve sus llamadas rechazadas (sesión revocada), y el código nuevo empareja un "PC de repuesto" que obtiene credenciales que funcionan; el robado no puede volver con las viejas.
- **Heartbeat:** `device_heartbeat` actualiza `last_seen_at`/`app_version` solo de la fila propia y solo esas columnas; no puede tocar la fila de otro dispositivo ni otro campo.
- **Aviso de impresora:** el panel muestra el banner cuando un destino usado por la carta no tiene impresora habilitada, y no lo muestra cuando sí la tiene.
- **Anti-fuga / allowlist:** las formas canónicas nuevas (grants de las RPCs, cualquier policy nueva) entran exactas en `tests/integration/helpers/policy-check.ts`; la suite anti-fuga sigue exigiendo que ninguna tabla tenant-scoped quede sin policy ni con `USING (true)`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El agente necesita el service role para leer/marcar | Se prohíbe estructuralmente: el agente solo usa RPCs `SECURITY DEFINER` con su JWT; `@suarex/agent` no importa el cliente service-role. Test que lo verifica |
| Duplicar tickets bajo reintentos/crash | Semántica *at-least-once* explícita y documentada; marca por impresora, así que solo se reintenta lo que falló. Un duplicado es preferible a un ticket perdido |
| Rate-limit inútil en serverless (memoria no compartida) | Contador durable en Postgres, no en memoria del proceso |
| El `signOut` del reset no revoca de verdad la sesión | Test que reproduce el robo: token viejo rechazado tras `resetDevice`, código nuevo funciona |
| Una RPC nueva demasiado abierta filtra datos de otro tenant | La RPC toma el tenant de `current_tenant_id()`, nunca de un parámetro; test de aislamiento A↔B; forma de grant en el allowlist exacto |
| El aviso de impresora da falsos positivos/negativos | Se deriva de los destinos reales que usa la carta y de las impresoras `enabled`; test con y sin impresora del destino |

## Regla de despliegue

Como todo el proyecto, C2a se demuestra en local con dispositivos y tenants de prueba. Los repositorios y proyectos Supabase en producción no se tocan. C2b (Electron + USB RAW + empaquetado) será el primer sub-proyecto que de verdad necesite el hardware del cliente para validarse, y tendrá su propio spec.
