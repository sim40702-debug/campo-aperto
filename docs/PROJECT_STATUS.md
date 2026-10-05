# PROJECT_STATUS — Campo Aperto

Aggiornato: 05/10/2026, sessione 9, versione 0.7.0

## Obiettivo
Gioco di calcio 3D originale (11 contro 11), giocabile nel browser, costruito a milestone fino a un prodotto con modalità, carriera ed editor.

## Tecnologia
- HTML5 + JavaScript, Three.js r128 (da cdnjs), Web Audio per i suoni procedurali.
- Una sola pagina autocontenuta, generata da `build.js` concatenando `src/01..17` (destinazioni: web, test, desktop; la variabile BUILD_TARGET dice quale).
- Node.js supportato: 22, 24, 26 (26 grazie a overrides yauzl 3.4.0 per l'installatore di Electron 33).
- App desktop: Electron 33 + electron-builder (config in package.json, icona in risorse/, finestra in desktop/main.js).
- Simulazione (moduli 01-08) e rete (12) indipendenti da THREE e DOM: girano anche in Node per i test.
- Online: server relay WebSocket (server/relay.js, libreria ws) + host autorevole che simula la partita; i client mandano
  solo comandi e ricevono istantanee binarie (34 + 22x12 float, 30 al secondo) che interpolano.
- Rete locale (app desktop): "Crea partita" avvia il relay sul PC dell'host (porta 8787, o libera) che risponde a UDP 8788 al codice;
  chi entra manda il codice in broadcast e ottiene l'indirizzo. desktop/preload.js espone window.campoLan (hostStart, hostStop, find).
- Passo fisso 1/60 s. Coordinate: x lunghezza (±52.5), z larghezza (±34), y altezza.

## Architettura (src/)
01 config e RNG, 02 database, 03 fisica palla (aria, effetto, rimbalzo), 04 giocatore, 05 squadra e tattica, 06 azioni (volo dei calci calcolato), 07 IA,
08 partita e regole (più umani) + 08_referee arbitro (contrasti, falli, vantaggio, cartellini; vedi docs/ARBITRO_E_FISICA.md),
09 render 3D (preset qualità, HiDPI, particelle), 10 audio (tre canali), 11 input (tastiera, mouse, controller, rimappabile, navigazione menu), 12 rete (NetLink,
HostSession, ClientSession), 13 impostazioni (localStorage), 14 gioco (schermate, HUD, loop, online), shell.html (UI).
15 account (client dell'API, solo il token in localStorage), 16 economia (schermate partite, centro partita, schedina, feed social,
negozio, personaggio, inventario, profilo, classifiche, anteprime 2D), 17 visione sincronizzata delle partite del server.
server/relay.js: lobby e inoltro messaggi.
cloud/: server dell'economia (Cloudflare Worker + D1 + Durable Object "Engine" e "Relay", una stanza per codice su
wss://…/relay), vedi docs/ECONOMIA.md. Regole delle schedine in cloud/src/betlogic.js, lo stesso file nel server e nel gioco. Il motore del server è
generato da `node build.js engine` con gli stessi file 01..08 (impronta ENGINE_ID = SHA-256 dei file); RNG per partita
(Match opts.rng) per rigiocare uguale una partita dal seme. Quote da cloud/src/odds-model.json (Monte Carlo col motore vero).
Test: rules_test.js (31), referee_test.js (54), sim_test.js, net_test.js (83, relay e WebSocket veri), browser_test.py (28), controls_browser_test.py (27,
controller simulato), online_browser_test.py (15, due giocatori), electron_smoke.js (16, app vera con tasti reali e due finestre online).

Test dell'economia: cloud/test/markets_test.js (21), cloud/test/api_test.js (100, contro wrangler dev), economy_browser_test.py (45,
due giocatori nel browser, server locale, multiplayer con cosmetici, visione sincronizzata), electron_economy_smoke.js (6).

## Funzionalità completate (verificate)
- 0.7.0: multiple vere (più mercati della stessa partita se compatibili, motore unico validateBetCombination, quota
  collegata, bonus a soglie, VOID), "La mia schedina" con conflitti spiegati, Home da videogioco, transizioni senza salti,
  giocatori più realistici con inerzia, risoluzione e finestra, comandi salvati sull'account. Solo PC (desktop).
- 0.6.1: multiplayer via internet sullo stesso indirizzo del Worker con codice stanza.
- Economia (0.6.0): account, portafoglio sul server, partite del server, 25 mercati, singole e multiple, liquidazione,
  feed social, copia con conferma, condivisione, reazioni, statistiche, classifiche, negozio, inventario, personaggio,
  cosmetici in 3D anche online, bonus giornaliero, obiettivi, premio spettatore, premi di stagione.
- Partita rapida 11v11 umano vs IA o IA vs IA, 8 squadre originali, setup completo.
- Fisica palla: rotolamento, volo, effetto, rimbalzi, pali/traversa/rete.
- Azioni: passaggio, lancio/cross, filtrante, tiro caricato, colpo di testa, contrasto, scivolata, cambio giocatore.
- Portieri: posizionamento, tuffi, uscite, prese/respinte, rinvii.
- Regole: gol, rimessa laterale, corner, rinvio dal fondo, falli, punizioni, rigori, fuorigioco, intervallo con cambio campo, fine partita.
- IA: assegnazione ruoli (chaser, pressing, copertura, marcature), smarcamenti, valutazione passaggi, decisioni del portatore, difficoltà.
- Stamina, tattica live in pausa (mentalità, pressing, formazione).
- Stadio procedurale, pubblico animato, luci/ombre, 3 telecamere, replay del gol, HUD con minimappa, audio procedurale.
- Qualità Bassa/Media/Alta/Ultra, scala di risoluzione, risoluzione dinamica, limite fps, HiDPI e 4K (verificato 3840x2160).
- Online: crea partita, codice, unisciti, lobby, squadre, avvio, sincronizzazione, disconnessioni e rientro, chiusura dell'host.
- Tasti rimappabili, mouse, gestione focus, feedback visivo dei comandi, impostazioni salvate.
- Controller (gamepad) completo: movimento analogico, rimappatura, vibrazione, Xbox/PlayStation, menu navigabili, schermata Comandi.
- Pressing assistito, cambio verso il ricevitore e con levetta destra, aiuto ricezione, tuffo scelto sui rigori contro.
- App desktop offline con versione nel menu, pulsante Esci, F11. Pacchetto Linux verificato; Windows e Mac configurati ma da compilare sulle rispettive macchine (o con GitHub Actions).

## In sviluppo / parziale
- Bilanciamento IA: media 3.3 gol e 13 tiri in partite IA da 3 minuti per tempo (1.7 gol con tempi da 90 s). Da rivedere
  con partite contro umani: le parate più facili valgono anche per i tiri del giocatore.
- Rimesse laterali rare nelle partite IA (da verificare).

## Limiti dell'online (scelte motivate)
- Nessun passaggio di host: lo stato completo della simulazione (IA, timer, piazzati) esiste solo sull'host. Serve una
  serializzazione completa di Match e un'elezione del nuovo host. Oggi: attesa 20 s, poi chiusura con messaggio.
- Nessuna predizione lato client: il proprio calciatore risponde con ritardo pari a ping + 0.1 s.
- Online solo nell'app desktop (la pagina web pubblicata non può aprire WebSocket verso altri server).
- Tattica in pausa solo offline.

## Non ancora implementato
Sostituzioni, finte, tiro a giro manuale, barriera controllabile, salvataggi, editor giocatori, creazione squadra, allenamento, torneo, campionato, coppe, carriera, mercato. Nel menu sono dichiarati "In costruzione".

## Bug conosciuti
- Controller provato solo con un controller simulato nei test: da provare con controller veri (Xbox, PlayStation, Switch Pro).
- Controller con mappatura non standard: i pulsanti possono non corrispondere (si rimappano a mano).
- Il font Saira può non caricarsi offline (c'è il fallback).
- Con rendering software (senza GPU) il gioco scende a pochi fps (la risoluzione dinamica aiuta).
- Gli fps reali con scheda grafica non sono misurabili nell'ambiente di sviluppo: misurati solo disegni, ombre e tempi CPU.
- npm audit segnala vulnerabilità in Electron 33 ed electron-builder 25 (aggiornamento maggiore da fare a parte).
- App non firmate: avvisi di Gatekeeper (Mac) e SmartScreen (Windows) al primo avvio.

## Prossima attività
1. Provare l'online tra due computer reali (partita in rete locale con ricerca automatica, firewall Windows, e server di casa con wss) e un controller vero.
2. M1 rifinitura: verificare il numero di gol contro umani e le rimesse laterali.
3. M2: cartellini, sostituzioni, finte/dribbling a scatto, tiro a giro, rigori e punizioni controllati.
4. M3: salvataggi (localStorage), editor giocatori, creazione squadra.

## Decisioni tecniche
- Pagina singola per poterla pubblicare come artifact; i documenti di stato sono incorporati nell'HTML (`<script type="text/markdown" id="doc-...">`) perché il filesystem di lavoro non persiste tra le sessioni.
- Tutto originale: nomi, squadre, marchi dei cartelloni inventati; grafica solo da primitive e texture canvas.
