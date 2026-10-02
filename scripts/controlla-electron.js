// ============================================================
// CONTROLLO ELECTRON
// Viene eseguito dopo "npm install" e prima di "npm start" / "npm run dist:*".
//
// 1. Controlla che la versione di Node.js sia compatibile.
// 2. Controlla che Electron sia installato davvero (programma completo + path.txt).
// 3. Se l'installazione è rotta o a metà, cancella i file incompleti
//    e la rifà da solo, usando l'installatore ufficiale di Electron.
//
// Perché serve: l'installatore di Electron 33 usa extract-zip con yauzl 2.10.
// Con Node.js 26 yauzl 2.10 si ferma dopo il primo file dello zip senza dare errori:
// Electron resta estratto a metà, path.txt non viene scritto e "electron ."
// risponde "Electron failed to install correctly".
// La correzione vera è in package.json ("overrides": yauzl 3.4.0, compatibile con Node 26);
// questo controllo resta come rete di sicurezza per installazioni vecchie o interrotte.
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const radice = path.join(__dirname, '..');
const cartellaElectron = path.join(radice, 'node_modules', 'electron');

// versioni di Node.js provate con questo progetto: 22, 24 e 26
const NODE_MINIMO = 22;
const NODE_MASSIMO = 26;

function errore(testo) {
  console.error('\n[Campo Aperto] ERRORE: ' + testo + '\n');
  process.exit(1);
}

// ---------- 1. versione di Node.js ----------
const versioneNode = Number(process.versions.node.split('.')[0]);
if (versioneNode < NODE_MINIMO || versioneNode > NODE_MASSIMO) {
  errore('stai usando Node.js ' + process.versions.node + '.\n' +
    'Questo progetto è provato con Node.js da ' + NODE_MINIMO + ' a ' + NODE_MASSIMO + '.\n' +
    'Installa una di queste versioni, poi cancella node_modules e rifai "npm install".');
}

// ---------- 2. Electron è installato? ----------
if (!fs.existsSync(path.join(cartellaElectron, 'package.json'))) {
  errore('il pacchetto electron non è in node_modules. Esegui "npm install".');
}
const versioneElectron = require(path.join(cartellaElectron, 'package.json')).version;

// percorso del programma Electron dentro node_modules/electron/dist
function percorsoProgramma() {
  if (process.platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron';
  if (process.platform === 'win32') return 'electron.exe';
  return 'electron';
}

function electronInstallato() {
  const fileVersione = path.join(cartellaElectron, 'dist', 'version');
  const filePath = path.join(cartellaElectron, 'path.txt');
  if (!fs.existsSync(fileVersione) || !fs.existsSync(filePath)) return false;
  // la versione estratta deve essere quella del pacchetto
  if (fs.readFileSync(fileVersione, 'utf8').trim().replace(/^v/, '') !== versioneElectron) return false;
  if (fs.readFileSync(filePath, 'utf8').trim() !== percorsoProgramma()) return false;
  // il programma deve esserci davvero
  const programma = path.join(cartellaElectron, 'dist', percorsoProgramma());
  if (!fs.existsSync(programma)) return false;
  // sul Mac controllo anche il framework: se l'estrazione si è fermata a metà manca
  if (process.platform === 'darwin') {
    const framework = path.join(cartellaElectron, 'dist', 'Electron.app', 'Contents', 'Frameworks',
      'Electron Framework.framework', 'Versions', 'A', 'Electron Framework');
    if (!fs.existsSync(framework)) return false;
  }
  return true;
}

if (electronInstallato()) {
  console.log('[Campo Aperto] Electron ' + versioneElectron + ' installato correttamente.');
  process.exit(0);
}

// ---------- 3. riparazione ----------
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
  errore('la variabile ELECTRON_SKIP_BINARY_DOWNLOAD è impostata e impedisce di scaricare Electron.\n' +
    'Toglila (unset ELECTRON_SKIP_BINARY_DOWNLOAD) e rifai "npm install".');
}

console.log('[Campo Aperto] Electron non è installato completamente: lo reinstallo...');
// cancello i file incompleti, altrimenti l'installatore li lascerebbe a metà
fs.rmSync(path.join(cartellaElectron, 'dist'), { recursive: true, force: true });
fs.rmSync(path.join(cartellaElectron, 'path.txt'), { force: true });

try {
  // installatore ufficiale di Electron (scarica lo zip, o lo prende dalla cache, e lo estrae)
  execFileSync(process.execPath, [path.join(cartellaElectron, 'install.js')], {
    cwd: cartellaElectron,
    stdio: 'inherit',
  });
} catch (e) {
  errore('l\'installazione di Electron non è riuscita (controlla la connessione a internet).');
}

if (!electronInstallato()) {
  errore('Electron è ancora incompleto dopo la reinstallazione.\n' +
    'Cancella la cartella node_modules e rifai "npm install".\n' +
    'Controlla che in node_modules/yauzl ci sia la versione 3.4.0 (richiesta da "overrides" in package.json).');
}
console.log('[Campo Aperto] Electron ' + versioneElectron + ' reinstallato correttamente.');
