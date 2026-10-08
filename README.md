[![JavaScript](https://img.shields.io/badge/Language-JavaScript-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Language-Python-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20|%2024%20|%2026-green.svg)](https://nodejs.org/)

# Campo Aperto

**Calcio 3D originale, undici contro undici.** Si gioca nel browser o come app desktop su Windows, macOS e Linux: contro l'IA, con gli amici in rete locale oppure online, in competizioni o in una carriera da allenatore di più stagioni.

In italiano, inglese, tedesco e francese.

### Le novità (0.10 – 0.14)

- **Allenamento** (0.14): tiri, punizioni con la barriera, rigori, dribbling e passaggi, con sfide a punti e record.
- **Meteo e ora del giorno** (0.14): sereno, pioggia o neve, di giorno, al tramonto o di sera. Con la pioggia la palla
  scivola, con la neve frena e rimbalza poco.
- **Fine partita più ricca** (0.14): possesso per tempo, parate, precisione dei passaggi, **migliore in campo** con i
  voti e le **azioni migliori** da rivedere (gol, pali, parate, occasioni).
- **Aspetto dei giocatori** delle tue squadre (0.14): pelle, capelli, scarpe e stile di maglia comprati nello Shop.
- **Avvio a schermo intero** e **controllo dei server** all'avvio: se non rispondono si può giocare offline (0.14).
- **Aggiornamenti automatici** (0.13): l'app desktop avvisa quando c'è una versione nuova e si aggiorna da sola.
- **Lingue**: italiano, English, Deutsch, Français, da Impostazioni → Generale.
- **Telecronaca** scritta e **a voce**, nella lingua del gioco (si sceglie prima della partita, in pausa o nelle impostazioni).
- **Cambi** durante la partita dal menu di pausa, **finta** per saltare l'uomo, **mirino** su punizioni e rigori.
- **Le mie squadre**: crea la tua squadra con nome, colori, forza e giocatori.
- **Carriera da allenatore**: più stagioni, mercato con budget, giovani che crescono e ragazzi del vivaio.
- **App per Linux** nelle release (`.AppImage` e `.deb`).

---

## Installazione

Scarica l'ultima versione dalla pagina **[Releases](../../releases)**.

### Windows

- **Installer:** apri `CampoAperto-<versione>-win-x64.exe` e segui la procedura. Crea anche il collegamento sul desktop.
- **Portable:** `CampoAperto-<versione>-portable.exe` parte subito, senza installazione.

Se compare SmartScreen *"Windows ha protetto il PC"*, scegli **Ulteriori informazioni → Esegui comunque**.

### macOS

1. Scarica il `.dmg` giusto per il tuo Mac: `arm64` per Apple Silicon (M1, M2…), `x64` per Intel.
2. Aprilo e trascina **Campo Aperto** in **Applicazioni**.
3. Al primo avvio fai **clic destro sull'app → Apri → Apri**.

Se macOS dice che l'app è danneggiata, apri il Terminale ed esegui:

```bash
xattr -cr "/Applications/Campo Aperto.app"
```

### Linux

- **AppImage** (tutte le distribuzioni): scarica `CampoAperto-<versione>-linux-x86_64.AppImage`, rendilo eseguibile e
  aprilo:

  ```bash
  chmod +x CampoAperto-*-linux-x86_64.AppImage
  ./CampoAperto-*-linux-x86_64.AppImage
  ```

  Se non parte, su Ubuntu 22.04 e successive serve la libreria FUSE: `sudo apt install libfuse2`.
- **Pacchetto .deb** (Ubuntu, Debian, Linux Mint): installalo con

  ```bash
  sudo apt install ./CampoAperto-*-linux-amd64.deb
  ```

  e lo trovi tra le applicazioni come **Campo Aperto**. Per toglierlo: `sudo apt remove campo-aperto`.

Per la partita in rete locale il firewall (per esempio `ufw`) deve lasciar passare la porta TCP 8787 e la UDP 8788.

### Aggiornamenti

Dalla versione 0.13 non serve più tornare qui per ogni versione nuova. All'avvio (e poi ogni 6 ore) l'app controlla le
Releases di GitHub; se c'è una versione più recente compare in alto a destra **● Nuovo aggiornamento disponibile**.
Cliccando si vedono la versione installata, quella nuova e le novità: **Aggiorna ora** scarica il file giusto per il tuo
sistema (con percentuale e MB), lo controlla, chiude il gioco, lo installa e lo riapre. Si può anche controllare a mano da
Impostazioni → Generale → Aggiornamenti.

- **Windows:** funziona con l'installer e con la versione portable (la portable deve stare in una cartella dove puoi scrivere).
- **macOS:** l'app deve stare nella cartella **Applicazioni** (non aperta dal disco `.dmg`).
- **Linux:** `.AppImage` si sostituisce da solo; con il `.deb` il sistema chiede la password per installare.

Il file scaricato si installa solo se è identico a quello della release (impronta sha512) e mai se è una versione più
vecchia; se il download non riesce il gioco resta com'era. La versione 0.12 non ha ancora questa funzione: la 0.13 va
scaricata a mano un'ultima volta.

---

## Comandi di gioco

| Azione | Tastiera | Controller (Xbox) |
|---|---|---|
| Movimento | WASD / frecce | Levetta sinistra / croce |
| Scatto | Shift | RT |
| Passaggio / contrasto | J (clic sinistro) | A |
| Tiro caricato / scivolata | K (clic destro) | B |
| Lancio / cross | L | X |
| Filtrante | I | Y |
| Cambio giocatore | Q / Tab | LB |
| Pressing | E (tieni premuto) | RB |
| Finta / dribbling | U | L3 (premi la levetta) |
| Tiro a giro / passaggio teso / filtrante alto | E + K / J / I | RB + B / A / Y |
| Pausa | Esc / P | Menu |
| Telecamera | C | View |
| Audio on/off | M | — |
| Guida comandi | F1 / H | — |

Ogni tasto si può rimappare in **Impostazioni → Controlli**. Nell'app desktop **F11** attiva lo schermo intero.

### In partita

- **Finta**: con la palla, U (o L3) fa uno scarto di lato verso la direzione scelta, oppure lontano dall'avversario
  più vicino. Per mezzo secondo i contrasti riescono meno, di più con un buon dribbling o con la caratteristica
  «Dribblatore». Costa un po' di energia e si rifà dopo circa un secondo.
- **Punizioni e rigori**: con la direzione si sposta un **anello giallo sulla porta** (di lato e in alto), poi si tiene
  premuto il tiro per caricarlo e si rilascia. Sulle punizioni vicine alla porta c'è la barriera.
- **Cambi**: nel **menu di pausa** (Esc) c'è la sezione **Cambi**. Scegli chi esce (vedi la sua energia) e chi entra
  dalla panchina, fino a 5 cambi; il cambio avviene alla prossima palla ferma. Un portiere si cambia solo con un
  portiere. Anche l'IA cambia i giocatori più stanchi dal 58'. I cambi ci sono nella partita rapida e nelle competizioni.
- **Telecronaca**: frasi brevi in basso («Gran parata!», «Giallo per…», «Rete di…») e, se vuoi, anche **a voce** con la
  sintesi vocale del computer, nella lingua del gioco. Si sceglie **Spenta / Solo scritte / Scritte e voce** in Nuova
  partita, nel menu di pausa o in Impostazioni → Generale. La voce segue il volume generale e il tasto M.

## Modalità

- **Partita rapida** contro l'IA (o IA contro IA da guardare), con le 8 squadre del gioco o con le tue. Prima del fischio
  scegli anche **meteo** (sereno, pioggia, neve, a caso) e **ora** (giorno, tramonto, sera).
- **Allenamento** (nella home, accanto a Gioca): cinque esercizi con un obiettivo da superare e il tuo record:
  - **Tiri in porta**: 10 tiri da fuori area contro il portiere (obiettivo 5 gol);
  - **Punizioni**: 10 punizioni con la barriera, con il mirino (obiettivo 3);
  - **Rigori**: 10 rigori (obiettivo 7);
  - **Dribbling**: 8 attacchi contro due difensori e il portiere (obiettivo 4);
  - **Passaggi**: tieni palla con tre compagni contro due difensori, passaggi riusciti in 60 secondi (obiettivo 15).
- **Competizioni**: campionato, torneo, coppe e la **carriera da allenatore**.
- **Multiplayer** online o in rete locale, fino a 8 persone.
- **Partite del server** da guardare in 3D, con scommesse in monete (serve un account).

## Fine partita

Oltre al risultato: possesso (anche per tempo), tiri e tiri in porta, parate, passaggi riusciti e precisione,
contrasti e dribbling, falli, cartellini, corner e fuorigioco. A destra il **migliore in campo** con il voto (da 4 a 10)
e i tre migliori di ogni squadra. **Rivedi le azioni migliori** fa rivedere al rallentatore fino a sei momenti della
partita (tutti i gol, poi pali, parate e grandi occasioni): **Prossima** passa alla successiva, Esc torna al resoconto.

## Avvio e gioco offline

L'app desktop si apre a **schermo intero** (si cambia in Impostazioni → Grafica → Avvio; F11 entra ed esce). Durante il
caricamento il gioco controlla se i **server** rispondono. Se non rispondono compare **Server non raggiungibile** con
**Gioca offline** e **Riprova**: offline funzionano partita rapida, allenamento, competizioni, carriera e le tue squadre;
account, monete, scommesse, shop e partite online tornano quando i server rispondono (pulsante **Offline · Riprova**
nella home).

## Lingue

Il gioco è in **italiano, inglese, tedesco e francese**: si sceglie in **Impostazioni → Generale → Lingua** e
cambia subito, senza riavviare. Anche numeri e date seguono la lingua. La scelta resta salvata sul computer.

## Le mie squadre

In **Nuova partita → Le mie squadre** crei fino a 8 squadre tue:

- nome, sigla del tabellone, allenatore, colori della maglia di casa e da trasferta (con l'anteprima);
- forza della squadra (da 50 a 92) e formazione;
- i 18 giocatori: nome, numero, caratteristica (Bomber, Regista, Muro…) e piede. **Nomi casuali** li rigenera;
- l'**aspetto**: la pelle la scegli tu (clic sul colore); **capelli**, **scarpe** e **stile di maglia** sono oggetti dello
  **Shop** e si possono usare solo se li hai comprati con il tuo account (**Vai allo Shop** salva la squadra e apre il
  negozio). Gli oggetti si ricordano sul computer per il tuo account: in partita si vedono anche senza internet.

Le squadre si salvano su questo computer e compaiono nella partita rapida, dopo quelle del gioco. Online e nelle
competizioni si usano solo le squadre del gioco, perché tutti devono avere le stesse.

**Arbitro:** il contatto da solo non è fallo. Se prendi prima il pallone il contrasto è regolare; da dietro, attraverso le gambe, è fallo; le scivolate imprudenti o violente portano giallo o rosso. C'è il vantaggio e il doppio giallo espelle. Dettagli su arbitro e fisica in [`docs/ARBITRO_E_FISICA.md`](docs/ARBITRO_E_FISICA.md).

---

## Multiplayer

### Via internet (da casa propria)

1. Chi ospita va su **Gioca online → Crea partita online** e riceve un codice di 6 caratteri.
2. Gli amici, ognuno da casa sua, aprono **Unisciti**, scrivono il codice e premono **Entra**.
3. Ognuno sceglie la squadra: fino a 8 persone, 4 per squadra; gli altri calciatori li muove l'IA.

Tutti si collegano allo stesso indirizzo (il server del gioco, `wss://…workers.dev/relay`): il codice sceglie la
partita, quindi si possono giocare più partite contemporaneamente. Non servono indirizzi IP, porte o impostazioni.
La partita la simula il computer di chi la crea: se lui esce, la partita finisce.

### Se la partita va a scatti

Nella lobby, accanto a ogni giocatore, c'è il ritardo verso l'host e (tra parentesi) verso il server; per l'host i suoi
fotogrammi al secondo. Sotto compare la causa probabile: computer dell'host lento (abbassate la grafica sull'host o fate
ospitare il PC più veloce), rete con filtri (scuola, ufficio: se siete nella stessa rete usate la partita in rete
locale), connessione dell'host.

### In rete locale

1. Nell'app desktop, chi ospita va su **Gioca online → Crea in rete locale** e riceve un codice che inizia con L.
2. Gli amici aprono **Unisciti**, scrivono il codice e premono **Entra**.
3. Ognuno sceglie la squadra: fino a 4 umani per squadra, gli altri li muove l'IA.

Non servono indirizzi IP né porte da aprire.

**Se non si collega:**
- **Ctrl+Maiusc+D** apre la diagnostica di rete.
- In **Unisciti → «La partita non viene trovata?»** scrivi l'indirizzo che compare nella lobby dell'host.
- **Windows:** consenti Campo Aperto nel firewall anche per le reti pubbliche.
- **macOS:** Impostazioni di Sistema → Privacy e sicurezza → Rete locale → attiva Campo Aperto.
- Reti ospiti, Wi-Fi pubblici e VPN spesso bloccano il collegamento tra dispositivi.

### Online con un tuo server (facoltativo)

Al posto del server predefinito puoi usare un relay tuo:

```bash
cd server
npm install --omit=dev
node relay.js --host 127.0.0.1 --port 8787
```

Metti davanti un reverse proxy HTTPS (nginx o Caddy) che inoltri `wss://calcio.tuodominio.ch` a `127.0.0.1:8787` con l'upgrade WebSocket. Poi nel gioco inserisci l'indirizzo in **Impostazioni → Online → Server online**.

## Competizioni: campionato, torneo, coppe

Dal menu **Competizioni**:

- **Carriera da allenatore**: vedi sotto.
- **Campionato**: da 6 a 20 squadre, solo andata o andata e ritorno. Calendario all'italiana generato da solo, classifica
  (punti, PG, V, N, P, GF, GS, DR, forma delle ultime 5, serie, porte inviolate, percentuale di vittorie), statistiche,
  marcatori e, a fine stagione, campione, miglior attacco e difesa, capocannoniere. **Nuova stagione** tiene lo storico.
- **Torneo**: 8, 16 o 32 squadre a eliminazione diretta (sedicesimi, ottavi, quarti, semifinali, finale) con supplementari
  e rigori.
- **Coppe**: modelli pronti (Coppa Nazionale, Coppa dei Campioni con gironi, Coppa Lampo, Coppa della Tradizione) o il tuo
  formato: gironi + eliminazione, andata e ritorno, supplementari sì/no, rigori sì/no (senza rigori una parità si ripete).

**Gioca** apre la partita vera; al fischio finale il risultato entra da solo nella competizione e le altre partite della
giornata si simulano. **Simula partita** usa la simulazione ufficiale (forza delle rose, forma, fattore campo): la stessa
partita dà sempre lo stesso risultato, quindi non si può "rilanciare". Uscire a metà simula il tempo che manca dal punteggio
attuale; se il gioco si chiude a metà partita, al riavvio la partita si completa con la simulazione.

## Carriera da allenatore

Da **Competizioni → Carriera da allenatore** scegli una delle 8 squadre e la guidi stagione dopo stagione, in un
campionato a 8 squadre con andata e ritorno.

- **Rosa**: età, forza, potenziale e valore di ogni giocatore. I primi 11 sono i titolari: clicca un giocatore e poi
  un altro per scambiarli. Scegli anche la formazione; un giocatore fuori ruolo è segnato in rosso. In porta va un portiere.
- **Mercato**: parti con 6 M di budget. Compri riserve e titolari delle altre squadre o giocatori svincolati, vendi i
  tuoi all'85% del valore. La rosa va da 16 a 23 giocatori. Il mercato si rinnova a ogni stagione.
- **Le partite**: **Vai al campionato** apre la competizione; ogni partita si gioca con il motore o si simula, sempre
  con le rose vere della carriera.
- **Fine stagione**: **Chiudi la stagione** dà il premio in base alla posizione (da 9 M per il primo a 2,5 M per
  l'ultimo). I giovani crescono fino al loro potenziale, dai 30 anni si cala e dai 34 ci si ritira: al posto di chi si
  ritira arriva un ragazzo del vivaio. Poi parte la stagione dopo, con calendario e mercato nuovi.
- **Storico**: posizione, punti, premio, chi è cresciuto e chi si è ritirato in ogni stagione.

La carriera si salva su questo computer.

## Amici e sfide tra amici

Con l'account, nella Home c'è il pannello **Amici** a destra (si chiude e riapre con la linguetta):

- **Tutti i giocatori**: chi è iscritto al server, con la ricerca per nome. **Aggiungi** manda la richiesta di amicizia;
  l'altro la trova in **Richieste e inviti** (pallino rosso sulla linguetta) e la accetta.
- **Gioca** accanto a un amico: partita online 1 contro 1, ognuno con la sua squadra da 11. L'amico riceve l'invito nel
  pannello e preme **Entra**. Nella lobby di qualunque partita online c'è anche **Invita amici**.
- **Sfida** accanto a un amico (o **Nuova sfida**): scegli campionato, torneo o coppa, le regole come nelle competizioni
  e la tua squadra, invita gli amici. Ognuno accetta scegliendo una squadra libera; le altre le guida l'IA.
  Quando ci siete, chi l'ha creata preme **Inizia la competizione**.
- **Giocare**: contro l'IA premi **Gioca** (o **Simula partita**); contro un amico premi **Gioca online**: si apre la
  stanza e l'amico, dalla sua competizione, preme **Entra nella partita**. A fine partita il risultato va al server da
  solo e vale quando lo mandate uguale tutti e due. Le partite tra squadre dell'IA le simula il server.

Le sfide stanno sul server: le ritrovi da qualunque computer e in **Competizioni → Con gli amici**.

## Monete, scommesse e negozio

Con un account (nome utente e password, dal menu: **Accedi**) hai un portafoglio di monete salvato sul server: lo ritrovi
uguale su ogni computer e browser. Dal menu:

- **Partite**: ogni 10 minuti una partita della **Serie del server**, il campionato del server (giornate e classifica in
  Competizioni). Scommetti fino a 10 secondi dal calcio
  d'inizio (1X2, gol, corner, cartellini, tiri, possesso e altri, singole o multiple), poi **Guarda partita**: il gioco la
  rigioca in 3D esattamente come l'ha calcolata il server, con la cronaca e le scommesse degli altri giocatori accanto.
- **Scommesse**: le tue in corso e concluse, quelle pubbliche degli altri (con **Copia scommessa**: la giocata parte solo
  quando confermi), i codici BET-XXXXX condivisi, la classifica dei migliori scommettitori e le statistiche del giorno.
- **Negozio**, **Personaggio**, **Inventario**: maglie, pantaloncini, calzettoni, scarpe, guanti, capelli e accessori per il
  tuo attaccante, con numero e nome di maglia. Online gli altri ti vedono vestito così.
- **Profilo**: saldo, movimenti, obiettivi, bonus giornaliero e la scelta "Mostra pubblicamente le mie scommesse".

Il server è un Worker Cloudflare con database D1 (`cloud/`): è lui a tenere i saldi e a decidere quote, risultati e
vincite, il gioco mostra soltanto. Come metterlo online sul tuo account, aggiornarlo e fare i backup:
[docs/ECONOMIA.md](docs/ECONOMIA.md).

---

## Sviluppo

Richiede **Node.js 22, 24 o 26**.

```bash
npm install
npm test     # lingue, motore, regole, arbitro, partite simulate, rigori, competizioni e online
npm start    # apre il gioco in una finestra desktop
```

### Compilare l'app

| Comando | Output in `release/<versione>/` |
|---|---|
| `npm run dist:win` | Installer `.exe` + portable |
| `npm run dist:mac` | `.dmg` e `.zip` per Intel e Apple Silicon |
| `npm run dist:linux` | `.AppImage` e `.deb` |

`npm run dist:win` prepara da solo lo strumento di electron-builder per l'icona del file `.exe` (winCodeSign): così
non serve più aprire PowerShell come amministratore né attivare la Modalità sviluppatore di Windows.

Per compilare Windows, macOS e Linux insieme con GitHub Actions basta pubblicare un tag con la versione di
`package.json`:

```bash
git tag v0.13.0 && git push --tags
```

Dopo qualche minuto i file dei tre sistemi compaiono in **Releases**, con le note prese dal
[CHANGELOG](docs/CHANGELOG.md). Se la macchina di un sistema resta in coda a lungo, annulla solo quel lavoro nella
scheda **Actions**: la release esce con gli altri e rilanciando il flusso più tardi si aggiungono i file mancanti.

Appena la release è pubblicata, le app già installate (dalla 0.13) la vedono da sole e propongono l'aggiornamento.
Il flusso pubblica anche i file `latest.yml`, `latest-mac.yml`, `latest-linux.yml` e `latest-portable.yml`: servono
all'app per scegliere il file giusto e controllarne l'impronta, quindi non vanno tolti dalla release.

Quando cambia il **motore della partita** (i file di `src/engine/`) o il codice di `cloud/`, il **server dell'economia si
aggiorna da solo** appena le modifiche arrivano nel `main` (flusso **Aggiorna il server** in Actions), perché le
partite del server si rigiocano nel gioco con lo stesso motore. Serve impostare una volta i segreti di Cloudflare
(vedi [docs/ECONOMIA.md](docs/ECONOMIA.md#aggiornare)). A mano si fa così:

```bash
cd cloud
npm run deploy
```

### Struttura

```
src/
  engine/    motore della partita (01..08 e le squadre in più): lo stesso codice gira nel gioco e nel server
  client/    grafica 3D, audio, comandi e rete del gioco
  game/      menu, impostazioni, account ed economia, competizioni, telecronaca, editor squadre, carriera
  i18n/      lingue: 00_i18n.js (il sistema) e un file per lingua (en.json, de.json, fr.json)
  shell.html la pagina in cui build.js inserisce tutto il codice
desktop/   app Electron (main.js; aggiornamenti.js controlla GitHub Releases e installa le versioni nuove)
scripts/   aiuti per build e app (sorgenti.js trova i file in src/, prepara-windows.js per npm run dist:win,
           latest-portable.js crea l'impronta della versione portable per gli aggiornamenti)
server/    server lobby/relay per l'online
cloud/     server dell'economia (Cloudflare Worker + D1 + Durable Object), con migrazioni e test
tests/     test automatici
docs/      roadmap, changelog, guida dell'economia
```

### Aggiungere una traduzione

Le frasi nel codice restano in italiano. C'è un file per lingua in `src/i18n/`: `en.json` (inglese), `de.json`
(tedesco) e `fr.json` (francese). Ogni file è diviso in sezioni (`generale`, `partita`, `telecronaca`…) e in ogni
sezione la frase italiana porta alla traduzione. Per tradurre una frase nuova aggiungila nella stessa sezione di
tutti e tre i file:

```json
"Gran parata!": "Great save!"            (en.json)
"Gran parata!": "Starke Parade!"         (de.json)
"Gran parata!": "Superbe arrêt !"        (fr.json)
```

Una frase con dei valori usa `{0}`, `{1}`… al posto dei valori, per esempio `"Giallo per {0}"`. Una frase senza
traduzione resta semplicemente in italiano. `node tests/lingue_test.js` controlla che i tre file abbiano le stesse
frasi e gli stessi segnaposto.

Per aggiungere una lingua nuova serve un altro file (per esempio `es.json`), poi la lingua va aggiunta in
`src/i18n/00_i18n.js` (`LANGUAGES`, `LANG_COLUMN` e le mappe di `I18N`) e nell'elenco delle lingue di `build.js`.

### Test nel browser e nell'app desktop

Servono Python e Playwright:

```bash
pip install playwright
playwright install chromium
```

Poi prepara la build di test e lancia i test:

```bash
npm run build:test
python3 tests/browser_test.py            # menu, partita, tastiera, impostazioni, risoluzioni
python3 tests/updates_browser_test.py    # avviso e schermata degli aggiornamenti (app desktop simulata)
python3 tests/controls_browser_test.py   # controller simulato, comandi, rimappatura
python3 tests/online_browser_test.py     # due giocatori online con il server relay
python3 tests/economy_browser_test.py    # account, scommesse, social, negozio, partite del server (serve cloud/: npm install)
python3 tests/competitions_browser_test.py  # campionato, torneo con supplementari e rigori, coppa con gironi
python3 tests/feel_browser_test.py       # reattività: tasti al fotogramma dopo, pulsanti, cambio schermata
python3 tests/social_browser_test.py     # amici, inviti e sfide tra amici (serve cloud/: npm install)
```

Per provare la vera app desktop:

```bash
npm run build:desktop
npx electron tests/electron_smoke.js
```

Con il server dell'economia in locale (serve `npm install` in `cloud/`):

```bash
npx electron tests/electron_economy_smoke.js
```

Su Linux senza schermo anteponi `xvfb-run` ai comandi Electron; se lavori come root aggiungi `--no-sandbox` dopo `electron`.

### Nota tecnica: Node.js 26

Electron 33 si installa con `extract-zip`, che usa `yauzl` 2.10. Con Node 26 questa versione si ferma dopo il primo file dell'archivio e non segnala nessun errore, quindi Electron resta installato solo in parte.

In `package.json` ci sono due impostazioni per evitarlo:

- `"overrides": { "yauzl": "3.4.0" }` fa usare a `extract-zip` una versione compatibile con Node 26. L'estrazione è identica a quella di `unzip`, link simbolici del Mac compresi.
- `"allowScripts"` autorizza lo script postinstall di Electron, come richiede npm 11.

In più `scripts/controlla-electron.js` parte da solo dopo `npm install` e prima di `npm start` / `npm run dist:*`. Se trova un'installazione di Electron a metà la cancella e la rifà, senza comandi a mano.
