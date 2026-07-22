# Sub-proyecto: App de escritorio del agente — Fase C2b-b (Electron + Windows + instalador)

Fecha: 2026-07-22
Estado: aprobado, pendiente de plan de implementación

## Advertencia honesta sobre la validación

**Esta fase se construye a ciegas.** El entorno de desarrollo es macOS/Linux sin impresora: aquí NO se puede ejecutar Electron empaquetado, NO se puede cargar el FFI de `winspool.drv`, NO se puede escribir a una impresora física, y NO se puede correr el instalador NSIS de Windows. A diferencia de todas las fases anteriores —que terminaban en "toda la suite en verde"—, **"hecho" en C2b-b significa: el usuario ejecutó la app en el PC Windows 11 del cliente y de verdad imprimió**. Habrá un bucle de iteración real (build → el usuario lo corre → pega los errores → se corrige). El diseño está pensado para minimizar ese bucle: la iteración es lenta porque el PC es del cliente, así que cada visita debe rendir el máximo de información. Esta advertencia se repite en el plan y se traduce en dos cosas concretas: (1) todo lo que PUEDE probarse headless se aísla y se prueba; (2) todo lo que NO, se diagnostica en la propia app (lista de impresoras visible, botón de impresión de prueba sin nube, panel de log que se captura y se pega).

## Contexto

El canal QR imprime en la nube y el agente headless (`@suarex/agent`, fases C2a/C2b-a) ya sabe sondear los pedidos pagados de su tenant con su propio JWT, renderizar el ticket ESC/POS y entregarlo — por red (TCP) o por USB (a través de un *sink* registrable, `registerUsbRawSink`, cuyo mecanismo real quedó deliberadamente sin implementar). Lo que falta para un cliente real con impresora USB es la **app de escritorio** que corre en su PC Windows: hospeda el agente, implementa el sink USB real (winspool RAW), y se instala como cualquier programa.

Los seams necesarios ya existen y no cambian: `runAgent(creds, opts)` devuelve una función de parada; `registerUsbRawSink(fn)` fija el sink; `printToPrinter` despacha la entrega USB al sink; `POST /api/devices/pair` devuelve `{deviceId, email, password, tenantId}`; la `SUPABASE_URL` y la anon key son públicas por diseño (documentado en `.env.example` y en la migración `20260722000001`), así que pueden hornearse en el instalable — el service role, jamás.

## Alcance

**Dentro (C2b-b, un solo entregable: app + instalador):**
- App Electron `apps/agent-desktop` (Windows x64), construida con electron-vite (ESM + bundle de los paquetes TS del workspace).
- El **sink USB real** con koffi + winspool (`OpenPrinterW`/`StartDocPrinterW` datatype `RAW`/`WritePrinter`/…), aislado en un único fichero, registrado en `registerUsbRawSink` al arrancar.
- Enumerar las impresoras locales (API nativa de Electron `getPrintersAsync`) y mostrar sus **nombres exactos** en la UI.
- UI de **emparejamiento** (introducir el código → `POST /api/devices/pair` → guardar credenciales, la contraseña cifrada con `safeStorage`/DPAPI).
- **Ciclo del agente**: al arrancar, si está emparejado, registra el sink y llama a `runAgent(creds)`; para en el cierre.
- **Operación desatendida**: auto-arranque en el login de Windows, icono en la bandeja del sistema, cerrar-a-bandeja, single-instance lock.
- **UI diagnóstica**: estado de emparejamiento/agente, lista de impresoras, botón "Imprimir ticket de prueba" (ejercita el sink RAW sin la nube), panel de log.
- **Empaquetado**: electron-builder → instalador NSIS por-usuario (sin admin), con el binario nativo de koffi des-asar; el build hornea `SUPABASE_URL` + anon key.

**Fuera (fases posteriores u otros sub-proyectos):**
- **Auto-update** (por ahora se actualiza reinstalando).
- **Firma de código** (el instalable va sin firmar; se documenta el paso de SmartScreen).
- Builds para macOS/Linux.
- El papel de **kiosko** (tótem que toma pedidos en local).

**Éxito de C2b-b:** el usuario instala la app en el PC Windows 11 del cliente; la app arranca sola, muestra la lista de impresoras locales, y el botón "Imprimir ticket de prueba" saca un ticket ESC/POS por la impresora USB elegida; el owner da de alta en el panel (C2b-a) una impresora USB con ese nombre exacto atada a este dispositivo; se introduce el código de emparejamiento en la app; y a partir de ahí un pedido QR pagado se imprime solo en la impresora del local, sin que nadie abra la app. Toda la parte testeable headless (emparejamiento HTTP, store de config, marshalling del sink) está en verde en CI/local.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Alcance de C2b-b | App completa + instalador NSIS en un solo entregable (elección del usuario) |
| Mecanismo RAW | koffi + winspool (`OpenPrinterW` → `StartDocPrinterW` datatype `RAW` → `WritePrinter`). FFI con binarios precompilados, sin recompilar node-gyp, amigable con Electron; el datatype RAW pasa los bytes ESC/POS sin que el driver los procese |
| Enumerar impresoras | API nativa de Electron `webContents.getPrintersAsync()` — sin FFI para esto; el FFI se limita a la escritura |
| Dónde vive el sink | En la app (`apps/agent-desktop`), NO en `@suarex/printing` (que sigue agnóstico de plataforma con solo el hueco registrable) |
| Credenciales del device | La contraseña cifrada con `safeStorage` (DPAPI en Windows); el resto en JSON en `userData`. Nunca salen del PC |
| Config pública horneada | `SUPABASE_URL` + anon key en el build (públicas por diseño). El service role JAMÁS viaja |
| Operación | Desatendida: auto-arranque en login + bandeja + cerrar-a-bandeja + single-instance |
| Auto-update | Diferido — se actualiza reinstalando |
| Firma de código | Sin firmar en esta fase; se documenta el paso de SmartScreen |
| Bundler | electron-vite (ESM + bundle de los `@suarex/*` que exportan TS crudo) |

## Arquitectura

```
apps/agent-desktop/
  package.json                electron, electron-vite, electron-builder, koffi; deps @suarex/agent, @suarex/printing
  electron.vite.config.ts      main/preload/renderer; `define` hornea SUPABASE_URL + anon key
  electron-builder.yml         target NSIS x64, per-user; asarUnpack del .node de koffi
  src/main/
    index.ts                   ciclo de vida: ventana, tray, single-instance, auto-launch, arranque del agente
    usb-sink-winspool.ts       el sink USB real (koffi + winspool). ÚNICO fichero con FFI de impresión
    printers.ts                enumerar impresoras (getPrintersAsync) + resolver el ticket de prueba
    pairing.ts                 POST /api/devices/pair (pura, testeable con fetch mockeado)
    config-store.ts            leer/guardar credenciales (safeStorage + JSON en userData), pura sobre un backend inyectable
    agent-runner.ts            registerUsbRawSink(winspoolSink) + runAgent(creds); guarda el stop fn
    baked-config.ts            SUPABASE_URL + anon key horneadas (via `define`)
    ipc.ts                     canales IPC entre renderer y main (emparejar, listar impresoras, test-print, estado/log)
  src/preload/index.ts         puente contextBridge seguro (expone solo los canales IPC necesarios)
  src/renderer/                UI mínima: emparejamiento, estado, lista de impresoras, botón test, panel de log
  src/main/*.test.ts           unit de lo testeable headless (pairing, config-store, marshalling del sink)
docs/
  agent-desktop-validacion.md  CHECKLIST que el usuario corre en el PC Windows (parte del entregable)
```

### El sink USB (koffi + winspool) — el corazón del riesgo

`usb-sink-winspool.ts` implementa un `UsbRawSink` (`(buffer, printerName) => Promise<void>`). Ata con koffi las funciones de `winspool.drv` necesarias para una impresión RAW: `OpenPrinterW`, `StartDocPrinterW` (con una estructura `DOC_INFO_1W` cuyo `pDatatype` es `"RAW"`), `StartPagePrinter`, `WritePrinter`, `EndPagePrinter`, `EndDocPrinter`, `ClosePrinter`. El nombre de impresora se pasa en UTF-16 (las variantes `*W`). Se escribe el buffer ESC/POS tal cual; el datatype `RAW` hace que el spooler entregue los bytes al dispositivo sin que el driver los reinterprete —justo lo que necesita ESC/POS—. Cualquier fallo (impresora no encontrada, `WritePrinter` parcial, handle nulo) se traduce en un `throw`, que `printToPrinter` mapea a `ok:false` y reintenta; el pedido no se marca impreso hasta que la entrega tiene éxito (semántica *at-least-once* ya existente).

Este es el único fichero con FFI de impresión, a propósito: si algo no imprime, es aquí donde se mira. La carga del propio koffi/winspool se hace de forma defensiva al arrancar; si falla (FFI no disponible), la app lo muestra como un error fatal diagnosticable en el panel de log, no como un fallo silencioso de impresión.

Lo testeable headless de este fichero es el *marshalling*: que el buffer y el `printerName` se conviertan a los tipos/encodings correctos antes de la llamada FFI. La llamada real a winspool se aísla tras una frontera inyectable para poder probar la lógica de alrededor (construcción de argumentos, manejo de un WritePrinter que devuelve menos bytes de los escritos) sin un Windows real; la ejecución de winspool en sí solo se valida en el PC del cliente.

### Enumerar impresoras

`printers.ts` usa `webContents.getPrintersAsync()` (API nativa de Electron, sin FFI) para listar las impresoras instaladas con su `name`. La UI las muestra para que el owner sepa el **nombre exacto** que debe teclear en el panel de administración cloud (C2b-a) al dar de alta la impresora USB — cierra el hueco "¿cómo sé el nombre de la impresora de Windows?" que C2b-a dejó abierto a propósito. El mismo `name` es el que el sink pasa a `OpenPrinterW`.

### Emparejamiento y credenciales

`pairing.ts` hace `POST ${SUPABASE_ORIGIN}/api/devices/pair` con `{ pairingCode }` y devuelve `{deviceId, email, password, tenantId}` (o un error tipado en 404/429). Es una función pura sobre `fetch`, testeable con un `fetch` mockeado. La `SUPABASE_ORIGIN` sale de la config horneada.

`config-store.ts` guarda esas credenciales: la contraseña del device cifrada con `safeStorage.encryptString` (DPAPI en Windows, ligada al usuario/máquina), y `deviceId`/`email`/`tenantId` en un JSON en `app.getPath("userData")`. Al leer, descifra la contraseña. La lógica (qué se cifra, dónde se guarda, cómo se detecta "no emparejado") es pura sobre un backend inyectable (`safeStorage` + FS), así que se prueba headless con un backend falso; `safeStorage` real solo actúa en la app.

### Ciclo del agente

`agent-runner.ts`: al arrancar, si `config-store` dice que hay credenciales, `registerUsbRawSink(winspoolSink)` (una vez) y `runAgent({ supabaseUrl, anonKey, email, password })`, guardando la función de parada que devuelve. Al salir la app (o al des-emparejar), se llama a esa función. `SUPABASE_URL` + anon key vienen de `baked-config.ts`.

### Operación desatendida

`src/main/index.ts`: `app.requestSingleInstanceLock()` (una sola instancia), `app.setLoginItemSettings({ openAtLogin: true })` (auto-arranque en el login de Windows), un `Tray` con menú (abrir / estado / salir), y `window.on("close")` que oculta a bandeja en vez de cerrar. Así el barebone imprime desde el arranque sin que nadie abra la app; el owner solo interactúa con la ventana para emparejar o diagnosticar.

### UI diagnóstica

El renderer es una UI mínima (sin framework pesado; HTML + un poco de JS, o un framework ligero si electron-vite lo trae por plantilla) con: estado de emparejamiento (emparejado / no, device/tenant), estado del agente (corriendo, último sondeo, contadores impreso/fallo del último tick), la lista de impresoras locales (nombres a copiar), un botón **"Imprimir ticket de prueba"** que manda un buffer ESC/POS fijo por el sink a la impresora elegida —ejercita el camino RAW sin depender de la nube ni de un pedido—, y un **panel de log** con los eventos (emparejamiento, cada intento de impresión con ok/fallo y razón, carga del FFI). El log es la evidencia que el usuario captura y pega para diagnosticar en pocas rondas.

### Empaquetado

`electron-builder.yml`: target `nsis` para `win` x64, instalación **per-user** (`perMachine: false`, sin pedir admin), `oneClick: false` (asistente con opción de carpeta). El binario nativo de koffi (`koffi.node`) se marca en `asarUnpack` para que se extraiga del asar y sea cargable en runtime. El build de electron-vite hornea `SUPABASE_URL` + anon key vía `define`. Sin firma de código: el instalable dispara la advertencia de SmartScreen, cuyo paso ("Más información → Ejecutar de todas formas") se documenta en la checklist de validación.

## Manejo de errores

- **koffi/winspool no carga al arrancar:** error fatal visible en el panel de log ("no se pudo cargar el binding de impresión"), no un fallo silencioso — así el usuario sabe que el problema es el FFI/empaquetado, no la impresora.
- **`printerName` que no existe / impresora apagada:** `OpenPrinterW` falla → `throw` → `printToPrinter` reintenta y devuelve `ok:false` → el pedido no se marca → se reintenta; el log muestra la razón.
- **`WritePrinter` escribe menos bytes de los pedidos:** se trata como fallo (`throw`), no como éxito parcial.
- **Emparejamiento 404 (código inválido/caducado) o 429 (rate-limit):** mensaje claro en la UI, distinto para cada caso; no se guardan credenciales.
- **Sin red / Supabase inalcanzable:** el agente ya reintenta en el siguiente sondeo (lógica de `runAgent`); la UI muestra "sin conexión" en el estado.
- **Cierre de la app con el agente corriendo:** se llama a la función de parada de `runAgent` antes de salir de verdad (no al ocultar a bandeja).
- **Segunda instancia:** el single-instance lock la rechaza y enfoca la existente.

## Pruebas

**Testeable headless (unit, en CI/local, sin Windows):**
- `pairing.ts`: con un `fetch` mockeado, un 200 devuelve las credenciales; un 404 y un 429 devuelven errores tipados distintos; un body corrupto no revienta.
- `config-store.ts`: con un backend `safeStorage`+FS falso, guardar y leer credenciales hace round-trip; "no emparejado" se detecta cuando no hay fichero; la contraseña se pasa por el cifrado (el backend falso lo registra), nunca se escribe en claro.
- `usb-sink-winspool.ts` (marshalling): la construcción de argumentos para la llamada FFI (buffer, `printerName` a UTF-16, datatype `"RAW"`) es correcta; un `WritePrinter` falso que devuelve menos bytes produce `throw`; la frontera FFI está inyectada, así que se prueba sin winspool real.

**NO testeable aquí (lo valida el usuario en el PC Windows, guiado por `docs/agent-desktop-validacion.md`):**
- La escritura winspool RAW real a la impresora ESC/POS (botón "Imprimir ticket de prueba").
- La cáscara Electron (ventana, tray, auto-arranque, single-instance).
- El emparejamiento real contra el `/api/devices/pair` desplegado.
- El bucle completo: pedido QR pagado → impreso en la impresora del local, con la app minimizada en bandeja.
- El instalador NSIS (instala, arranca, el `.node` de koffi carga, la config horneada es correcta), incluido el paso de SmartScreen.

La **checklist de validación** (`docs/agent-desktop-validacion.md`) es parte del entregable: una lista ordenada de pasos que el usuario ejecuta en el PC del cliente, cada uno con el resultado esperado y qué capturar (nombres de impresora, salida del botón de test, panel de log) si algo falla, para que una sola visita rinda el máximo diagnóstico.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Todo se construye a ciegas; algo no compila/carga en el PC del cliente | Aislar lo arriesgado (sink en un fichero, FFI mínimo), diagnóstico en la app (log, error fatal visible), y una checklist de validación que rinde info en pocas rondas |
| El binario nativo de koffi no se carga desde el asar empaquetado | `asarUnpack` del `.node`; carga defensiva con error fatal claro si falla; se prueba explícitamente en la checklist |
| El driver de la impresora reinterpreta los bytes ESC/POS | datatype `"RAW"` en `StartDocPrinter` hace que el spooler entregue los bytes sin procesar; el botón de test lo valida antes de depender de un pedido real |
| La anon key horneada se confunde con un secreto | Es pública por diseño (documentado); el service role nunca se hornea ni viaja. Revisión explícita de que ningún secreto entra en el build |
| Iteración lenta (PC del cliente) multiplica el coste de cada fallo | UI diagnóstica (nombres de impresora, test sin nube, log) + checklist ordenada = cada visita valida el máximo de una vez |
| El emparejamiento expone credenciales en el disco del cliente | La contraseña se cifra con `safeStorage` (DPAPI); solo el usuario/máquina puede descifrarla; nunca en claro en el JSON |

## Regla de despliegue

C2b-b se construye contra el proyecto Supabase **de desarrollo** (la app horneada apunta a la URL local/dev durante la validación; el build de producción apunta al proyecto real cuando el resto esté probado). Los repositorios y el proyecto Supabase de producción no se tocan como parte de esta fase. La validación en hardware la hace el usuario en el PC Windows 11 del cliente siguiendo la checklist; hasta que esa checklist pase, C2b-b no está "hecha", por muy verde que esté la parte headless.
