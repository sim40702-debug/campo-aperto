// Classifica dei giocatori online: punti e livelli dalle partite online tra persone (stanze del relay).
// A fine partita ogni giocatore con l'account manda il risultato (codice della partita, la sua squadra, gol).
// La partita vale solo quando arrivano i risultati di tutte e due le squadre e sono uguali: contro l'IA o da
// soli non si prendono punti. Per evitare i "punti facili" tra due account dello stesso giocatore: al massimo
// MAX_PER_DAY partite con punti al giorno e MAX_PAIR_PER_DAY contro lo stesso avversario.
// Presenza: il gioco si fa vivo ogni minuto (POST /api/presence) e gli amici vedono chi è online o in partita.
import { fail } from './util.js';

export const ONLINE = {
  WIN: 30, DRAW: 12, LOSS: 5,       // punti per risultato
  MAX_PER_DAY: 15,
  MAX_PAIR_PER_DAY: 3,
  REPORT_WINDOW: 3 * 3600 * 1000,   // i risultati della stessa partita devono arrivare entro 3 ore
  ONLINE_MS: 150 * 1000,            // "online" se si è fatto vivo negli ultimi due minuti e mezzo
  TOP: 50,
};
const MATCH_RE = /^[A-Z0-9]{4,8}:[a-z0-9]{4,12}$/;
const DAY = 24 * 3600 * 1000;

// livello dai punti: 0 → 1, 25 → 2, 100 → 3, 225 → 4 ... (ogni livello costa un po' di più del precedente)
export function levelOf(points) { return Math.floor(Math.sqrt(Math.max(0, points) / 25)) + 1; }
export function levelInfo(points) {
  const level = levelOf(points);
  const from = (level - 1) * (level - 1) * 25, to = level * level * 25;
  return { level: level, from: from, to: to };
}
function pointsFor(gf, ga) { return gf > ga ? ONLINE.WIN : gf === ga ? ONLINE.DRAW : ONLINE.LOSS; }

// risultato di una partita online. body: { match: 'CODICE:partita', side: 0|1, score: [gol casa, gol ospiti] }
export async function reportOnline(env, user, body, t) {
  const match = String(body.match || '');
  if (!MATCH_RE.test(match)) fail(400, 'BAD_MATCH', 'Codice della partita non valido');
  const side = body.side === 0 || body.side === 1 ? body.side : -1;
  if (side < 0) fail(400, 'BAD_SIDE', 'Squadra non valida');
  const sc = Array.isArray(body.score) ? body.score.map(Number) : [];
  if (sc.length !== 2 || !sc.every(n => Number.isInteger(n) && n >= 0 && n <= 50)) fail(400, 'BAD_SCORE', 'Risultato non valido');
  // un risultato per giocatore e partita (il secondo invio non cambia niente)
  await env.DB.prepare('INSERT INTO online_reports (match_id, user_id, side, home_goals, away_goals, counted, points, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?) ON CONFLICT DO NOTHING')
    .bind(match, user.id, side, sc[0], sc[1], t).run();
  const { results } = await env.DB.prepare('SELECT user_id, side, home_goals, away_goals, counted, points, created_at FROM online_reports WHERE match_id = ?').bind(match).all();
  const mine = results.find(r => r.user_id === user.id);
  // confermata: risultati di tutte e due le squadre, tutti uguali, arrivati entro la finestra
  const first = Math.min(...results.map(r => r.created_at));
  const fresh = results.filter(r => r.created_at - first <= ONLINE.REPORT_WINDOW);
  const sides = new Set(fresh.map(r => r.side));
  const same = fresh.every(r => r.home_goals === mine.home_goals && r.away_goals === mine.away_goals);
  if (!sides.has(0) || !sides.has(1)) return { status: 'waiting', points: 0 };
  if (!same) return { status: 'mismatch', points: 0 };
  // dà i punti a chi non li ha ancora avuti
  for (const r of fresh.filter(x => x.counted === 0)) await creditReport(env, match, r, fresh, t);
  const me = await env.DB.prepare('SELECT counted, points FROM online_reports WHERE match_id = ? AND user_id = ?').bind(match, user.id).first();
  return { status: me.counted === 1 ? 'counted' : me.counted === 2 ? 'limit' : 'waiting', points: me.points };
}

async function creditReport(env, match, r, all, t) {
  const gf = r.side === 0 ? r.home_goals : r.away_goals, ga = r.side === 0 ? r.away_goals : r.home_goals;
  // limiti del giorno: partite con punti in tutto e contro gli stessi avversari
  const day = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_reports WHERE user_id = ? AND counted = 1 AND created_at > ?').bind(r.user_id, t - DAY).first();
  let ok = day.n < ONLINE.MAX_PER_DAY;
  for (const opp of all.filter(x => x.side !== r.side)) {
    if (!ok) break;
    const pair = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_reports a JOIN online_reports b ON b.match_id = a.match_id ' +
      'WHERE a.user_id = ? AND b.user_id = ? AND a.side <> b.side AND a.counted = 1 AND a.created_at > ?').bind(r.user_id, opp.user_id, t - DAY).first();
    if (pair.n >= ONLINE.MAX_PAIR_PER_DAY) ok = false;
  }
  const pts = ok ? pointsFor(gf, ga) : 0;
  const claim = await env.DB.prepare('UPDATE online_reports SET counted = ?, points = ? WHERE match_id = ? AND user_id = ? AND counted = 0').bind(ok ? 1 : 2, pts, match, r.user_id).run();
  if (!claim.meta.changes || !ok) return;   // già contata da un'altra richiesta, o limite raggiunto
  const w = gf > ga ? 1 : 0, d = gf === ga ? 1 : 0, l = gf < ga ? 1 : 0;
  await env.DB.prepare('INSERT INTO online_stats (user_id, points, played, won, drawn, lost, goals_for, goals_against, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT (user_id) DO UPDATE SET points = points + excluded.points, played = played + 1, won = won + excluded.won, drawn = drawn + excluded.drawn, ' +
    'lost = lost + excluded.lost, goals_for = goals_for + excluded.goals_for, goals_against = goals_against + excluded.goals_against, updated_at = excluded.updated_at')
    .bind(r.user_id, pts, w, d, l, gf, ga, t).run();
}

function row(r, rank) {
  return { rank: rank, username: r.username, points: r.points, level: levelOf(r.points), played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goals_for, goalsAgainst: r.goals_against };
}
// classifica: i primi 50 (uguale per tutti)
export async function onlineLeaderboard(env) {
  const { results } = await env.DB.prepare('SELECT u.username, s.points, s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against FROM online_stats s JOIN users u ON u.id = s.user_id ' +
    'WHERE u.hidden = 0 AND s.played > 0 ORDER BY s.points DESC, s.won DESC, s.updated_at ASC LIMIT ' + ONLINE.TOP).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_stats s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0 AND s.played > 0').first();
  return { top: results.map((r, i) => row(r, i + 1)), total: total.n, rules: { win: ONLINE.WIN, draw: ONLINE.DRAW, loss: ONLINE.LOSS, perDay: ONLINE.MAX_PER_DAY, perOpponent: ONLINE.MAX_PAIR_PER_DAY } };
}
// i miei numeri e la mia posizione
export async function myOnline(env, user) {
  const s = await env.DB.prepare('SELECT u.username, s.points, s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against, s.updated_at FROM online_stats s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?').bind(user.id).first();
  if (!s) return { username: user.username, points: 0, level: 1, levelInfo: levelInfo(0), played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, rank: null };
  const better = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_stats s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0 AND s.played > 0 AND (s.points > ? OR (s.points = ? AND s.won > ?) OR (s.points = ? AND s.won = ? AND s.updated_at < ?))')
    .bind(s.points, s.points, s.won, s.points, s.won, s.updated_at).first();
  return Object.assign(row(s, s.played > 0 ? better.n + 1 : null), { levelInfo: levelInfo(s.points) });
}
// livelli di alcuni giocatori (per la lista degli amici): { id: punti }
export async function pointsOf(env, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { results } = await env.DB.prepare('SELECT user_id, points FROM online_stats WHERE user_id IN (' + ids.map(() => '?').join(',') + ')').bind(...ids).all();
  for (const r of results) out.set(r.user_id, r.points);
  return out;
}

// il gioco si fa vivo: online nel menu o in partita
export async function presence(env, user, body, t) {
  const what = body && body.status === 'match' ? 'match' : 'menu';
  await env.DB.prepare('UPDATE users SET last_seen = ?, presence = ? WHERE id = ?').bind(t, what, user.id).run();
  return { ok: true };
}
// stato di un amico per la lista: 'match' (in partita), 'online', oppure null (con l'ultima volta che si è visto)
export function friendStatus(lastSeen, pres, t) {
  if (!lastSeen || t - lastSeen > ONLINE.ONLINE_MS) return null;
  return pres === 'match' ? 'match' : 'online';
}
