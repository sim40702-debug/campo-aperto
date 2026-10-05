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

**AppImage**, funziona su qualsiasi distribuzione:

```bash
chmod +x CampoAperto-*.AppImage
./CampoAperto-*.AppImage
```

**Debian / Ubuntu (.deb)**:

```bash
sudo apt install ./CampoAperto-*.deb
```

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
| Pausa | Esc / P | Menu |
| Telecamera | C | View |
| Audio on/off | M | — |
| Guida comandi | F1 / H | — |

Ogni tasto si può rimappare in **Impostazioni → Controlli**. Nell'app desktop **F11** attiva lo schermo intero.

---

## Multiplayer

### In rete locale

1. Chi ospita va su **Gioca online → Crea partita** e riceve un codice di 6 caratteri.
2. Gli amici aprono **Unisciti**, scrivono il codice e premono **Entra**.
3. Ognuno sceglie la squadra: fino a 4 umani per squadra, gli altri li muove l'IA.

Non servono indirizzi IP né porte da aprire.

**Se non si collega:**
- **Ctrl+Maiusc+D** apre la diagnostica di rete.
- In **Unisciti → «La partita non viene trovata?»** scrivi l'indirizzo che compare nella lobby dell'host.
- **Windows:** consenti Campo Aperto nel firewall anche per le reti pubbliche.
- **macOS:** Impostazioni di Sistema → Privacy e sicurezza → Rete locale → attiva Campo Aperto.
- Reti ospiti, Wi-Fi pubblici e VPN spesso bloccano il collegamento tra dispositivi.

### Online con il tuo server

```bash
cd server
npm install --omit=dev
node relay.js --host 127.0.0.1 --port 8787
```

Metti davanti un reverse proxy HTTPS (nginx o Caddy) che inoltri `wss://calcio.tuodominio.ch` a `127.0.0.1:8787` con l'upgrade WebSocket. Poi nel gioco inserisci l'indirizzo in **Impostazioni → Online → Server online**.

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
| `npm run dist:linux` | `.AppImage` e `.deb` |

Per compilare tutte le piattaforme insieme con GitHub Actions basta pubblicare un tag:

```bash
git tag v0.4.2 && git push --tags
```

Dopo qualche minuto i file compaiono in **Releases**, dentro una release in bozza.

### Struttura

```
src/       codice del gioco (simulazione, grafica, audio, input, rete)
server/    server lobby/relay per l'online
desktop/   app Electron
tests/     test automatici
docs/      roadmap e changelog
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
```

Per provare la vera app desktop:

```bash
npm run build:desktop
npx electron tests/electron_smoke.js
```

Su Linux senza schermo anteponi `xvfb-run` all'ultimo comando.

### Nota tecnica: Node.js 26

Electron 33 si installa con `extract-zip`, che usa `yauzl` 2.10. Con Node 26 questa versione si ferma dopo il primo file dell'archivio e non segnala nessun errore, quindi Electron resta installato solo in parte.

In `package.json` ci sono due impostazioni per evitarlo:

- `"overrides": { "yauzl": "3.4.0" }` fa usare a `extract-zip` una versione compatibile con Node 26. L'estrazione è identica a quella di `unzip`, link simbolici del Mac compresi.
- `"allowScripts"` autorizza lo script postinstall di Electron, come richiede npm 11.

In più `scripts/controlla-electron.js` parte da solo dopo `npm install` e prima di `npm start` / `npm run dist:*`. Se trova un'installazione di Electron a metà la cancella e la rifà, senza comandi a mano.
