// ============================================================
// PREPARA WINDOWS — prima di "npm run dist:win"
// electron-builder scarica uno strumento (winCodeSign) che serve per mettere icona e versione nel file .exe.
// Dentro l'archivio ci sono anche due file per il Mac che sono "collegamenti simbolici": su Windows crearli
// richiede i permessi di amministratore (o la Modalità sviluppatore), altrimenti l'estrazione fallisce con
// "Cannot create symbolic link : Il privilegio richiesto non appartiene al client" e la compilazione si ferma.
// Questo script scarica lo stesso archivio e lo estrae da solo nella cartella dove electron-builder lo cerca,
// saltando la parte per il Mac (non serve per Windows). Se la cartella c'è già non fa niente.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = 'winCodeSign-2.6.0';
const URL = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/' + VERSION + '/' + VERSION + '.7z';

// la cartella della cache di electron-builder (come la calcola lui)
function cacheDir() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'electron-builder', 'Cache');
}

async function main() {
  // serve solo su Windows (con PREPARA_WINDOWS=1 si può provare anche su altri sistemi)
  if (process.platform !== 'win32' && !process.env.PREPARA_WINDOWS) return;
  const dest = path.join(cacheDir(), 'winCodeSign', VERSION);
  if (fs.existsSync(path.join(dest, 'rcedit-x64.exe'))) return; // già pronto

  console.log('[Campo Aperto] Preparo ' + VERSION + ' per electron-builder...');
  const res = await fetch(URL); // fetch segue da solo i reindirizzamenti di GitHub
  if (!res.ok) throw new Error('download non riuscito (' + res.status + ')');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wincodesign-'));
  const archive = path.join(tmp, VERSION + '.7z');
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

  // estrazione con il 7-Zip che usa anche electron-builder, senza la cartella "darwin" (i file del Mac)
  const out = path.join(tmp, 'out');
  const sevenZip = require('7zip-bin').path7za;
  execFileSync(sevenZip, ['x', '-bd', '-y', archive, '-o' + out, '-xr!darwin'], { stdio: 'ignore' });
  if (!fs.existsSync(path.join(out, 'rcedit-x64.exe'))) throw new Error('archivio estratto ma senza rcedit-x64.exe');

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true }); // un tentativo vecchio a metà
  fs.cpSync(out, dest, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('[Campo Aperto] ' + VERSION + ' pronto in ' + dest);
}

main().catch(err => {
  // se non riesce, electron-builder proverà comunque da solo: si scrive solo come risolvere a mano
  console.warn('[Campo Aperto] Non sono riuscito a preparare ' + VERSION + ': ' + err.message);
  console.warn('  Se la compilazione si ferma con "Cannot create symbolic link", attiva la Modalità sviluppatore');
  console.warn('  di Windows (Impostazioni → Sistema → Per sviluppatori) oppure apri PowerShell come amministratore.');
});
