# Validación en hardware — App de escritorio del agente (C2b-b)

Esta app se construyó a ciegas (sin Windows ni impresora en el entorno de desarrollo).
Estos pasos, en el PC Windows 11 del cliente, son los que confirman que funciona. Si un
paso falla, captura lo que se indica y pégalo para diagnosticar.

## Requisitos
- Windows 11 x64, impresora ESC/POS USB con su driver instalado (aparece en "Impresoras y
  escáneres" con un nombre).
- El build de la app apuntando al Supabase correcto (dev durante pruebas).
- El build debe hornearse con AMBAS envs de build, o el emparejamiento (paso 6) fallará
  siempre con "código inválido": `SUPABASE_URL` + `SUPABASE_ANON_KEY` (host de Supabase) Y
  `PLATFORM_WEB_ORIGIN` (origin de la web de la plataforma donde vive `/api/devices/pair`,
  p. ej. `https://<tenant>.suarex.app` en prod o `http://garum.localhost:3000` en dev). Son
  orígenes distintos: falta cualquiera de los dos y el emparejamiento no funciona.

## Pasos

1. **Instalar.** Ejecuta el instalador (`SuarEx Agente Setup *.exe`). Windows SmartScreen
   avisará (app sin firmar): pulsa **Más información → Ejecutar de todas formas**. Instala.
   - ✅ Esperado: se instala sin pedir admin y crea acceso directo.
   - ❌ Si falla: captura el mensaje del instalador.

2. **Arranque.** La app se abre y aparece en la bandeja del sistema.
   - ✅ Esperado: ventana "SuarEx — Agente de impresión", estado "sin emparejar".
   - ❌ Si el panel de log muestra "no se pudo cargar el binding de impresión": el `.node`
     de koffi no se empaquetó/cargó — captura el log completo.

3. **Impresoras.** Pulsa "Actualizar lista".
   - ✅ Esperado: aparece tu impresora ESC/POS por su nombre de Windows. Anota ese nombre
     EXACTO (lo necesitas en el panel cloud).
   - ❌ Si la lista está vacía: captura el log.

4. **Ticket de prueba (lo más importante).** Selecciona la impresora y pulsa "Imprimir
   ticket de prueba".
   - ✅ Esperado: sale un ticket "SUAREX / Ticket de prueba / <fecha>" por la impresora.
   - ❌ Si no sale nada o el log da error: captura el log (aquí es donde el binding
     winspool puede necesitar ajuste). Esto valida el camino RAW sin depender de la nube.

5. **Alta en el panel cloud.** En el panel de administración (web), crea una impresora de
   tipo **USB** con el nombre EXACTO del paso 3, atada a este dispositivo, con su destino
   (cocina/barra).

6. **Emparejar.** En el panel, genera un código de emparejamiento para este dispositivo.
   En la app, pégalo y pulsa "Emparejar".
   - ✅ Esperado: log "Emparejado: dispositivo …", estado pasa a "emparejado · agente
     corriendo".
   - ❌ "código inválido": el código caducó o se tecleó mal. "demasiados intentos": espera.

7. **Pedido real de punta a punta.** Haz un pedido QR de prueba y págalo.
   - ✅ Esperado: en pocos segundos, el ticket sale por la impresora, con la app minimizada
     en la bandeja.

8. **Desatendido.** Cierra la ventana (se oculta a bandeja), reinicia Windows.
   - ✅ Esperado: tras el login, la app arranca sola (bandeja) y sigue imprimiendo pedidos
     sin abrir la ventana.

## Watchdog del sistema (solo Windows)

Esto NO se puede probar fuera de Windows, así que es obligatorio hacerlo aquí. Lo que se
verifica es que el agente vuelve solo cuando alguien mata el proceso — no cuando se reinicia
el PC, que ya lo cubre el auto-arranque en el login.

La tarea solo existe mientras el equipo está **emparejado**: un PC sin emparejar no pertenece a
ningún restaurante y no debe reabrir la app.

**0. Sin emparejar, no hay tarea.** Con la app recién instalada y abierta, sin emparejar, la
consulta del paso 1 tiene que decir que la tarea no existe.

**1. ¿Existe la tarea?** Tras emparejar, en PowerShell:

```powershell
schtasks /query /tn "SuarEx Agente Watchdog" /v /fo list
```

Tiene que aparecer con repetición cada 5 minutos, y la tarea que ejecuta tiene que ser el propio
`SuarEx Agente.exe` con `--en-segundo-plano`, **no** `powershell.exe`. Si dice que no existe,
mira el panel de registro de la app: se avisa del fallo al registrarla.

El agente que resucita la tarea ES la instancia en marcha de la tarea, así que sus ajustes
importan tanto como que exista:

```powershell
([xml](schtasks /query /tn "SuarEx Agente Watchdog" /xml)).Task.Settings
```

`ExecutionTimeLimit` tiene que ser `PT0S`, y `StopIfGoingOnBatteries` y
`DisallowStartIfOnBatteries`, `false`. Con los valores por defecto, Windows mataría al agente a
las 72 horas y al desenchufar un portátil. `Priority` 5: con la de por defecto (7) correría por
debajo de lo normal.

**1b. Sin ventanas.** Cada vez que salta la tarea no debe aparecer nada en pantalla: ni una
consola, ni la ventana del agente. La primera versión del watchdog pasaba por PowerShell y, con
Windows Terminal como terminal por defecto, dejaba una ventana negra abierta tras resucitar al
agente; cerrarla mataba al agente sin dejar rastro. Si ves cualquier ventana al pasar el minuto
múltiplo de 5, es un fallo.

**2. La prueba de verdad.** Con el agente emparejado y funcionando:

1. Manda un pedido de prueba y comprueba que imprime.
2. Abre el Administrador de tareas y **finaliza el proceso** del agente (no lo cierres desde
   la bandeja: eso es una salida ordenada, no una caída).
3. Comprueba que el icono de la bandeja desaparece.
4. **Espera hasta 5 minutos.** El icono tiene que volver solo, **sin abrir ninguna ventana**:
   un agente resucitado vuelve a la bandeja, igual que en el arranque de Windows.
5. Manda otro pedido: tiene que imprimir sin que nadie haya tocado el PC.

El paso 4 es el que importa. Si no vuelve, el watchdog no está haciendo su trabajo y la
cocina se quedaría sin comandas hasta que alguien pasara por el ordenador.

**3. Que no se duplique.** Con el agente ya funcionando, espera a que pase el ciclo de 5
minutos y comprueba en el Administrador de tareas que **sigue habiendo un solo proceso**. La
tarea lanza la app cada cinco minutos; si ya corre, el bloqueo de instancia única hace que ese
segundo lanzamiento salga en el acto, y como llega con `--en-segundo-plano` tampoco saca la
ventana del que ya corre. Si el agente que corre lo resucitó la propia tarea, ni siquiera lanza:
la tarea figura "En ejecución" mientras él viva, y es lo correcto. Si vieras dos procesos, los
tickets se imprimirían por duplicado; si viste aparecer la ventana del agente, el flag no está
llegando.

**3b. "Salir" desde la bandeja.** Es una salida ordenada, pero el watchdog no la distingue de
una caída: a los cinco minutos, como mucho, la app vuelve. Es el comportamiento actual; anótalo
si en el local resulta un problema.

**4. Al des-emparejar se limpia.** Des-empareja el dispositivo desde la app y repite la
consulta del paso 1: la tarea ya no debe existir. Si se quedara, el PC seguiría reabriendo
cada cinco minutos una app que ya no pertenece a ningún restaurante.

## Validar el diagnóstico exportable

No se puede probar fuera de Windows empaquetado, así que va aquí con el resto.

1. En **Ayuda**, pulsa **Guardar diagnóstico**. Debe abrirse el diálogo nativo con el
   Escritorio y un nombre tipo `suarex-diagnostico-2026-09-24-1830.txt`.
2. Guarda y ábrelo. Arriba tiene que estar la versión, el sistema, si está emparejado y en
   marcha, y el id del dispositivo.
3. **Busca dentro la palabra `password` y el correo `@devices.local`.** No deben aparecer: este
   fichero se manda por correo y la contraseña del dispositivo vive cifrada en ese mismo
   directorio. Si salieran, es un fallo grave, no una errata.
4. Debajo de `--- Registro ---` tiene que haber líneas con fecha ISO y nivel. Si pone
   `(sin entradas)` en una instalación que lleva días funcionando, el log no se está
   escribiendo: comprueba `%APPDATA%\@suarex\agent-desktop\logs\agent.log`.
5. Pulsa el botón y **cancela** el diálogo: el panel de registro no debe decir nada (cancelar
   no es un error).

## Qué capturar si algo falla
- El **fichero de diagnóstico** (Ayuda → Guardar diagnóstico). Sustituye a copiar el panel a
  mano y trae además el registro de los días anteriores.
- El nombre exacto de la impresora (paso 3).
- Si es el instalador: el mensaje de error de Windows.
