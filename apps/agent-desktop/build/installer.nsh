; Script NSIS personalizado. electron-builder incluye automáticamente `build/installer.nsh`.
;
; Watchdog del sistema: la app registra al ARRANCAR una tarea programada ("SuarEx Agente
; Watchdog") que resucita el proceso si muere del todo. Registrarla es cosa de la app en runtime
; (idempotente, apunta siempre al exe actual). Pero una DESINSTALACIÓN no ejecuta código de la
; app, así que el borrado de la tarea tiene que vivir aquí: sin esto quedaría una tarea huérfana
; intentando cada 5 min lanzar un exe que ya no existe.
!macro customUnInstall
  ExecWait 'schtasks /Delete /TN "SuarEx Agente Watchdog" /F'
!macroend
