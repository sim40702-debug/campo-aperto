// Test delle lingue (src/00_i18n.js e src/lingue/*.js): righe complete, segnaposto uguali in tutte le lingue,
// frasi tradotte, frasi con valori, numeri, nomi delle squadre e dei giocatori mai toccati.
// uso: node tests/lingue_test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let ok = 0, ko = 0;
function check(name, cond, extra) {
  if (cond) ok++; else ko++;
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
}

// il sistema delle lingue e le traduzioni, senza pagina (document non c'è)
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'src', '00_i18n.js'), 'utf8') + '\nthis.I18N = I18N; this.tr = tr; this.trf = trf; this.setLanguage = setLanguage; this.uiLocale = uiLocale;', ctx);
const rows = [];
const langDir = path.join(root, 'src', 'lingue');
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.js')).sort();
for (const f of files) {
  const src = fs.readFileSync(path.join(langDir, f), 'utf8');
  // si raccolgono anche le righe per controllarle una per una
  vm.runInContext('addTranslations', ctx)([]);
  const collect = { rows: null };
  vm.runInNewContext(src, { addTranslations: r => { collect.rows = r; } });
  rows.push(...collect.rows.map(r => ({ f, r })));
  vm.runInContext(src, ctx);
}
check('file delle traduzioni caricati (' + files.length + ' file, ' + rows.length + ' righe)', files.length >= 5 && rows.length > 1000);

// ---- righe
const bad = rows.filter(x => x.r.length !== 4 || x.r.some(c => typeof c !== 'string' || !c.trim()));
check('ogni riga ha italiano, inglese, tedesco e francese', bad.length === 0, bad.slice(0, 3));
const ph = s => (s.match(/\{[t#]?\d+\}/g) || []).sort().join(',');
const badPh = rows.filter(x => x.r.slice(1).some(c => ph(c) !== ph(x.r[0])));
check('segnaposto ({0}, {t0}, {#0}) uguali in tutte le lingue', badPh.length === 0, badPh.slice(0, 3).map(x => x.r));
const seen = new Map(), dup = [];
for (const x of rows) { const k = x.r[0].replace(/^@/, '').replace(/\{[t#](\d+)\}/g, '{$1}').replace(/\s+/g, ' ').trim(); if (seen.has(k)) dup.push(k); seen.set(k, x.f); }
check('nessuna frase italiana ripetuta', dup.length === 0, dup.slice(0, 5));

// ---- traduzioni
const T = (lang, s) => { ctx.setLanguage(lang); return ctx.tr(s); };
check('italiano: il testo resta com\'è', T('it', 'Impostazioni') === 'Impostazioni');
check('frase fissa: Impostazioni', T('en', 'Impostazioni') === 'Settings' && T('de', 'Impostazioni') === 'Einstellungen' && T('fr', 'Impostazioni') === 'Paramètres');
check('spazi ai lati e a capo nell\'HTML', T('de', '\n   Calcio  d\'angolo \n') === '\n   Eckstoss \n');
check('frase con valore: cartellino', T('en', 'Cartellino giallo — Luca Brenzi') === 'Yellow card — Luca Brenzi');
check('frase con valore tradotto ({t0}): fallo', T('fr', 'Fallo — Carica da dietro') === 'Faute — Charge par derrière', T('fr', 'Fallo — Carica da dietro'));
check('messaggio del server: selezioni incompatibili con mercati tradotti',
  T('en', 'Selezione incompatibile: «Risultato esatto: 0-1» non si può combinare con «Esito finale: Pareggio» (Orsi di Valle – Lupi del Ceresio)') === 'Incompatible selection: «Correct score: 0-1» can\'t be combined with «Match result: Draw» (Orsi di Valle – Lupi del Ceresio)',
  T('en', 'Selezione incompatibile: «Risultato esatto: 0-1» non si può combinare con «Esito finale: Pareggio».'));
check('numeri ({#0}): "3 di 7" tradotto', T('de', '3 di 7') === '3 von 7');
check('trf: modello tradotto, poi i valori (anche HTML)', (ctx.setLanguage('en'), ctx.trf('Hai aperto la stanza {0}: aspetta che {1} entri.', '<b>AB12CD</b>', 'anna')) === 'You opened room <b>AB12CD</b>: wait for anna to join.');
check('trf in italiano: solo i valori', (ctx.setLanguage('it'), ctx.trf('{0}º posto', 3)) === '3º posto');
check('righe @: solo per il codice, non per la pagina', T('en', 'PG') === 'PG' && (ctx.setLanguage('en'), ctx.trf('PG')) === 'P');
check('formato dei numeri per lingua', (ctx.setLanguage('de'), ctx.uiLocale()) === 'de-CH' && (ctx.setLanguage('it'), ctx.uiLocale()) === 'it-IT');
check('lingua sconosciuta: si torna all\'italiano', (ctx.setLanguage('xx'), ctx.I18N.lang) === 'it');

// ---- nomi propri: squadre, giocatori, marchi dei cartelloni non si traducono mai
const names = [];
const db = fs.readFileSync(path.join(root, 'src', '02_database.js'), 'utf8') + fs.readFileSync(path.join(root, 'src', '18_squadre.js'), 'utf8');
for (const m of db.matchAll(/name: '([^']+)'/g)) names.push(m[1]);
for (const m of db.matchAll(/'([A-Z][a-zà-ù]+)'/g)) names.push(m[1]);
const changed = [];
for (const l of ['en', 'de', 'fr']) for (const n of names) if (T(l, n) !== n) changed.push(l + ': ' + n + ' -> ' + T(l, n));
// le caratteristiche dei giocatori ("Bomber", "Muro"...) sono parole, non nomi: si traducono
const traits = new Set(['Bomber', 'Muro', 'Regista', 'Dribblatore', 'Instancabile', 'Velocista', 'Destro', 'Sinistro', 'Difensiva', 'Equilibrata', 'Offensiva']);
const realNames = changed.filter(c => !traits.has(c.split(': ')[1].split(' -> ')[0]));
check('nomi delle squadre e dei giocatori mai tradotti (' + names.length + ' nomi)', names.length > 100 && realNames.length === 0, realNames.slice(0, 5));
check('anche in frasi: "Falchi di Brera 2-1 Orsi di Valle"', T('en', 'Falchi di Brera 2-1 Orsi di Valle') === 'Falchi di Brera 2-1 Orsi di Valle');

console.log('\nRisultato: ' + ok + ' superati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
