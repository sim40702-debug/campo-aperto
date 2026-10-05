// Parte social delle scommesse: scommesse dei giocatori (solo pubbliche e di profili pubblici), più giocate,
// statistiche, classifiche, reazioni. Tutti i numeri vengono dal database: nessun giocatore inventato.
// Le statistiche descrivono cosa hanno giocato le persone: non sono probabilità.
import { fail, dayKey } from './util.js';
import { betViews, visibleTo, REACTIONS } from './bets.js';
import { fixtureByCode } from './fixtures.js';
import { seasonOf } from './rewards.js';

const PAGE = 20;
const PUBLIC = "b.visibility = 'public' AND u.public_bets = 1";
const COLS = 'b.id, b.code, b.user_id, b.stake, b.odds, b.potential_payout, b.status, b.payout, b.visibility, b.shared, b.copied_from, b.created_at, b.settled_at, u.username, u.public_bets';

// scommesse dei giocatori su una partita. before: pagine più vecchie; after: solo le nuove (aggiornamento leggero)
export async function fixtureFeed(env, code, viewer, q) {
  const f = await fixtureByCode(env, code);
  const after = Number(q.get('after')) || 0;
  const before = Number(q.get('before')) || 2 ** 53;
  const sql = 'SELECT ' + COLS + ' FROM bets b JOIN users u ON u.id = b.user_id WHERE b.id IN (SELECT bet_id FROM bet_items WHERE fixture_id = ?) AND ' + PUBLIC +
    (after ? ' AND b.id > ? ORDER BY b.id ASC' : ' AND b.id < ? ORDER BY b.id DESC') + ' LIMIT ' + PAGE;
  const { results } = await env.DB.prepare(sql).bind(f.id, after || before).all();
  const rows = after ? results.reverse() : results;
  const bets = await betViews(env, rows, viewer);
  return { bets, cursor: rows.length ? { newest: rows[0].id, oldest: rows[rows.length - 1].id } : null, more: results.length === PAGE };
}

// esiti di scommesse già mostrate (per aggiornare ✅/❌ senza ricaricare tutto)
export async function betStatuses(env, codes, viewer) {
  if (!Array.isArray(codes) || codes.length > 50) fail(400, 'BAD_CODES', 'Elenco non valido');
  const ok = codes.filter(c => typeof c === 'string' && /^BET-[A-Z0-9]{5}$/.test(c));
  if (!ok.length) return { bets: [] };
  const { results } = await env.DB.prepare('SELECT ' + COLS + ' FROM bets b JOIN users u ON u.id = b.user_id WHERE b.code IN (' + ok.map(() => '?').join(',') + ')').bind(...ok).all();
  return { bets: results.filter(b => visibleTo(b, viewer)).map(b => ({ code: b.code, status: b.status, payout: b.payout })) };
}

export async function globalFeed(env, viewer, q) {
  const before = Number(q.get('before')) || 2 ** 53;
  const { results } = await env.DB.prepare('SELECT ' + COLS + ' FROM bets b JOIN users u ON u.id = b.user_id WHERE ' + PUBLIC + ' AND b.id < ? ORDER BY b.id DESC LIMIT ' + PAGE)
    .bind(before).all();
  return { bets: await betViews(env, results, viewer), more: results.length === PAGE, next: results.length ? results[results.length - 1].id : null };
}

// selezioni più giocate su una partita (conteggi anonimi su tutte le scommesse: nessun nome)
export async function popular(env, code) {
  const f = await fixtureByCode(env, code);
  const tot = await env.DB.prepare('SELECT COUNT(DISTINCT bet_id) AS n FROM bet_items WHERE fixture_id = ?').bind(f.id).first();
  const { results } = await env.DB.prepare(
    'SELECT i.market, i.selection, MAX(i.market_label) AS ml, MAX(i.selection_label) AS sl, COUNT(*) AS n, SUM(b.stake) AS stake ' +
    'FROM bet_items i JOIN bets b ON b.id = i.bet_id WHERE i.fixture_id = ? GROUP BY i.market, i.selection ORDER BY n DESC, stake DESC LIMIT 5').bind(f.id).all();
  return {
    totalBets: tot.n,
    top: results.map(r => ({ market: r.market, selection: r.selection, marketLabel: r.ml, selectionLabel: r.sl, bets: r.n, coins: r.stake, share: tot.n ? Math.round(r.n / tot.n * 100) : 0 })),
  };
}

// statistiche di una partita: quante giocate, quante monete, come si dividono sull'esito finale
export async function fixtureStats(env, code) {
  const f = await fixtureByCode(env, code);
  const t = await env.DB.prepare('SELECT COUNT(DISTINCT i.bet_id) AS bets, COUNT(DISTINCT b.user_id) AS players FROM bet_items i JOIN bets b ON b.id = i.bet_id WHERE i.fixture_id = ?').bind(f.id).first();
  const coins = await env.DB.prepare('SELECT COALESCE(SUM(stake), 0) AS s FROM bets WHERE id IN (SELECT bet_id FROM bet_items WHERE fixture_id = ?)').bind(f.id).first();
  const { results: x12 } = await env.DB.prepare("SELECT selection, COUNT(*) AS n FROM bet_items WHERE fixture_id = ? AND market = '1X2' GROUP BY selection").bind(f.id).all();
  const n12 = x12.reduce((s, r) => s + r.n, 0);
  const pct = sel => { const r = x12.find(x => x.selection === sel); return n12 && r ? Math.round(r.n / n12 * 100) : 0; };
  const top = await env.DB.prepare('SELECT market, MAX(market_label) AS label, COUNT(*) AS n FROM bet_items WHERE fixture_id = ? GROUP BY market ORDER BY n DESC LIMIT 1').bind(f.id).first();
  const big = await env.DB.prepare('SELECT b.code, b.potential_payout, u.username FROM bets b JOIN users u ON u.id = b.user_id WHERE b.id IN (SELECT bet_id FROM bet_items WHERE fixture_id = ?) AND ' + PUBLIC + ' ORDER BY b.potential_payout DESC LIMIT 1').bind(f.id).first();
  return {
    bets: t.bets, players: t.players, coins: coins.s,
    split1X2: { '1': pct('1'), X: pct('X'), '2': pct('2'), bets: n12 },
    topMarket: top ? { market: top.market, label: top.label, bets: top.n } : null,
    biggestPotential: big ? { code: big.code, user: big.username, amount: big.potential_payout } : null,
  };
}

// statistiche del giorno (UTC)
export async function todayStats(env, t) {
  const start = Date.parse(dayKey(t) + 'T00:00:00Z');
  const a = await env.DB.prepare('SELECT COUNT(*) AS bets, COUNT(DISTINCT user_id) AS players, COALESCE(SUM(stake), 0) AS coins FROM bets WHERE created_at >= ?').bind(start).first();
  const w = await env.DB.prepare("SELECT COUNT(*) AS won, COALESCE(SUM(payout), 0) AS paid FROM bets WHERE status = 'WON' AND settled_at >= ?").bind(start).first();
  const big = await env.DB.prepare("SELECT b.code, b.payout, b.odds, u.username FROM bets b JOIN users u ON u.id = b.user_id WHERE b.status = 'WON' AND b.settled_at >= ? AND " + PUBLIC + ' ORDER BY b.payout DESC LIMIT 1').bind(start).first();
  return { day: dayKey(t), bets: a.bets, players: a.players, coins: a.coins, won: w.won, paid: w.paid, biggestWin: big ? { code: big.code, user: big.username, amount: big.payout, odds: big.odds } : null };
}

// classifica dei migliori scommettitori (mai per saldo): profitto, ROI, percentuale di vittorie, numero di
// scommesse, serie. Solo profili pubblici; per le percentuali servono almeno 5 scommesse decise.
export const METRICS = ['profit', 'roi', 'winrate', 'bets', 'streak'];
export const PERIODS = ['day', 'week', 'month', 'season'];
export function periodStart(period, t) {
  const d = new Date(t);
  if (period === 'day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (period === 'week') { const wd = (d.getUTCDay() + 6) % 7; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd); }
  if (period === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return seasonOf(t).start;
}
export async function leaderboard(env, metric, period, t) {
  if (!METRICS.includes(metric)) metric = 'profit';
  if (!PERIODS.includes(period)) period = 'week';
  if (metric === 'streak') {
    const { results } = await env.DB.prepare('SELECT username, streak, best_streak FROM users WHERE public_bets = 1 AND best_streak > 0 ORDER BY streak DESC, best_streak DESC, id LIMIT 20').all();
    return { metric, period: 'all', rows: results.map((r, i) => ({ rank: i + 1, user: r.username, streak: r.streak, bestStreak: r.best_streak })) };
  }
  const from = periodStart(period, t);
  const order = { profit: 'profit DESC', roi: 'roi DESC', winrate: 'winrate DESC', bets: 'n DESC' }[metric];
  const minDecided = metric === 'roi' || metric === 'winrate' ? 5 : 1;
  const { results } = await env.DB.prepare(
    "SELECT u.username, COUNT(*) AS n, SUM(b.status = 'WON') AS won, SUM(b.status IN ('WON','LOST')) AS decided, SUM(b.stake) AS staked, SUM(b.payout - b.stake) AS profit, " +
    "CAST(SUM(b.payout - b.stake) AS REAL) / SUM(b.stake) AS roi, CAST(SUM(b.status = 'WON') AS REAL) / MAX(1, SUM(b.status IN ('WON','LOST'))) AS winrate " +
    "FROM bets b JOIN users u ON u.id = b.user_id WHERE b.status <> 'OPEN' AND b.settled_at >= ? AND u.public_bets = 1 " +
    'GROUP BY b.user_id HAVING decided >= ? ORDER BY ' + order + ', n DESC, MIN(b.id) LIMIT 20').bind(from, minDecided).all();
  return {
    metric, period, from,
    rows: results.map((r, i) => ({ rank: i + 1, user: r.username, bets: r.n, won: r.won, profit: r.profit, roi: Math.round(r.roi * 1000) / 10, winRate: Math.round(r.winrate * 1000) / 10 })),
  };
}

// reazione: si mette o si toglie. Solo su scommesse visibili e non proprie
export async function react(env, user, code, emoji, t) {
  if (!REACTIONS.includes(emoji)) fail(400, 'BAD_EMOJI', 'Reazione non valida');
  if (typeof code !== 'string' || !/^BET-[A-Z0-9]{5}$/.test(code)) fail(404, 'NO_BET', 'Scommessa non trovata');
  const b = await env.DB.prepare('SELECT ' + COLS + ' FROM bets b JOIN users u ON u.id = b.user_id WHERE b.code = ?').bind(code).first();
  if (!b || !visibleTo(b, user)) fail(404, 'NO_BET', 'Scommessa non trovata');
  if (b.user_id === user.id) fail(400, 'OWN_BET', 'Non puoi reagire alle tue scommesse');
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM bet_reactions WHERE user_id = ? AND created_at > ?').bind(user.id, t - 60000).first();
  const del = await env.DB.prepare('DELETE FROM bet_reactions WHERE bet_id = ? AND user_id = ? AND emoji = ?').bind(b.id, user.id, emoji).run();
  let on = false;
  if (!del.meta.changes) {
    if (recent.n >= 30) fail(429, 'RATE_LIMIT', 'Troppe reazioni in poco tempo');
    await env.DB.prepare('INSERT OR IGNORE INTO bet_reactions (bet_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').bind(b.id, user.id, emoji, t).run();
    on = true;
  }
  const { results } = await env.DB.prepare('SELECT emoji, COUNT(*) AS n FROM bet_reactions WHERE bet_id = ? GROUP BY emoji').bind(b.id).all();
  const reactions = {};
  for (const r of results) reactions[r.emoji] = r.n;
  return { code, emoji, on, reactions };
}
