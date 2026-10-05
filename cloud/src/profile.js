// Profilo dell'utente: saldo, movimenti, impostazioni di privacy, obiettivi, profilo pubblico.
import { fail } from './util.js';
import { dailyStatus } from './rewards.js';
import { USERNAME_RE } from './auth.js';

export async function me(env, user, t) {
  const u = await env.DB.prepare('SELECT u.username, u.public_bets, u.streak, u.best_streak, u.shirt_number, u.shirt_name, u.created_at, w.balance FROM users u JOIN wallets w ON w.user_id = u.id WHERE u.id = ?')
    .bind(user.id).first();
  const s = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(status = 'WON') AS won, SUM(status = 'LOST') AS lost, SUM(status = 'OPEN') AS open, COALESCE(SUM(CASE WHEN status <> 'OPEN' THEN payout - stake END), 0) AS profit FROM bets WHERE user_id = ?")
    .bind(user.id).first();
  const { results: ach } = await env.DB.prepare('SELECT a.id, a.name, a.description, a.reward, ua.earned_at FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ? ORDER BY a.reward')
    .bind(user.id).all();
  return {
    username: u.username, balance: u.balance, publicBets: !!u.public_bets, createdAt: u.created_at,
    streak: u.streak, bestStreak: u.best_streak, avatar: { number: u.shirt_number, name: u.shirt_name },
    stats: { bets: s.n, won: s.won || 0, lost: s.lost || 0, open: s.open || 0, profit: s.profit },
    daily: await dailyStatus(env, user.id, t),
    achievements: ach.map(a => ({ id: a.id, name: a.name, description: a.description, reward: a.reward, earnedAt: a.earned_at })),
    serverTime: t,
  };
}

export async function balance(env, user) {
  const w = await env.DB.prepare('SELECT balance FROM wallets WHERE user_id = ?').bind(user.id).first();
  return { balance: w ? w.balance : 0 };
}

export async function transactions(env, user, q) {
  const before = Number(q.get('before')) || 2 ** 53;
  const { results } = await env.DB.prepare('SELECT id, type, amount, balance_before, balance_after, reference_id, created_at FROM transactions WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 30')
    .bind(user.id, before).all();
  return {
    transactions: results.map(r => ({ id: r.id, type: r.type, amount: r.amount, balanceBefore: r.balance_before, balanceAfter: r.balance_after, reference: r.reference_id, createdAt: r.created_at })),
    next: results.length === 30 ? results[results.length - 1].id : null,
  };
}

export async function setPrivacy(env, user, body) {
  if (typeof body.publicBets !== 'boolean') fail(400, 'BAD_VALUE', 'Valore non valido');
  await env.DB.prepare('UPDATE users SET public_bets = ? WHERE id = ?').bind(body.publicBets ? 1 : 0, user.id).run();
  return { publicBets: body.publicBets };
}

// profilo pubblico: nome, statistiche di gioco se il profilo è pubblico. Mai saldo, id o dati dell'account
export async function publicProfile(env, username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) fail(404, 'NO_USER', 'Giocatore non trovato');
  const u = await env.DB.prepare('SELECT id, username, public_bets, streak, best_streak, created_at FROM users WHERE username_lc = ?').bind(username.toLowerCase()).first();
  if (!u) fail(404, 'NO_USER', 'Giocatore non trovato');
  const out = { username: u.username, since: u.created_at, publicBets: !!u.public_bets };
  if (u.public_bets) {
    const s = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(status = 'WON') AS won, SUM(status = 'LOST') AS lost, COALESCE(SUM(CASE WHEN status <> 'OPEN' THEN payout - stake END), 0) AS profit FROM bets WHERE user_id = ? AND visibility = 'public'")
      .bind(u.id).first();
    out.stats = { bets: s.n, won: s.won || 0, lost: s.lost || 0, profit: s.profit, streak: u.streak, bestStreak: u.best_streak };
  }
  const { results } = await env.DB.prepare('SELECT a.id, a.name FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ?').bind(u.id).all();
  out.achievements = results;
  return out;
}
