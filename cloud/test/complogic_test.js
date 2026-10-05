// Test delle regole delle competizioni (cloud/src/complogic.js), le stesse del gioco e del server.
import * as C from '../src/complogic.js';

let ok = 0, ko = 0;
const check = (name, cond, extra) => { if (cond) ok++; else ko++; console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : '')); };

// ---------- calendario ----------
let rrOk = true, rrWhy = null;
for (let n = 2; n <= 32; n++) for (const legs of [1, 2]) {
  const teams = Array.from({ length: n }, (_, i) => i);
  const rounds = C.roundRobin(teams, legs);
  const expRounds = (n % 2 ? n : n - 1) * legs, perRound = Math.floor(n / 2);
  const pairs = new Map(), homes = new Array(n).fill(0);
  if (rounds.length !== expRounds) { rrOk = false; rrWhy = { n, legs, rounds: rounds.length }; break; }
  for (const r of rounds) {
    if (r.length !== perRound) { rrOk = false; rrWhy = { n, legs, perRound: r.length }; }
    const seen = new Set();
    for (const g of r) {
      if (g.home === g.away) { rrOk = false; rrWhy = { n, self: g }; }
      if (seen.has(g.home) || seen.has(g.away)) { rrOk = false; rrWhy = { n, twice: g }; }
      seen.add(g.home); seen.add(g.away); homes[g.home]++;
      const k = Math.min(g.home, g.away) + '-' + Math.max(g.home, g.away);
      pairs.set(k, (pairs.get(k) || []).concat([g.home]));
    }
  }
  if (pairs.size !== n * (n - 1) / 2) { rrOk = false; rrWhy = { n, legs, pairs: pairs.size }; }
  for (const [k, hs] of pairs) {
    if (hs.length !== legs) { rrOk = false; rrWhy = { n, legs, k, hs }; }
    if (legs === 2 && hs[0] === hs[1]) { rrOk = false; rrWhy = { n, sameHome: k }; }
  }
  // casa e trasferta equilibrate (girone singolo: al massimo una partita di scarto, più il turno di riposo)
  if (legs === 1) { const mx = Math.max(...homes), mn = Math.min(...homes); if (mx - mn > 1) { rrOk = false; rrWhy = { n, homes }; } }
  if (legs === 2 && homes.some(h => h !== n - 1)) { rrOk = false; rrWhy = { n, legs, homes }; }
  if (!rrOk) break;
}
check('calendario 2..32 squadre, andata e andata/ritorno: niente doppioni, niente squadre contro sé stesse, una partita per turno, giornate complete', rrOk, rrWhy);
const r20 = C.roundRobin(Array.from({ length: 20 }, (_, i) => i), 2);
check('campionato a 20: 38 giornate da 10 partite (380 in tutto)', r20.length === 38 && r20.every(r => r.length === 10));
const r7 = C.roundRobin([0, 1, 2, 3, 4, 5, 6], 1);
check('7 squadre: 7 giornate da 3 partite, ognuna riposa una volta', r7.length === 7 && r7.every(r => r.length === 3) &&
  [0, 1, 2, 3, 4, 5, 6].every(t => r7.filter(r => !r.some(g => g.home === t || g.away === t)).length === 1));

// ---------- classifica ----------
const res = [
  { home: 'A', away: 'B', h: 2, a: 1 }, { home: 'C', away: 'D', h: 0, a: 0 },
  { home: 'B', away: 'C', h: 3, a: 0 }, { home: 'D', away: 'A', h: 1, a: 1 },
  { home: 'A', away: 'C', h: 0, a: 1 }, { home: 'B', away: 'D', h: 2, a: 2 },
];
const st = C.standings(['A', 'B', 'C', 'D'], res);
const row = t => st.find(r => r.team === t);
check('classifica: punti 3/1/0, partite, gol fatti e subiti, differenza reti', row('A').pt === 4 && row('A').pg === 3 && row('A').gf === 3 && row('A').gs === 3 && row('A').dr === 0 &&
  row('B').pt === 4 && row('B').gf === 6 && row('B').dr === 2 && row('C').pt === 4 && row('D').pt === 3 && row('D').n === 3, st);
check('classifica: a pari punti decidono gli scontri diretti (A ha battuto B, C ha battuto A, B ha battuto C: si passa alla differenza reti)',
  st[0].team === 'B' && st.map(r => r.team).join('') === 'BACD', st.map(r => r.team + r.pt + '/' + r.dr));
const st2 = C.standings(['X', 'Y', 'Z'], [{ home: 'X', away: 'Y', h: 1, a: 0 }, { home: 'Z', away: 'X', h: 3, a: 0 }, { home: 'Y', away: 'Z', h: 4, a: 0 }]);
check('classifica: forma, vittorie, porta inviolata, percentuale', row('C').form.join('') === 'NPV' && row('C').cleanSheets === 2 && row('C').winPct === 33.3 && st2.every(r => r.pt === 3));
const st3 = C.standings(['P', 'Q'], [{ home: 'P', away: 'Q', h: 1, a: 1 }, { home: 'Q', away: 'P', h: 2, a: 1 }]);
check('classifica: scontro diretto vinto davanti', st3[0].team === 'Q' && st3[0].pt === 4 && st3[1].pt === 1);
const streak = C.standings(['S', 'T'], [{ home: 'S', away: 'T', h: 1, a: 0 }, { home: 'T', away: 'S', h: 0, a: 2 }, { home: 'S', away: 'T', h: 3, a: 1 }]);
check('classifica: serie in corso (V3) e ultime 5', streak[0].streak === 'V3' && streak[1].streak === 'P3');

// ---------- tabellone ----------
for (const n of [8, 16, 32]) {
  const seeds = Array.from({ length: n }, (_, i) => 't' + i);
  const br = C.buildBracket(seeds);
  const names = br.map(r => r.name);
  const ok1 = br.length === Math.log2(n) && br[0].ties.length === n / 2 && br[br.length - 1].name === 'Finale' && br[br.length - 1].ties.length === 1;
  // vince sempre la squadra "a": il vincitore finale è t0
  for (let r = 0; r < br.length; r++) br[r].ties.forEach((t, i) => C.advanceBracket(br, r, i, t.a));
  check('torneo a ' + n + ': ' + names.join(' → ') + ', i vincenti avanzano, uno solo vince', ok1 && br[br.length - 1].ties[0].winner === 't0' && br[1].ties[0].a === 't0' && br[1].ties[0].b === 't2');
}
let threw = false; try { C.buildBracket([1, 2, 3]); } catch (e) { threw = true; }
check('tabellone: 3 squadre rifiutate (servono potenze di 2)', threw);
const tie1 = { a: 'A', b: 'B', legs: 1 };
check('sfida in gara unica: vince chi vince (anche ai rigori)', C.tieOutcome(tie1, [{ played: true, home: 'A', away: 'B', h: 1, a: 1, et: { h: 0, a: 0 }, pens: { h: 3, a: 4 }, winner: 1 }]).winner === 'B');
const tie2 = { a: 'A', b: 'B', legs: 2 };
check('andata e ritorno: somma dei gol (2-0 e 1-2 → passa A)', C.tieOutcome(tie2, [{ played: true, home: 'A', away: 'B', h: 2, a: 0 }, { played: true, home: 'B', away: 'A', h: 2, a: 1, winner: 0 }]).winner === 'A');
check('andata e ritorno: dopo l\'andata non è finita', C.tieOutcome(tie2, [{ played: true, home: 'A', away: 'B', h: 2, a: 0 }]) === null);
check('andata e ritorno: parità nella somma, decidono i rigori del ritorno', C.tieOutcome(tie2, [{ played: true, home: 'A', away: 'B', h: 1, a: 0 }, { played: true, home: 'B', away: 'A', h: 1, a: 0, et: { h: 0, a: 0 }, pens: { h: 5, a: 4 }, winner: 0 }]).winner === 'B');

// ---------- gironi ----------
const teams32 = Array.from({ length: 32 }, (_, i) => i);
const groups = C.drawGroups(teams32, t => 100 - t, 8, C.compRng(7));
check('gironi: 8 gironi da 4, una squadra per fascia in ogni girone, nessuna ripetuta',
  groups.length === 8 && groups.every(g => g.length === 4 && g.every((t, p) => t >= p * 8 && t < (p + 1) * 8)) && new Set(groups.flat()).size === 32);
const tables = groups.map(g => C.standings(g, []));
const ks = C.knockoutSeedsFromGroups(tables, 2);
check('dopo i gironi: 16 qualificate, le prime contro le seconde di un altro girone', ks.length === 16 && ks[0] === tables[0][0].team && ks[1] === tables[1][1].team && ks[2] === tables[1][0].team && ks[3] === tables[0][1].team);

// ---------- simulazione ----------
const mk = (lvl) => ({
  players: [{ role: 'GK', overall: lvl, attr: { gk: lvl, shot: 20, pass: 50, dribble: 30, speed: 40, defense: 30, physical: 60 }, name: 'Portiere' }]
    .concat(Array.from({ length: 10 }, (_, i) => ({ role: i < 4 ? 'DF' : i < 8 ? 'MF' : 'FW', overall: lvl, name: 'G' + i,
      attr: { gk: 20, shot: lvl + (i >= 8 ? 6 : -10), pass: lvl, dribble: lvl, speed: lvl, defense: lvl + (i < 4 ? 6 : -10), physical: lvl } }))),
});
const strong = C.teamProfile(mk(82)), weak = C.teamProfile(mk(64)), even = C.teamProfile(mk(73));
let w = 0, d = 0, l = 0, goals = 0, wE = 0, lE = 0;
const rng = C.compRng(12345);
for (let i = 0; i < 4000; i++) {
  const m = C.simulateMatch(strong, weak, rng, {});
  goals += m.h + m.a;
  if (m.h > m.a) w++; else if (m.h === m.a) d++; else l++;
  const e = C.simulateMatch(even, even, rng, {});
  if (e.h > e.a) wE++; else if (e.h < e.a) lE++;
}
check('simulazione: la squadra forte vince più spesso, ma non sempre (vittorie ' + (w / 40).toFixed(1) + '%, sconfitte ' + (l / 40).toFixed(1) + '%)', w / 4000 > 0.6 && w / 4000 < 0.92 && l > 40);
check('simulazione: squadre pari, il fattore campo pesa (casa ' + (wE / 40).toFixed(1) + '% contro ' + (lE / 40).toFixed(1) + '%)', wE > lE * 1.15 && wE / 4000 < 0.55);
check('simulazione: gol per partita realistici (' + (goals / 4000).toFixed(2) + ')', goals / 4000 > 1.9 && goals / 4000 < 3.6);
const a1 = C.simulateMatch(strong, weak, C.compRng(C.seedFor(99, 'm1')), {}), a2 = C.simulateMatch(strong, weak, C.compRng(C.seedFor(99, 'm1')), {});
check('simulazione: stesso seme, stesso risultato (non si può rilanciare)', JSON.stringify(a1) === JSON.stringify(a2) && C.seedFor(99, 'm1') !== C.seedFor(99, 'm2'));
let koOk = true, etSeen = 0, pensSeen = 0;
const rk = C.compRng(5);
for (let i = 0; i < 2000; i++) {
  const m = C.simulateMatch(even, even, rk, { knockout: true, extraTime: true, penalties: true, neutral: true });
  if (m.winner !== 0 && m.winner !== 1) koOk = false;
  if (m.et) etSeen++;
  if (m.pens) { pensSeen++; if (m.pens.h === m.pens.a) koOk = false; if (m.h + m.et.h !== m.a + m.et.a) koOk = false; }
  if (m.scorers.length !== m.h + m.a + (m.et ? m.et.h + m.et.a : 0)) koOk = false;
}
check('eliminazione diretta: sempre un vincitore; supplementari solo in parità (' + etSeen + '), rigori solo se ancora pari (' + pensSeen + ')', koOk && etSeen > 200 && pensSeen > 80 && pensSeen < etSeen);
const noPens = C.simulateMatch(even, even, C.compRng(1), { knockout: true, extraTime: false, penalties: false, aggregate: [0, 0] });
check('senza supplementari e rigori una parità chiede la ripetizione (vincitore nullo)', noPens.h !== noPens.a || noPens.winner === null);
const agg = C.simulateMatch(weak, strong, C.compRng(3), { knockout: true, extraTime: true, penalties: true, aggregate: [0, 9] });
check('ritorno: conta la somma con l\'andata (0-9 all\'andata: passa la squadra in trasferta)', agg.winner === 1 && !agg.et);
let shOk = true;
for (let i = 0; i < 500; i++) { const s = C.simulateShootout(even, weak, C.compRng(i + 1)); if (s.h === s.a || (s.winner === 0) !== (s.h > s.a) || s.kicks.length < 6) shOk = false; }
check('rigori: sempre un vincitore, almeno 3 tiri a testa, chiusura anticipata quando non si può più rimontare', shOk);

// ---------- riepilogo ----------
const sum = C.seasonSummary(st, res.map((m, i) => Object.assign({ played: true, scorers: i === 2 ? [{ team: 0, name: 'Bomber' }, { team: 0, name: 'Bomber' }, { team: 0, name: 'Altro' }] : [] }, m)));
check('fine stagione: campione, miglior attacco e difesa, capocannoniere, media gol', sum.champion === 'B' && sum.bestAttack.team === 'B' && sum.bestAttack.gf === 6 &&
  sum.bestDefense.gs === 3 && sum.topScorers[0].name === 'Bomber' && sum.topScorers[0].goals === 2 && sum.topScorers[0].team === 'B' && sum.matches === 6 && sum.goals === 13, sum);

console.log('\n' + ok + ' PASS, ' + ko + ' FAIL');
process.exit(ko ? 1 : 0);
