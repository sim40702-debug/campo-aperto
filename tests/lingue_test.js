// Test delle lingue (src/i18n/00_i18n.js e src/i18n/en.json, de.json, fr.json): righe complete, segnaposto uguali in tutte le lingue,
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
const { gameFile } = require('../scripts/sorgenti.js');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(gameFile('00_i18n.js'), 'utf8') + '\nthis.I18N = I18N; this.tr = tr; this.trf = trf; this.setLanguage = setLanguage; this.uiLocale = uiLocale; this.loadLanguages = loadLanguages;', ctx);
// un file per lingua: src/i18n/en.json, de.json, fr.json
const langs = {};
for (const l of ['en', 'de', 'fr']) langs[l] = JSON.parse(fs.readFileSync(path.join(root, 'src', 'i18n', l + '.json'), 'utf8'));
ctx.loadLanguages(langs);

// i tre file devono avere le stesse sezioni e le stesse frasi italiane
const keysOf = l => Object.keys(langs[l]).flatMap(sec => Object.keys(langs[l][sec]).map(k => sec + ' / ' + k));
const missing = [];
for (const a of ['en', 'de', 'fr']) for (const b of ['en', 'de', 'fr']) {
  const has = new Set(keysOf(b));
  for (const k of keysOf(a)) if (!has.has(k)) missing.push(b + '.json non ha: ' + k);
}
check('en.json, de.json e fr.json hanno le stesse frasi', missing.length === 0, missing.slice(0, 5));

// le righe [italiano, inglese, tedesco, francese] per controllarle una per una
const rows = [];
for (const sec in langs.en) for (const it in langs.en[sec])
  rows.push({ f: sec, r: [it, langs.en[sec][it], (langs.de[sec] || {})[it], (langs.fr[sec] || {})[it]] });
check('file delle traduzioni caricati (' + Object.keys(langs.en).length + ' sezioni, ' + rows.length + ' frasi)', Object.keys(langs.en).length >= 5 && rows.length > 1000);

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
const db = fs.readFileSync(gameFile('02_database.js'), 'utf8') + fs.readFileSync(gameFile('18_squadre.js'), 'utf8');
for (const m of db.matchAll(/name: '([^']+)'/g)) names.push(m[1]);
for (const m of db.matchAll(/'([A-Z][a-zà-ù]+)'/g)) names.push(m[1]);
const changed = [];
for (const l of ['en', 'de', 'fr']) for (const n of names) if (T(l, n) !== n) changed.push(l + ': ' + n + ' -> ' + T(l, n));
// le caratteristiche dei giocatori ("Bomber", "Muro"...) sono parole, non nomi: si traducono
const traits = new Set(['Bomber', 'Muro', 'Regista', 'Dribblatore', 'Instancabile', 'Velocista', 'Destro', 'Sinistro', 'Difensiva', 'Equilibrata', 'Offensiva']);
const realNames = changed.filter(c => !traits.has(c.split(': ')[1].split(' -> ')[0]));
check('nomi delle squadre e dei giocatori mai tradotti (' + names.length + ' nomi)', names.length > 100 && realNames.length === 0, realNames.slice(0, 5));
check('anche in frasi: "Falchi di Brera 2-1 Orsi di Valle"', T('en', 'Falchi di Brera 2-1 Orsi di Valle') === 'Falchi di Brera 2-1 Orsi di Valle');

// ---- telecronaca: ogni frase ha la sua traduzione
const comm = fs.readFileSync(gameFile('21_commentary.js'), 'utf8');
const phrases = [...comm.slice(comm.indexOf('const COMMENTARY ='), comm.indexOf('const COMMENTARY_RANK')).matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"));
const untranslated = [];
for (const l of ['en', 'de', 'fr']) for (const p of phrases) { ctx.setLanguage(l); if (ctx.trf(p, 'X') === p.replace('{0}', 'X')) untranslated.push(l + ': ' + p); }
check('telecronaca: tutte le ' + phrases.length + ' frasi tradotte', phrases.length > 30 && untranslated.length === 0, untranslated.slice(0, 5));

console.log('\nRisultato: ' + ok + ' superati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
