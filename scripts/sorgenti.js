// ============================================================
// SORGENTI — dove sono i file del gioco
// Il codice è diviso in cartelle dentro src/ (engine, client, game, i18n), ma l'ordine in cui si uniscono resta
// quello del numero davanti al nome (01_config.js, 02_database.js...). Build e test usano queste funzioni,
// così non devono sapere in quale cartella sta un file.
// ============================================================
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

// tutti i file sotto una cartella (anche nelle sottocartelle)
function allFiles(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(allFiles(p));
    else out.push(p);
  }
  return out;
}

// file del gioco il cui nome rispetta la regola, in ordine di nome (percorsi completi)
function gameFiles(rule) {
  return allFiles(SRC)
    .filter(p => rule.test(path.basename(p)))
    .sort((a, b) => (path.basename(a) < path.basename(b) ? -1 : path.basename(a) > path.basename(b) ? 1 : 0));
}

// un file del gioco cercato per nome (es. '21_commentary.js')
function gameFile(name) {
  const p = allFiles(SRC).find(x => path.basename(x) === name);
  if (!p) throw new Error('File del gioco non trovato: ' + name);
  return p;
}

// il codice di più file uniti, nell'ordine giusto
function readGame(rule) {
  return gameFiles(rule).map(p => fs.readFileSync(p, 'utf8')).join('\n');
}

module.exports = { SRC, gameFiles, gameFile, readGame };
