// Eliminazione diretta sul motore vero: supplementari, rigori (IA e giocatore umano), andata e ritorno, ripetizione.
// Uso: node tests/knockout_test.js
const fs = require('fs'), path = require('path');
const files = fs.readdirSync(path.join(__dirname, '../src')).filter(f => /^0[1-8]_/.test(f)).sort();
let code = files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, KnockoutMatch, buildDatabase, setSeed, CONFIG };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let ok = 0, fail = 0;
function check(name, cond, extra) { if (cond) { ok++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const noInput = { mx: 0, mz: 0, sprint: false, shoot: false, pressed: {} };
const db = (A.setSeed(5), A.buildDatabase(9));

// porta la partita alla fine del tempo in corso con il punteggio scelto (la simulazione resta quella vera)
function toEndOfHalf(m, score, input) {
  let guard = 0;
  const startHalf = m.half;
  while (m.half === startHalf && m.state !== 'FULLTIME' && !m.so && guard++ < 60 * 400) {
    if (m.state === 'PLAY' || m.state === 'SETPIECE' || m.state === 'KICKOFF') {
      const lim = m.half <= 2 ? 2700 : 900;
      if (m.clock < lim - 30) m.clock = lim - 30;
      m.teams[0].score = score[0]; m.teams[1].score = score[1];
    }
    m.update(1 / 60, input || noInput);
    if (m.state === 'HALFTIME') break;
  }
}
function run(m, secs, input) { for (let i = 0; i < secs * 60 && m.state !== 'FULLTIME'; i++) m.update(1 / 60, input || noInput); }
function playOut(m, maxSecs, input) { for (let i = 0; i < maxSecs * 60 && m.state !== 'FULLTIME'; i++) m.update(1 / 60, typeof input === 'function' ? input(m) : input || noInput); }

// 1. parità ai 90' -> supplementari -> parità -> rigori -> un vincitore
A.setSeed(11);
let m = new A.KnockoutMatch(db[0], db[1], { halfSeconds: 60, humanTeam: -1, knockout: { extraTime: true, penalties: true } });
toEndOfHalf(m, [1, 1]); run(m, 4);
toEndOfHalf(m, [1, 1]);
check('90 minuti in parità: si va ai supplementari (intervallo, poi terzo tempo)', m.state === 'HALFTIME' && m.regScore && m.regScore[0] === 1, { state: m.state, half: m.half });
run(m, 5);
check('primo supplementare: calcio d\'inizio, minuto oltre il 90°', m.half === 3 && m.minute() >= 90, { half: m.half, min: m.minute() });
toEndOfHalf(m, [2, 2]); run(m, 5);
check('secondo supplementare', m.half === 4, m.half);
toEndOfHalf(m, [2, 2]);
check('ancora pari dopo 120 minuti: rigori', !!m.so && m.state === 'SHOOTOUT', m.state);
playOut(m, 240);
const r = m.result();
check('rigori decisi dal motore: un vincitore, punteggi diversi, serie registrata (' + m.so.score.join('-') + ')',
  m.state === 'FULLTIME' && (r.winner === 0 || r.winner === 1) && r.pens && r.pens.h !== r.pens.a && m.so.log.length >= 6 && m.so.log.every(k => k.name), { r, log: m.so.log.length });
check('risultato per la competizione: 1-1 nei 90, 1-1 nei supplementari, poi rigori', r.h === 1 && r.a === 1 && r.et && r.et.h === 1 && r.et.a === 1, r);
check('nella serie le reti non cambiano il punteggio della partita', m.teams[0].score === 2 && m.teams[1].score === 2);
check('dopo i rigori tutti tornano nelle squadre', m.teams[0].players.length >= 10 && m.teams[1].players.length >= 10);

// 2. vittoria nei 90': niente supplementari
A.setSeed(12);
m = new A.KnockoutMatch(db[2], db[3], { halfSeconds: 60, humanTeam: -1 });
toEndOfHalf(m, [0, 0]); run(m, 4); toEndOfHalf(m, [2, 1]);
check('vittoria nei 90 minuti: fine, nessun supplementare', m.state === 'FULLTIME' && m.result().winner === 0 && !m.result().et && !m.result().pens, m.result());

// 3. ritorno: conta la somma con l'andata
A.setSeed(13);
m = new A.KnockoutMatch(db[2], db[3], { halfSeconds: 60, humanTeam: -1, knockout: { aggregate: [0, 2] } });
toEndOfHalf(m, [0, 0]); run(m, 4); toEndOfHalf(m, [2, 0]);
check('ritorno 2-0 dopo l\'andata 0-2 (somma pari): supplementari', m.state === 'HALFTIME' && m.half === 2 && m.regScore, { s: m.state, h: m.half });
A.setSeed(14);
m = new A.KnockoutMatch(db[2], db[3], { halfSeconds: 60, humanTeam: -1, knockout: { aggregate: [0, 2] } });
toEndOfHalf(m, [0, 0]); run(m, 4); toEndOfHalf(m, [1, 0]);
check('ritorno 1-0 dopo 0-2: passa la squadra in trasferta senza supplementari', m.state === 'FULLTIME' && m.result().winner === 1, m.result());

// 4. senza supplementari, con rigori
A.setSeed(15);
m = new A.KnockoutMatch(db[4], db[5], { halfSeconds: 60, humanTeam: -1, knockout: { extraTime: false, penalties: true } });
toEndOfHalf(m, [0, 0]); run(m, 4); toEndOfHalf(m, [0, 0]);
check('senza supplementari: subito i rigori', !!m.so && m.half === 2);
playOut(m, 240);
check('rigori senza supplementari: vincitore e nessun supplementare nel risultato', m.result().winner !== null && !m.result().et && m.result().pens, m.result());

// 5. né supplementari né rigori: parità, serve la ripetizione
A.setSeed(16);
m = new A.KnockoutMatch(db[4], db[5], { halfSeconds: 60, humanTeam: -1, knockout: { extraTime: false, penalties: false } });
toEndOfHalf(m, [0, 0]); run(m, 4); toEndOfHalf(m, [1, 1]);
check('senza supplementari né rigori: fine in parità, nessun vincitore (ripetizione)', m.state === 'FULLTIME' && m.result().winner === null);

// 6. rigori con il giocatore: il tiratore umano tira tenendo e rilasciando il tiro, il portiere umano sceglie il tuffo
A.setSeed(17);
m = new A.KnockoutMatch(db[0], db[1], { halfSeconds: 60, humanTeam: 0 });
toEndOfHalf(m, [0, 0]); run(m, 4); toEndOfHalf(m, [0, 0]); run(m, 5); toEndOfHalf(m, [0, 0]); run(m, 5); toEndOfHalf(m, [0, 0]);
check('rigori con un umano', !!m.so);
let humanKicks = 0, phaseT = 0;
const humanInput = mm => {
  const h = mm.humans[0], so = mm.so;
  if (!so || so.phase !== 'kick' || mm.state !== 'SETPIECE' || !mm.setPieceReady) { phaseT = 0; return noInput; }
  if (so.kicking === 0 && h.player === so.kicker) { phaseT++; if (phaseT === 1) humanKicks++; return { mx: 0, mz: 0.8, sprint: false, shoot: phaseT < 40, pressed: phaseT === 1 ? { shootDown: true } : {} }; }
  return { mx: 0, mz: -1, sprint: false, shoot: false, pressed: {} };   // in porta: tuffo a sinistra
};
playOut(m, 300, humanInput);
check('rigori: il giocatore ha tirato i suoi (' + humanKicks + ') e la serie è finita con un vincitore', m.state === 'FULLTIME' && humanKicks >= 3 && m.result().winner !== null, { humanKicks, st: m.state, so: m.so && m.so.score });

console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
