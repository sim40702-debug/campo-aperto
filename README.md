[![JavaScript](https://img.shields.io/badge/Language-JavaScript-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Language-Python-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%20|%2024%20|%2026-green.svg)](https://nodejs.org/)

# Campo Aperto

**Calcio 3D originale, undici contro undici.** Si gioca nel browser o come app desktop su Windows, macOS e Linux: contro l'IA, con gli amici in rete locale oppure online tramite il tuo server.

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

Le release pubblicano solo Windows e macOS. Su Linux si compila in locale con `npm run dist:linux` (`.AppImage` e
`.deb` in `release/<versione>/`), oppure si gioca dal sorgente con `npm start`.

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

Nelle **punizioni e nei rigori** si mira con la direzione: un anello sulla porta mostra dove va il tiro (di lato e in alto), poi si carica e si rilascia il tiro.
Nel **menu di pausa** si fanno i cambi (fino a 5): scegli chi esce e chi entra, il cambio avviene alla prossima palla ferma.

Ogni tasto si può rimappare in **Impostazioni → Controlli**. Nell'app desktop **F11** attiva lo schermo intero.

## Modalità

- **Partita rapida** contro l'IA, anche con le tue squadre (Nuova partita → Le mie squadre).
- **Competizioni**: campionato, torneo, coppe, e la **carriera da allenatore** con più stagioni, mercato e giovani che crescono.
- **Multiplayer** online o in rete locale, **partite del server** con le scommesse.

## Lingue

Il gioco è in **italiano, inglese, tedesco e francese**: si sceglie in **Impostazioni → Generale → Lingua** e
cambia subito, senza riavviare. La scelta resta salvata sul computer.

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
npm test     # regole, partite simulate e online
npm start    # apre il gioco in una finestra desktop
```

### Compilare l'app

| Comando | Output in `release/<versione>/` |
|---|---|
| `npm run dist:win` | Installer `.exe` + portable |
| `npm run dist:mac` | `.dmg` e `.zip` per Intel e Apple Silicon |
| `npm run dist:linux` | `.AppImage` e `.deb` (solo in locale, non nelle release) |

Per compilare Windows e macOS insieme con GitHub Actions basta pubblicare un tag:

```bash
git tag v0.4.2 && git push --tags
```

Dopo qualche minuto i file compaiono in **Releases**, dentro una release in bozza.

### Struttura

```
src/       codice del gioco (simulazione, grafica, audio, input, rete, account ed economia)
server/    server lobby/relay per l'online
cloud/     server dell'economia (Cloudflare Worker + D1 + Durable Object), con migrazioni e test
desktop/   app Electron
tests/     test automatici
docs/      roadmap, changelog, guida dell'economia
```

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
python3 tests/controls_browser_test.py   # controller simulato, comandi, rimappatura
python3 tests/online_browser_test.py     # due giocatori online con il server relay
python3 tests/economy_browser_test.py    # account, scommesse, social, negozio, partite del server (serve cloud/: npm install)
python3 tests/competitions_browser_test.py  # campionato, torneo con supplementari e rigori, coppa con gironi
python3 tests/feel_browser_test.py       # reattività: tasti al fotogramma dopo, pulsanti, cambio schermata
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
