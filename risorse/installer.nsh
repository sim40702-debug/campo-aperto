; Incluso da electron-builder nell'installer Windows (NSIS).
; Le partite in rete locale ricevono connessioni sul computer di chi ospita (TCP 8787, UDP 8788).
; Windows considera "pubblica" ogni nuova rete Wi-Fi e lì blocca le connessioni in entrata: questa regola
; le consente al gioco, ma solo dai dispositivi della stessa sottorete (remoteip=localsubnet).
; Serve l'installazione per tutti gli utenti (con permessi di amministratore); altrimenti netsh fallisce
; senza conseguenze e Windows chiederà il permesso al primo avvio di una partita.

!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Campo Aperto (rete locale)"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Campo Aperto (rete locale)" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=any remoteip=localsubnet'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Campo Aperto (rete locale)"'
!macroend
