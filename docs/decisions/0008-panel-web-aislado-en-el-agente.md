# 0008 — El panel web del agente es contenido remoto aislado

**Estado:** vigente · **Fecha:** 2026-10-24 (recogida de `apps/agent-desktop/src/main/web-panel.ts`)

## Contexto

La app de escritorio enseña dentro de su ventana páginas de la plataforma (Comandas, Productos,
Cierre). Reimplementarlas en nativo crearía dos juegos de reglas que divergirían con el primer
cambio, así que se incrustan las de la web. Pero eso es contenido REMOTO dentro de una app que
puede emparejar, imprimir y des-emparejar el PC de la cocina, que usa cualquiera que pase.

## Decisión (`web-panel.ts`)

- **`WebContentsView`, no `<webview>`.** El segundo está desaconsejado por Electron y reutiliza el
  proceso del renderer que SÍ tiene el puente `window.agent`; una vista aparte tiene su propio
  `webContents`.
- **Sin `preload`.** Un XSS en el panel no puede llegar a `window.agent.*` (emparejar, imprimir,
  des-emparejar). Habla con su servidor por HTTP, no necesita más.
- **`sandbox: true`**, con `contextIsolation` y `nodeIntegration: false`.
- **Dos particiones** (`PARTICIONES`): las Comandas guardan su sesión en disco (el trabajo de todo
  el día); Productos y Cierre (precios, caja) van en una de memoria que se borra al cerrar la
  ventana y pide la cuenta del gestor cada vez.
- **La navegación no sale del origen de la plataforma** (`isSameOrigin`, que compara el origen
  completo y nunca por prefijo). Fuera de origen, `window.open` y los enlaces van al navegador del
  sistema.

## Consecuencias

- Los permisos son de la PERSONA que inicia sesión (owner/admin), no de la máquina: las
  credenciales del dispositivo siguen siendo de solo-imprimir y RLS excluye al rol `device` del
  catálogo. Robar el PC no permite reescribir los precios del negocio.
- Sin la guarda de origen, un enlace externo convertiría el panel en un navegador SIN barra de
  direcciones: nadie sabría qué sitio mira mientras teclea su contraseña (phishing).
- Lo que hay que vigilar: añadir un `preload` a la vista, abrir ventanas hijas de Electron (que
  heredarían estas preferencias sin la guarda) o compararla por `startsWith`.
