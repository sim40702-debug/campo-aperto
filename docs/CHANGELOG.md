# CHANGELOG — Campo Aperto

Formato delle versioni: MAGGIORE.MINORE.CORREZIONE (la versione sta in package.json).

## Prossima versione (cartelle in ordine)
- **Cartelle del codice in ordine**: `src/engine/` (motore della partita, lo stesso nel gioco e nel server),
  `src/client/` (grafica, audio, comandi, rete), `src/game/` (menu, economia, competizioni, carriera...) e `src/i18n/`
  (lingue). I numeri davanti ai nomi dei file restano e decidono sempre l'ordine; `scripts/sorgenti.js` trova i file
  nelle cartelle per build e test. L'impronta del motore non cambia (70420182d2d0): partite e server restano compatibili.
- **Un file per lingua**: le traduzioni sono in `src/i18n/en.json`, `de.json` e `fr.json` (prima un file per argomento
  con le tre lingue insieme). `tests/lingue_test.js` controlla che i tre file abbiano le stesse frasi.
- **Compilazione su Windows**: `npm run dist:win` non si ferma più con "Cannot create symbolic link : Il privilegio
  richiesto non appartiene al client". Il nuovo `scripts/prepara-windows.js` prepara da solo lo strumento winCodeSign di
  electron-builder senza i file del Mac, quindi non servono più i permessi di amministratore.

## 0.12.1 — 08/10/2026 (telecronaca a voce)
- La **telecronaca parla**: le frasi si sentono anche a voce, con la sintesi vocale del computer nella lingua del gioco
  (italiano, inglese, tedesco, francese). Una frase importante (gol, rosso) interrompe quella in corso, una meno
  importante mentre si parla si salta. Segue il volume generale e l'audio muto; in pausa e fuori dalla partita tace.
- Scelta **Spenta / Solo scritte / Scritte e voce** prima della partita (Nuova partita), nel menu di pausa e in
  Impostazioni → Generale.
- **Release anche per Linux**: `.AppImage` (tutte le distribuzioni) e `.deb` (Ubuntu, Debian, Mint), compilati con
  GitHub Actions insieme a Windows e Mac. Se la macchina Linux di GitHub resta in coda si può annullare solo quel lavoro.
- README aggiornato con tutte le novità, l'installazione su Linux e come aggiungere una traduzione.
- **Server aggiornato da solo**: nuovo flusso GitHub Actions «Aggiorna il server» che pubblica `cloud/` (motore,
  migrazioni, Worker) quando nel `main` cambiano il server o il motore. Servono i segreti `CLOUDFLARE_API_TOKEN` e
  `CLOUDFLARE_ACCOUNT_ID` (docs/ECONOMIA.md).

## 0.12.0 — 08/10/2026 (carriera da allenatore, telecronaca, editor di squadre)
- **Carriera da allenatore** (Competizioni → Carriera da allenatore): scegli una delle 8 squadre e guidala per più
  stagioni in un campionato a 8 con andata e ritorno. Rosa con età, forza, potenziale e valore; scegli titolari (i primi
  11, scambio con due clic) e formazione. **Mercato** con budget: giocatori delle altre squadre e svincolati, si compra e
  si vende (rosa da 16 a 23). **Fine stagione**: premio in base alla posizione, i giovani crescono fino al potenziale, dai
  30 anni si cala, dai 34 ci si ritira e arriva un ragazzo del vivaio; mercato nuovo e calendario nuovo. Le rose stanno
  su questo computer; il campionato è una competizione normale (si gioca con il motore o si simula, con le rose vere).
- **Telecronaca a scritte**: frasi brevi in basso durante la partita (gol, parate, pali, tiri, falli, cartellini...),
  nelle 4 lingue, si spegne in Impostazioni → Generale.
- **Editor di squadre** (Nuova partita → Le mie squadre): fino a 8 squadre tue con nome, sigla, colori, forza,
  formazione e giocatori; si usano nella partita rapida.
- Test: lingue_test (anche le frasi della telecronaca), motore_test; prove nel browser di carriera ed editor.

## 0.11.0 — 08/10/2026 (cambi, finta, mirino)
- **Sostituzioni**: nel menu di pausa, sezione «Cambi»: scegli chi esce (con la barra dell'energia) e chi entra dalla
  panchina; fino a 5 cambi, il cambio avviene alla prossima palla ferma (un portiere solo con un portiere). Anche l'IA
  cambia i più stanchi dal 58' (al massimo 3). Solo nella partita rapida e nelle competizioni.
- **Finta / dribbling** (U, sul controller L3): scarto di lato per saltare l'uomo, verso la direzione o lontano
  dall'avversario; per mezzo secondo i contrasti riescono meno (di più con un buon dribbling o «Dribblatore»). Costa
  energia, si rifà dopo poco più di un secondo. Solo per chi gioca: l'IA non la usa.
- **Mirino su punizioni e rigori**: con la direzione si sposta un anello sulla porta (di lato e in altezza), poi si
  carica e si rilascia il tiro. La barriera sulle punizioni vicine c'era già.
- **Server**: le partite del server non cambiano (stesso seme, stesso risultato: controllato in motore_test), ma
  l'impronta del motore sì, perché i file 08 sono cambiati. Serve `npm run deploy` nella cartella cloud, altrimenti il
  gioco nuovo dice «altro motore» e non mostra le partite del server in 3D.
- Test: motore_test (20, nel `npm test`), con le partite tra IA confrontate con la 0.10.0.

## 0.10.0 — 08/10/2026 (lingue: inglese, tedesco, francese)
- **Quattro lingue**: italiano, English, Deutsch, Français. Si sceglie in Impostazioni → **Generale** (scheda nuova, la
  prima) → Lingua; il cambio è immediato, anche sulle schermate già aperte, e la scelta resta nelle impostazioni
  (`lang`, predefinita italiano). Numeri e date seguono la lingua (1'000 in tedesco svizzero, 1 000 in francese).
- Tradotto tutto quello che si vede: menu, impostazioni, comandi, scritte della partita e dell'arbitro, multiplayer e
  rete locale, partite del server e scommesse (anche i mercati), negozio e oggetti, profilo, competizioni e sfide tra
  amici, pannello Amici, messaggi di errore del server.
- Come funziona: il codice resta in italiano. `src/00_i18n.js` guarda le scritte della pagina e le sostituisce con la
  traduzione (righe `[italiano, inglese, tedesco, francese]` in `src/lingue/*.js`); le frasi con valori usano `{0}`,
  `{t0}` (valore da tradurre) e `{#0}` (solo numeri). Così si traducono anche le frasi della simulazione e del server
  senza toccarli: **motore e server non cambiano** (stessa impronta del motore, nessun deploy). Le frasi composte più
  complicate (competizioni) usano `trf()` direttamente nel codice. I nomi di squadre e giocatori non si traducono mai.
- Test: lingue_test (18, nel `npm test`); browser, comandi, competizioni, sensazioni ed economia invariati e superati;
  prove con le competizioni in tedesco e con l'economia in francese senza scritte italiane rimaste.

## 0.9.2 — 06/10/2026 (inviti alle partite online, diagnosi del ritardo)
- **Gioca con un amico in un clic**: nel pannello Amici, «Gioca» accanto a un amico apre una partita online e gli manda
  l'invito; lui lo trova in «Richieste e inviti» (pallino e avviso anche a pannello chiuso) e preme «Entra»: niente codice
  da passarsi. È un 1 contro 1 con le squadre complete da 11 (gli altri calciatori li guida l'IA, ognuno controlla il
  suo e cambia giocatore come sempre). Nella lobby di ogni partita online c'è «Invita amici»; nelle sfide tra amici
  c'è «Amichevole» accanto a ogni partecipante. Inviti sul server (migrazione 0007), validi 15 minuti, solo tra amici.
- **Da dove viene il ritardo**: nella lobby, per ognuno, ping verso l'host e (tra parentesi) verso il server; per l'host
  il suo ping al server e i suoi fotogrammi al secondo. Un avviso dice la causa probabile (computer dell'host lento, rete
  con filtri o proxy, connessione dell'host) e cosa fare. In partita l'indicatore mostra gli stessi numeri.
  Misura sul relay del server: 17 ms verso il server e 31-33 ms dal client all'host e ritorno, anche con il traffico di
  una partita (il relay non aggiunge ritardo); con 300 ms il ritardo nasce prima, nella rete o nel computer dell'host.
- Pannello Amici: aggiornamento ogni 30 secondi nella Home (anche chiuso, per gli inviti); account nascosti dalla 0.9.1.
- Test: friends_test 74, social_browser_test 30, online 20, rete 87.

## 0.9.1 — 06/10/2026 (solo server: account nascosti)
- L'account **admin** è nascosto: non compare tra i giocatori, nella ricerca, tra gli amici, negli inviti, nel profilo
  pubblico, nel feed, nelle classifiche e nei premi di stagione; non può chiedere né ricevere amicizie. Gioca normalmente.
- Migrazione 0006: colonna `users.hidden`; toglie le amicizie e le richieste dell'account nascosto, elimina le sue sfide
  e lo toglie da quelle degli altri (la sua squadra passa all'IA, il turno si completa da solo). Un nuovo account
  "admin" nasce già nascosto.
- Solo il server cambia: `npm run deploy` nella cartella cloud, il gioco 0.9.0 resta valido. Test: friends_test 67.

## 0.9.0 — 06/10/2026 (amici e sfide tra amici)
- **Pannello Amici** nella Home, a destra a metà schermo (si chiude in una linguetta; su schermi stretti va in basso):
  tutti i giocatori iscritti dal server con ricerca per nome, richieste di amicizia (accetta, rifiuta, annulla, togli),
  amici, inviti alle sfide e le tue sfide in corso. Pallino rosso con le richieste e gli inviti in attesa. Degli altri si
  vede solo il nome pubblico. Si aggiorna all'apertura, al ritorno nella Home e ogni 45 secondi solo se è aperto.
- **Sfide tra amici**: «Sfida» accanto a un amico (o «Nuova sfida») crea un campionato, un torneo o una coppa con le
  stesse opzioni delle competizioni (squadre, andata e ritorno, gironi, supplementari, rigori, durata, IA) e invita gli
  amici. Ognuno accetta scegliendo una squadra libera; le altre le guida l'IA. Chi l'ha creata la avvia, può invitare
  altri amici prima dell'inizio, simulare una partita bloccata, avviare la nuova stagione o eliminarla; gli altri possono
  lasciarla (la loro squadra passa all'IA). Anche nel menu Competizioni, sezione «Con gli amici».
- **Partite**: contro l'IA si gioca con il motore vero (risultato al server da solo; uscita a metà = resto simulato;
  partita iniziata e mai finita = simulazione). Tra due amici si gioca online: uno apre la stanza dalla competizione,
  l'altro entra con un clic (codice comunicato dal server), squadre e lati fissati; a fine partita il gioco di ognuno
  manda il risultato e vale solo se coincide (o se entrambi chiedono la simulazione). Nell'eliminazione diretta una
  parità tra amici va a supplementari e rigori della simulazione ufficiale. Partite tra squadre dell'IA simulate dal server.
- **Tutto sul server**: stato, calendario e risultati delle sfide stanno nel database (migrazione 0005); nessuna richiesta
  permette di scrivere un risultato a mano; controlli su squadre, turno, regole (supplementari e rigori solo se previsti)
  e modifiche contemporanee (una partita si registra una volta sola).
- **Un solo sistema di regole**: l'avanzamento delle competizioni (calendario, tabellone, gironi, risultati) è passato da
  Career a `cloud/src/complogic.js`, usato identico dal gioco e dal server; le 24 squadre in più stanno in
  `src/18_squadre.js`, incluse anche nel server (`npm run engine` genera `cloud/src/teams.gen.json`).
- **Release**: solo Windows e Mac (le macchine Linux di GitHub restavano in coda); su Linux `npm run dist:linux`.
- Test: cloud/test/friends_test.js (60, server vero), tests/social_browser_test.py (23, due giocatori nel browser,
  partita contro l'IA e partita online tra amici), competizioni 32, regressioni invariate.

## 0.8.0 — 05/10/2026 (competizioni, reattività, personaggi)
- **Competizioni** (menu Competizioni, al posto di "In costruzione"): Campionato all'italiana (6-20 squadre, andata o
  andata e ritorno, giornate, classifica con scontri diretti, forma, serie, porte inviolate, % vittorie, statistiche,
  marcatori, fine stagione con campione, miglior attacco e difesa, capocannoniere, nuova stagione con storico), Torneo
  (8/16/32, sedicesimi → finale) e Coppe configurabili (nome, squadre, gironi + eliminazione, andata e ritorno con finale
  secca, supplementari, rigori o ripetizione; modelli pronti). 32 squadre: le 8 del server più 24 nuove, tutte originali.
- **Partite vere**: Gioca usa il motore della partita; il risultato torna da solo nella competizione e la giornata si
  completa con la simulazione ufficiale. Supplementari e rigori sono nel motore (KnockoutMatch): rigori con rincorsa,
  tiro caricato e tuffo del portiere, anche col giocatore. Il risultato non si modifica né si rilancia: niente
  Ricomincia/Rivincita, uscita a metà = resto simulato dal punteggio, gioco chiuso a metà = partita simulata al riavvio.
- **Simulazione**: forza dalle rose vere (attacco, difesa, portiere), forma delle ultime 5, fattore campo, casualità con
  seme per partita (sempre lo stesso risultato). La più forte vince più spesso ma non sempre.
- **Serie del server**: le partite delle scommesse formano un campionato con giornate e classifica ufficiale (solo partite
  finite), marcatori, stagioni; etichetta della giornata su ogni partita. Liquidazione invariata, tutta sul server.
- **Salvataggi**: carriera sul computer e, con l'account, sul server (vince la copia più recente, nessun aggiornamento
  continuo). Migrazione 0004.
- **Reattività**: movimento dei calciatori guidati da una persona riscritto (primo passo in 67 ms, inversione 0,30 s invece
  di 0,63, curva di 90° 0,28 s invece di 0,60, frenata 0,30 s, scatto progressivo, curve più larghe in scatto, corpo che
  gira subito); buffer di 0,2 s per passaggio, lancio, filtrante e tiro premuti un istante prima di ricevere (prima
  andavano persi); carica del tiro visibile subito; anello che si allarga al cambio giocatore; piccoli colpi di
  telecamera sui tuoi tiri potenti e contrasti duri. L'IA e le partite del server non cambiano comportamento.
- **Online**: predizione del proprio calciatore sul client (risponde subito, corretto da ogni istantanea dell'host:
  scarto 3 cm da fermo), palla ai piedi in conduzione, gesto del calcio immediato.
- **Menu**: ogni pulsante si abbassa e suona alla pressione (non al rilascio).
- **Personaggi**: scheletro con bacino, busto e testa separati, proporzioni da atleta (anca 0,92 m, spalle ~46 cm),
  polpacci, scarpe con tallone, colletto e bordi; corsa con spalle contro anche e ginocchio alto in scatto, frenata
  accovacciata, respiro e sguardo da fermo, calcio con rotazione del busto, contrasto in piedi distinto dalla scivolata,
  colpo di testa con stacco, caduta con le braccia avanti, quattro esultanze.
- Test: competizioni 27 + 32, supplementari e rigori 16, reattività 12, API 124, nel browser competizioni 26,
  reattività 10, online 20, economia 65.

## 0.7.1 — 05/10/2026 (nomi delle squadre)
- Nuova partita: il nome della squadra di casa non si vedeva. Causa: due elementi con lo stesso id ("home-name"), il
  nome del giocatore nella Home e quello della squadra; il gioco scriveva nel primo. Ora la Home usa "home-user-name".
- Nomi delle squadre personalizzabili: si scrivono direttamente nella scheda della squadra (vuoto = nome originale),
  restano salvati sul computer per quella squadra; la sigla del tabellone viene dal nome (es. "I Leoni" → ILE).
- Online: l'host scrive i nomi nella lobby, tutti li vedono nella lobby e in partita. I nomi ricevuti dalla rete sono
  ripuliti (testo semplice, niente < >, al massimo 24 caratteri); la squadra del database non cambia.
- App desktop: alla chiusura della finestra (e prima di uscire) impostazioni e accesso vengono scritti subito su
  disco. Nuovo test sull'app vera (tests/electron_persist_test.py): modifica e chiusura immediata, 5 riavvii.
- Test: rete 87 (nomi ostili), gioco nel browser 31, online 18, app desktop con riavvii 9.

## 0.7.0 — 05/10/2026 (multiple vere, Home nuova, transizioni, giocatori, risoluzione)
- Multiple vere: più selezioni della stessa partita se compatibili, fino a 20 selezioni. Motore unico in
  cloud/src/betlogic.js (lo stesso nel server e nel gioco): ogni mercato è una condizione sui fatti della partita, la
  compatibilità si controlla provando gli esiti possibili per gruppi indipendenti (niente liste di casi). Selezione
  incompatibile: non entra, si vede quale la blocca, "Sostituisci" o "Annulla"; quelle incompatibili sono smorzate.
- Quote: quota base = prodotto; nella stessa partita la quota collegata dalla probabilità congiunta del modello (mai
  sopra il prodotto); bonus multipla a soglie configurabili (5 → +5%, 10 → +10%, 15 → +15%, 20 → +25%); vincita
  massima. Tutto calcolato dal server; il gioco mostra subito una stima con le stesse regole.
- Liquidazione: VOID tolta dal prodotto e bonus ricalcolato; liquidazione con le stesse regole del controllo.
  Migrazione 0003 (quota base, bonus, quota effettiva delle selezioni, preferenze).
- "La mia schedina": selezioni raggruppate per partita, quota collegata, bonus e soglia successiva, vincita possibile.
  Se una quota cambia (alla conferma o mentre la schedina è aperta) si vede "Quota cambiata" con la quota originale e
  la nuova, e un clic arrivato subito dopo non gioca: si conferma solo dopo aver visto la quota nuova.
- Home ridisegnata: GIOCA in primo piano, sezioni (Guarda partita, Multiplayer, Scommesse, Shop, Personalizzazione),
  scheda del giocatore con avatar, nome e coin, menu (Impostazioni, Controlli, Audio, Grafica, Account).
- Transizioni: due @keyframes con lo stesso nome ("slidein") si sovrascrivevano e i pannelli partivano spostati di
  metà larghezza, poi saltavano al centro; idem l'avviso in basso. Ora un solo sistema con nomi unici: dissolvenza e
  micro-movimento di 6 px, la schermata nasce al suo posto.
- Giocatori: busto e pantaloncini sagomati, testa ovale con collo, orecchie, naso e occhi, spalle, maniche, mani,
  calzettoni e scarpe con la punta; corsa con inerzia (inclinazione in accelerazione e in curva, gomiti nello scatto),
  respiro da fermo, tiro in tre tempi, scivolata più credibile.
- Impostazioni → Grafica: risoluzione di disegno (nativa o fissa da 1280×720 a 3840×2160) e, nell'app desktop,
  dimensione della finestra.
- Comandi: salto del replay con l'azione Passaggio (niente tasti fissi); comandi personalizzati salvati anche
  sull'account (vince la modifica più recente).
- Test: schedine 68, API 114, relay 22, gioco nel browser con multipla della stessa partita, conflitti, transizioni,
  comandi sull'account.

## 0.6.1 — 05/10/2026 (partite online via internet, stesso indirizzo per tutti)
- Relay delle partite online nel Worker dell'economia: tutti si collegano a `wss://…workers.dev/relay` e il codice
  sceglie la partita. Ogni partita è un Durable Object a sé (più partite insieme, separate), stesso protocollo di
  server/relay.js; il codice viaggia anche nell'indirizzo (`?code=`, `?op=create`) così il Worker trova subito la stanza.
- Nel gioco "Crea partita online" usa questo server senza impostare niente (Impostazioni → Online → Server online vuoto =
  predefinito); nell'app desktop resta "Crea in rete locale".
- Il relay risponde alla chiusura del socket: senza risposta il rientro automatico di un giocatore caduto partiva tardi.
- Server: le partite del server si creano anche se il cron di Cloudflare è in ritardo (al massimo una volta al minuto).
- Impronta del motore indipendente dagli a capo (CRLF su Windows).
- Test: relay nel Worker (22: 5 giocatori nella stessa partita, una seconda partita in contemporanea, errori, caduta e
  rientro, uscita dell'host), test nel browser con il relay del Worker.

## 0.6.0 — 05/10/2026 (account, monete, scommesse, social, negozio)
- Server dell'economia in `cloud/` (Cloudflare Worker + database D1 + Durable Object), vedi docs/ECONOMIA.md. Il database
  è l'autorità: saldo, quote, risultati, vincite, oggetti e prezzi si decidono lì; il gioco mostra e chiede.
- Account con nome utente e password (PBKDF2-SHA256, mai in chiaro), sessione con token (sul computer solo il token).
  Portafoglio con vincolo di saldo non negativo e registro dei movimenti con riferimento unico (niente doppioni).
- Partite del server ogni 10 minuti, calcolate con il motore del gioco (stessi file, `node build.js engine`; nessuna
  seconda simulazione). Seme segreto fino al calcio d'inizio, scommesse chiuse 10 s prima, eventi rivelati solo quando
  avvengono, liquidazione automatica dai fatti della partita.
- Motore: generatore casuale per partita (Match opts.rng), istante reale negli eventi, eventi SHOT e SHOT_ON_TARGET;
  "Guarda partita" rigioca in 3D la partita del server allineata al suo orologio, con controllo dei gol: se il gioco va
  diversamente la visione si ferma e vale il server. Impronta del motore (ENGINE_ID) uguale in gioco e server.
- 25 mercati (1X2, doppia chance, primo tempo, handicap, risultato esatto, gol, entrambe segnano, gol per tempo, primo e
  ultimo gol, porta inviolata, corner, primo corner, cartellini, primo cartellino, espulsione, rigore, tiri, tiri in porta,
  possesso) con quote da una calibrazione Monte Carlo del motore; singole e multiple fino a 10 partite; quota ricontrollata
  alla conferma ("Quota cambiata").
- Social: scommesse dei giocatori (solo pubbliche, nessun dato privato), "Copia scommessa" che riempie la schedina senza
  giocare, codici BET-XXXXX, reazioni, più giocate, statistiche, classifiche per bravura (mai per saldo) con periodi,
  privacy "Mostra pubblicamente le mie scommesse". Aggiornamento leggero (6-20 s, solo le novità, solo a schermata aperta).
- Negozio con 30 oggetti in 7 categorie e rarità, inventario, personaggio (numero e nome di maglia), anteprime disegnate;
  in partita il tuo attaccante ha il tuo aspetto, e online gli altri lo leggono dal server.
- Ricompense: monete di benvenuto, bonus giornaliero con serie (doppio nel fine settimana), premio spettatore, 7 obiettivi,
  premi di stagione.
- Menu: saldo, Partite, Scommesse, Negozio, Personaggio, Inventario, Profilo; "Guarda partita" apre le partite del server
  (la partita libera tra IA resta nella stessa schermata). Impostazioni → Online → Server dell'economia.
- App desktop: la politica di sicurezza permette HTTPS verso il server dell'economia. Release: variabile CAMPO_API_URL.
- Test: mercati (21), API contro il server vero in locale (100: sicurezza, 20 test social, saldi persistenti anche dopo il
  riavvio del server, liquidazione), gioco nel browser con due giocatori (45), app desktop Electron con il server (6).

## 0.5.0 — 05/10/2026 (arbitro vero, fisica più credibile, grafica)
- Arbitro (nuovo src/08_referee.js). Prima il fallo era un numero casuale: probabilità di base più scivolata più "da dietro",
  senza guardare chi prende il pallone; inseguendo il portatore oltre metà dei contrasti diventava fallo. Ora
  analyzeChallenge ricostruisce la dinamica (linea dell'intervento, pallone raggiungibile o coperto dal corpo, chi lo tocca
  per primo, contatto e punto di contatto, direzione, velocità di impatto, contesto) e evaluateChallenge decide:
  contatto da solo mai fallo, pallone preso per primo regolare salvo forza eccessiva, gambe senza pallone fallo,
  imprudente giallo, grave fallo di gioco rosso, fallo tattico giallo, occasione da rete negata rosso (giallo in area).
- Vantaggio (con ritorno al fallo se non si concretizza entro 2.5 s), cartellini al fischio, doppio giallo, espulsione
  (l'espulso esce dal campo, la squadra gioca in dieci, portiere sostituito da un difensore), rigori solo per falli veri.
- Fuorigioco anche sulle ribattute dei tiri; parate e deviazioni non lo annullano.
- Registro centrale degli eventi (timeline): GOAL, FOUL, YELLOW_CARD, SECOND_YELLOW, RED_CARD, PENALTY, FREE_KICK, CORNER,
  OFFSIDE, THROW_IN, GOAL_KICK, ADVANTAGE, KICK_OFF, HALF_TIME, FULL_TIME, con tempo, giocatori, squadra, posizione, motivo,
  gravità e conseguenza.
- IA: contrasta solo quando può arrivare al pallone, si affianca se è alle spalle, va in pressione chi è tra il portatore e
  la porta; ogni tanto sbaglia valutazione (più spesso i difensori aggressivi) e in situazioni pericolose prova la
  scivolata di recupero.
- Fisica: resistenza dell'aria quadratica, effetto Magnus laterale e verticale, rimbalzo dipendente dall'impatto, volo dei
  calci calcolato con la fisica vera; tiro rasoterra, normale, potente, a giro (pressing + tiro); passaggio teso
  (pressing + passaggio), filtrante nello spazio davanti alla corsa, filtrante alto (pressing + filtrante); primo controllo
  lungo; conduzione più larga in sprint; accelerazione progressiva e frenata più rapida; urti tra giocatori con massa;
  pallone che rimbalza sul corpo di chi non lo può giocare. Parate ritarate sulle velocità d'arrivo (gol medi invariati).
- Grafica: trama dell'erba nello shader del campo, ombre morbide di contatto per giocatori e pallone, rete che si gonfia al
  gol, caduta dopo un fallo, scia dei tiri potenti, erba e polvere sui contrasti, vignettatura, luce un po' più contrastata.
  Scritte dell'arbitro in una striscia sotto il tabellone (fallo, giallo, rosso, vantaggio, fuorigioco, rigore), espulsioni e
  vantaggio nel tabellone, cartellini nel riepilogo finale.
- Rete: istantanea con 14 valori per calciatore (cartellini, espulsione, caduta), sempre tutti i 22; eventi dell'arbitro
  inoltrati e ripuliti; il registro degli eventi del client è quello dell'host. Versione 0.5.0: tutti la stessa.
- Test: nuovo referee_test (54: i 10 casi dell'arbitro con 100-200 prove ciascuno, fuorigioco, eventi, fisica), net_test 83
  (+5, TEST 10 in multiplayer).

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
