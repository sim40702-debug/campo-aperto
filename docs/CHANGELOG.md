# CHANGELOG — Campo Aperto

Formato delle versioni: MAGGIORE.MINORE.CORREZIONE (la versione sta in package.json).

## 0.4.2 — 05/10/2026 (rete locale: un solo "Crea partita", ricerca più robusta, diagnostica)
- Causa del "stesso codice ma non trova la partita": il pulsante principale "Crea partita" creava la stanza sul server delle
  impostazioni, che per difetto era ws://localhost:8787, cioè il computer di CHI lo usa. L'host creava la partita sul proprio
  computer, l'amico la cercava sul suo: stesso codice, due elenchi di stanze diversi. In più il server autonomo ascolta solo su
  127.0.0.1 e i codici senza L non venivano mai cercati in rete. Ora nell'app desktop "Crea partita" ospita sempre sul computer
  di chi crea (server integrato su tutte le schede di rete, codice con L) e il server online è facoltativo (vuoto per difetto;
  il vecchio valore localhost viene tolto). Con un server impostato compare "Crea sul server online".
- Ricerca: scansione unicast anche per sottoreti /22 e /23 (Wi-Fi mesh), con l'interfaccia della rotta predefinita per prima.
  Ogni gruppo della scansione usa un proprio socket: i datagrammi verso indirizzi vuoti aspettano l'ARP occupando il buffer di
  invio, e con un socket solo oltre circa 250 indirizzi l'invio verso l'host restava fermo (riprodotto in una /22).
- Collegamento: dopo 4 ping senza risposta (circa 8 s) il socket è considerato perso e parte il rientro automatico (prima un
  host spento o un Wi-Fi caduto potevano lasciare il client bloccato per minuti). Errori con codice (TIMEOUT, UNREACHABLE,
  NO_REPLY...) e messaggi precisi: codice non valido, partita non trovata, trovata ma host irraggiungibile, server non
  disponibile, connessione scaduta, host disconnesso, partita già iniziata (si entra come spettatore).
- Diagnostica di rete (Ctrl+Maiusc+D o Impostazioni, Online): ruolo, IP locali, server, porte, codice, stato, ping, ultimo
  errore, eventi con orario; sull'host anche le richieste di ricerca ricevute. Nuovo comando IPC lan:status.
- Installatore Windows: regola del firewall per il gioco limitata alla sottorete locale (risorse/installer.nsh). Mac:
  NSLocalNetworkUsageDescription per il permesso Rete locale.
- Relay: i tentativi di codice falliti vecchi vengono dimenticati (la tabella cresceva senza limite).
- Test: net_test 78 (+5: errore UNREACHABLE, stato dell'host, scansione /22, collegamento muto).

## 0.4.1 — 05/10/2026 (rete locale: ricerca più robusta e diagnosi)
- Caso reale: Windows (host) e Mac (client) sull'hotspot di un iPhone, "Impossibile collegarsi al server". L'hotspot può non
  inoltrare i broadcast UDP e macOS può bloccare la rete locale all'app (permesso "Rete locale"); prima ogni errore di invio era
  nascosto dietro un messaggio generico.
- La ricerca scrive anche, in unicast, a tutti gli indirizzi delle sottoreti piccole (da /24 in su, al massimo 1024 destinatari,
  a gruppi per non sparare tutto insieme), oltre ai broadcast. Il tempo massimo sale a 2 secondi; se l'host risponde si entra subito.
- Campo facoltativo "Indirizzo dell'host (solo se la ricerca non funziona)" in Unisciti (solo desktop): accetta IP, IP:porta o
  ws://IP:porta. Viene ricordato dopo un ingresso riuscito e usato come destinatario in più; se la ricerca non risponde si prova
  il collegamento diretto a quell'indirizzo.
- Messaggi precisi al posto di quello generico: nessuna rete, invio bloccato (su Mac: istruzioni per il permesso Rete locale),
  nessuna risposta, host trovato ma connessione rifiutata / scaduta (firewall dell'host) / non raggiungibile; sempre con il codice errore.
- findGame ora restituisce { url } oppure { url: null, why, detail }. Nuovi: checkHost (prova TCP) e comando IPC lan:check.
- Nuovo strumento `npm run prova-lan -- IP-host[:porta] CODICE` (scripts/prova-lan.js): controlla passo per passo interfacce, invii UDP,
  risposta alla ricerca, TCP, WebSocket e ingresso, e indica il passo che fallisce.
- Versione 0.4.1: tutti i giocatori devono avere la stessa versione.
- Test: net_test +11 (scansione unicast, why no-reply, analisi dell'indirizzo, checkHost).

## 0.4.0 — 05/10/2026 (partita in rete locale)
- Nuovo pulsante "Ospita in rete locale" (solo app desktop): avvia un piccolo server sul computer di chi ospita e apre la
  lobby con il codice. Gli amici scrivono SOLO il codice in "Unisciti": il gioco cerca l'host nella rete con un breve
  messaggio UDP (porta 8788) e si collega da solo, senza digitare indirizzi IP. I codici della rete locale iniziano sempre con L
  e solo questi vengono cercati in rete (gli altri vanno subito al server online); il codice non viaggia in chiaro (nonce + HMAC,
  limite di 10 richieste al secondo per indirizzo). Se non lo trova, ripiega sul server impostato.
- Server integrato più rigido: solo il computer che ospita può creare la partita, massimo 32 collegamenti, socket senza
  stanza chiusi dopo 10 secondi. Il codice ricevuto dal server viene controllato prima dell'uso.
- Nella lobby dell'host compare l'indirizzo di rete (es. 192.168.1.23:8787) come ripiego. Windows può chiedere il permesso
  del firewall al primo avvio: va consentito. Il server si ferma quando la partita finisce o si chiude il gioco.
- L'indirizzo dell'host è ben visibile: riquadro nella lobby con IP:porta in grande (quello realmente usato per la rete per primo,
  gli altri adattatori sotto), pulsante "Copia" e avviso "Server avviato su IP:porta" all'avvio.
- Nuovi file: desktop/lan.js (server integrato e ricerca), desktop/preload.js (ponte isolato, solo 3 comandi).
  La libreria ws passa tra le dipendenze (serve dentro l'app pacchettizzata).
- Versione 0.4.0: tutti i giocatori devono avere la stessa versione.
- Test: net_test 43 (+11, rete locale: ricerca dal codice, codice sbagliato, datagrammi malformati, risposte false, riavvio porte).

## 0.3.2 — 02/10/2026 (più gol, più fluido)
- Più gol nelle partite: media nelle partite IA contro IA da 0.94 a 3.3 gol (tempi da 3 minuti, 30 partite),
  tiri da 9.5 a 13 a partita. Cause trovate: l'IA tirava spesso sopra la soglia di potenza che manda la palla
  alta (3.6 tiri fuori a partita), parate troppo sicure (circa 80%), pochi tiri dalla media distanza.
  Interventi: potenza dei tiri IA sotto la soglia, probabilità di parata più bassa sui tiri forti, tiri un po'
  più frequenti tra 16 e 30 metri. Le parate più facili valgono anche contro i tiri dei giocatori umani.
- Movimento fluido a ogni frequenza dello schermo: la grafica disegna tra gli ultimi due passi della simulazione
  (interpolazione). Prima a 144 Hz il 60% dei fotogrammi mostrava i calciatori fermi (scatti), ora nessuno.
  Vale per partita offline, host online e partita del menu (il client online era già interpolato).
- Telecamera con inseguimento esponenziale: stessa morbidezza a qualunque fps.
- Meno lavoro per la scheda grafica: corpo, testa e capelli dei calciatori in un solo pezzo colorato, stinco e scarpa
  insieme, un solo materiale per tutti; braccia senza ombra. Disegni per fotogramma da 304 a 208, oggetti che
  proiettano ombra da circa 240 a 110, geometrie da 705 a 246. Aspetto invariato.
- Memoria: i calciatori delle partite precedenti venivano solo tolti dalla scena e mai liberati (la memoria video
  cresceva a ogni partita); i fotogrammi del replay vengono riusati invece di crearne 60 nuovi al secondo.
- Interfaccia: il tabellone e la scheda del calciatore scrivono nella pagina solo quando cambia qualcosa;
  minimappa ridisegnata 30 volte al secondo.
- Risoluzione dinamica più stabile: cambia solo dopo misure costanti e mai più di una volta ogni 4 secondi
  (ogni cambio produceva un piccolo scatto e prima poteva oscillare di continuo).
- Test: controls_browser_test 27 (+1, fluidità a 144 Hz).

## 0.3.1 — 02/10/2026 (controller, controlli e correzioni di gioco)
- Controller (Gamepad API, mappatura standard): levetta analogica (poco inclinata = camminata), croce, grilletti,
  zona morta regolabile, nomi dei pulsanti Xbox o PlayStation, vibrazione (tiri, contrasti, pali, gol), avvisi di
  collegamento/scollegamento, pausa automatica offline se il controller si scollega. Tastiera, mouse e controller
  insieme senza conflitti: i suggerimenti a schermo seguono il dispositivo usato per ultimo.
- Rimappatura: ogni azione ha due tasti e un pulsante del controller; il tasto alternativo si toglie con Backspace;
  avviso quando un tasto viene tolto da un'altra azione; ripristino separato per tastiera e controller.
  Le impostazioni vecchie vengono aggiornate senza perdere i tasti scelti.
- Nuova schermata Comandi (menu, pausa, F1/H) generata dai tasti assegnati.
- Menu navigabili con frecce e controller (A conferma, B/Esc indietro, LB/RB schede delle impostazioni).
- Nuovi comandi: Pressing tenuto (E / RB), cambio giocatore con la levetta destra, il cambio va a chi riceve il
  passaggio, aiuto alla ricezione (disattivabile), tuffo del portiere scelto dall'umano sui rigori contro,
  rinvio automatico del portiere umano dopo 6 s.
- Controlli più reattivi: tasti premuti tra due passi di simulazione non vanno più persi (schermi a 120-144 Hz),
  tocco rapidissimo del tiro = tiro debole, accelerazione dei calciatori umani più pronta, comandi relativi alla
  telecamera "Dietro al giocatore" (su = verso la porta avversaria).
- Gioco: passaggio senza direzione al compagno più libero (prima al calcio d'inizio la palla andava agli avversari);
  tiro spingendo verso la porta = angolo lontano dal portiere; contrasto premuto da lontano senza penalità;
  cross dalla bandierina senza direzione verso un compagno in area.
- Correzioni: i gol dopo una parata non riuscita erano contati come autogol del portiere (tutti gli "autogol" delle
  partite IA erano questo); l'host online bloccava la partita aprendo impostazioni o comandi; clic destro apriva il
  menu del browser in partita; impostazioni salvate rovinate potevano lasciare i tasti vuoti.
- Interfaccia: riquadri dei comandi diversi in attacco e in difesa, suggerimenti per rigori, portiere e piazzati,
  conferma per Ricomincia ed Esci, pulsante "Cambia squadre" a fine partita, ultima partita ricordata.
- Test: rules_test 31 (+13), net_test 32 (+3), nuovo controls_browser_test.py 26 (controller simulato),
  electron_smoke 16 (+1).

## 0.3.0 — 01/10/2026 (online, controlli, grafica, interfaccia)
- Online con host autorevole: server lobby/relay (`server/relay.js`, dipendenza `ws` 8.22.0), codice partita di 6 caratteri
  (senza 0/O/1/I), lobby con squadre/spettatori, ping e stato di connessione, avvio solo dall'host, comandi dei client
  validati dall'host, istantanee binarie a 30 Hz interpolate (ritardo 0.1 s), eventi (suoni, gol, particelle) sincronizzati.
- Disconnessioni: client caduto -> l'IA prende il suo calciatore, rientro automatico nello stesso posto entro 30 s;
  host caduto -> i client aspettano 20 s, poi la stanza si chiude con un messaggio; host che perde il server -> continua offline.
- `Match` supporta più giocatori umani (fino a 4 per squadra), API compatibile con prima (humanTeam/controlled).
- Controlli: tasti rimappabili (due per azione, salvati), WASD e frecce, mouse (clic sinistro passaggio, destro tiro),
  niente ripetizioni automatiche, tasti rilasciati quando la finestra perde il focus, pausa automatica offline,
  i tasti di gioco non fanno scorrere la pagina, riquadri dei comandi che si illuminano.
- Grafica: preset Bassa/Media/Alta/Ultra (Ultra = risoluzione nativa fino al 4K), scala di risoluzione, risoluzione dinamica,
  limite fps, rapporto pixel aggiornato quando cambia lo schermo, texture del campo fino a 4096 px con filtro anisotropico,
  ombre fino a 4096, tone mapping ACES, particelle (erba, polvere, coriandoli), tremolio della telecamera al gol,
  indicatori e nomi per ogni giocatore umano, numeri e pallone più nitidi, minimappa nitida su HiDPI.
- Interfaccia: schermata di caricamento, menu rinnovato (Nuova partita, Gioca online, Impostazioni), schermate online e lobby
  (codice su tabellone a palette, copia), impostazioni a schede (grafica, audio con tre volumi, controlli, server), schermo intero,
  avvisi di errore e di connessione, pausa e fine partita in versione online.
- Correzioni trovate nei test: la ripresa dalla pausa ripausava subito il gioco; il server crashava se la porta era occupata.

## 0.2.2 — 01/10/2026 (compatibilità Node.js 26)
- Compatibilità reale con Node.js 26.9.0 / npm 11.19.1: causa individuata in yauzl 2.10 (dipendenza di extract-zip,
  usato dall'installatore di Electron 33), che su Node 26 si ferma dopo il primo file dello zip.
  Aggiunto `"overrides": { "yauzl": "3.4.0" }`. Unica modifica al lockfile: yauzl 2.10.0 -> 3.4.0 (fd-slicer non più necessario).
- `engines` portato a `>=22.12.0 <27`, `.nvmrc` a 26, controlla-electron.js accetta Node 22-26.
- `allowScripts` per il postinstall di electron@33.4.11 (avviso di npm 11).
- Corretto `npm run dist:*` in locale: tolta la configurazione publish (richiedeva un repository Git) e passata solo
  nel workflow GitHub; aggiunto `homepage` richiesto dal pacchetto .deb.
- Workflow GitHub Actions su Node 26.

## 0.2.1 — 01/10/2026 (correzione installazione)
- Risolto "Electron failed to install correctly" su `npm start`: con Node.js 26 l'installatore di Electron 33
  (extract-zip) si fermava a metà senza errori, lasciando dist/ incompleta e senza path.txt. Riprodotto con Node 26.9.0.
- Progetto configurato per Node.js 24 LTS (testato anche 22): `engines` in package.json, `.npmrc` con engine-strict, `.nvmrc`.
- Nuovo scripts/controlla-electron.js (postinstall, start, dist): verifica Node ed Electron e ripara da solo un'installazione incompleta.
- Versioni delle dipendenze fissate a quelle già nel package-lock (nessun aggiornamento).
- Workflow GitHub Actions su Node 24.

## 0.2.0 — 01/10/2026 (app desktop)
- App desktop con Electron per Windows (installer + portable), Mac (dmg/zip Intel e Apple Silicon) e Linux (AppImage/deb).
- Versione unica in package.json, mostrata nel menu e nei nomi dei file compilati.
- build.js con tre destinazioni: web, test, desktop. La versione desktop funziona offline (three.js e font Saira inclusi).
- Pulsante "Esci" nel menu dell'app desktop; F11 schermo intero; regole di sicurezza (Content-Security-Policy).
- Icona dell'app originale.
- Workflow GitHub Actions che compila le tre piattaforme quando si pubblica un tag v*.
- Test di fumo in Electron (tests/electron_smoke.js); verificata la pacchettizzazione Linux (AppImage avviata correttamente).
- LEGGIMI.md con le istruzioni di compilazione.

## 0.1.0 — 29/09/2026 (M1, nucleo giocabile)
- Aggiunti moduli src 01-12 e shell.html: configurazione, database originale (8 squadre, giocatori generati con attributi completi), fisica palla, giocatori, tattiche, azioni, IA, regole della partita, rendering Three.js, audio, input, gestione schermate.
- Aggiunti test Node: simulazione di partite complete (6 semi) e 18 test di regole/comandi, tutti superati.
- Bilanciamento IA dopo i primi test (pressing, contrasti, decisioni di tiro e passaggio, tempi di reazione).
- Correzioni: palla che rallenta a gioco fermo, rimessa con palla dentro il campo, portiere sul rigore, cambio automatico se l'umano controlla il portiere.
- Aggiunto build.js (versione pubblicata e versione di test locale) e test browser con screenshot.
- Corretta la telecamera del menu che finiva dietro le tribune; telecamera televisiva più vicina.
- Aggiunta qualità grafica adattiva.
