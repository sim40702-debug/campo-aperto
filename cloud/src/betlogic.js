// ============================================================
// LOGICA DELLE SCHEDINE — modulo puro, lo stesso nel server e nel gioco (build.js lo include nel client)
//
// Ogni selezione è una condizione sui "fatti" della partita: gol per squadra e per tempo, ordine dei gol,
// corner, cartellini, espulsione, rigore, tiri, possesso. La stessa condizione serve per:
//  - la liquidazione (vinta/persa con i fatti veri della partita);
//  - la compatibilità: una combinazione è possibile solo se esiste almeno un esito della partita che le
//    soddisfa tutte. Non c'è una lista di coppie vietate: si provano gli esiti possibili.
// I mercati sono divisi in gruppi indipendenti (gol, corner, cartellini, rigore, tiri, possesso): una
// combinazione è possibile se lo è in ogni gruppo, e ogni gruppo si controlla da solo (pochi esiti, veloce).
// Un mercato nuovo si aggiunge con una riga in RULES: gruppo e condizione.
// ============================================================

// ---------- configurazione centrale delle multiple ----------
export const MAX_SELECTIONS = 20;            // selezioni in una schedina
export const BONUS_TIERS = [[5, 0.05], [10, 0.10], [15, 0.15], [20, 0.25]];   // [selezioni, bonus]
export const BONUS_MIN_ODDS = 1.2;           // una selezione conta per il bonus solo da questa quota in su
export const MAX_TOTAL_ODDS = 10000;         // quota finale massima
export const MAX_PAYOUT = 1000000;           // vincita massima di una schedina (monete)

export function bonusFor(count) {
  let b = 0;
  for (const [n, v] of BONUS_TIERS) if (count >= n) b = v;
  return b;
}
export function nextBonusTier(count) {
  for (const [n, v] of BONUS_TIERS) if (count < n) return { at: n, bonus: v, missing: n - count };
  return null;
}

// ---------- regole dei mercati ----------
// linea dentro l'id della selezione: "O2.5" / "U2.5"
function overUnder(value) {
  return (F, sel) => {
    const m = /^([OU])(\d{1,2}(?:\.5)?)$/.exec(sel);
    if (!m) return null;
    const v = value(F), l = Number(m[2]);
    return m[1] === 'O' ? v > l : v < l;
  };
}
function lineOf(sel) { const m = /^[OU](\d{1,2}(?:\.5)?)$/.exec(sel); return m ? Number(m[1]) : 0; }
const yesNo = value => (F, sel) => (sel === 'SI' ? !!value(F) : sel === 'NO' ? !value(F) : null);
const firstOf = key => (F, sel) => (sel === '1' ? F[key] === 0 : sel === '2' ? F[key] === 1 : sel === 'N' ? F[key] === -1 : null);
const goals = F => F.g[0] + F.g[1];

// group: gruppo di fatti da cui dipende il mercato; half/order: servono il primo tempo / l'ordine dei gol
export const RULES = {
  '1X2': { group: 'goals', test: (F, s) => (s === '1' ? F.g[0] > F.g[1] : s === 'X' ? F.g[0] === F.g[1] : s === '2' ? F.g[0] < F.g[1] : null) },
  DC: { group: 'goals', test: (F, s) => (s === '1X' ? F.g[0] >= F.g[1] : s === 'X2' ? F.g[0] <= F.g[1] : s === '12' ? F.g[0] !== F.g[1] : null) },
  HT: { group: 'goals', half: true, test: (F, s) => (s === '1' ? F.g1[0] > F.g1[1] : s === 'X' ? F.g1[0] === F.g1[1] : s === '2' ? F.g1[0] < F.g1[1] : null) },
  HCP: { group: 'goals', test: (F, s) => {
    const d = F.g[0] - F.g[1];
    return s === 'H-1.5' ? d >= 2 : s === 'A+1.5' ? d < 2 : s === 'A-1.5' ? -d >= 2 : s === 'H+1.5' ? -d < 2 : null;
  } },
  CS: { group: 'goals', test: (F, s) => {
    if (s === 'ALTRO') return F.g[0] > 3 || F.g[1] > 3;
    const m = /^([0-3])-([0-3])$/.exec(s);
    return m ? F.g[0] === +m[1] && F.g[1] === +m[2] : null;
  } },
  TG: { group: 'goals', test: overUnder(goals) },
  BTTS: { group: 'goals', test: yesNo(F => F.g[0] > 0 && F.g[1] > 0) },
  G1: { group: 'goals', half: true, test: overUnder(F => F.g1[0] + F.g1[1]) },
  G2: { group: 'goals', half: true, test: overUnder(F => goals(F) - F.g1[0] - F.g1[1]) },
  FG: { group: 'goals', order: true, test: firstOf('firstGoal') },
  LG: { group: 'goals', order: true, test: firstOf('lastGoal') },
  CSH: { group: 'goals', test: yesNo(F => F.g[1] === 0) },
  CSA: { group: 'goals', test: yesNo(F => F.g[0] === 0) },
  TC: { group: 'corners', test: overUnder(F => F.c[0] + F.c[1]) },
  HC: { group: 'corners', test: overUnder(F => F.c[0]) },
  AC: { group: 'corners', test: overUnder(F => F.c[1]) },
  FC: { group: 'corners', order: true, test: firstOf('firstCorner') },
  TK: { group: 'cards', test: overUnder(F => F.k[0] + F.k[1]) },
  FK: { group: 'cards', order: true, test: firstOf('firstCard') },
  RED: { group: 'cards', test: yesNo(F => F.red) },
  PEN: { group: 'pen', test: yesNo(F => F.pen) },
  TS: { group: 'shots', test: overUnder(F => F.s[0] + F.s[1]) },
  TOT: { group: 'shots', test: overUnder(F => F.o[0] + F.o[1]) },
  POS: { group: 'pos', test: (F, s) => (s === '1' ? F.pos[0] > F.pos[1] : s === '2' ? F.pos[1] > F.pos[0] : null) },
};

// esito di una selezione con i fatti veri: 'WON' | 'LOST' | 'VOID' (mercato o selezione sconosciuti, partita annullata)
export function settleBy(market, selection, F) {
  if (!F || F.void) return 'VOID';
  const r = RULES[market];
  if (!r) return 'VOID';
  const v = r.test(F, selection);
  return v === null ? 'VOID' : v ? 'WON' : 'LOST';
}

// la selezione esiste (mercato noto, id valido)?
const PROBE = { g: [0, 0], g1: [0, 0], firstGoal: -1, lastGoal: -1, c: [0, 0], firstCorner: -1, k: [0, 0], firstCard: -1, red: false, pen: false, s: [0, 0], o: [0, 0], pos: [50, 50] };
export function selectionKnown(market, selection) {
  const r = RULES[market];
  return !!r && typeof selection === 'string' && r.test(PROBE, selection) !== null;
}

// ---------- esiti possibili di un gruppo, con il loro peso (probabilità del modello, 1 senza modello) ----------
const fact = n => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const pois = (k, l) => Math.exp(-l) * Math.pow(l, k) / fact(k);
const binom = (k, n, p) => fact(n) / (fact(k) * fact(n - k)) * Math.pow(p, k) * Math.pow(1 - p, n - k);
const maxLine = sels => sels.reduce((m, x) => Math.max(m, lineOf(x.selection)), 0);

// sels: selezioni dello stesso gruppo e della stessa partita; m: modello della coppia (o null)
function* groupStates(group, sels, m) {
  const needHalf = sels.some(x => RULES[x.market].half), needOrder = sels.some(x => RULES[x.market].order);
  const W = !!m;
  if (group === 'goals') {
    const top = Math.min(12, Math.max(6, Math.ceil(maxLine(sels)) + 2));
    for (let a = 0; a <= top; a++) for (let b = 0; b <= top; b++) {
      const wg = W ? pois(a, m.g[0]) * pois(b, m.g[1]) : 1;
      const halves = [];
      if (needHalf) { for (let x = 0; x <= a; x++) for (let y = 0; y <= b; y++) halves.push([x, y, W ? binom(x, a, m.firstHalfShare) * binom(y, b, m.firstHalfShare) : 1]); }
      else halves.push([0, 0, 1]);
      const n = a + b, orders = [];
      if (!needOrder || n === 0) orders.push([n === 0 ? -1 : (a > 0 ? 0 : 1), n === 0 ? -1 : (a > 0 ? 0 : 1), 1]);
      else {
        const cnt = [a, b];
        for (const f of [0, 1]) for (const l of [0, 1]) {
          if (!cnt[f] || !cnt[l]) continue;
          if (n === 1) { if (f === l) orders.push([f, l, 1]); continue; }
          orders.push([f, l, (cnt[f] / n) * ((cnt[l] - (f === l ? 1 : 0)) / (n - 1))]);
        }
      }
      for (const [x, y, wh] of halves) for (const [f, l, wo] of orders) {
        yield [{ g: [a, b], g1: [x, y], firstGoal: needOrder ? f : -1, lastGoal: needOrder ? l : -1 }, wg * wh * (needOrder ? wo : 1)];
      }
    }
  } else if (group === 'corners' || group === 'cards') {
    const top = Math.max(6, Math.ceil(maxLine(sels)) + 3);
    const mean = W ? (group === 'corners' ? m.c : m.k) : null;
    const pNone = W ? pois(0, mean[0] + mean[1]) : 0;
    const pRed = W ? Math.min(1, m.redRate / Math.max(1e-9, 1 - pNone)) : 0;
    for (let a = 0; a <= top; a++) for (let b = 0; b <= top; b++) {
      const w = W ? pois(a, mean[0]) * pois(b, mean[1]) : 1;
      const n = a + b;
      const firsts = !needOrder ? [[-1, 1]] : n === 0 ? [[-1, 1]] : [0, 1].filter(t => (t ? b : a) > 0).map(t => [t, (t ? b : a) / n]);
      const reds = group === 'cards' ? (n === 0 ? [[false, 1]] : [[true, pRed], [false, 1 - pRed]]) : [[false, 1]];
      for (const [f, wf] of firsts) for (const [red, wr] of reds) {
        const F = group === 'corners' ? { c: [a, b], firstCorner: f } : { k: [a, b], firstCard: f, red: red };
        yield [F, w * (needOrder ? wf : 1) * (W ? wr : 1)];
      }
    }
  } else if (group === 'shots') {
    const top = Math.max(12, Math.ceil(maxLine(sels)) + 4);
    const ratio = W ? Math.min(1, (m.o[0] + m.o[1]) / Math.max(1e-9, m.s[0] + m.s[1])) : 0.5;
    for (let s = 0; s <= top; s++) for (let o = 0; o <= s; o++) yield [{ s: [s, 0], o: [o, 0] }, W ? pois(s, m.s[0] + m.s[1]) * binom(o, s, ratio) : 1];
  } else if (group === 'pen') {
    yield [{ pen: true }, W ? m.penaltyRate : 1];
    yield [{ pen: false }, W ? 1 - m.penaltyRate : 1];
  } else if (group === 'pos') {
    yield [{ pos: [60, 40] }, W ? m.posHome : 1];
    yield [{ pos: [40, 60] }, W ? 1 - m.posHome : 1];
    yield [{ pos: [50, 50] }, 0];
  }
}

const byGroup = sels => {
  const out = {};
  for (const x of sels) (out[RULES[x.market].group] = out[RULES[x.market].group] || []).push(x);
  return out;
};
const allTrue = (sels, F) => sels.every(x => RULES[x.market].test(F, x.selection) === true);

// le selezioni (stessa partita) possono vincere tutte insieme?
export function satisfiable(sels) {
  const g = byGroup(sels);
  for (const k in g) {
    let ok = false;
    for (const [F] of groupStates(k, g[k], null)) if (allTrue(g[k], F)) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}

// "others" (stessa partita) implicano "s": in ogni esito in cui vincono gli altri vince anche s
export function implied(others, s) {
  const grp = RULES[s.market].group;
  const same = others.filter(x => RULES[x.market].group === grp);
  if (!same.length) return false;
  const all = same.concat([s]);
  let any = false;
  for (const [F] of groupStates(grp, all, null)) {
    if (!allTrue(same, F)) continue;
    any = true;
    if (RULES[s.market].test(F, s.selection) !== true) return false;
  }
  return any;
}

// probabilità che vincano tutte (stessa partita) con il modello della coppia: prodotto sui gruppi indipendenti
export function jointProbability(model, sels) {
  const g = byGroup(sels);
  let p = 1;
  for (const k in g) {
    let ok = 0, tot = 0;
    for (const [F, w] of groupStates(k, g[k], model)) { tot += w; if (allTrue(g[k], F)) ok += w; }
    p *= tot > 0 ? ok / tot : 0;
  }
  return p;
}

// ---------- validazione di una schedina ----------
const keyOf = x => x.fixture + '|' + x.market + '|' + x.selection;

// items: [{ fixture, market, selection }] — risultato: { ok, errors: [{ code, fixture, items: [indici] }] }
export function validateBetCombination(items) {
  const errors = [];
  if (items.length > MAX_SELECTIONS) errors.push({ code: 'TOO_MANY', items: [] });
  const seen = new Map();
  items.forEach((x, i) => {
    if (!selectionKnown(x.market, x.selection)) errors.push({ code: 'BAD_SELECTION', fixture: x.fixture, items: [i] });
    const k = keyOf(x);
    if (seen.has(k)) errors.push({ code: 'DUPLICATE', fixture: x.fixture, items: [seen.get(k), i] });
    else seen.set(k, i);
  });
  if (errors.length) return { ok: false, errors };
  const byFix = new Map();
  items.forEach((x, i) => { if (!byFix.has(x.fixture)) byFix.set(x.fixture, []); byFix.get(x.fixture).push(i); });
  for (const [fixture, idx] of byFix) {
    const sels = idx.map(i => items[i]);
    if (satisfiable(sels)) continue;
    errors.push({ code: 'INCOMPATIBLE', fixture: fixture, items: conflictCore(sels).map(j => idx[j]) });
  }
  return { ok: errors.length === 0, errors };
}

// selezioni responsabili del conflitto (indici in sels): prima una coppia impossibile, se c'è; altrimenti
// si tolgono una alla volta quelle non necessarie al conflitto
function conflictCore(sels) {
  for (let i = 0; i < sels.length; i++) for (let j = i + 1; j < sels.length; j++) if (!satisfiable([sels[i], sels[j]])) return [i, j];
  let core = sels.map((_, i) => i);
  for (const i of sels.map((_, k) => k)) {
    const rest = core.filter(k => k !== i);
    if (rest.length && !satisfiable(rest.map(k => sels[k]))) core = rest;
  }
  return core;
}

// si può aggiungere "cand" alla schedina? conflicts: indici delle selezioni già presenti che lo impediscono
export function checkAdd(items, cand) {
  if (!selectionKnown(cand.market, cand.selection)) return { ok: false, code: 'BAD_SELECTION', conflicts: [] };
  const dup = items.findIndex(x => keyOf(x) === keyOf(cand));
  if (dup >= 0) return { ok: false, code: 'DUPLICATE', conflicts: [dup] };
  if (items.length >= MAX_SELECTIONS) return { ok: false, code: 'TOO_MANY', conflicts: [] };
  const idx = [];
  items.forEach((x, i) => { if (x.fixture === cand.fixture) idx.push(i); });
  const sels = idx.map(i => items[i]);
  if (satisfiable(sels.concat([cand]))) return { ok: true, conflicts: [] };
  const direct = idx.filter(i => !satisfiable([items[i], cand]));
  if (direct.length) return { ok: false, code: 'INCOMPATIBLE', conflicts: direct };
  const core = conflictCore(sels.concat([cand])).filter(j => j < sels.length).map(j => idx[j]);
  return { ok: false, code: 'INCOMPATIBLE', conflicts: core };
}

// ---------- totali della schedina ----------
// items: [{ fixture, market, selection, odds }]. groupOdds (facoltativo): quota di ogni partita calcolata dal server
// (selezioni collegate della stessa partita). Senza, la quota della partita è il prodotto delle sue selezioni.
export function slipTotals(items, groupOdds) {
  const byFix = new Map();
  items.forEach((x, i) => { if (!byFix.has(x.fixture)) byFix.set(x.fixture, []); byFix.get(x.fixture).push(i); });
  const redundant = items.map(() => false);
  let base = 1;
  const groups = [];
  for (const [fixture, idx] of byFix) {
    const product = idx.reduce((p, i) => p * items[i].odds, 1);
    const odds = groupOdds && groupOdds[fixture] ? Math.min(product, groupOdds[fixture]) : product;
    groups.push({ fixture, items: idx, product, odds, correlated: odds < product - 1e-9 });
    base *= odds;
    // una selezione già implicata dalle altre della stessa partita non aggiunge niente: non conta per il bonus
    if (idx.length > 1) idx.forEach(i => { redundant[i] = implied(idx.filter(j => j !== i).map(j => items[j]), items[i]); });
  }
  const counted = items.map((x, i) => !redundant[i] && x.odds >= BONUS_MIN_ODDS);
  const count = counted.filter(Boolean).length;
  const bonus = bonusFor(count);
  return { selections: items.length, groups, base, bonus, bonusCount: count, counted, redundant, total: base * (1 + bonus), next: nextBonusTier(count) };
}

// vincita: puntata × quota, per difetto (con un margine per gli errori dei decimali)
export function payoutFor(stake, odds) { return Math.floor(Math.round(stake * odds * 1e6) / 1e6); }
