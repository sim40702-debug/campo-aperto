// Test del motore delle schedine (compatibilità, bonus, quote collegate, liquidazione delle multiple).
// node test/betlogic_test.js
import fs from 'node:fs';
import { validateBetCombination, checkAdd, slipTotals, bonusFor, jointProbability, settleBy, implied, BONUS_TIERS } from '../src/betlogic.js';
import { pairModel, buildMarkets, settleBet, factsFromMatch } from '../src/markets.js';

const model = JSON.parse(fs.readFileSync(new URL('../src/odds-model.json', import.meta.url), 'utf8'));
let pass = 0, failN = 0;
const check = (name, cond, info) => { if (cond) { pass++; console.log('PASS', name); } else { failN++; console.log('FAIL', name, info === undefined ? '' : JSON.stringify(info)); } };
const S = (fixture, market, selection, odds) => ({ fixture, market, selection, odds: odds || 2 });
const valid = list => validateBetCombination(list).ok;

// ---- singole
for (const [m, s] of [['1X2', '1'], ['TG', 'O1.5'], ['BTTS', 'SI'], ['CS', '1-0'], ['DC', 'X2'], ['TC', 'O4.5'], ['RED', 'SI'], ['POS', '2']]) check('singola ' + m + ' ' + s, valid([S('A', m, s)]));
check('selezione inesistente rifiutata', !valid([S('A', 'CS', '9-9')]) && !valid([S('A', 'ZZZ', '1')]));

// ---- stessa partita (casi richiesti)
const cases = [
  ['1 + Over 1.5', [['1X2', '1'], ['TG', 'O1.5']], true],
  ['1 + BTTS Sì', [['1X2', '1'], ['BTTS', 'SI']], true],
  ['1 + Over 2.5', [['1X2', '1'], ['TG', 'O2.5']], true],
  ['1-0 + Under 2.5', [['CS', '1-0'], ['TG', 'U2.5']], true],
  ['1-0 + Over 1.5', [['CS', '1-0'], ['TG', 'O1.5']], false],
  ['1-0 + BTTS Sì', [['CS', '1-0'], ['BTTS', 'SI']], false],
  ['1-0 + BTTS No', [['CS', '1-0'], ['BTTS', 'NO']], true],
  ['1-0 + Over 2.5', [['CS', '1-0'], ['TG', 'O2.5']], false],
  ['2-1 + Over 2.5', [['CS', '2-1'], ['TG', 'O2.5']], true],
  ['2-1 + Under 2.5', [['CS', '2-1'], ['TG', 'U2.5']], false],
  ['2-2 + BTTS Sì', [['CS', '2-2'], ['BTTS', 'SI']], true],
  ['2-2 + Over 3.5', [['CS', '2-2'], ['TG', 'O3.5']], true],
  ['2-2 + Under 3.5', [['CS', '2-2'], ['TG', 'U3.5']], false],
  ['1 + X', [['1X2', '1'], ['1X2', 'X']], false],
  ['1 + 2', [['1X2', '1'], ['1X2', '2']], false],
  ['1X + 2', [['DC', '1X'], ['1X2', '2']], false],
  ['Over 2.5 + Under 2.5', [['TG', 'O2.5'], ['TG', 'U2.5']], false],
  ['Inter vincente + Over 1.5 + BTTS Sì + Over 4.5 corner', [['1X2', '1'], ['TG', 'O1.5'], ['BTTS', 'SI'], ['TC', 'O4.5']], true],
  ['1-0 + primo gol ospiti', [['CS', '1-0'], ['FG', '2']], false],
  ['1-0 + primo gol casa + ultimo gol casa', [['CS', '1-0'], ['FG', '1'], ['LG', '1']], true],
  ['0-0 + primo gol nessuno', [['CS', '0-0'], ['FG', 'N']], true],
  ['0-0 + porta inviolata ospiti No', [['CS', '0-0'], ['CSA', 'NO']], false],
  ['1 + porta inviolata casa Sì + BTTS Sì', [['1X2', '1'], ['CSH', 'SI'], ['BTTS', 'SI']], false],
  ['primo tempo 2-0 (HT 1 + Gol 1T Over 1.5) + Under 1.5', [['HT', '1'], ['G1', 'O1.5'], ['TG', 'U1.5']], false],
  ['HT casa + finale ospiti', [['HT', '1'], ['1X2', '2']], true],
  ['handicap casa -1,5 + pareggio', [['HCP', 'H-1.5'], ['1X2', 'X']], false],
  ['espulsione Sì + cartellini Under 0.5', [['RED', 'SI'], ['TK', 'U0.5']], false],
  ['espulsione Sì + cartellini Over 0.5', [['RED', 'SI'], ['TK', 'O0.5']], true],
  ['primo corner casa + corner casa Under 0.5', [['FC', '1'], ['HC', 'U0.5']], false],
  ['tiri in porta Over 6.5 + tiri Under 5.5', [['TOT', 'O6.5'], ['TS', 'U5.5']], false],
  ['possesso casa + possesso ospiti', [['POS', '1'], ['POS', '2']], false],
  ['rigore Sì + rigore No', [['PEN', 'SI'], ['PEN', 'NO']], false],
  ['corner e cartellini indipendenti dai gol (0-0 + Over 4.5 corner + Over 2.5 cartellini)', [['CS', '0-0'], ['TC', 'O4.5'], ['TK', 'O2.5']], true],
];
for (const [name, sels, want] of cases) check((want ? 'valido: ' : 'INVALIDO: ') + name, valid(sels.map(([m, s]) => S('A', m, s))) === want);

// ---- più partite
check('multipla su 3 partite: A (1 + Over 1.5), B (X + Under 3.5), C (BTTS Sì)',
  valid([S('A', '1X2', '1'), S('A', 'TG', 'O1.5'), S('B', '1X2', 'X'), S('B', 'TG', 'U3.5'), S('C', 'BTTS', 'SI')]));
check('1 e 2 su partite diverse: valido', valid([S('A', '1X2', '1'), S('B', '1X2', '2')]));
check('stessa selezione due volte: rifiutata', !valid([S('A', '1X2', '1'), S('A', '1X2', '1')]));

// ---- conflitto: si indica quale selezione lo causa
const slip = [S('A', 'CS', '1-0'), S('A', 'TC', 'O4.5'), S('B', 'TG', 'O2.5')];
const add = checkAdd(slip, S('A', 'TG', 'O1.5'));
check('aggiunta incompatibile: indica la selezione in conflitto (1-0)', !add.ok && add.code === 'INCOMPATIBLE' && add.conflicts.length === 1 && add.conflicts[0] === 0, add);
check('aggiunta compatibile', checkAdd(slip, S('A', 'TG', 'U2.5')).ok);
const add3 = checkAdd([S('A', 'HT', '1'), S('A', 'G2', 'O0.5')], S('A', 'TG', 'U1.5'));   // coppie possibili, tutte e tre no
check('conflitto a tre (gol nel 1° tempo + gol nel 2° tempo + Under 1.5): indica entrambe le selezioni', !add3.ok && add3.conflicts.length === 2, add3);

// ---- bonus a soglie
check('bonus: 4 → 0, 5 → 5%, 10 → 10%, 15 → 15%, 20 → 25%', bonusFor(4) === 0 && bonusFor(5) === 0.05 && bonusFor(9) === 0.05 && bonusFor(10) === 0.10 && bonusFor(15) === 0.15 && bonusFor(20) === 0.25, BONUS_TIERS);
const mk = n => Array.from({ length: n }, (_, i) => S('F' + i, '1X2', '1', 1.5));
for (const n of [4, 5, 10, 15, 20]) {
  const t = slipTotals(mk(n));
  const base = Math.pow(1.5, n);
  check(n + ' selezioni su partite diverse: quota base = prodotto, bonus ' + Math.round(t.bonus * 100) + '%', Math.abs(t.base - base) < 1e-9 && Math.abs(t.total - base * (1 + bonusFor(n))) < 1e-9 && t.bonusCount === n);
}
check('esempio 1.80 × 1.50 × 1.70 × 1.90 = 8.721 (nessun bonus con 4)', Math.abs(slipTotals([S('A', '1X2', '1', 1.8), S('B', 'TG', 'O1.5', 1.5), S('C', 'BTTS', 'SI', 1.7), S('D', 'TG', 'O2.5', 1.9)]).total - 8.721) < 1e-9);
const low = slipTotals([...mk(4), S('X', 'DC', '1X', 1.1)]);
check('una selezione sotto 1.20 non conta per il bonus', low.bonusCount === 4 && low.bonus === 0);
const red = slipTotals([S('A', 'CS', '1-0', 8), S('A', 'TG', 'U2.5', 1.5), S('A', 'BTTS', 'NO', 1.6), S('A', 'TG', 'U1.5', 2.2), S('B', '1X2', '1', 2)]);
check('selezioni implicate (1-0 ⇒ Under 2.5, BTTS No, Under 1.5) non contano per il bonus', red.bonusCount === 2 && red.redundant.filter(Boolean).length === 3, red.redundant);
check('implicazione: 2-2 ⇒ Over 3.5 e BTTS Sì', implied([S('A', 'CS', '2-2')], S('A', 'TG', 'O3.5')) && implied([S('A', 'CS', '2-2')], S('A', 'BTTS', 'SI')) && !implied([S('A', 'CS', '2-2')], S('A', 'TG', 'O4.5')));

// ---- quote collegate della stessa partita: probabilità congiunta dal modello
const pm = pairModel(model, 0, 1);
const mkts = buildMarkets(model, 0, 1, { home: 'Casa', away: 'Ospiti' });
const book = (m, s) => mkts.book[m + ':' + s];
const single = jointProbability(pm, [S('A', '1X2', '1')]);
check('probabilità congiunta di una sola selezione = quella del listino (1X2 "1": ' + single.toFixed(4) + ' vs ' + book('1X2', '1').p + ')', Math.abs(single - book('1X2', '1').p) < 0.01);
const pCS = jointProbability(pm, [S('A', 'CS', '1-0')]), pCSU = jointProbability(pm, [S('A', 'CS', '1-0'), S('A', 'TG', 'U2.5')]);
check('1-0 + Under 2.5: stessa probabilità di 1-0 (Under 2.5 non aggiunge rischio)', Math.abs(pCS - pCSU) < 1e-12, [pCS, pCSU]);
const pInd = jointProbability(pm, [S('A', '1X2', '1'), S('A', 'TC', 'O0.5')]);
check('gruppi indipendenti: probabilità = prodotto (esito × corner)', Math.abs(pInd - jointProbability(pm, [S('A', '1X2', '1')]) * jointProbability(pm, [S('A', 'TC', 'O0.5')])) < 1e-12);
const t0 = Date.now();
for (let i = 0; i < 50; i++) jointProbability(pm, [S('A', 'HT', '1'), S('A', 'FG', '1'), S('A', 'TG', 'O2.5'), S('A', 'TC', 'O2.5'), S('A', 'TK', 'O1.5'), S('A', 'TS', 'O9.5')]);
check('calcolo veloce (50 schedine complesse in ' + (Date.now() - t0) + ' ms)', Date.now() - t0 < 500);

// ---- liquidazione delle multiple
const F = { g: [2, 1], g1: [1, 0], c: [3, 1], k: [1, 2], s: [6, 4], o: [4, 2], pos: [55, 45], firstGoal: 0, lastGoal: 1, firstCorner: 1, firstCard: 0, red: false, pen: true };
check('liquidazione dalle regole: 2-1 → 1X2 "1" vinta, Over 2.5 vinta, BTTS Sì vinta, 1-0 persa', settleBy('1X2', '1', F) === 'WON' && settleBy('TG', 'O2.5', F) === 'WON' && settleBy('BTTS', 'SI', F) === 'WON' && settleBy('CS', '1-0', F) === 'LOST');
const it = (status, odds, flag) => ({ status, odds, bonusFlag: flag === undefined ? 1 : flag });
check('tutte vincenti: puntata × prodotto × bonus', settleBet(100, [it('WON', 2), it('WON', 1.5), it('WON', 1.5), it('WON', 1.5), it('WON', 1.5)], 0.05).payout === Math.floor(100 * 2 * Math.pow(1.5, 4) * 1.05));
check('una perdente: multipla persa', settleBet(100, [it('WON', 2), it('LOST', 1.5), it('WON', 3)], 0).status === 'LOST');
const v = settleBet(100, [it('WON', 2), it('VOID', 1.5), it('WON', 1.5), it('WON', 1.5), it('WON', 1.5)], 0.05);
check('una VOID: tolta dal prodotto e bonus ricalcolato (4 valide → niente bonus)', v.status === 'WON' && v.payout === Math.floor(100 * 2 * 1.5 * 1.5 * 1.5), v);
check('bonus mai più alto di quello concesso alla giocata (schedine vecchie: 0)', settleBet(100, [it('WON', 1.5), it('WON', 1.5), it('WON', 1.5), it('WON', 1.5), it('WON', 1.5)], 0).payout === Math.floor(100 * Math.pow(1.5, 5)));
check('partita annullata: tutto VOID = rimborso', JSON.stringify(settleBet(50, [it('VOID', 2), it('VOID', 3)], 0.05)) === JSON.stringify({ status: 'VOID', payout: 50 }));
void factsFromMatch;

console.log('\n' + pass + ' PASS, ' + failN + ' FAIL');
process.exit(failN ? 1 : 0);
