# Scrum — versione 0.25 (rete, porta, pallone, grafica)

## Strumento
Non c'è uno strumento Scrum collegato a questa sessione (nessun Jira, Trello o simili tra i collegamenti
disponibili). Il lavoro segue comunque Scrum: backlog con priorità del Product Owner qui sotto, uno sprint alla volta
con la lista delle attività nell'app, implementazione, prove automatiche e review scritta qui; ogni sprint esce come
versione.

## Ruoli
- **Product Owner**: Simone (richiesta del 30/10/2026: "nuova fase di miglioramento, priorità massima alla rete").
- **Scrum Master e team**: Claude.

## Definition of Done
Come per la 0.24: nel codice vero, provato con test automatici che misurano la cosa richiesta, nessun errore nella
console, `npm test` e test nel browser superati, prestazioni controllate, CHANGELOG.

## Product Backlog
| # | Storia | Sprint |
|---|---|---|
| 1 | Rete della porta realistica: deformazione nel punto d'impatto, oscillazione elastica, fili visibili, nessuna compenetrazione, suono | 0.25.0 |
| 2 | Porta e pali: rimbalzi credibili su pali e traversa, rete attaccata bene, materiali e ombre | 0.25.0 (rete attaccata) e 0.25.1 |
| 3 | Fisica del pallone: peso, velocità, rotazione, traiettoria, rimbalzi e impatti | 0.25.1 |
| 4 | Grafica: luce, ombre, materiali, stadio | 0.25.2 |
| 5 | Grafica "quasi come FC 26": inquadratura TV, erba, calciatori, fari | 0.25.4 e seguenti |
| 6 | Scegliere il pallone nelle impostazioni (tanti disegni) | 0.25.4 |
| 7 | Punizioni dell'allenamento più facili: troppi difensori, respingono sempre | 0.25.5 |

## Review degli sprint

### Sprint 0.25.0 — La rete della porta: fatto
- **Analisi**: la rete 3D a nodi (0.24) si deformava già e tornava a riposo; mancavano il contatto preciso con i tiri
  veloci (il pallone era guardato solo a fine fotogramma), lo spessore dei fili (linee di 1 pixel, senza ombra), la
  cessione verso l'interno quando la rete è presa da fuori (lì era un muro rigido), il suono e l'attacco corretto ai
  pali.
- **Grafica** (`09_render_net.js`): posizione del pallone interpolata nei 3 sotto-passi; raggio di contatto = pallone
  più mezza maglia; fili come InstancedMesh di cilindri (media e alta) con ombra, visibili sotto i 30 m dalla porta,
  altrimenti solo ombra e linee; rete che parte da POST_R dietro la linea di porta; niente passo con dt = 0.
- **Motore** (`03_ball.js`, `08_match.js`): la rete cede anche da fuori (molla, al massimo 30 cm; il pallone non
  entra mai: `netOut` impedisce l'ingresso dalla parte sbagliata); evento `net` con la velocità, uno per colpo
  (anche in rete per le partite online).
- **Audio** (`10_audio.js`): `net(v)`, fruscio e colpo secondo la velocità.
- **Prove**: `tests/novita025_browser_test.py` 11/11 (tiro forte al centro, angolo alto, angolo basso, pallone lento,
  rete presa da fuori, oscillazione che si spegne, nessuna compenetrazione, un suono per colpo e più forte per i tiri
  forti, fili veri e LOD, rete dietro ai pali); `rete_test.js` 18/18 (anche palo, traversa, tetto, da dietro);
  `npm test`; test nel browser della 0.24.

### Sprint 0.25.1 — Pali, traversa e fisica del pallone: fatto
- **Analisi**: il rimbalzo sul legno usava una restituzione fissa (0,7), senza attrito e senza cambiare la rotazione
  (sul palo l'effetto veniva solo girato di segno); il volo del pallone era perfettamente prevedibile.
- **Motore** (`03_ball.js`): `woodBounce` con restituzione da 0,78 (colpo piano) a 0,55 (colpo forte), attrito lungo
  il legno, effetto laterale dal palo, rotazione in avanti o all'indietro dalla traversa; `knuckle` (foglia morta) per
  i tiri sopra 22 m/s quasi senza rotazione: spinta laterale fino a 1 m/s² che cambia verso, fase decisa a caso al
  calcio (con il generatore della partita: stesso seme, stessa partita).
- **Equilibrio**: 3,17 → 3,04 gol a partita (24 partite, dentro la variabilità normale). `motore_ref.json` rifatto.
- **Prove**: `rete_test.js` 23/23 (rimbalzo piano più alto di quello forte, effetto dal palo, rotazione dalla
  traversa sotto e sopra, foglia morta diversa ogni volta e assente nei tiri a giro), `npm test`, novita025 11/11,
  novita024 43/43.

### Sprint 0.25.2 — Luce, ombre, riflessi: fatto
- **Analisi**: una sola mappa d'ombra per tutto lo stadio (140 × 100 m: ombre sfocate), nessun ambiente per i riflessi
  (i materiali lucidi erano opachi), una sola ombra per calciatore anche di sera.
- **Grafica** (`09_render_light.js`, nuovo): ombra che segue il punto guardato (zona 48-140 m secondo la distanza
  della telecamera, a scatti di un pixel della mappa); `PMREMGenerator` da una piccola scena (cielo, fari, erba) per
  `scene.environment`, una per ora del giorno, niente a qualità bassa; 88 ombre dei fari in un solo InstancedMesh.
- **Correzione trovata nei test**: con i riflessi three.js definisce delle costanti `r1`, `r2` nello shader; le
  pieghe della stoffa (0.24) usavano gli stessi nomi e lo shader dei calciatori non compilava: rinominate.
- **Prove**: `novita025_browser_test.py` 14/14 (ombra che segue, riflessi, ombre dei fari di sera e non di giorno),
  novita024 43/43, grafica 19/19, natale 21/21, browser (alta qualità), `npm test`.

### Sprint 0.25.3 — Il legno vibra, la rete trema: fatto
- **Motore**: l'evento `post` porta la forza del colpo (`v`, dalla velocità contro il legno); in rete `power` e `y`.
- **Grafica** (`09_render_field.js`): `onPost` avvia la vibrazione del gruppo della porta (13 Hz, si spegne in
  0,8 s, ampiezza secondo la forza) e dà una spinta ai nodi della rete vicini al punto colpito; la rete si sposta con
  il telaio.
- **Prove**: `novita025_browser_test.py` 16/16 (palo e traversa: la porta vibra pochi centimetri e torna ferma, la
  rete trema), novita024 43/43, `npm test`.

### Sprint 0.25.4 — Inquadratura TV, palloni da scegliere: fatto
- **Richieste del Product Owner**: "deve diventare quasi come FC 26"; "nelle impostazioni scegliere che palla usare,
  tanti disegni".
- **Grafica**: telecamera TV con teleobiettivo (campo visivo 30° invece di 38°, più lontana e più bassa: prospettiva
  piatta come in TV, `applyFov`); riflesso delle strisce del prato che cambia con la direzione della telecamera
  (`grassView`); luce di taglio sui bordi dei calciatori; fasci di luce dei fari di sera (più visibili con pioggia e
  neve, solo qualità media e alta); niente bandiere davanti alla telecamera TV.
- **Palloni** (`09_render_ball.js`): `BALL_DESIGNS` con 9 disegni (premium, Natale, classico a 32 pannelli, notte,
  fuoco, ghiaccio, arancione, retrò in cuoio con i lacci, arcobaleno); `setBallDesign`; impostazione `ballDesign`
  ("Automatico" = Natale a dicembre, premium il resto dell'anno) nel menu Grafica.
- **Prove**: `novita025_browser_test.py` 20/20 (texture diversa per ogni pallone, automatico, menu che si salva,
  teleobiettivo, riflesso dell'erba, fasci di sera e non di giorno), novita024 43/43, browser 31/31, `npm test`.

### Sprint 0.25.5 — Punizioni dell'allenamento: fatto
- **Richiesta del Product Owner**: "le punizioni nell'allenamento più facili: troppi difensori e respingono tutto".
- **Analisi** (40 punizioni tirate da un giocatore simulato che mira agli angoli): 0 gol. Quattro difensori in
  barriera messi secondo il numero di maglia; ogni difensore colpiva di testa qualsiasi pallone sotto i 2,6 m, anche
  un tiro a 80 all'ora (18 tiri su 30 respinti); il mirino partiva a 1,4 m; i tiri col mirino arrivavano 30-50 cm
  più in alto del mirino (distanza misurata da chi tira e non dal pallone, più il raggio del pallone) e il portiere
  li toccava sopra la traversa.
- **Allenamento** (`28_training.js`): barriera di due difensori spalla a spalla, verso il palo vicino; un tiro veloce
  sopra 1,8 m passa sopra la barriera; mirino che parte a 1,6 m; il tiro veloce che il portiere prenderebbe solo con
  la punta delle dita entra; punizioni da 19-25 m, più centrali.
- **Motore** (`06_actions.js`): i tiri col mirino (punizioni e rigori dei giocatori) arrivano all'altezza del mirino.
  I tiri dell'IA non cambiano (equilibrio delle partite uguale).
- **Risultato**: 17 gol su 40 (prima 0), barriera 3 su 40 (prima 18 su 30).
- **Prove**: `novita025_browser_test.py` 23/23, novita024 43/43, novita023 21/21, `npm test`.
