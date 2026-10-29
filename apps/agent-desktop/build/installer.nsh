; Script NSIS personalizado. electron-builder incluye automáticamente `build/installer.nsh`.
;
; Watchdog del sistema: mientras el equipo está emparejado, la app registra una tarea programada
; ("SuarEx Agente Watchdog") que resucita el proceso si muere del todo, y la borra al
; des-emparejar. Es cosa de la app en runtime (idempotente, apunta siempre al exe actual). Pero una
; DESINSTALACIÓN no ejecuta código de la app, así que el borrado de la tarea tiene que vivir aquí:
; sin esto quedaría una tarea huérfana intentando cada 5 min lanzar un exe que ya no existe.
;
; Lo mismo con el arranque con Windows (`setLoginItemSettings`): Electron lo escribe en Run con el
; AppUserModelID de la app como nombre, y desinstalar no lo borra solo.
!macro customUnInstall
  ExecWait 'schtasks /Delete /TN "SuarEx Agente Watchdog" /F'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.suarex.agent"
!macroend
