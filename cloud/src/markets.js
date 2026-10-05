// ============================================================
// MERCATI — quote e liquidazione (modulo puro: niente database, niente rete)
// Le probabilità vengono dal modello calibrato con il motore vero del gioco (odds-model.json):
// medie per coppia di squadre di gol, corner, cartellini, tiri, tiri in porta, possesso.
// La liquidazione usa i "fatti" della partita calcolata dal server con lo stesso motore.
// ============================================================

export const MARGIN = 0.06;           // margine del banco: quote un po' sotto il valore equo
export const MIN_ODDS = 1.03, MAX_ODDS = 50;
export const GROUPS = ['1X2', 'GOL', 'CORNER', 'CARTELLINI', 'ALTRO'];

// ---------- probabilità ----------
const fact = n => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
export function poisson(k, l) { return Math.exp(-l) * Math.pow(l, k) / fact(k); }
const MAXG = 12;
// distribuzione congiunta di due Poisson indipendenti
function joint(lh, la) {
  const ph = [], pa = [];
  for (let i = 0; i <= MAXG; i++) { ph.push(poisson(i, lh)); pa.push(poisson(i, la)); }
  return (f) => { let s = 0; for (let i = 0; i <= MAXG; i++) for (let j = 0; j <= MAXG; j++) if (f(i, j)) s += ph[i] * pa[j]; return s; };
}
const over = (l, line) => { let s = 0; for (let k = 0; k <= Math.floor(line); k++) s += poisson(k, l); return 1 - s; };
// linee: quella centrale vicino alla media, una sotto e una sopra (sempre almeno 0.5)
export function linesFor(mean) {
  const main = Math.max(0.5, Math.round(mean - 0.5) + 0.5);
  return [...new Set([main - 1, main, main + 1].filter(l => l >= 0.5))];
}
const fmtLine = l => String(l).replace('.', ',');

// ---------- definizione dei mercati ----------
// ogni mercato: id, gruppo, etichetta, selezioni (id + etichetta), probabilità e liquidazione.
// Le selezioni con linea hanno la linea nell'id (es. "O2.5"). F = fatti della partita (vedi factsFromTimeline).
function marketList(model, h, a) {
  const lh = model.g[0], la = model.g[1], sh = model.firstHalfShare;
  const J = joint(lh, la), J1 = joint(lh * sh, la * sh), J2 = joint(lh * (1 - sh), la * (1 - sh));
  const pNoGoal = poisson(0, lh) * poisson(0, la);
  const cH = model.c[0], cA = model.c[1], kH = model.k[0], kA = model.k[1];
  const T = { 1: h, 2: a };
  const ou = (id, group, label, mean, value) => ({
    id, group, label,
    sels: linesFor(mean).flatMap(l => [
      { id: 'O' + l, label: 'Più di ' + fmtLine(l), p: over(mean, l), settle: F => value(F) > l },
      { id: 'U' + l, label: 'Meno di ' + fmtLine(l), p: 1 - over(mean, l), settle: F => value(F) < l },
    ]),
  });
  const firstOf = (id, group, label, ph, pa, pn, key, noneLabel) => ({
    id, group, label, sels: [
      { id: '1', label: T[1], p: ph * (1 - pn), settle: F => F[key] === 0 },
      { id: '2', label: T[2], p: pa * (1 - pn), settle: F => F[key] === 1 },
      { id: 'N', label: noneLabel, p: pn, settle: F => F[key] === -1 },
    ],
  });
  const yesNo = (id, group, label, p, value) => ({
    id, group, label, sels: [
      { id: 'SI', label: 'Sì', p: p, settle: F => !!value(F) },
      { id: 'NO', label: 'No', p: 1 - p, settle: F => !value(F) },
    ],
  });
  const scores = [];
  for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) scores.push([i, j]);
  const goalsOf = F => F.g[0] + F.g[1];
  return [
    { id: '1X2', group: '1X2', label: 'Esito finale', sels: [
      { id: '1', label: h + ' vincente', p: J((i, j) => i > j), settle: F => F.g[0] > F.g[1] },
      { id: 'X', label: 'Pareggio', p: J((i, j) => i === j), settle: F => F.g[0] === F.g[1] },
      { id: '2', label: a + ' vincente', p: J((i, j) => i < j), settle: F => F.g[0] < F.g[1] },
    ] },
    { id: 'DC', group: '1X2', label: 'Doppia chance', sels: [
      { id: '1X', label: h + ' o pareggio', p: J((i, j) => i >= j), settle: F => F.g[0] >= F.g[1] },
      { id: 'X2', label: 'Pareggio o ' + a, p: J((i, j) => i <= j), settle: F => F.g[0] <= F.g[1] },
      { id: '12', label: h + ' o ' + a, p: J((i, j) => i !== j), settle: F => F.g[0] !== F.g[1] },
    ] },
    { id: 'HT', group: '1X2', label: 'Risultato primo tempo', sels: [
      { id: '1', label: h, p: J1((i, j) => i > j), settle: F => F.g1[0] > F.g1[1] },
      { id: 'X', label: 'Pareggio', p: J1((i, j) => i === j), settle: F => F.g1[0] === F.g1[1] },
      { id: '2', label: a, p: J1((i, j) => i < j), settle: F => F.g1[0] < F.g1[1] },
    ] },
    { id: 'HCP', group: '1X2', label: 'Handicap', sels: [
      { id: 'H-1.5', label: h + ' -1,5', p: J((i, j) => i - j >= 2), settle: F => F.g[0] - F.g[1] >= 2 },
      { id: 'A+1.5', label: a + ' +1,5', p: J((i, j) => i - j < 2), settle: F => F.g[0] - F.g[1] < 2 },
      { id: 'A-1.5', label: a + ' -1,5', p: J((i, j) => j - i >= 2), settle: F => F.g[1] - F.g[0] >= 2 },
      { id: 'H+1.5', label: h + ' +1,5', p: J((i, j) => j - i < 2), settle: F => F.g[1] - F.g[0] < 2 },
    ] },
    { id: 'CS', group: 'GOL', label: 'Risultato esatto', sels: scores.map(([i, j]) => (
      { id: i + '-' + j, label: i + '-' + j, p: J((x, y) => x === i && y === j), settle: F => F.g[0] === i && F.g[1] === j }
    )).concat([{ id: 'ALTRO', label: 'Altro risultato', p: J((x, y) => x > 3 || y > 3), settle: F => F.g[0] > 3 || F.g[1] > 3 }]) },
    ou('TG', 'GOL', 'Gol totali', lh + la, goalsOf),
    yesNo('BTTS', 'GOL', 'Entrambe segnano', (1 - poisson(0, lh)) * (1 - poisson(0, la)), F => F.g[0] > 0 && F.g[1] > 0),
    ou('G1', 'GOL', 'Gol primo tempo', (lh + la) * sh, F => F.g1[0] + F.g1[1]),
    ou('G2', 'GOL', 'Gol secondo tempo', (lh + la) * (1 - sh), F => goalsOf(F) - F.g1[0] - F.g1[1]),
    firstOf('FG', 'GOL', 'Primo gol', lh / (lh + la), la / (lh + la), pNoGoal, 'firstGoal', 'Nessun gol'),
    firstOf('LG', 'GOL', 'Ultimo gol', lh / (lh + la), la / (lh + la), pNoGoal, 'lastGoal', 'Nessun gol'),
    yesNo('CSH', 'GOL', 'Porta inviolata ' + h, poisson(0, la), F => F.g[1] === 0),
    yesNo('CSA', 'GOL', 'Porta inviolata ' + a, poisson(0, lh), F => F.g[0] === 0),
    ou('TC', 'CORNER', 'Corner totali', cH + cA, F => F.c[0] + F.c[1]),
    ou('HC', 'CORNER', 'Corner ' + h, cH, F => F.c[0]),
    ou('AC', 'CORNER', 'Corner ' + a, cA, F => F.c[1]),
    firstOf('FC', 'CORNER', 'Primo corner', cH / (cH + cA || 1), cA / (cH + cA || 1), poisson(0, cH + cA), 'firstCorner', 'Nessun corner'),
    ou('TK', 'CARTELLINI', 'Cartellini totali', kH + kA, F => F.k[0] + F.k[1]),
    firstOf('FK', 'CARTELLINI', 'Primo cartellino', kH / (kH + kA || 1), kA / (kH + kA || 1), poisson(0, kH + kA), 'firstCard', 'Nessun cartellino'),
    yesNo('RED', 'CARTELLINI', 'Espulsione', model.redRate, F => F.red),
    yesNo('PEN', 'ALTRO', 'Rigore', model.penaltyRate, F => F.pen),
    ou('TS', 'ALTRO', 'Tiri totali', model.s[0] + model.s[1], F => F.s[0] + F.s[1]),
    ou('TOT', 'ALTRO', 'Tiri in porta', model.o[0] + model.o[1], F => F.o[0] + F.o[1]),
    { id: 'POS', group: 'ALTRO', label: 'Più possesso palla', sels: [
      { id: '1', label: h, p: model.posHome, settle: F => F.pos[0] > F.pos[1] },
      { id: '2', label: a, p: 1 - model.posHome, settle: F => F.pos[1] > F.pos[0] },
    ] },
  ];
}

const odds = p => (p < 0.015 ? null : Math.round(Math.min(MAX_ODDS, Math.max(MIN_ODDS, 1 / (p * (1 + MARGIN)))) * 100) / 100);

// modello della coppia (casa, ospite) dal file di calibrazione, con i valori globali
export function pairModel(model, home, away) {
  const p = model.pairs[home + '-' + away];
  if (!p) throw new Error('coppia senza calibrazione: ' + home + '-' + away);
  return Object.assign({ firstHalfShare: model.firstHalfShare, redRate: Math.max(0.02, model.redRate), penaltyRate: Math.max(0.02, model.penaltyRate) }, p);
}

// quote base di una partita, congelate alla sua creazione: { "1X2:1": { odds, p }, ... } più l'elenco dei mercati
export function buildMarkets(model, home, away, names) {
  const list = marketList(pairModel(model, home, away), names.home, names.away);
  const book = {};
  for (const m of list) for (const s of m.sels) {
    const o = odds(s.p);
    if (o) book[m.id + ':' + s.id] = { o: o, p: Math.round(s.p * 10000) / 10000 };
  }
  return { book: book, markets: list.map(m => ({ id: m.id, group: m.group, label: m.label, sels: m.sels.filter(s => book[m.id + ':' + s.id]).map(s => ({ id: s.id, label: s.label })) })) };
}

// quota attuale: la quota base scende un po' se su quella selezione è puntato molto più del suo peso
// (stakes: { selezione: monete puntate } sullo stesso mercato della partita). Calcolata solo dal server.
export function currentOdds(base, prob, selection, stakes) {
  const total = Object.values(stakes || {}).reduce((s, v) => s + v, 0);
  if (!total) return base;
  const share = (stakes[selection] || 0) / total;
  const confidence = Math.min(1, total / 2000);
  const cut = Math.min(0.2, Math.max(0, share - prob) * 0.5 * confidence);
  return Math.max(MIN_ODDS, Math.round(base * (1 - cut) * 100) / 100);
}

// liquidazione di una selezione: 'WON' | 'LOST' | 'VOID'
export function settleSelection(model, home, away, names, market, selection, F) {
  if (!F || F.void) return 'VOID';
  const m = marketList(pairModel(model, home, away), names.home, names.away).find(x => x.id === market);
  const s = m && m.sels.find(x => x.id === selection);
  if (!s) return 'VOID';
  return s.settle(F) ? 'WON' : 'LOST';
}

// etichette leggibili (per feed, schedina, storico)
export function labelOf(marketsJson, market, selection) {
  const m = marketsJson.markets.find(x => x.id === market);
  const s = m && m.sels.find(x => x.id === selection);
  return { market: m ? m.label : market, selection: s ? s.label : selection };
}

// esito di una scommessa dalle sue selezioni: tutte vinte (le annullate contano 1) = vinta, una persa = persa
export function settleBet(stake, items) {
  if (items.some(i => i.status === 'OPEN')) return null;
  if (items.some(i => i.status === 'LOST')) return { status: 'LOST', payout: 0 };
  if (items.every(i => i.status === 'VOID')) return { status: 'VOID', payout: stake };
  return { status: 'WON', payout: payoutOf(stake, items.filter(i => i.status === 'WON').map(i => i.odds)) };
}

// vincita: puntata × prodotto delle quote, arrotondata per difetto (con un margine per gli errori dei decimali,
// così l'ordine delle moltiplicazioni non cambia il risultato)
export function payoutOf(stake, oddsList) {
  const total = oddsList.reduce((p, o) => p * o, 1);
  return Math.floor(Math.round(stake * total * 1e6) / 1e6);
}

// fatti della partita dagli eventi dell'arbitro (gli stessi che vede il gioco) e dalle statistiche finali.
// e.team è la squadra a cui va l'evento: per il gol quella che segna (anche con un autogol)
export function factsFromMatch(m, events) {
  const ev = events || m.timeline, side = e => e.team;
  const of = (types) => ev.filter(e => types.includes(e.type));
  const count = (types, t) => of(types).filter(e => side(e) === t).length;
  const firstSide = types => { const e = of(types)[0]; return e ? side(e) : -1; };
  const goals = of(['GOAL']);
  const cards = ['YELLOW_CARD', 'SECOND_YELLOW', 'RED_CARD'];
  const [s0, s1] = m.teams.map(t => t.stats);
  return {
    g: [m.teams[0].score, m.teams[1].score],
    g1: [goals.filter(e => e.half === 1 && e.team === 0).length, goals.filter(e => e.half === 1 && e.team === 1).length],
    c: [count(['CORNER'], 0), count(['CORNER'], 1)],
    k: [count(cards, 0), count(cards, 1)],
    s: [s0.shots, s1.shots], o: [s0.onTarget, s1.onTarget],
    pos: [Math.round(s0.possession), Math.round(s1.possession)],
    firstGoal: goals.length ? goals[0].team : -1,
    lastGoal: goals.length ? goals[goals.length - 1].team : -1,
    firstCorner: firstSide(['CORNER']), firstCard: firstSide(cards),
    red: of(['RED_CARD']).length > 0, pen: of(['PENALTY']).length > 0,
  };
}
