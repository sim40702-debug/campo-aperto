// Test degli aggiornamenti (desktop/aggiornamenti.js) senza Electron: confronto delle versioni e lettura di latest*.yml
// uso: node tests/aggiornamenti_test.js
const Module = require('module');
const path = require('path');

let ok = 0, ko = 0;
function check(name, cond, extra) {
  if (cond) ok++; else ko++;
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
}

// al posto di Electron un finto modulo con quello che serve per caricare il file
const fakeElectron = { app: { getVersion: () => '1.4.0', getPath: () => '/tmp', isPackaged: false }, net: {}, ipcMain: { handle() {} }, shell: {}, BrowserWindow: { getAllWindows: () => [] } };
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? fakeElectron : load.call(this, req, ...rest); };
const { confronta, leggiYml, scriptMac } = require(path.join(__dirname, '..', 'desktop', 'aggiornamenti.js'));
Module._load = load;

// ---- versioni
check('1.3.0 < 1.4.0: aggiornamento disponibile', confronta('1.4.0', '1.3.0') === 1);
check('1.4.0 = 1.4.0: nessun aggiornamento', confronta('1.4.0', '1.4.0') === 0);
check('1.9.0 < 1.10.0 (numeri, non testo)', confronta('1.10.0', '1.9.0') === 1 && confronta('1.9.0', '1.10.0') === -1);
check('mai una versione più vecchia: 0.12.1 < 0.13.0', confronta('0.12.1', '0.13.0') === -1);
check('"v" davanti al tag va bene', confronta('v2.0.0', '1.99.99') === 1 && confronta('v1.0.0', '1.0.0') === 0);
check('suffisso di pre-release ignorato nel confronto', confronta('1.2.0-beta.1', '1.2.0') === 0);

// ---- latest.yml (Windows, come lo scrive electron-builder)
const win = leggiYml(`version: 0.12.1
files:
  - url: CampoAperto-0.12.1-win-x64.exe
    sha512: uVO91RXCd3SfoMKbmAr8YkAYZzlxmWY9nGawHc4GSAYvyiA1h5Yrd3H4X7v2mLnU1kI3grJyV750RYKDhaGiYg==
    size: 82208146
path: CampoAperto-0.12.1-win-x64.exe
sha512: uVO91RXCd3SfoMKbmAr8YkAYZzlxmWY9nGawHc4GSAYvyiA1h5Yrd3H4X7v2mLnU1kI3grJyV750RYKDhaGiYg==
releaseDate: '2026-10-08T17:53:28.567Z'
`);
check('latest.yml: un file con impronta e grandezza', win.length === 1 && win[0].url === 'CampoAperto-0.12.1-win-x64.exe' && win[0].size === 82208146 && win[0].sha512.length === 88, win);

// ---- latest-mac.yml: due architetture, zip e dmg
const mac = leggiYml(`version: 0.12.1
files:
  - url: CampoAperto-0.12.1-mac-arm64.zip
    sha512: y3i/FMaqCoh0ZKrpOJYnmVHTJOQEeRZuQOG8uL+ufqykzNb/FhPal5qycaqS150SRq6qWT4glv7db6D1d0LjRQ==
    size: 95451046
  - url: CampoAperto-0.12.1-mac-x64.zip
    sha512: Df1sY8AF6ofImShlSRq/SxaJZu9W7tX4BUu2yyofHU76X84vTbsSuqjY0LwEUpxXlQx6RmUBVTcPZM7VP3FLxQ==
    size: 100078239
  - url: CampoAperto-0.12.1-mac-arm64.dmg
    sha512: FNo/SbU9aJj8ECE5zdv59P80rm2Yi29hoJdLxVGvVYEU5ON3AIalp3sgjKSRjrEQ8iPtgeLRqh2xde3LQHmGTg==
    size: 98902682
path: CampoAperto-0.12.1-mac-arm64.zip
sha512: y3i/FMaqCoh0ZKrpOJYnmVHTJOQEeRZuQOG8uL+ufqykzNb/FhPal5qycaqS150SRq6qWT4glv7db6D1d0LjRQ==
`);
check('latest-mac.yml: tre file', mac.length === 3, mac.map(f => f.url));
const pick = arch => mac.find(x => x.url.endsWith('-' + arch + '.zip'));
check('Mac Apple Silicon sceglie lo zip arm64', pick('arm64').url === 'CampoAperto-0.12.1-mac-arm64.zip' && pick('arm64').size === 95451046);
check('Mac Intel sceglie lo zip x64', pick('x64').url === 'CampoAperto-0.12.1-mac-x64.zip' && pick('x64').size === 100078239);
check('impronta del file giusto (non quella in fondo al file)', pick('x64').sha512.startsWith('Df1sY8AF'));

// ---- latest-linux.yml con blockMapSize
const lin = leggiYml(`version: 0.12.1
files:
  - url: CampoAperto-0.12.1-linux-x86_64.AppImage
    sha512: bdzmTeLRjQGG9GeEJWEkqyCL2SFoBg+2VxJbxyIhs7k5MHYWkXqwR28ompwUCXOGuZ0TEDWtkuAksY37UtwzfA==
    size: 108556519
    blockMapSize: 114939
  - url: CampoAperto-0.12.1-linux-amd64.deb
    sha512: nEKZvWop12kFg9qIiyfDnqReDlXNjEXctkDooMIu1RVeGpVtaA9c6il711VXbWTkEMJJVKtee78fTm0Ga8GmHw==
    size: 75346484
`);
check('latest-linux.yml: AppImage e deb', lin.length === 2 && lin[1].url.endsWith('.deb') && lin[1].size === 75346484 && lin[0].size === 108556519);
check('file senza impronta scartato', leggiYml('files:\n  - url: a.exe\n    size: 3\n').length === 0);

// ---- script del Mac (la shell è la stessa sul Mac e su Linux; "open" e "xattr" finti)
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
async function provaMac(conNuova) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-mac-'));
  const bin = path.join(d, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\necho "$1" >> "' + path.join(d, 'aperta.txt') + '"\n', { mode: 0o755 });
  const vecchia = path.join(d, 'Applicazioni', "Campo Aperto (l'app).app"), nuova = path.join(d, 'tmp', 'nuova', 'Campo Aperto.app');
  fs.mkdirSync(vecchia, { recursive: true }); fs.writeFileSync(path.join(vecchia, 'versione'), '1.3.0');
  if (conNuova) { fs.mkdirSync(nuova, { recursive: true }); fs.writeFileSync(path.join(nuova, 'versione'), '1.4.0'); }
  const app = spawn('sleep', ['1']);   // l'app "ancora aperta": lo script deve aspettare che si chiuda
  const t0 = Date.now();
  fs.writeFileSync(path.join(d, 'aggiorna.sh'), scriptMac(app.pid, vecchia, nuova));
  // lo script gira mentre node resta libero (così l'app finta, quando finisce, sparisce davvero)
  await new Promise(ok => spawn('/bin/sh', [path.join(d, 'aggiorna.sh')], { env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH }), stdio: 'ignore' }).on('exit', ok));
  const r = { attesa: Date.now() - t0, versione: fs.readFileSync(path.join(vecchia, 'versione'), 'utf8'), vecchiaRimasta: fs.existsSync(vecchia + '.vecchia'),
    aperta: fs.existsSync(path.join(d, 'aperta.txt')) ? fs.readFileSync(path.join(d, 'aperta.txt'), 'utf8').trim() : '' };
  fs.rmSync(d, { recursive: true, force: true });
  return Object.assign(r, { vecchia });
}
(async () => {
// lo script del Mac si prova solo dove c'è /bin/sh (Mac e Linux, non Windows)
if (process.platform !== 'win32') {
const m1 = await provaMac(true);
check('Mac: lo script aspetta che l\'app sia chiusa', m1.attesa >= 900, m1.attesa);
check('Mac: la nuova versione prende il posto della vecchia (anche con spazi e apostrofo nel percorso)', m1.versione === '1.4.0' && !m1.vecchiaRimasta, m1);
check('Mac: poi l\'app si riapre', m1.aperta === m1.vecchia, m1);
const m2 = await provaMac(false);
check('Mac: se la nuova manca resta la vecchia, intatta, e si riapre', m2.versione === '1.3.0' && !m2.vecchiaRimasta && m2.aperta === m2.vecchia, m2);
}

console.log('\nRisultato: ' + ok + ' superati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
})();
