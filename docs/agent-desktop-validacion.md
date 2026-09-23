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

**1. ¿Existe la tarea?** Tras abrir la app por primera vez, en PowerShell:

```powershell
schtasks /query /tn "SuarEx Agente Watchdog" /v /fo list
```

Tiene que aparecer, apuntando al `.exe` instalado y con repetición cada 5 minutos. Si dice
que no existe, mira el panel de registro de la app: se avisa del fallo al registrarla.

**2. La prueba de verdad.** Con el agente emparejado y funcionando:

1. Manda un pedido de prueba y comprueba que imprime.
2. Abre el Administrador de tareas y **finaliza el proceso** del agente (no lo cierres desde
   la bandeja: eso es una salida ordenada, no una caída).
3. Comprueba que el icono de la bandeja desaparece.
4. **Espera hasta 5 minutos.** El icono tiene que volver solo.
5. Manda otro pedido: tiene que imprimir sin que nadie haya tocado el PC.

El paso 4 es el que importa. Si no vuelve, el watchdog no está haciendo su trabajo y la
cocina se quedaría sin comandas hasta que alguien pasara por el ordenador.

**3. Que no se duplique.** Con el agente ya funcionando, espera a que pase el ciclo de 5
minutos y comprueba en el Administrador de tareas que **sigue habiendo un solo proceso**. La
tarea lanza la app cada cinco minutos pase lo que pase; es el bloqueo de instancia única el
que hace que la segunda salga sola. Si vieras dos procesos, los tickets se imprimirían por
duplicado.

**4. Al des-emparejar se limpia.** Des-empareja el dispositivo desde la app y repite la
consulta del paso 1: la tarea ya no debe existir. Si se quedara, el PC seguiría reabriendo
cada cinco minutos una app que ya no pertenece a ningún restaurante.

## Qué capturar si algo falla
- El **panel de registro** completo de la app (cópialo entero).
- El nombre exacto de la impresora (paso 3).
- Si es el instalador: el mensaje de error de Windows.
