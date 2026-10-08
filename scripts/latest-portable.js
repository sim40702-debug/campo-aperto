// ============================================================
// LATEST-PORTABLE — crea latest-portable.yml per la versione portable di Windows
// electron-builder scrive latest.yml solo per l'installer: la versione portable non ha un file con l'impronta.
// L'app portable lo usa per controllare che il file scaricato sia identico a quello della release (sha512 e grandezza).
// uso: node scripts/latest-portable.js <cartella con i file della release>
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = process.argv[2] || 'release';
const version = require('../package.json').version;

// cerca CampoAperto-<versione>-portable.exe anche nelle sottocartelle
function find(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const r = find(p); if (r) return r; }
    else if (e.name === 'CampoAperto-' + version + '-portable.exe') return p;
  }
  return null;
}

const exe = find(dir);
if (!exe) { console.log('latest-portable.yml: nessun file portable per la versione ' + version); process.exit(0); }
const data = fs.readFileSync(exe);
const sha512 = crypto.createHash('sha512').update(data).digest('base64');
const yml = [
  'version: ' + version,
  'files:',
  '  - url: ' + path.basename(exe),
  '    sha512: ' + sha512,
  '    size: ' + data.length,
  'path: ' + path.basename(exe),
  'sha512: ' + sha512,
  "releaseDate: '" + new Date().toISOString() + "'",
  '',
].join('\n');
fs.writeFileSync(path.join(path.dirname(exe), 'latest-portable.yml'), yml);
console.log('latest-portable.yml scritto accanto a ' + path.basename(exe));
