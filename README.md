[![JavaScript](https://img.shields.io/badge/Language-JavaScript-yellow.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Python](https://img.shields.io/badge/Language-Python-blue.svg)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)

# Campo Aperto — come compilare l'app

Gioco di calcio 3D originale. Funziona nel browser e come app desktop (Electron) per Windows, Mac e Linux.

## Cosa serve
- Node.js 22, 24 o 26 (provato con 26.9.0 e npm 11.19.1). Il file `.nvmrc` indica 26.
- Per l'app Mac serve un Mac, per l'app Windows conviene un PC Windows (oppure GitHub Actions, vedi sotto).

## Compatibilità con Node.js 26
Electron 33 si installa con extract-zip, che usa yauzl 2.10: con Node 26 yauzl 2.10 si ferma dopo il primo
file dello zip senza errori. In `package.json` c'è `"overrides": { "yauzl": "3.4.0" }`, che fa usare a
extract-zip la versione 3.4.0, compatibile con Node 26 (estrazione verificata identica a `unzip`, link simbolici del Mac compresi).
`"allowScripts"` autorizza lo script postinstall di Electron, come chiede npm 11.

## Controllo automatico di Electron
`scripts/controlla-electron.js` parte da solo dopo `npm install` e prima di `npm start` / `npm run dist:*`.
Controlla la versione di Node.js e che Electron sia installato per intero; se trova un'installazione a metà
la cancella e la rifà da solo. Non serve lanciare comandi a mano.

## Primo avvio
```
npm install
npm test          # test delle regole, partite simulate e online
npm start         # apre il gioco in una finestra desktop
```

## Compilare l'app
| Comando | Risultato (cartella `release/<versione>/`) |
|---|---|
| `npm run dist:win` | installer `CampoAperto-<versione>-win-x64.exe` e versione portable |
| `npm run dist:mac` | `.dmg` e `.zip` per Mac Intel (x64) e Apple Silicon (arm64) |
| `npm run dist:linux` | `.AppImage` e `.deb` |

Altri comandi:
- `npm run build:web` crea `dist/index.html`, la versione da aprire nel browser.
- `npm run build:desktop` prepara solo i file dell'app in `desktop/app/` (three.js e font inclusi, funziona offline).

## Versioni
La versione è scritta una sola volta in `package.json` e compare nel menu del gioco e nel nome dei file compilati.
Per una nuova versione:
```
npm version patch   # 0.2.0 -> 0.2.1 (correzioni)
npm version minor   # 0.2.0 -> 0.3.0 (nuove funzioni)
```
Poi aggiungi una voce in `docs/CHANGELOG.md`.

## Test nel browser e nell'app
Servono Python con Playwright (`pip install playwright` e `playwright install chromium`):
```
npm run build:test
python3 tests/browser_test.py            # menu, partita, tastiera, impostazioni, risoluzioni
python3 tests/controls_browser_test.py   # controller simulato, menu, comandi, rimappatura
```
App desktop vera: `npm run build:desktop` e poi `npx electron tests/electron_smoke.js` (su Linux senza schermo con `xvfb-run`).

## Compilare tutto in automatico con GitHub
Il file `.github/workflows/release.yml` compila Windows, Mac e Linux insieme sui server di GitHub.
1. Metti il progetto in un repository GitHub.
2. Crea un tag di versione: `git tag v0.2.0` e `git push --tags` (oppure lancia il workflow a mano dalla scheda Actions).
3. Dopo qualche minuto trovi i file nella scheda Releases, in una release bozza.

## Avvisi al primo avvio (app non firmate)
L'app non ha una firma digitale (costa: Apple Developer 99 USD/anno, certificato Windows a parte).
- **Mac**: "impossibile verificare lo sviluppatore". Clic destro sull'app → Apri → Apri. Se dice che è danneggiata: `xattr -cr "/Applications/Campo Aperto.app"` nel Terminale.
- **Windows**: SmartScreen "Windows ha protetto il PC" → Ulteriori informazioni → Esegui comunque.

## Comandi
Elenco completo nel gioco: menu, Comandi (oppure F1 o H in partita).

| Azione | Tastiera | Controller (Xbox) |
|---|---|---|
| Movimento | WASD o frecce | levetta sinistra, croce |
| Scatto | Shift | RT |
| Passaggio / contrasto | J (clic sinistro) | A |
| Tiro caricato / scivolata | K (clic destro) | B |
| Lancio / cross | L | X |
| Filtrante | I | Y |
| Cambio giocatore | Q o Tab | LB, levetta destra per una direzione |
| Pressing (tieni premuto) | E | RB |
| Pausa | Esc o P | Menu |
| Telecamera | C | View |
| Audio sì/no | M | — |
| Comandi | F1 o H | — |

Nei menu: frecce o croce per spostarsi, Invio o A per confermare, Esc o B per tornare indietro.
Tutti i tasti e i pulsanti si cambiano in Impostazioni, scheda Controlli (lì anche vibrazione, zona morta, nomi PlayStation).
Nell'app desktop: F11 schermo intero, F12 strumenti di sviluppo.

## Giocare online

Chi crea la partita fa da host: la partita gira sul suo computer. Tutti si collegano a un piccolo
server "lobby" (`server/relay.js`) che trova la partita dal codice e inoltra i messaggi.
Così nessuno deve aprire porte sul proprio computer.

### Provare su un solo computer
Terminale 1:

    npm run server

Terminale 2 (prima finestra del gioco, compila e avvia):

    npm start

Terminale 3 (seconda finestra, senza ricompilare, con impostazioni separate):

    npx electron . --profilo=2

Nella prima finestra: Gioca online, Crea partita. Nella seconda: Gioca online, scrivi il codice, Entra.
Su Mac, per aprire una seconda finestra dell'app pacchettizzata: `open -n "/Applications/Campo Aperto.app" --args --profilo=2`.

### Giocare in rete locale
Nell'app desktop, senza terminale né indirizzi IP: chi ospita sceglie Gioca online, Ospita in rete locale e dà agli amici
il codice di 6 caratteri (inizia sempre con L). Gli amici (stessa rete Wi-Fi o cavo) scrivono solo il codice in Unisciti e premono Entra: il gioco
cerca l'host da solo. Al primo avvio Windows può mostrare l'avviso del firewall: scegli Consenti (rete privata).
Se la rete blocca la ricerca (alcuni Wi-Fi pubblici o di scuola), nella lobby dell'host c'è l'indirizzo, per esempio
192.168.1.23:8787: gli amici lo inseriscono in Impostazioni, Online come `ws://192.168.1.23:8787`.
Il codice non viaggia in chiaro nella rete (nonce e HMAC), ma essendo di 6 caratteri non protegge da un attaccante deciso sulla stessa rete: gioca solo su reti fidate.
Usano le porte 8787 (TCP, partita) e 8788 (UDP, ricerca). Tutti devono avere la stessa versione del gioco.

### Rete di casa (due computer)
Sul computer che fa da server:

    npm run server:lan

Il server ascolta sulla porta 8787 di tutte le schede di rete. Negli altri computer:
Impostazioni, scheda Online, indirizzo `ws://IP-DEL-COMPUTER:8787` (per esempio `ws://192.168.1.20:8787`).
Su Mac, il firewall può chiedere se permettere le connessioni in entrata a "node": rispondi Consenti.

### Server di casa raggiungibile da internet
Copia la cartella `server/` sul server Ubuntu e:

    cd server
    npm install --omit=dev
    node relay.js --host 127.0.0.1 --port 8787

Metti davanti un reverse proxy con HTTPS (nginx o Caddy) che inoltri un dominio, per esempio
`wss://calcio.tuodominio.ch`, a `127.0.0.1:8787` con l'upgrade WebSocket. In nginx:

    location / {
      proxy_pass http://127.0.0.1:8787;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 60s;
    }

Nel gioco l'indirizzo diventa `wss://calcio.tuodominio.ch`. Il server risponde anche a `/health` per i controlli.
Opzioni del server: `--port`, `--host` (o le variabili PORT e HOST).

### Cosa succede se cade la rete
- Un giocatore perde la connessione: il suo calciatore passa all'IA e il gioco prova a rientrare da solo per circa 30 secondi.
- L'host perde la connessione: gli altri aspettano 20 secondi, poi la partita si chiude con un messaggio.
- L'host perde il server: la sua partita continua offline contro l'IA.
- Il passaggio dell'host a un altro giocatore non c'è: lo stato completo della partita esiste solo sull'host.

### Sicurezza
- Il codice partita è casuale e serve solo a trovare la lobby. Non contiene indirizzi o dati personali.
- Il server limita i tentativi di codice (30 al minuto per indirizzo), i messaggi al secondo e la dimensione dei messaggi.
- Solo l'host può inviare lo stato della partita. I client mandano soltanto i propri comandi, che l'host controlla.
- Per impostazione il server ascolta solo su questo computer (127.0.0.1). La rete locale si apre solo con `server:lan`.

## Struttura
- `src/` codice del gioco (01-08 simulazione, 09 grafica, 10 audio, 11 input, 12 rete, 13 impostazioni, 14 gioco, shell.html interfaccia)
- `server/` server lobby/relay per l'online (ha un suo package.json per installarlo da solo)
- `desktop/main.js` finestra dell'app Electron
- `risorse/icon.png` icona (da qui vengono generate .ico e .icns)
- `tests/` test automatici
- `docs/` stato del progetto, roadmap, changelog

