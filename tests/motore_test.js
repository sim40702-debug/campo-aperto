// Test delle novità del motore: sostituzioni, dribbling, punizioni e rigori mirati.
// E soprattutto: senza le opzioni nuove una partita tra IA esce identica (le partite del server non cambiano).
// uso: node tests/motore_test.js
const fs = require('fs');
const path = require('path');
const files = require('../scripts/sorgenti.js').gameFiles(/^0[1-8]_/);
let code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, KnockoutMatch, buildDatabase, setSeed, makeRng, CONFIG, SUBS };';
require('vm').runInThisContext(code);
const API = globalThis.__api;
let ok = 0, ko = 0;
function check(name, cond, extra) {
  if (cond) ok++; else ko++;
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
}
const DT = API.CONFIG.DT;
const db = API.buildDatabase(2026);

// partita completa con un seme: ritorna il "riassunto" (risultato, tiri, eventi)
function play(seed, opts, each) {
  const m = new API.Match(db[seed % 8], db[(seed + 3) % 8], Object.assign({ halfSeconds: 120, humanTeam: -1, rng: API.makeRng(seed) }, opts));
  let steps = 0;
  const subs = [];
  while (m.state !== 'FULLTIME' && steps < 60 * 60 * 10) {
    m.update(DT, null);
    if (each) each(m, steps);
    for (const e of m.events) if (e.type === 'ref' && e.data.type === 'SUB') subs.push(e.data);
    m.events.length = 0;
    steps++;
  }
  return { m, sig: [m.teams[0].score, m.teams[1].score, m.teams[0].stats.shots, m.teams[1].stats.shots, m.teams[0].stats.passes, m.timeline.length, steps].join(','), subs };
}

// ---- 1. stesso seme, stessa partita (e la funzione dei cambi spenta non cambia niente)
const a = play(11, {}), b = play(11, {});
check('stesso seme: partita identica', a.sig === b.sig, [a.sig, b.sig]);
check('senza opts.subs nessun cambio', a.subs.length === 0);
// impronta delle partite del server prima delle novità (motore 0.10.0): devono restare uguali
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'motore_ref.json'), 'utf8'));
const now = {};
for (const s of [3, 11, 27, 40]) now[s] = play(s, {}).sig;
const diff = Object.keys(REF).filter(s => REF[s] !== now[s]);
check('partite tra IA come nella 0.10.0 (4 semi: risultato, tiri, passaggi, eventi, durata)', diff.length === 0, diff.map(s => [s, REF[s], now[s]]));

// ---- 2. sostituzioni dell'IA
const c = play(5, { subs: true });
check('IA: cambi nel secondo tempo (' + c.subs.length + ')', c.subs.length >= 1 && c.subs.length <= 2 * API.SUBS.AI_MAX, c.subs.length);
check('IA: cambi solo dopo il minuto ' + API.SUBS.AI_FROM_MINUTE, c.subs.every(s => s.minute >= API.SUBS.AI_FROM_MINUTE), c.subs.map(s => s.minute));
const t0 = c.m.teams[0];
check('dopo i cambi: 11 in campo, panchina più corta, uscito registrato', t0.players.length === 11 && t0.bench.length === 7 - (t0.subsMade || 0) && (t0.subbedOff || []).length === (t0.subsMade || 0));
check('nessun portiere cambiato dall\'IA', c.m.teams.every(t => t.players[0].isGK));

// ---- 3. cambio chiesto da un umano: avviene alla prossima palla ferma
{
  const m = new API.Match(db[0], db[4], { halfSeconds: 120, humanTeam: 0, subs: true, rng: API.makeRng(9) });
  const t = m.teams[0], out = t.players[5], outName = out.data.name, inData = t.bench[3];
  m.state = 'PLAY';
  check('cambio accettato', m.requestSub(t, out, 3) === true);
  check('portiere con un giocatore di movimento: rifiutato', m.requestSub(t, t.players[0], 3) === false);
  check('ancora in campo finché il gioco va', out.data.name === outName);
  m.startSetPiece = m.startSetPiece; // (nessun cambio di comportamento)
  m.pendingSetPiece = { type: 'THROW_IN', team: t, x: 0, z: 34 };
  m.startSetPiece();
  check('alla palla ferma entra il panchinaro, stesso posto in campo', out.data === inData && t.players.includes(out) && out.energy === 100, out.data.name);
  check('cambi rimasti', m.subsLeft(t) === API.SUBS.MAX - 1);
  check('l\'IA non cambia la squadra di un umano', (m.teams[0].subsMade || 0) === 1);
  let n = 0; for (let i = 0; i < 10; i++) if (m.requestSub(t, t.players[1 + (i % 9)], 0)) n++;
  check('al massimo ' + API.SUBS.MAX + ' cambi', n <= API.SUBS.MAX - 1 && m.subsLeft(t) >= 0, n);
}

// ---- 4. finta
{
  const m = new API.Match(db[0], db[4], { halfSeconds: 120, humanTeam: 0, rng: API.makeRng(4) });
  m.state = 'PLAY';
  const t = m.teams[0], p = t.players[9], opp = m.teams[1].players[3];
  m.ball.owner = p; p.facing = 0; p.vx = 4; p.vz = 0;
  opp.x = p.x + 1.2; opp.z = p.z + 0.4;
  const did = m.humanDribble(p, { mx: 0, mz: 0 });
  check('finta: scarto di lato (velocità laterale), protezione e attesa', did && Math.abs(p.vz) > 2 && p.dribbleShield > 0 && p.dribbleCooldown > 0, [p.vx, p.vz]);
  check('finta: non si ripete subito', m.humanDribble(p, { mx: 0, mz: 0 }) === false);
  let dodged = 0;
  for (let i = 0; i < 200; i++) {
    p.dribbleShield = 0.4; opp.tackleCooldown = 0; m.ball.owner = p;
    const d = m.resolveTackle(opp, p, false);
    if (d && d.reason === 'Dribbling riuscito') dodged++;
  }
  check('finta: una parte dei contrasti va a vuoto (' + dodged + '/200)', dodged > 30 && dodged < 180, dodged);
  for (let i = 0; i < 6; i++) p.update(0.2);
  check('finta: la protezione finisce', !(p.dribbleShield > 0) && !(p.dribbleCooldown > 0));
}

// ---- 5. rigore con il mirino
{
  const m = new API.Match(db[1], db[2], { halfSeconds: 120, humanTeam: 0, rng: API.makeRng(8) });
  const t = m.teams[0];
  m.pendingSetPiece = { type: 'PENALTY', team: t, x: t.oppGoalX() - t.dir * 11, z: 0 };
  m.startSetPiece();
  const h = m.humans[0], taker = m.setPiece.taker;
  h.player = taker; m.setPieceReady = true;
  // mezzo secondo di "su" (lato) e "verso la porta" (altezza), poi tiro caricato
  for (let i = 0; i < 30; i++) { h.input = { mx: t.dir, mz: 1, shoot: false, pressed: {} }; m.humanSetPieceInput(taker, h, DT); }
  const aim = { z: h.aim.z, y: h.aim.y };
  check('mirino: si sposta di lato e in alto', aim.z > 1.5 && aim.y > 0.9 && m.aimMarker && m.aimMarker.z === aim.z, aim);
  for (let i = 0; i < 40; i++) { h.input = { mx: 0, mz: 0, shoot: true, pressed: {} }; m.humanSetPieceInput(taker, h, DT); }
  h.input = { mx: 0, mz: 0, shoot: false, pressed: {} };
  m.humanSetPieceInput(taker, h, DT);
  const b = m.ball;
  check('mirino: tiro partito verso il lato scelto, mirino sparito', m.state === 'PLAY' && Math.sign(b.vz) === 1 && !m.aimMarker, [b.vx, b.vz]);
}

console.log('\nRisultato: ' + ok + ' superati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
