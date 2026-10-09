// ============================================================
// AGGIORNAMENTI — l'app controlla da sola se su GitHub Releases c'è una versione nuova e la installa
// Il controllo legge l'ultima release del repository (senza bozze e pre-release) e confronta la versione con quella
// installata (1.9.0 < 1.10.0). Una versione uguale o più vecchia non viene mai installata.
// Come si installa dipende da come è installata l'app:
//   Windows (installer)        electron-updater (la soluzione ufficiale di electron-builder): scarica l'installer,
//   Linux .AppImage e .deb     controlla l'impronta sha512 di latest.yml / latest-linux.yml, chiude l'app, installa e riapre
//   Mac                        l'app non è firmata da Apple e l'updater ufficiale lì vuole la firma: si scarica lo .zip,
//                              si controlla l'impronta di latest-mac.yml, si estrae e un piccolo script sostituisce
//                              l'app dopo che si è chiusa, poi la riapre (se qualcosa va storto rimette la vecchia)
//   Windows portable           come il Mac, con latest-portable.yml (lo crea il flusso "Rilascio app desktop")
// Il gioco (pagina) vede solo lo stato: campoUpdate in preload.js. Gli errori diventano un codice semplice
// ('rete', 'verifica', 'cartella', 'nessun-file', 'generico') che la pagina trasforma in una frase chiara.
// ============================================================
const { app, net, ipcMain, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const REPO = 'sim40702-debug/campo-aperto';
const PRIMO_CONTROLLO = 8 * 1000;            // poco dopo l'avvio, per non rallentare l'apertura
const OGNI = 6 * 60 * 60 * 1000;             // poi ogni 6 ore
const IN_ATTESA = () => path.join(app.getPath('userData'), 'aggiornamento-in-corso.json');

// stato mandato alla pagina. fase: nessuno | controllo | disponibile | scarico | installo | errore | non-supportato
let stato = { fase: 'nessuno', attuale: app.getVersion() };
let release = null;          // l'ultima release letta da GitHub
let annulla = null;          // funzione per fermare il download in corso

function cambia(nuovo) {
  stato = Object.assign({}, stato, nuovo);
  for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('upd:cambio', stato); } catch (e) { /* finestra chiusa */ } }
}

// confronto tra versioni: -1 se a è più vecchia, 0 se uguali, 1 se a è più nuova (1.9.0 < 1.10.0)
function confronta(a, b) {
  const pa = String(a).replace(/^v/, '').split('-')[0].split('.');
  const pb = String(b).replace(/^v/, '').split('-')[0].split('.');
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// come è installata l'app (decide il file da scaricare e come installarlo)
function tipoInstallazione() {
  if (!app.isPackaged) return 'sviluppo';
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installer';
  if (process.platform === 'darwin') return 'mac';
  if (process.env.APPIMAGE) return 'appimage';
  try {
    if (fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim() === 'deb') return 'deb';
  } catch (e) { /* non è un .deb */ }
  return 'altro';
}

// il file con le impronte che serve per ogni tipo di installazione
const YML = { installer: 'latest.yml', appimage: 'latest-linux.yml', deb: 'latest-linux.yml', mac: 'latest-mac.yml', portable: 'latest-portable.yml' };

// ---------- rete ----------
async function leggi(url, comeJson) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'CampoAperto/' + app.getVersion(), Accept: comeJson ? 'application/vnd.github+json' : '*/*' } });
  if (!r.ok) throw errore('rete', 'HTTP ' + r.status + ' ' + url);
  return comeJson ? r.json() : r.text();
}
function errore(codice, testo) { const e = new Error(testo || codice); e.codice = codice; return e; }

// legge i file elencati in latest*.yml: [{ url, sha512, size }]
function leggiYml(testo) {
  const files = [];
  let f = null;
  for (const riga of testo.split(/\r?\n/)) {
    let m = /^\s*-\s*url:\s*(.+)$/.exec(riga);
    if (m) { f = { url: m[1].trim().replace(/^['"]|['"]$/g, '') }; files.push(f); continue; }
    if (!f) continue;
    m = /^\s+sha512:\s*(.+)$/.exec(riga);
    if (m) f.sha512 = m[1].trim().replace(/^['"]|['"]$/g, '');
    m = /^\s+size:\s*(\d+)/.exec(riga);
    if (m) f.size = Number(m[1]);
    if (/^\S/.test(riga)) f = null;   // fine dell'elenco dei file
  }
  return files.filter(x => x.url && x.sha512);
}

// ---------- controllo ----------
async function controlla(manuale) {
  if (stato.fase === 'scarico' || stato.fase === 'installo') return stato;
  const tipo = tipoInstallazione();
  if (tipo === 'sviluppo' || tipo === 'altro') { cambia({ fase: 'non-supportato' }); return stato; }
  if (manuale) cambia({ fase: 'controllo', errore: null });
  try {
    const rel = await leggi('https://api.github.com/repos/' + REPO + '/releases/latest', true);
    const nuova = String(rel.tag_name || '').replace(/^v/, '');
    // niente bozze, niente pre-release, mai una versione uguale o più vecchia
    if (!/^\d+\.\d+\.\d+$/.test(nuova) || rel.draft || rel.prerelease || confronta(nuova, app.getVersion()) <= 0) {
      release = null;
      cambia({ fase: 'nessuno', nuova: null, controllato: Date.now() });
      return stato;
    }
    release = rel;
    const nomi = (rel.assets || []).map(a => a.name);
    cambia({
      fase: 'disponibile',
      nuova,
      note: String(rel.body || '').slice(0, 20000),
      automatico: nomi.includes(YML[tipo]),   // senza il file delle impronte non si installa da soli
      errore: null,
      controllato: Date.now(),
    });
  } catch (e) {
    // controllo in background: se GitHub non risponde non si disturba nessuno
    cambia(manuale ? { fase: 'errore', errore: 'rete' } : { fase: release ? 'disponibile' : 'nessuno' });
  }
  return stato;
}

// ---------- download con percentuale (Mac e portable) ----------
async function scaricaFile(url, dest, atteso) {
  const ctrl = new AbortController();
  annulla = () => ctrl.abort();
  const r = await net.fetch(url, { signal: ctrl.signal });
  if (!r.ok) throw errore('rete', 'HTTP ' + r.status);
  const totale = Number(r.headers.get('content-length')) || atteso.size || 0;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(dest);
  let scaricati = 0, ultimo = 0;
  try {
    for await (const pezzo of r.body) {
      const b = Buffer.from(pezzo);
      hash.update(b);
      if (!out.write(b)) await new Promise(ok => out.once('drain', ok));
      scaricati += b.length;
      if (Date.now() - ultimo > 150) { ultimo = Date.now(); cambia({ scaricati, totale, percentuale: totale ? scaricati / totale * 100 : 0 }); }
    }
  } finally {
    await new Promise(ok => out.end(ok));
  }
  cambia({ scaricati, totale, percentuale: 100 });
  // il file deve essere identico a quello della release: stessa grandezza e stessa impronta sha512
  if ((atteso.size && scaricati !== atteso.size) || hash.digest('base64') !== atteso.sha512) throw errore('verifica');
}

// cartella pulita per i file scaricati
function cartellaTemporanea() {
  const dir = path.join(app.getPath('temp'), 'campo-aperto-aggiornamento');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// il file indicato nel .yml, preso dalla release
async function fileDellaRelease(tipo, scegli) {
  const asset = n => (release.assets || []).find(a => a.name === n);
  const yml = asset(YML[tipo]);
  if (!yml) throw errore('nessun-file');
  const files = leggiYml(await leggi(yml.browser_download_url, false));
  const f = scegli(files);
  const a = f && asset(f.url);
  if (!a) throw errore('nessun-file');
  return { url: a.browser_download_url, nome: f.url, sha512: f.sha512, size: f.size };
}

function esegui(cmd, args) {
  return new Promise((ok, ko) => execFile(cmd, args, (err, stdout) => (err ? ko(err) : ok(String(stdout).trim()))));
}

// la versione nuova si è scaricata: si ricorda per controllarla al prossimo avvio, poi si chiude l'app
function ricordaEChiudi(avvia) {
  try { fs.writeFileSync(IN_ATTESA(), JSON.stringify({ versione: stato.nuova, da: app.getVersion() })); } catch (e) { /* non importante */ }
  cambia({ fase: 'installo' });
  setTimeout(avvia, 900);   // la pagina fa in tempo a mostrare "Installazione…"
}

// ---------- Mac ----------
async function aggiornaMac() {
  const vecchia = path.resolve(process.execPath, '..', '..', '..');   // .../Campo Aperto.app
  const dove = path.dirname(vecchia);
  // dentro un disco (.dmg) o in una cartella senza permessi l'app non si può sostituire
  if (!vecchia.endsWith('.app') || vecchia.startsWith('/Volumes/') || vecchia.includes('/AppTranslocation/')) throw errore('cartella');
  try { fs.accessSync(dove, fs.constants.W_OK); } catch (e) { throw errore('cartella'); }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const f = await fileDellaRelease('mac', files => files.find(x => x.url.endsWith('-' + arch + '.zip')));
  const tmp = cartellaTemporanea();
  const zip = path.join(tmp, f.nome);
  await scaricaFile(f.url, zip, f);

  // estrazione e controllo: dentro ci deve essere l'app con la versione giusta
  const estratta = path.join(tmp, 'nuova');
  await esegui('/usr/bin/ditto', ['-x', '-k', zip, estratta]);
  const nomeApp = fs.readdirSync(estratta).find(n => n.endsWith('.app'));
  if (!nomeApp) throw errore('verifica');
  const nuova = path.join(estratta, nomeApp);
  const versione = await esegui('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(nuova, 'Contents', 'Info.plist')]);
  if (versione !== stato.nuova) throw errore('verifica');

  // lo script sostituisce l'app quando si è chiusa (scriptMac, più sotto)
  const script = path.join(tmp, 'aggiorna.sh');
  fs.writeFileSync(script, scriptMac(process.pid, vecchia, nuova), { mode: 0o755 });
  ricordaEChiudi(() => {
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  });
}
// testo tra virgolette per la shell
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

// ---------- Windows portable ----------
async function aggiornaPortable() {
  const vecchia = process.env.PORTABLE_EXECUTABLE_FILE;
  const dove = path.dirname(vecchia);
  // si prova a scrivere nella cartella del file .exe: se non si può, niente aggiornamento automatico
  try { const prova = path.join(dove, '.campo-aperto-prova'); fs.writeFileSync(prova, ''); fs.unlinkSync(prova); } catch (e) { throw errore('cartella'); }

  const f = await fileDellaRelease('portable', files => files.find(x => x.url.endsWith('.exe')));
  const tmp = cartellaTemporanea();
  const nuova = path.join(tmp, f.nome);
  await scaricaFile(f.url, nuova, f);

  // lo script sostituisce il file .exe quando il gioco si è chiuso (scriptPortable, più sotto)
  const script = path.join(tmp, 'aggiorna.cmd');
  fs.writeFileSync(script, scriptPortable(process.pid, vecchia, nuova));
  ricordaEChiudi(() => {
    spawn('cmd.exe', ['/d', '/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    app.quit();
  });
}

// script per il Mac: aspetta che l'app (pid) sia chiusa, sposta la vecchia da parte, mette la nuova e la apre.
// La vecchia si cancella solo se la nuova è al suo posto; se no torna com'era.
function scriptMac(pid, vecchia, nuova) {
  return [
    '#!/bin/sh',
    'PID=' + pid,
    'VECCHIA=' + q(vecchia),
    'NUOVA=' + q(nuova),
    'while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done',
    'rm -rf "$VECCHIA.vecchia"',
    'if ! mv "$VECCHIA" "$VECCHIA.vecchia"; then open "$VECCHIA"; exit 1; fi',
    'if mv "$NUOVA" "$VECCHIA"; then',
    '  xattr -cr "$VECCHIA" 2>/dev/null',
    '  rm -rf "$VECCHIA.vecchia"',
    'else',
    '  mv "$VECCHIA.vecchia" "$VECCHIA"',
    'fi',
    'open "$VECCHIA"',
    '',
  ].join('\n');
}

// script per la versione portable di Windows: aspetta che il gioco (pid) sia chiuso, mette il nuovo .exe al posto
// del vecchio e lo apre. Il vecchio si cancella solo dopo; se lo spostamento non riesce torna com'era.
function scriptPortable(pid, vecchia, nuova) {
  return [
    '@echo off',
    'set "VECCHIA=' + vecchia + '"',
    'set "NUOVA=' + nuova + '"',
    'set tentativi=0',
    ':aspetta',
    'timeout /t 1 /nobreak >nul',
    'tasklist /fi "PID eq ' + pid + '" | find "' + pid + '" >nul',
    'if not errorlevel 1 goto aspetta',
    ':sposta',
    'move /y "%VECCHIA%" "%VECCHIA%.vecchia" >nul 2>&1',
    'if not errorlevel 1 goto metti',
    'set /a tentativi+=1',
    'if %tentativi% lss 30 (timeout /t 1 /nobreak >nul & goto sposta)',
    'goto fine',
    ':metti',
    'move /y "%NUOVA%" "%VECCHIA%" >nul 2>&1',
    'if errorlevel 1 move /y "%VECCHIA%.vecchia" "%VECCHIA%" >nul 2>&1',
    'del /f /q "%VECCHIA%.vecchia" >nul 2>&1',
    ':fine',
    'start "" "%VECCHIA%"',
    '',
  ].join('\r\n');
}

// ---------- Windows (installer) e Linux: electron-updater ----------
async function aggiornaConElectronUpdater() {
  const { autoUpdater, CancellationToken } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;
  const r = await autoUpdater.checkForUpdates();
  if (!r || !r.updateInfo || confronta(r.updateInfo.version, app.getVersion()) <= 0) throw errore('nessun-file');
  const token = new CancellationToken();
  annulla = () => token.cancel();
  const progresso = p => cambia({ scaricati: p.transferred, totale: p.total, percentuale: p.percent });
  autoUpdater.on('download-progress', progresso);
  try {
    await autoUpdater.downloadUpdate(token);   // finisce solo con il file completo e l'impronta sha512 giusta
  } finally {
    autoUpdater.removeListener('download-progress', progresso);
  }
  // installazione silenziosa, poi l'app si riapre da sola
  ricordaEChiudi(() => autoUpdater.quitAndInstall(true, true));
}

async function aggiorna() {
  if (stato.fase !== 'disponibile' && stato.fase !== 'errore') return stato;
  if (!release) { await controlla(true); if (stato.fase !== 'disponibile') return stato; }
  const tipo = tipoInstallazione();
  cambia({ fase: 'scarico', percentuale: 0, scaricati: 0, totale: 0, errore: null });
  let fermato = false;
  annulla = () => { fermato = true; };   // il download vero, quando parte, mette la sua funzione per fermarsi
  try {
    if (tipo === 'mac') await aggiornaMac();
    else if (tipo === 'portable') await aggiornaPortable();
    else await aggiornaConElectronUpdater();
  } catch (e) {
    console.warn('[aggiornamenti]', e && e.message);
    const fermatoDaUtente = fermato || (e && (e.name === 'AbortError' || /cancel/i.test(e.message)));
    if (fermatoDaUtente) cambia({ fase: 'disponibile', percentuale: 0 });
    else cambia({ fase: 'errore', errore: e && e.codice ? e.codice : (e && /net::|ENOTFOUND|ECONN|ETIMEDOUT|HTTP/i.test(e.message) ? 'rete' : 'generico') });
  } finally {
    annulla = null;
  }
  return stato;
}

// ---------- avvio ----------
function init(fidato) {
  // l'aggiornamento di prima è andato a buon fine? (la versione installata deve essere almeno quella scaricata)
  try {
    const prima = JSON.parse(fs.readFileSync(IN_ATTESA(), 'utf8'));
    fs.unlinkSync(IN_ATTESA());
    if (confronta(app.getVersion(), prima.versione) >= 0) stato.appenaAggiornato = app.getVersion();
    else stato.nonRiuscito = prima.versione;
  } catch (e) { /* nessun aggiornamento in corso */ }

  ipcMain.handle('upd:stato', e => (fidato(e) ? stato : null));
  ipcMain.handle('upd:controlla', e => (fidato(e) ? controlla(true) : null));
  ipcMain.handle('upd:aggiorna', e => (fidato(e) ? aggiorna() : null));
  ipcMain.handle('upd:annulla', e => { if (fidato(e) && annulla) annulla(); return true; });
  ipcMain.handle('upd:pagina', e => {
    // pagina della release su GitHub (solo se non si può installare da soli)
    if (fidato(e)) shell.openExternal(release && /^https:\/\/github\.com\//.test(release.html_url) ? release.html_url : 'https://github.com/' + REPO + '/releases/latest');
    return true;
  });
  ipcMain.handle('upd:visto', e => { if (fidato(e)) { delete stato.appenaAggiornato; delete stato.nonRiuscito; } return true; });

  setTimeout(() => controlla(false), PRIMO_CONTROLLO);
  setInterval(() => controlla(false), OGNI);
}

// per i test (tests/aggiornamenti_test.js)
module.exports = { init, confronta, leggiYml, scriptMac, scriptPortable, scaricaFile };
