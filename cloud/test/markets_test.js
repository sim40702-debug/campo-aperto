// Test dei mercati (modulo puro): quote, linee, liquidazione, multiple, vincite.
// node test/markets_test.js
import fs from 'node:fs';
import { buildMarkets, settleSelection, settleBet, payoutOf, currentOdds, linesFor, MIN_ODDS, MAX_ODDS, GROUPS } from '../src/markets.js';

const model = JSON.parse(fs.readFileSync(new URL('../src/odds-model.json', import.meta.url), 'utf8'));
let pass = 0, failN = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('PASS', name); } else { failN++; console.log('FAIL', name, info === undefined ? '' : JSON.stringify(info)); }
}
const names = { home: 'Casa', away: 'Ospiti' };
const F = { g: [2, 1], g1: [1, 0], c: [3, 1], k: [1, 2], s: [6, 4], o: [4, 2], pos: [55, 45], firstGoal: 0, lastGoal: 1, firstCorner: 1, firstCard: 0, red: false, pen: true };

// 1. ogni coppia calibrata produce quote nei limiti, gruppi validi, selezioni coerenti
let allOk = true, nMk = 0, sumOk = true;
for (const key of Object.keys(model.pairs)) {
  const [h, a] = key.split('-').map(Number);
  const mk = buildMarkets(model, h, a, names);
  for (const m of mk.markets) {
    nMk++;
    if (!GROUPS.includes(m.group)) allOk = false;
    for (const s of m.sels) { const b = mk.book[m.id + ':' + s.id]; if (!b || b.o < MIN_ODDS || b.o > MAX_ODDS) allOk = false; }
  }
  // 1X2: le probabilità sommano a 1 (Poisson troncato a 12 gol)
  const p = ['1', 'X', '2'].reduce((s, x) => s + mk.book['1X2:' + x].p, 0);
  if (Math.abs(p - 1) > 0.002) sumOk = false;
}
check('quote nei limiti [' + MIN_ODDS + ', ' + MAX_ODDS + '] per tutte le coppie (' + nMk + ' mercati)', allOk);
check('1X2: probabilità che sommano a 1', sumOk);

// 2. margine: la somma delle probabilità implicite supera 1 (banco), ma di poco
const mk01 = buildMarkets(model, 0, 1, names);
const over = ['1', 'X', '2'].reduce((s, x) => s + 1 / mk01.book['1X2:' + x].o, 0);
check('margine del banco 1X2 tra 1 e 1.12 (' + over.toFixed(3) + ')', over > 1 && over < 1.12);

// 3. linee
check('linee vicine alla media', JSON.stringify(linesFor(2.4)) === JSON.stringify([1.5, 2.5, 3.5]) && JSON.stringify(linesFor(0.1)) === JSON.stringify([0.5, 1.5]));

// 4. liquidazione delle selezioni con fatti noti
const S = (m, s) => settleSelection(model, 0, 1, names, m, s, F);
const cases = [
  ['1X2', '1', 'WON'], ['1X2', 'X', 'LOST'], ['1X2', '2', 'LOST'], ['DC', '1X', 'WON'], ['DC', 'X2', 'LOST'], ['DC', '12', 'WON'],
  ['HT', '1', 'WON'], ['HCP', 'H-1.5', 'LOST'], ['HCP', 'A+1.5', 'WON'], ['CS', '2-1', 'WON'], ['CS', '1-1', 'LOST'], ['CS', 'ALTRO', 'LOST'],
  ['TG', 'O2.5', 'WON'], ['TG', 'U2.5', 'LOST'], ['TG', 'O0.5', 'WON'], ['BTTS', 'SI', 'WON'], ['BTTS', 'NO', 'LOST'],
  ['G1', 'O0.5', 'WON'], ['G2', 'O1.5', 'WON'], ['FG', '1', 'WON'], ['FG', 'N', 'LOST'], ['LG', '2', 'WON'], ['CSH', 'NO', 'WON'], ['CSA', 'SI', 'LOST'],
  ['FK', '1', 'WON'], ['RED', 'NO', 'WON'], ['PEN', 'SI', 'WON'], ['POS', '1', 'WON'], ['POS', '2', 'LOST'],
  ['XXX', '1', 'VOID'], ['1X2', 'Z', 'VOID'],
];
const wrong = cases.filter(([m, s, want]) => S(m, s) !== want).map(([m, s, want]) => [m, s, want, S(m, s)]);
check('liquidazione di ' + cases.length + ' selezioni su fatti noti', wrong.length === 0, wrong);
check('fatti mancanti o partita annullata = VOID', settleSelection(model, 0, 1, names, '1X2', '1', null) === 'VOID' && settleSelection(model, 0, 1, names, '1X2', '1', { void: true }) === 'VOID');
// linee che dipendono dalla coppia: corner e tiri in porta con la linea vera del mercato
const tc = mk01.markets.find(m => m.id === 'TC');
if (tc) {
  const line = Number(tc.sels[0].id.slice(1));
  const tot = F.c[0] + F.c[1];
  check('corner totali: Più di ' + line + ' con ' + tot + ' corner', S('TC', 'O' + line) === (tot > line ? 'WON' : 'LOST') && S('TC', 'U' + line) === (tot < line ? 'WON' : 'LOST'));
} else check('mercato corner presente', false);

// 5. scommesse: singola, multipla, annullate, aperte
check('singola vinta', JSON.stringify(settleBet(100, [{ status: 'WON', odds: 1.85 }])) === JSON.stringify({ status: 'WON', payout: 185 }));
check('singola persa', settleBet(100, [{ status: 'LOST', odds: 1.85 }]).status === 'LOST' && settleBet(100, [{ status: 'LOST', odds: 1.85 }]).payout === 0);
check('multipla: una persa = persa', settleBet(50, [{ status: 'WON', odds: 2 }, { status: 'LOST', odds: 3 }]).status === 'LOST');
check('multipla: una persa = persa anche con altre partite da giocare', settleBet(50, [{ status: 'LOST', odds: 2 }, { status: 'OPEN', odds: 3 }]).status === 'LOST');
check('multipla: aperta finché manca una partita', settleBet(50, [{ status: 'WON', odds: 2 }, { status: 'OPEN', odds: 3 }]) === null);
check('multipla vinta: prodotto delle quote', settleBet(50, [{ status: 'WON', odds: 2 }, { status: 'WON', odds: 3.1 }]).payout === 310);
check('multipla con una annullata: quota 1 per quella', settleBet(50, [{ status: 'WON', odds: 2 }, { status: 'VOID', odds: 3.1 }]).payout === 100);
check('tutte annullate = rimborso', JSON.stringify(settleBet(70, [{ status: 'VOID', odds: 2 }])) === JSON.stringify({ status: 'VOID', payout: 70 }));
check('vincita indipendente dall\'ordine delle quote', payoutOf(100, [1.85, 2.1]) === payoutOf(100, [2.1, 1.85]) && payoutOf(100, [1.85, 2.1]) === 388);
check('vincita arrotondata per difetto', payoutOf(3, [1.33]) === 3 && payoutOf(10, [1.37]) === 13);

// 6. quota dinamica: scende solo se una selezione è giocata molto più del suo peso
check('quota invariata senza puntate', currentOdds(2.5, 0.38, '1', {}) === 2.5);
check('quota invariata con puntate equilibrate', currentOdds(2.5, 0.38, '1', { 1: 380, X: 300, 2: 320 }) === 2.5);
const low = currentOdds(2.5, 0.38, '1', { 1: 5000, X: 100 });
check('quota più bassa se sbilanciata (' + low + ')', low < 2.5 && low >= 2.5 * 0.8);
check('quota mai sotto il minimo', currentOdds(1.05, 0.9, '1', { 1: 100000 }) >= MIN_ODDS);

console.log('\n' + pass + ' PASS, ' + failN + ' FAIL');
process.exit(failN ? 1 : 0);
