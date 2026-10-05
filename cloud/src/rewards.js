// Ricompense: bonus giornaliero, obiettivi, premio spettatore, premi di stagione. Tutto calcolato dal server:
// il client chiede soltanto, e ogni accredito ha un riferimento unico (non si può riscuotere due volte).
import { fail, moveCoins, constraintKind, dayKey } from './util.js';

export const DAILY_BASE = 100, DAILY_STREAK_STEP = 10, DAILY_STREAK_MAX = 60;
export const WATCH_REWARD = 20, WATCH_PER_DAY = 3;
export const SEASON_PRIZES = [1000, 600, 300];
export const SEASON_MIN_BETS = 5;

// obiettivo: lo dà una volta sola (chiave primaria utente+obiettivo e riferimento unico della transazione)
export async function award(env, userId, achId, t) {
  const a = await env.DB.prepare('SELECT reward FROM achievements WHERE id = ?').bind(achId).first();
  if (!a) return false;
  if (await env.DB.prepare('SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?').bind(userId, achId).first()) return false;
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO user_achievements (user_id, achievement_id, earned_at) VALUES (?, ?, ?)').bind(userId, achId, t),
      ...moveCoins(env.DB, userId, a.reward, 'ACHIEVEMENT', userId + ':' + achId, t),
    ]);
    return true;
  } catch (e) {
    if (constraintKind(e) === 'UNIQUE') return false;
    throw e;
  }
}

// evento del fine settimana: il bonus giornaliero raddoppia sabato e domenica (UTC)
export const weekendEvent = t => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6; };

export function dailyAmount(streak, t) {
  const base = DAILY_BASE + Math.min(DAILY_STREAK_MAX, (streak - 1) * DAILY_STREAK_STEP);
  return weekendEvent(t) ? base * 2 : base;
}

export async function dailyStatus(env, userId, t) {
  const today = dayKey(t), yesterday = dayKey(t - 86400000);
  const last = await env.DB.prepare('SELECT day, streak FROM daily_claims WHERE user_id = ? ORDER BY day DESC LIMIT 1').bind(userId).first();
  const claimed = !!last && last.day === today;
  const streak = claimed ? last.streak : (last && last.day === yesterday ? last.streak + 1 : 1);
  return { claimed, streak, amount: dailyAmount(streak, t), weekendEvent: weekendEvent(t), nextAt: Date.parse(today + 'T00:00:00Z') + 86400000 };
}

export async function claimDaily(env, user, t) {
  const st = await dailyStatus(env, user.id, t);
  if (st.claimed) fail(409, 'ALREADY_CLAIMED', 'Bonus di oggi già riscosso', { nextAt: st.nextAt });
  const day = dayKey(t);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO daily_claims (user_id, day, streak) VALUES (?, ?, ?)').bind(user.id, day, st.streak),
      ...moveCoins(env.DB, user.id, st.amount, 'DAILY_REWARD', user.id + ':' + day, t),
    ]);
  } catch (e) {
    if (constraintKind(e) === 'UNIQUE') fail(409, 'ALREADY_CLAIMED', 'Bonus di oggi già riscosso', { nextAt: st.nextAt });
    throw e;
  }
  if (st.streak >= 7) await award(env, user.id, 'DAILY_7', t);
  return { amount: st.amount, streak: st.streak, weekendEvent: st.weekendEvent };
}

// premio spettatore: si riscuote mentre una partita del server è in corso, dopo metà gara, massimo 3 al giorno.
// Il server non può sapere se lo schermo era davvero acceso: controlla solo il momento e i limiti.
export async function claimWatch(env, user, fixture, phase, elapsedMs, t) {
  if (phase !== 'LIVE' || elapsedMs < fixture.duration_ms / 2) fail(409, 'NOT_NOW', 'Il premio si riscuote durante il secondo tempo della partita');
  const day = dayKey(t);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND type = 'MATCH_REWARD' AND created_at >= ?")
    .bind(user.id, Date.parse(day + 'T00:00:00Z')).first();
  if (n.n >= WATCH_PER_DAY) fail(429, 'DAILY_LIMIT', 'Hai già riscosso ' + WATCH_PER_DAY + ' premi spettatore oggi');
  try {
    await env.DB.batch(moveCoins(env.DB, user.id, WATCH_REWARD, 'MATCH_REWARD', user.id + ':' + fixture.code, t));
  } catch (e) {
    if (constraintKind(e) === 'UNIQUE') fail(409, 'ALREADY_CLAIMED', 'Premio già riscosso per questa partita');
    throw e;
  }
  return { amount: WATCH_REWARD };
}

// stagione = trimestre solare (UTC)
export function seasonOf(t) {
  const d = new Date(t), q = Math.floor(d.getUTCMonth() / 3);
  const start = Date.UTC(d.getUTCFullYear(), q * 3, 1), end = Date.UTC(d.getUTCFullYear(), q * 3 + 3, 1);
  return { key: d.getUTCFullYear() + '-T' + (q + 1), start, end };
}

// premi della stagione appena finita ai primi tre per profitto (solo profili pubblici con almeno 5 scommesse
// liquidate). Lo chiama il Durable Object a ogni giro: i riferimenti unici impediscono doppi pagamenti.
export async function paySeasonPrizes(env, t) {
  const prev = seasonOf(seasonOf(t).start - 1);
  const flag = 'season_paid:' + prev.key;
  if (await env.DB.prepare('SELECT 1 FROM meta WHERE key = ?').bind(flag).first()) return 0;
  const { results } = await env.DB.prepare(
    "SELECT b.user_id, SUM(b.payout - b.stake) AS profit, COUNT(*) AS n FROM bets b JOIN users u ON u.id = b.user_id " +
    "WHERE b.status IN ('WON','LOST','VOID') AND b.settled_at >= ? AND b.settled_at < ? AND u.public_bets = 1 " +
    'GROUP BY b.user_id HAVING n >= ? AND profit > 0 ORDER BY profit DESC, b.user_id LIMIT ?')
    .bind(prev.start, prev.end, SEASON_MIN_BETS, SEASON_PRIZES.length).all();
  let paid = 0;
  for (let i = 0; i < results.length; i++) {
    try {
      await env.DB.batch(moveCoins(env.DB, results[i].user_id, SEASON_PRIZES[i], 'SEASON_PRIZE', prev.key + ':' + (i + 1), t));
      paid++;
    } catch (e) { if (constraintKind(e) !== 'UNIQUE') throw e; }
  }
  await env.DB.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind(flag, String(t)).run();
  return paid;
}
