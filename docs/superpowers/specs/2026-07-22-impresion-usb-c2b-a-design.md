# Sub-proyecto: Impresión USB — Fase C2b-a (plomería, sin hardware)

Fecha: 2026-07-22
Estado: aprobado, pendiente de plan de implementación

## Contexto

El agente de impresión (fase C2a) ya corre headless, sondea los pedidos pagados de su tenant con su propio JWT y los imprime en impresoras de **red** (TCP `host:port`). Muchos locales, sin embargo, tienen la impresora de tickets conectada por **USB** al PC, y se imprime a través del spooler de Windows (RAW). Ese camino —el adaptador USB, la cáscara Electron que lo hospeda y el instalador— es la fase C2b.

C2b se parte en dos, con el mismo criterio que C2a: lo verificable en local ahora, y lo que solo puede validarse con el hardware del cliente. Esta fase, **C2b-a**, construye la **plomería USB** —el adaptador en el paquete de impresión, el acotado del agente a sus propias impresoras USB, y la configuración desde el panel de administración— **toda verificable en local sin hardware**, apoyándose en un *sink* de entrega inyectable que un test mueve con una impresora falsa. La **C2b-b** (la cáscara Electron, el binding nativo real de winspool que implementa ese sink, y el empaquetado/instalador) es un sub-proyecto posterior que solo puede validarse en un PC Windows con una impresora física.

## Alcance

**Dentro de C2b-a:**
- **Adaptador USB en `@suarex/printing`**: se introduce un *dispatch* de adaptador (hoy el discriminante `adapter: "escpos-tcp"` existe pero está muerto: nada lo lee, la entrega es siempre TCP). `printToPrinter` renderiza una vez y despacha por `config.adapter` a la entrega TCP (existente) o a la USB (nueva). La entrega USB llama a un **sink de bytes crudos registrado en runtime**; el sink por defecto falla limpio, un test registra uno falso, y la cáscara Electron registrará el real (winspool) en C2b-b.
- **Agente**: lee también sus impresoras **USB**, acotadas a las que están atadas a su propio dispositivo (`printers.device_id = ` el id del propio device), y las imprime en el mismo bucle. Una impresora USB está físicamente en UN PC, así que solo el agente de ese PC debe intentar imprimirla.
- **Panel de administración**: se puede dar de alta y editar una impresora de tipo **USB** (nombre de la impresora de Windows + dispositivo al que está atada), además de las de red que ya existen.

**Fuera (fase C2b-b u otros sub-proyectos):**
- La cáscara Electron (proceso principal que hospeda `runAgent`, preload, UI de emparejamiento y estado, reconexión, apagado).
- El **binding nativo real** de winspool (la implementación del sink USB que de verdad manda los bytes al spooler de Windows).
- La ayuda de **enumerar las impresoras locales** en el instalador/app para que el owner sepa qué nombre teclear.
- El **empaquetado/instalador** de Windows (electron-builder / NSIS) y el horneado de `SUPABASE_URL` + anon key (públicos por diseño) en el instalable.
- El papel de **kiosko** (tótem que toma pedidos en local): otro sub-proyecto.

**Éxito de C2b-a:** con el stack local y un dispositivo sembrado, un test registra un sink falso, siembra una impresora USB atada a ese dispositivo y un pedido pagado, corre un tick del agente, y los bytes ESC/POS exactos del ticket llegan al sink para el nombre de impresora correcto —sin abrir ningún socket—; una impresora USB atada a OTRO dispositivo no la imprime este agente; un `owner` da de alta una impresora USB desde el panel; y toda la suite (unit + integración) sigue en verde desde limpio.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Partición de C2b | C2b-a (plomería USB, verificable en local) ahora; C2b-b (Electron + binding winspool real + instalador) después, validado con hardware |
| Mecanismo de entrega USB | Un **sink inyectable registrado en runtime** (`registerUsbRawSink`), no pasado por la config ni por el agente: el paquete de impresión posee el hueco, el test/Electron lo rellenan. El sink por defecto falla limpio |
| Identidad de la impresora USB | `connection = { type: "usb", printerName }`, donde `printerName` es el nombre de la impresora tal como aparece en Windows (el que `OpenPrinter` espera) |
| Quién rellena `printerName` | El `owner`/`admin` lo teclea en el panel (cloud). El **device nunca escribe config** (la RLS de `printers` es escritura owner/admin, y así se conserva). En C2b-b la app Electron podrá ENSEÑAR los nombres locales para ayudar a teclear, pero el guardado sigue en el panel |
| Acotado del agente para USB | El agente imprime una impresora USB solo si `printers.device_id` es su propio dispositivo. Las de red siguen acotadas por local (venue), como en C2a |
| Migraciones | Ninguna: `printers.device_id`/`os`/`app_version` ya existen, `connection` es jsonb libre, y el device ya puede leer su propia fila (`devices_select_own`) y todas las impresoras del tenant (`printers_select`) |

## Arquitectura

```
packages/printing/src/
  adapters/types.ts        PrinterConfig pasa a unión discriminada (escpos-tcp | escpos-usb); PrintResult igual
  usb-sink.ts              NUEVO: hueco del sink registrable (registerUsbRawSink / el sink por defecto que falla)
  print-order.ts           dispatch por config.adapter; deviceKey con esquema tcp::/usb::; deliverUsb via el sink
  index.ts                 export de registerUsbRawSink + el tipo del sink
packages/agent/src/
  run-agent.ts             + usbPrinters() acotado por device_id; el tick imprime red + USB; resuelve el propio deviceId
packages/db/src/
  admin-printers.ts        PrinterConnection pasa a unión; buildUsbConnection(); createPrinter/updatePrinter aceptan tipo + deviceId
apps/web/app/admin/impresoras/
  PrinterForm.tsx          selector Red/USB; USB -> printerName + selector de dispositivo
  actions.ts               parseo del tipo de conexión + deviceId
tests/
  integration/usb-print.test.ts       printToPrinter USB via sink falso; dispatch; deviceKey; cola; TCP sigue a socket
  integration/agent-usb.test.ts        el agente imprime su USB atada; no la de otro device; red+USB en un tick
  integration/admin-printers-usb.test.ts  buildUsbConnection; createPrinter usb+deviceId; cross-tenant device_id rechazado
```

### 1. Adaptador USB en `@suarex/printing`

Hoy `printToPrinter(lines, config)` renderiza los bytes (`renderEscPos`, sin abrir conexión) y los entrega **siempre por TCP** (`deliverOnce(buffer, host, port)`, `node:net`); `config.adapter` es un tipo de un solo valor que nadie lee. C2b-a introduce el *dispatch*:

- **`PrinterConfig` pasa a unión discriminada** por `adapter`:
  - `{ adapter: "escpos-tcp"; id; label; destination; host; port }` (lo actual)
  - `{ adapter: "escpos-usb"; id; label; destination; printerName }` (nuevo)
- **`printToPrinter`** renderiza una vez y, dentro de su mismo bucle de reintentos, despacha por `config.adapter`: TCP → `deliverOnce(buffer, host, port)` (sin cambios); USB → `deliverUsb(buffer, printerName)`.
- **`deliverUsb(buffer, printerName)`** llama al **sink registrado**. El sink es una función `(buffer: Buffer, printerName: string) => Promise<void>` que vive en un hueco de módulo (`usb-sink.ts`): `registerUsbRawSink(fn)` lo fija; el sink por defecto **lanza** un error claro ("impresión USB no disponible: no hay sink registrado / plataforma no soportada"). Que el sink resuelva = entrega ok; que lance = `PrintResult.ok = false` con su `reason` —exactamente el mismo contrato que la entrega TCP—, así que un host sin sink registrado (o no-Windows) falla limpio y el pedido se reintenta, sin marcar nada como impreso.
- **`deviceKey(config)`** devuelve `tcp::${host}:${port}` o `usb::${printerName}`, para que `enqueueByDevice` serialice las tareas a la misma impresora física USB igual que ya hace con las de red (dos escrituras simultáneas al mismo spooler pierden un ticket).

Por qué un sink registrado y no un parámetro de la config o de `printToPrinter`: mantiene al agente y a la config **ignorantes del mecanismo**. El agente construye una `PrinterConfig` USB y llama a `printToPrinter` igual que para una de red; el paquete de impresión resuelve la entrega. El sink real (winspool) es una dependencia nativa, específica de Windows y de Electron, que no debe filtrarse ni al agente ni a la base de datos ni a los tests: el hueco registrable la aísla en un único punto que C2b-b rellena.

### 2. Agente: impresoras USB acotadas por dispositivo

En C2a el agente imprime todas las impresoras de RED habilitadas de su tenant, acotadas por local (`venue_id`). Una impresora USB, en cambio, está físicamente atada a UN PC: solo el agente que corre en ese PC puede alcanzarla. El acotado es por `printers.device_id`:

- El agente resuelve **su propio `deviceId`** leyendo su fila de `devices` (`devices_select_own` ya permite al device leer la fila cuyo `auth_user_id = auth.uid()`). Se hace una vez por tick (o se cachea); si no resuelve ninguna fila (p. ej. un device sembrado sin fila en `devices`), simplemente **no imprime USB** —las de red siguen funcionando.
- `usbPrinters(client, ownDeviceId)`: lee las impresoras habilitadas con `connection.type === "usb"` **y** `device_id === ownDeviceId`, y construye una `PrinterConfig` USB (`adapter: "escpos-usb"`, `printerName` de la conexión).
- El tick imprime en un solo bucle las de **red** (acotadas por venue, como en C2a) **y** las **USB** (acotadas por device). Cada una marca impreso por su `deviceKey` propio vía `reserve_printed_self`, con la misma semántica *at-least-once* (entregar → marcar; un fallo reintenta; nunca se pierde un ticket, como mucho se duplica).

Nota: para las impresoras de red el `device_id` se sigue ignorando (una impresora de red la alcanza cualquier agente del local); el acotado por `device_id` es específico de las USB, donde es una necesidad física, no una preferencia.

### 3. Panel de administración: alta de impresora USB

- **`PrinterConnection`** (`admin-printers.ts`) pasa de `{ type: "network"; host; port }` a una **unión**: `| { type: "network"; host; port } | { type: "usb"; printerName }`.
- **`buildUsbConnection(printerName)`**: valida que `printerName` no esté vacío (tras `trim`), y devuelve `{ type: "usb", printerName }`. Es el análogo de `buildNetworkConnection`, que se conserva sin cambios.
- **`createPrinter`/`updatePrinter`** aceptan un descriptor de conexión (los campos de red **o** el `printerName` de USB) y un `deviceId` opcional para atar la impresora a un dispositivo. La columna `printers.device_id` ya existe y su trigger `assert_same_tenant` ya rechaza atar una impresora al dispositivo de otro tenant (`cross-tenant reference rejected`).
- **`PrinterForm.tsx` + `actions.ts`**: un selector de tipo (Red / USB); Red → los campos `host`/`port` actuales; USB → un campo `printerName` y un selector de dispositivo (de `listDevices`). La Server Action parsea según el tipo elegido, sigue envuelta en `managerAction`, y el `tenantId` viene siempre de la sesión.

El aviso de impresora mal configurada (C2a, `destinationsMissingPrinter`) sigue funcionando sin cambios: mira el destino y `enabled`, no el tipo de conexión. Como mejora acotada de esta fase, se añade que una impresora **USB sin `device_id` asignado** también se señale (nunca imprimiría, porque ningún agente la reclama) —el mismo espíritu de hacer visible una configuración que dejaría pedidos sin imprimir.

## Manejo de errores

- **Sink USB no registrado / plataforma no soportada** (p. ej. el propio stack de test antes de registrar el falso, o un host que no es Windows): `deliverUsb` lanza → `PrintResult.ok = false` → el pedido no se marca → se reintenta. En un PC Windows real con el sink registrado (C2b-b) esto no ocurre.
- **Impresora USB sin `device_id`**: ningún agente la reclama (el filtro es por `device_id`), así que nunca imprime; el panel lo avisa.
- **Impresora USB cuyo dispositivo está apagado**: igual que una de red inalcanzable —no se marca, se reintenta cuando el agente vuelve.
- **Fallo transitorio del spooler** (el sink lanza una vez): lo absorbe el mismo bucle de reintentos de `printToPrinter` que ya cubre la entrega TCP.
- **`printerName` que no existe en Windows**: es responsabilidad del sink real (C2b-b) mapear ese fallo a un error; en C2b-a el sink falso puede simularlo para probar que un fallo del sink produce `ok:false` y reintento.

## Pruebas

Todas headless, sin hardware, con un sink falso registrado:

- **Adaptador USB (`@suarex/printing`)**: con un sink falso registrado, `printToPrinter(lines, usbConfig)` entrega al sink el **Buffer exacto** de `renderEscPos` para el `printerName` correcto y **no abre ningún socket**; un sink que lanza produce `PrintResult.ok = false` con `reason`; `deviceKey(usbConfig)` es `usb::<printerName>`; dos prints a la misma impresora USB se **serializan** (cola por `deviceKey`). Regresión: una `PrinterConfig` TCP sigue yendo por `node:net`, nunca al sink.
- **Agente (`@suarex/agent`)**: sembrado un device con su fila y una impresora USB atada a él (más un sink falso), un tick del agente hace llegar los bytes del ticket al sink y marca el pedido; una impresora USB atada a **otro** device NO la imprime este agente; en un tenant con una de red y una USB (ambas del device), el tick imprime las dos.
- **Admin (`@suarex/db` + panel)**: `buildUsbConnection` valida (vacío lanza); `createPrinter` con `type: "usb"` + `deviceId` escribe la fila con la conexión correcta; atar a un `device_id` de otro tenant lo rechaza el trigger; el round-trip del formulario (tipo USB → fila `{type:"usb", printerName}` con `device_id`) funciona.
- **Regresión**: la suite de C2a (agent-loop de red, print-flow, print-jobs, coverage) sigue en verde; el aviso de impresora ahora también marca una USB sin `device_id`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El mecanismo winspool (nativo, Windows) se filtra al agente/DB/tests | El sink registrable lo aísla en un único hueco; el agente construye una config USB y llama a `printToPrinter` sin saber nada del sink. El sink real es C2b-b |
| Una impresora USB se imprime desde el PC equivocado | Acotado por `device_id`: el agente solo reclama las USB atadas a su propio dispositivo. Test que lo verifica con dos devices |
| `PrinterConfig` como unión rompe llamantes existentes | Los únicos llamantes son el agente y los propios tests; el dispatch preserva el camino TCP byte a byte. Regresión explícita |
| Duplicar la lógica de entrega | El render es común (una vez); solo la entrega se ramifica (TCP existente vs sink USB), en un único punto de dispatch |
| Una USB sin `device_id` deja pedidos sin imprimir en silencio | El aviso del panel (extendido en esta fase) la señala, igual que un destino sin impresora |

## Regla de despliegue

Como todo el proyecto, C2b-a se demuestra en local con dispositivos, impresoras y tenants de prueba, con el sink USB falso. Los repositorios y proyectos Supabase en producción no se tocan. C2b-b (Electron + binding winspool real + instalador) será el sub-proyecto que de verdad necesite el PC Windows y la impresora física del cliente para validarse, y tendrá su propio spec.
