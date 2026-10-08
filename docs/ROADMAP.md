# CAMPO APERTO — Roadmap

Gioco di calcio 3D originale. Stack: HTML5 + JavaScript + Three.js r128, pagina singola autocontenuta.

## M1 — Nucleo giocabile (partita rapida)
- Architettura modulare (config, dati, palla, giocatore, tattiche, IA, partita, input, render, UI, audio)
- Fisica palla (rotolamento, volo, rimbalzi, pali, traversa, rete)
- 11 contro 11, movimento con accelerazione, sprint, stamina
- Passaggio corto, lungo, filtrante, cross, tiro con carica, colpo di testa, contrasto
- Portieri (posizionamento, parate, uscite, rinvii)
- IA di squadra: blocco tattico, pressing, copertura, marcatura, smarcamenti, scelte del portatore
- Regole: calcio d'inizio, gol, rimesse laterali, corner, rinvii dal fondo, falli, punizioni, rigori, fuorigioco, intervallo, fine partita
- Stadio procedurale, telecamere, HUD, minimappa, replay del gol, menu, audio procedurale
- Test automatici della simulazione (Node) e del rendering (Chromium headless)

## M2 — Profondità del gameplay
- Tiri a giro e di prima intenzione, finte e dribbling a scatto, scivolate
- Sostituzioni e stanchezza reale, gestione tattica durante la partita
- Punizioni dirette con barriera, rigori controllati dal giocatore
- IA: sovrapposizioni, tagli, linee di passaggio migliori, difesa a zona più fine

## M3 — Squadre e giocatori
- Database persistente (salvataggi), editor giocatori (aspetto, statistiche, divise)
- Creazione squadra con logo procedurale e divise personalizzate

## M4 — Modalità
- Allenamento, Torneo, Campionato, Coppe

## M5 — Carriera
- Stagioni, calendario, classifica, mercato, contratti, crescita, infortuni, finanze, obiettivi

## M6 — Presentazione e rifinitura
- Animazioni migliori, telecamere aggiuntive, commento testuale, audio più ricco, ottimizzazione, mobile/gamepad

## Piano versioni
- 0.1.x — M1 nucleo giocabile (browser)
- 0.2.x — app desktop Windows/Mac/Linux
- 0.3.0 — online con host autorevole, controlli rimappabili, grafica adattiva fino al 4K, nuova interfaccia
- 0.3.1 — controller (gamepad), schermata Comandi, menu navigabili, pressing assistito, correzione autogol
- 0.3.2 — più gol nelle partite IA, movimento interpolato e fluido, meno carico grafico
- 0.4.x – 0.9.x — arbitro, economia e scommesse, competizioni (torneo, campionato, coppe), amici e sfide tra amici
- 0.10.0 — lingue: italiano, inglese, tedesco, francese
- 0.11.0 — M2: sostituzioni, finte e dribbling, punizioni e rigori con il mirino
- 0.12.0 — M3 editor di squadre, M5 carriera da allenatore (stagioni, mercato, crescita), M6 telecronaca
- 0.12.1 — telecronaca a voce; release anche per Linux  ← attuale
- prossime — carriera: contratti, infortuni, obiettivi della società; editor dell'aspetto dei giocatori; allenamento
- 1.0.0 — M6 rifinitura completa, prima versione completa
