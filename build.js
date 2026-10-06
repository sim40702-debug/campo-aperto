// ============================================================
// BUILD — unisce src/01..17 dentro shell.html
// uso:
//   node build.js web      -> dist/index.html   (browser, three.js e font da internet)
//   node build.js test     -> dist/test.html    (test locali con node_modules/three)
//   node build.js desktop  -> desktop/app/      (app desktop, tutto offline)
//   node build.js engine   -> cloud/src/engine.gen.js (motore della partita per il server)
// ============================================================
const fs = require('fs');
const path = require('path');

const target = process.argv[2] || 'web';
const root = __dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const srcDir = path.join(root, 'src');
const crypto = require('crypto');

// impronta del motore: SHA-256 dei file della simulazione (01..08). Uguale nel gioco e nel server se e solo se
// la simulazione è la stessa: una partita del server si può rigiocare nel gioco solo con la stessa impronta
const simFiles = fs.readdirSync(srcDir).filter(f => /^0[1-8]_.*\.js$/.test(f)).sort();
// gli a capo si normalizzano: su Windows git può scrivere i file con CRLF, ma il codice (e la partita) è lo stesso
const engineId = crypto.createHash('sha256').update(simFiles.map(f => f + '\n' + fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/\r\n?/g, '\n')).join('\n')).digest('hex').slice(0, 12);

// motore per il server (cloud/): gli stessi file della simulazione del gioco (01..08) in un modulo ES.
// Il server non ha una seconda simulazione: calcola le partite con questo codice.
if (target === 'engine') {
  let mod = '// GENERATO da "node build.js engine": motore di Campo Aperto per il server. Non modificare a mano.\n' +
    'var GAME_VERSION = ' + JSON.stringify(version) + ';\nvar BUILD_TARGET = "engine";\nvar ENGINE_ID = ' + JSON.stringify(engineId) + ';\n';
  for (const f of simFiles) mod += '// ---- ' + f + ' ----\n' + fs.readFileSync(path.join(srcDir, f), 'utf8') + '\n';
  // le 24 squadre in più delle competizioni (non cambiano la simulazione, quindi non entrano nell'impronta)
  mod += '// ---- 18_squadre.js ----\n' + fs.readFileSync(path.join(srcDir, '18_squadre.js'), 'utf8') + '\n';
  mod += 'export { Match, KnockoutMatch, buildDatabase, buildExtraTeams, setSeed, makeRng, CONFIG, GAME_VERSION, ENGINE_ID };\n';
  const out = path.join(root, 'cloud', 'src', 'engine.gen.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, mod);
  console.log('build engine -> ' + path.relative(root, out) + ' (versione ' + version + ', motore ' + engineId + ')');
  process.exit(0);
}

// logica delle schedine: lo stesso file del server (cloud/src/betlogic.js), nel gioco come oggetto BetLogic.
// Un solo sistema di regole: il gioco controlla subito le combinazioni, il server decide comunque tutto.
// Allo stesso modo le regole delle competizioni (cloud/src/complogic.js) diventano l'oggetto CompLogic.
function sharedModule(file, varName) {
  const src = fs.readFileSync(path.join(root, 'cloud', 'src', file), 'utf8');
  const names = [...src.matchAll(/^export (?:const|function\*?|let) (\w+)/gm)].map(m => m[1]);
  return 'var ' + varName + ' = (function () {\n' + src.replace(/^export /gm, '') + '\nreturn { ' + names.join(', ') + ' };\n})();\n';
}
function betLogicModule() { return sharedModule('betlogic.js', 'BetLogic'); }

// 1. codice del gioco: tutti i file src che iniziano con due cifre, in ordine
const files = fs.readdirSync(srcDir).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
// server dell'economia incluso nella versione: variabile d'ambiente CAMPO_API_URL (es. nella release) oppure
// "campoApiUrl" in package.json; il giocatore può sempre cambiarlo nelle impostazioni
const apiUrl = String(process.env.CAMPO_API_URL || pkg.campoApiUrl || '').trim();
if (apiUrl && !/^https?:\/\/[^\s"'<>]+$/i.test(apiUrl)) { console.error('CAMPO_API_URL non valido: ' + apiUrl); process.exit(1); }
let code = 'var GAME_VERSION = ' + JSON.stringify(version) + ';\nvar BUILD_TARGET = ' + JSON.stringify(target) + ';\nvar DEFAULT_API_URL = ' + JSON.stringify(apiUrl) + ';\nvar ENGINE_ID = ' + JSON.stringify(engineId) + ';\n';
// regole condivise con il server prima del codice del gioco (sono funzioni pure: il gioco le usa già in fase di caricamento)
code += '// ---- cloud/src/betlogic.js ----\n' + betLogicModule();
code += '// ---- cloud/src/complogic.js ----\n' + sharedModule('complogic.js', 'CompLogic');
for (const f of files) code += '// ---- ' + f + ' ----\n' + fs.readFileSync(path.join(srcDir, f), 'utf8') + '\n';

// 2. three.js e font: da internet (web) oppure file locali (test, desktop)
let threeTag, fontsTag;
if (target === 'web') {
  threeTag = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>';
  fontsTag = '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;700;800&family=Saira:wght@400;600&display=swap" rel="stylesheet">';
} else if (target === 'test') {
  threeTag = '<script src="../node_modules/three/build/three.min.js"></script>';
  fontsTag = '';
} else if (target === 'desktop') {
  threeTag = '<script src="lib/three.min.js"></script>';
  // nell'app desktop si caricano solo file locali (regole di sicurezza consigliate da Electron)
  fontsTag = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; ' +
    'style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; media-src \'self\' data: blob:; ' +
    // connect-src: WebSocket verso il server lobby e HTTPS verso il server dell'economia (scelti nelle impostazioni);
    // http solo verso questo computer (server di prova in locale)
    'connect-src \'self\' ws: wss: https: http://localhost:* http://127.0.0.1:*">\n' +
    '<link href="fonts/fonts.css" rel="stylesheet">';
} else {
  console.error('Target sconosciuto: ' + target + ' (usa web, test o desktop)');
  process.exit(1);
}

// 3. documenti di progetto incorporati (nascosti) per la continuità tra sessioni
const docNames = ['PROJECT_STATUS.md', 'ROADMAP.md', 'CHANGELOG.md'];
let docs = '';
for (const d of docNames) {
  const p = path.join(root, 'docs', d);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script');
  docs += '<script type="text/markdown" id="doc-' + d.replace('.md', '').toLowerCase() + '">\n' + text + '\n</script>\n';
}

// 4. pagina finale
let html = fs.readFileSync(path.join(srcDir, 'shell.html'), 'utf8');
html = html.split('<!--THREE-->').join(threeTag);
html = html.split('<!--FONTS-->').join(fontsTag);
html = html.split('/*GAME*/').join(code);
html = html.replace('</body>', docs + '</body>');

// 5. scrittura dei file
if (target === 'desktop') {
  const app = path.join(root, 'desktop', 'app');
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(path.join(app, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(app, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(app, 'index.html'), html);
  fs.copyFileSync(path.join(root, 'node_modules', 'three', 'build', 'three.min.js'), path.join(app, 'lib', 'three.min.js'));
  // font Saira copiati dai pacchetti @fontsource
  const fonts = [
    ['Saira Condensed', 500, 'saira-condensed', 'saira-condensed-latin-500-normal.woff2'],
    ['Saira Condensed', 700, 'saira-condensed', 'saira-condensed-latin-700-normal.woff2'],
    ['Saira Condensed', 800, 'saira-condensed', 'saira-condensed-latin-800-normal.woff2'],
    ['Saira', 400, 'saira', 'saira-latin-400-normal.woff2'],
    ['Saira', 600, 'saira', 'saira-latin-600-normal.woff2'],
  ];
  let css = '';
  for (const f of fonts) {
    fs.copyFileSync(path.join(root, 'node_modules', '@fontsource', f[2], 'files', f[3]), path.join(app, 'fonts', f[3]));
    css += "@font-face { font-family: '" + f[0] + "'; font-weight: " + f[1] + "; font-style: normal; font-display: swap; src: url('" + f[3] + "') format('woff2'); }\n";
  }
  fs.writeFileSync(path.join(app, 'fonts', 'fonts.css'), css);
  console.log('build desktop -> desktop/app/ (versione ' + version + ')');
} else {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist', target === 'test' ? 'test.html' : 'index.html');
  fs.writeFileSync(out, html);
  console.log('build ' + target + ' -> ' + path.relative(root, out) + ' (versione ' + version + ', ' + (html.length / 1024).toFixed(1) + ' KB)');
}
