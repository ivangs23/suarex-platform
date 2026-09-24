# Sub-proyecto 4: Modo totem (canal `kiosko`), de extremo a extremo

Fecha: 2026-07-24
Estado: aprobado, pendiente de plan de implementación

## Contexto

Los sub-proyectos previos dejaron: la fundación multitenant (1), el canal QR en mesa con el
agente de impresión (2), y el panel de administración del catálogo (3). El sub-proyecto 2 ya
anticipó este: **una sola app de escritorio con los papeles activables por configuración
(`kiosko`, `agente`, o ambos)** — `devices.roles` (`text[] default '{agente}'`) existe desde
`20260722000001_devices_printers.sql` justo para esto. Este sub-proyecto construye el papel
`kiosko`.

Un **totem** táctil instalado en el local: el cliente pide él mismo, paga con datáfono y saca
sus propias comandas. Es el segundo canal de venta, hermano del QR en mesa. El valor declarado
`orders.channel = 'kiosko'` y `tenant_settings.channels` ya están reservados en el esquema desde
el sub-proyecto 2; hoy no los usa nada.

### Referencia: el kiosko legacy

Existe un producto anterior en producción, **`kiosko-manuela`** (repo `ivangs23/kiosko-manuela`,
en `Desktop/Proyectos/Manuela/kiosco-manuela`), del que se toma la integración de **Paytef** y el
formato de ticket. NO se toca; se lee como referencia. Sus lecciones: Paytef es una **API cloud**
(no serie/USB), y **hornear el secret key en el `.exe` fue un error** (exposición viva) que aquí
no se repite.

## Decisiones tomadas

| Decisión | Elección |
| --- | --- |
| Runtime del totem | La carta web de `apps/web` (temas + productos + carrito, ya construidos) corre a pantalla completa; el **agente-desktop en rol `kiosko`** la aloja en una ventana kiosko y le hace de **puente de hardware** (Paytef + impresión). Reutiliza toda la UI web; el flujo es genérico, el tema pinta lo visual. |
| Doctrina | La FUNCIONALIDAD del flujo (welcome → llevar/mesa → nº mesa → productos → carrito → pago → impresión) es idéntica para todos. Cambian aspecto (tema) y contenido (catálogo). |
| Pago | **Paytef Cloud** (`cloud.api.paytef.es`), reemplaza a Stripe en este canal. Con **modo simulación** para trabajar sin datáfono. |
| Config Paytef | Credenciales de cuenta (`accessKey`/`secretKey`/`companyID`) **por tenant** (gestionadas en `/admin/ajustes`, `secretKey` cifrado en reposo, entregado al device por su canal autenticado). `pinpadID` **por dispositivo** (`devices.pinpad_id`). Nunca horneado en el build. |
| Impresión | Se reutiliza `packages/printing` + el rol `agente` (ESC/POS, ya rutea `cocina/barra/all` por `destination`). El ticket de cliente es un layout ESC/POS nuevo. **Impresión directa e inmediata** al aprobar el pago, con la cola at-least-once del agente como red de seguridad. |
| Nº de mesa | Texto libre 1–100 (teclado en pantalla). NO casa con una fila `tables` sembrada: se guarda como **etiqueta** en el pedido, `table_id` queda nulo. |
| Offline | **Online-first.** Paytef y la creación del pedido son cloud; sin internet no se puede cobrar ni pedir, así que cachear el catálogo (como el SQLite del legacy) no habilita comprar. Si cae la red, el totem muestra "no disponible temporalmente". Offline se difiere. |

## Alcance

**Dentro:**
- Rol `kiosko` del agente-desktop: ventana a pantalla completa que carga la ruta de totem de la
  plataforma y expone el puente Paytef + impresión.
- Ruta de totem en `apps/web`: entrada del canal kiosko (sin cookie de QR de mesa) con el flujo
  completo, reutilizando la carta y los temas.
- Puente Paytef en el agente (auth → start → poll → result + cancel + mock), con la config
  resuelta por tenant/dispositivo.
- Alta de pedido `channel:'kiosko'` (con etiqueta de mesa o "para llevar"), pagado por Paytef.
- Impresión inmediata: ticket de cliente en el totem + comandas a cocina/barra/ambas.
- Config de Paytef en el panel admin (cuenta) y en el alta de dispositivo (`pinpad_id`).
- Selector de rol del dispositivo (`agente`/`kiosko`) que active el modo totem.

**Fuera (diferido):**
- Caché offline del catálogo.
- Integración fiscal/facturación más allá del ticket.
- Propinas, descuentos, fidelización en el totem.
- Devoluciones/anulaciones desde el totem (una operación denegada NO cobra; una anulación de un
  cobro aprobado es un flujo aparte, fuera de alcance).

## Arquitectura

```
  Totem (PC Windows)
  ┌─────────────────────────────────────────────┐
  │  agente-desktop (rol kiosko)                 │
  │  ┌───────────────────────────────────────┐  │
  │  │  Ventana kiosko (fullscreen)          │  │        Supabase (cloud)
  │  │  carga  https://<tenant>/totem/<tok>  │──┼──────▶ carta, catálogo, orders
  │  │  = carta web de apps/web (temas)      │  │
  │  └───────────────┬───────────────────────┘  │
  │      window.totem (bridge, preload)         │
  │        · pay(orderId, amount)  ──────────────┼──────▶ cloud.api.paytef.es (datáfono)
  │        · print(orderId)                      │
  │  ┌───────────────┴───────────────────────┐  │
  │  │  main: paytef-service + print (rol     │──┼──────▶ impresoras USB/red (cocina/barra)
  │  │  agente reutilizado)                   │  │
  │  └───────────────────────────────────────┘  │
  └─────────────────────────────────────────────┘
```

**Por qué la carta web dentro de la ventana kiosko y no un renderer nuevo:** la carta (productos,
carrito, temas, i18n) ya existe y es exactamente lo que el totem necesita mostrar. Reimplementarla
en el renderer del desktop rompería la doctrina (dos implementaciones del mismo flujo) y el DRY.
El desktop solo aporta lo que un navegador no puede: el datáfono y la impresora locales.

**El puente `window.totem` (a diferencia del panel admin embebido, que NO tiene puente por
seguridad):** la ventana kiosko carga la ruta de totem de la PROPIA plataforma (mismo origen,
confiable), y el puente se acota a dos operaciones validadas en el servidor, no arbitrarias:
- `pay(orderId)`: el agente lee el pedido de Supabase por su id (con el JWT del device), toma el
  importe **del servidor** (no del renderer), y cobra ese importe por Paytef. El renderer no dicta
  cuánto se cobra.
- `print(orderId)`: el agente compone los tickets a partir del pedido leído del servidor.
Así, un XSS en la carta no puede cobrar un importe arbitrario ni imprimir algo inventado: solo
puede pedir "cobra/imprime ESTE pedido", cuyos datos vienen de la base.

## Flujo del comensal

1. **Welcome** (idle): pantalla de bienvenida del tenant (tema). Tocar para empezar.
2. **Llevar o en mesa**: dos botones grandes. "Para llevar" → sin mesa. "En mesa" → paso 3.
3. **Nº de mesa** (solo en mesa): teclado numérico en pantalla, 1–100. Se guarda como etiqueta.
4. **Productos**: la carta reutilizada (categorías, ficha, extras, alérgenos, idioma), en formato
   totem (tiles grandes, táctil). Añadir al carrito.
5. **Carrito**: revisar líneas, cantidades, total. "Pagar".
6. **Pago**: se crea el pedido (`channel:'kiosko'`, `pending`), y el puente inicia Paytef. Pantalla
   "Siga las instrucciones del datáfono" con estados en vivo (`waiting_card`/`processing`). Botón
   "Cancelar" → `/pinpad/cancel`.
7. **Aprobado**: pedido → `paid`; el agente imprime **inmediatamente** el ticket de cliente en el
   totem y las comandas a cocina/barra/ambas. Pantalla "Recoge tu ticket. Nº <n>". Vuelve a idle.
8. **Denegado / cancelado / timeout**: no se cobra; el pedido queda cancelado/expirado; mensaje
   claro y vuelta al carrito (reintentar) o a idle.

## Modelo de datos

- `orders.channel` ya admite `'kiosko'`. El alta de pedido del totem lo fija (hoy `createPendingOrder`
  hornea `'qr-mesa'`; se parametriza).
- **Etiqueta de mesa libre**: nueva columna `orders.table_label text null` (o reutilizar una
  existente) para el número tecleado en el totem "en mesa". `table_id` queda nulo en kiosko (no
  hay fila `tables`). El QR en mesa sigue usando `table_id`; son excluyentes.
- **`para llevar`**: `table_label` nulo y una marca de retirada. El número de recogida puede ser
  el `order_number`.
- **Config Paytef de cuenta (por tenant)**: en `tenant_settings` (p. ej. `payments.paytef` con
  `accessKey`, `secretKey` cifrado, `companyID`). Lectura por el device vía RPC `SECURITY DEFINER`
  acotada a su tenant (no un SELECT abierto del secreto).
- **`devices.pinpad_id text null`**: el datáfono físico atado a ese totem.
- **`devices.roles`** ya existe: el totem lleva `{kiosko}` (o `{agente,kiosko}` si además imprime
  pedidos del QR).

RLS: toda tabla nueva/columna sigue las reglas del repo (tenant_id, anti-fuga). El secreto de
Paytef nunca sale por un SELECT abierto: solo por la RPC acotada al device de ese tenant.

## Pago con Paytef

Puerto directo del flujo cloud del legacy (`paytef-cloud-service.cjs`), en el proceso main del
agente:
1. `POST /authorize/` `{accessKey, secretKey}` → `token`.
2. `POST /transaction/start` (`Bearer`) `{pinpad, opType:"sale", requestedAmount:<céntimos>,
   executeOptions:{method:"polling"}, transactionReference}` → `sessionID`.
3. `POST /transaction/poll` (`Bearer`) `{sessionID, pinpad}` cada 2 s → `result.approved` +
   `authorisationCode` (o denegado). Emite estados al renderer.
4. Cancelar: `POST /pinpad/cancel` `{pinpad}`.

- **Importe desde el servidor**: el agente recalcula/lee el total del pedido en Supabase, nunca lo
  toma del renderer (misma disciplina que `POST /api/orders` recalcula precios en servidor).
- **Modo simulación** (`mock`): por defecto en dev y hasta tener datáfono; aprueba tras un retardo.
  Cambiar a real es solo config (credenciales + `pinpad_id` + apagar mock), sin tocar código.
- **Idempotencia**: `transactionReference` lleva el `orderId`; un reintento sobre un pedido ya
  pagado no vuelve a cobrar (se comprueba el estado antes de iniciar).

## Impresión

Se reutiliza el rol `agente` (`packages/printing`, ESC/POS, ruteo `cocina/barra/all` por
`destination` que YA existe en `runAgentTick`). Al aprobar el pago:
- **Ticket de cliente** (layout ESC/POS nuevo): cabecera del local, líneas con extras, total,
  desglose IVA, nº de recogida. Impreso en la impresora del totem.
- **Comandas** a cocina / barra / ambas según el `destination` de cada línea (mismo criterio que el
  QR). Un pedido con productos de barra y cocina saca dos comandas.
- **Directo + red de seguridad**: el totem imprime en el acto (cliente esperando). Si una impresora
  falla, el pedido queda como no-impreso en su destino y el bucle at-least-once del rol `agente` lo
  reintenta — nunca se pierde una comanda, misma garantía que el QR.

## Seguridad

- El puente `window.totem` es mínimo y validado en servidor (importe y contenido desde la base, no
  desde el renderer). Un XSS en la carta no cobra importes arbitrarios.
- El `secretKey` de Paytef: cifrado en reposo, entregado al device por su canal autenticado (HTTPS
  + RPC acotada), nunca horneado en el build (el error del legacy). Un device comprometido puede
  cobrar (es su función), pero el secreto no se filtra por la base ni por el instalador.
- La ventana kiosko se acota a la ruta de totem de la plataforma (no navega fuera del origen), y a
  pantalla completa sin barras (kiosk mode) para que el cliente no salga a Windows.

## Estrategia de pruebas

- **Puente Paytef (unit)**: la construcción de payloads (`start`/`poll`/`cancel`) y la máquina de
  estados como funciones puras; el mock verifica aprobado/denegado/cancelado/timeout.
- **Integración**: alta de pedido `channel:'kiosko'` con etiqueta de mesa y "para llevar"; el
  pedido aparece en el tablero de staff; el ruteo de impresión cocina/barra reutiliza los tests
  existentes del agente.
- **e2e**: el flujo de la carta totem (welcome → llevar/mesa → nº → productos → carrito → pago
  mock → confirmación) contra el dev server, reutilizando el arnés de Playwright.
- **Contrato de temas**: el totem entra en `contract.test.tsx` — todos los temas deben pintar los
  pasos del flujo totem, como ya hacen con el flujo QR.

## Fases

1. **Datos + config**: `channel` parametrizado, `table_label`, `devices.pinpad_id`, config Paytef
   por tenant + RPC de lectura acotada. Panel admin (ajustes + alta de dispositivo).
2. **Puente Paytef** en el agente (mock primero), con estados y cancelación. Tests.
3. **Rol `kiosko` del desktop**: ventana kiosko fullscreen + preload `window.totem` + wiring del
   selector de rol.
4. **Ruta de totem en `apps/web`**: flujo welcome → llevar/mesa → nº → productos → carrito → pago,
   reutilizando carta/temas. Formato táctil.
5. **Impresión**: ticket de cliente ESC/POS + comandas; enganche directo al aprobar + red de
   seguridad del agente.
6. **Cierre**: e2e del flujo, contrato de temas, y validación en build empaquetado con datáfono
   real (cambiando mock→real por config).

## Manejo de errores

- **Datáfono denegado**: mensaje claro, pedido no pagado (cancelado/expirado), vuelta al carrito.
- **Timeout del poll** (~4 min): cancela en el terminal y aborta; pedido no pagado.
- **Impresora caída tras cobrar**: el pago ya está hecho; la comanda queda en la cola del agente y
  se reintenta. El cliente ve su nº de recogida aunque el ticket tarde.
- **Sin internet**: el totem no puede cobrar ni pedir; pantalla "no disponible temporalmente", sin
  dejar avanzar.
- **Cierre a mitad**: un pedido `pending` sin pagar lo barre el `expire_pending_orders` existente.

## Riesgos

- **Sin datáfono de pruebas**: se avanza en mock; el flujo real de Paytef no se ejerce hasta tener
  hardware. Mitiga: el puente clona un flujo ya probado en producción (legacy) y el cambio a real
  es solo config.
- **Kiosk mode en Windows**: que el cliente no pueda salir a Windows (teclado físico, gestos). Se
  valida en el build empaquetado.
- **Doble cobro**: mitigado por idempotencia (`transactionReference` con `orderId` + comprobación
  de estado antes de cobrar).

## Regla de despliegue

Los repos/proyectos en producción (`kiosko-manuela`, `web-manuela`, etc.) **no se tocan**. El
`secretKey` de Paytef nunca entra en git ni en el build. La config real de Paytef (credenciales,
`pinpad_id`) se introduce por el panel/alta de dispositivo, nunca hardcodeada.
