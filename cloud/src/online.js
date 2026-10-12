// Classifica dei giocatori online: punti e livelli dalle partite online tra persone (stanze del relay).
// A fine partita ogni giocatore con l'account manda il risultato (codice della partita, la sua squadra, gol).
// La partita vale solo quando arrivano i risultati di tutte e due le squadre e sono uguali: contro l'IA o da
// soli non si prendono punti. Per evitare i "punti facili" tra due account dello stesso giocatore: al massimo
// MAX_PER_DAY partite con punti al giorno e MAX_PAIR_PER_DAY contro lo stesso avversario.
// Presenza: il gioco si fa vivo ogni minuto (POST /api/presence) e gli amici vedono chi è online o in partita.
import { fail, moveCoins, constraintKind } from './util.js';

export const ONLINE = {
  WIN: 30, DRAW: 12, LOSS: 5,       // punti per risultato
  MAX_PER_DAY: 15,
  MAX_PAIR_PER_DAY: 3,
  REPORT_WINDOW: 3 * 3600 * 1000,   // i risultati della stessa partita devono arrivare entro 3 ore
  ONLINE_MS: 150 * 1000,            // "online" se si è fatto vivo negli ultimi due minuti e mezzo
  TOP: 50,
  SEASON_PRIZES: [1000, 500, 250],  // monete ai primi tre della stagione (un mese)
  QUEUE_WAIT_MS: 15 * 1000,         // chi cerca e non si fa vivo da 15 secondi esce dalla coda
  QUEUE_MATCH_MS: 60 * 1000,        // una coppia trovata che non entra in partita entro un minuto viene tolta
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
// stagione della classifica online: un mese (ora UTC). key 'AAAA-MM', start e end in millisecondi
export function onlineSeasonOf(t) {
  const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
  const key = y + '-' + String(m + 1).padStart(2, '0');
  return { key: key, start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 1) };
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
  // e anche nella stagione di questo mese
  await env.DB.prepare('INSERT INTO online_season_stats (season, user_id, points, played, won, drawn, lost, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?) ' +
    'ON CONFLICT (season, user_id) DO UPDATE SET points = points + excluded.points, played = played + 1, won = won + excluded.won, drawn = drawn + excluded.drawn, ' +
    'lost = lost + excluded.lost, updated_at = excluded.updated_at')
    .bind(onlineSeasonOf(t).key, r.user_id, pts, w, d, l, t).run();
}

function row(r, rank) {
  return { rank: rank, username: r.username, points: r.points, level: levelOf(r.points), played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goals_for, goalsAgainst: r.goals_against };
}
// distintivi delle stagioni finite di alcuni giocatori: { id: [{ season, rank }] } (i più recenti prima)
async function badgesOf(env, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { results } = await env.DB.prepare('SELECT user_id, season, rank FROM online_badges WHERE user_id IN (' + ids.map(() => '?').join(',') + ') ORDER BY season DESC').bind(...ids).all();
  for (const b of results) {
    if (!out.has(b.user_id)) out.set(b.user_id, []);
    out.get(b.user_id).push({ season: b.season, rank: b.rank });
  }
  return out;
}
function seasonInfo(t) {
  const s = onlineSeasonOf(t);
  return { key: s.key, start: s.start, endsAt: s.end, prizes: ONLINE.SEASON_PRIZES };
}
// classifica: i primi 50 (uguale per tutti). which: 'season' (questo mese) oppure 'all' (di sempre)
export async function onlineLeaderboard(env, t, which) {
  const season = which === 'season';
  const key = onlineSeasonOf(t).key;
  let rows, total;
  if (season) {
    rows = (await env.DB.prepare('SELECT u.id AS uid, u.username, s.points, s.played, s.won, s.drawn, s.lost, 0 AS goals_for, 0 AS goals_against FROM online_season_stats s JOIN users u ON u.id = s.user_id ' +
      'WHERE s.season = ? AND u.hidden = 0 AND s.played > 0 ORDER BY s.points DESC, s.won DESC, s.updated_at ASC LIMIT ' + ONLINE.TOP).bind(key).all()).results;
    total = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_season_stats s JOIN users u ON u.id = s.user_id WHERE s.season = ? AND u.hidden = 0 AND s.played > 0').bind(key).first();
  } else {
    rows = (await env.DB.prepare('SELECT u.id AS uid, u.username, s.points, s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against FROM online_stats s JOIN users u ON u.id = s.user_id ' +
      'WHERE u.hidden = 0 AND s.played > 0 ORDER BY s.points DESC, s.won DESC, s.updated_at ASC LIMIT ' + ONLINE.TOP).all()).results;
    total = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_stats s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0 AND s.played > 0').first();
  }
  const badges = await badgesOf(env, rows.map(r => r.uid));
  // il livello è sempre quello dei punti di sempre: nella stagione si mostra lo stesso
  const lv = season ? await pointsOf(env, rows.map(r => r.uid)) : null;
  const top = rows.map((r, i) => {
    const o = row(r, i + 1);
    if (season) { o.level = levelOf(lv.get(r.uid) || 0); delete o.goalsFor; delete o.goalsAgainst; }
    o.badges = badges.get(r.uid) || [];
    return o;
  });
  return { which: season ? 'season' : 'all', season: seasonInfo(t), top: top, total: total.n,
    rules: { win: ONLINE.WIN, draw: ONLINE.DRAW, loss: ONLINE.LOSS, perDay: ONLINE.MAX_PER_DAY, perOpponent: ONLINE.MAX_PAIR_PER_DAY } };
}
// i miei numeri e la mia posizione (di sempre e della stagione), con i miei distintivi
export async function myOnline(env, user, t) {
  const s = await env.DB.prepare('SELECT u.username, s.points, s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against, s.updated_at FROM online_stats s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?').bind(user.id).first();
  let out;
  if (!s) out = { username: user.username, points: 0, level: 1, levelInfo: levelInfo(0), played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, rank: null };
  else {
    const better = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_stats s JOIN users u ON u.id = s.user_id WHERE u.hidden = 0 AND s.played > 0 AND (s.points > ? OR (s.points = ? AND s.won > ?) OR (s.points = ? AND s.won = ? AND s.updated_at < ?))')
      .bind(s.points, s.points, s.won, s.points, s.won, s.updated_at).first();
    out = Object.assign(row(s, s.played > 0 ? better.n + 1 : null), { levelInfo: levelInfo(s.points) });
  }
  const key = onlineSeasonOf(t).key;
  const ss = await env.DB.prepare('SELECT points, played, won, drawn, lost, updated_at FROM online_season_stats WHERE season = ? AND user_id = ?').bind(key, user.id).first();
  const season = { points: 0, played: 0, won: 0, drawn: 0, lost: 0, rank: null };
  if (ss) {
    const b = await env.DB.prepare('SELECT COUNT(*) AS n FROM online_season_stats s JOIN users u ON u.id = s.user_id WHERE s.season = ? AND u.hidden = 0 AND s.played > 0 AND (s.points > ? OR (s.points = ? AND s.won > ?) OR (s.points = ? AND s.won = ? AND s.updated_at < ?))')
      .bind(key, ss.points, ss.points, ss.won, ss.points, ss.won, ss.updated_at).first();
    Object.assign(season, { points: ss.points, played: ss.played, won: ss.won, drawn: ss.drawn, lost: ss.lost, rank: ss.played > 0 ? b.n + 1 : null });
  }
  out.season = Object.assign(seasonInfo(t), season);
  out.badges = (await badgesOf(env, [user.id])).get(user.id) || [];
  return out;
}

// premi della stagione online appena finita: monete e distintivo ai primi tre. Lo chiama il giro del server
// (tick.js): il segno nella tabella meta e i riferimenti unici delle monete impediscono doppi pagamenti.
export async function payOnlineSeason(env, t) {
  const prev = onlineSeasonOf(onlineSeasonOf(t).start - 1);
  const flag = 'online_season_paid:' + prev.key;
  if (await env.DB.prepare('SELECT 1 FROM meta WHERE key = ?').bind(flag).first()) return 0;
  const { results } = await env.DB.prepare('SELECT s.user_id, s.points FROM online_season_stats s JOIN users u ON u.id = s.user_id ' +
    'WHERE s.season = ? AND u.hidden = 0 AND s.played > 0 AND s.points > 0 ORDER BY s.points DESC, s.won DESC, s.updated_at ASC LIMIT ?')
    .bind(prev.key, ONLINE.SEASON_PRIZES.length).all();
  let paid = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    await env.DB.prepare('INSERT OR IGNORE INTO online_badges (user_id, season, rank, points, created_at) VALUES (?, ?, ?, ?, ?)').bind(r.user_id, prev.key, i + 1, r.points, t).run();
    try {
      await env.DB.batch(moveCoins(env.DB, r.user_id, ONLINE.SEASON_PRIZES[i], 'ONLINE_PRIZE', prev.key + ':' + (i + 1), t));
      paid++;
    } catch (e) { if (constraintKind(e) !== 'UNIQUE') throw e; }
  }
  await env.DB.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind(flag, String(t)).run();
  return paid;
}

// ---- partita veloce online: "Cerca avversario" ----
// body.action: 'join' (entro nella coda), 'poll' (come va?), 'room' (sono l'host: ecco il codice della stanza),
// 'leave' (esco). Risposte: status 'waiting' (nessuno ancora), 'matched' (trovato: role 'host' apre la stanza,
// 'guest' aspetta il codice), 'ready' (per il guest: c'è il codice in room), 'none' (non sono nella coda).
async function queueRow(env, id) {
  return env.DB.prepare('SELECT user_id, partner_id, role, room, created_at, last_seen FROM online_queue WHERE user_id = ?').bind(id).first();
}
async function nameOf(env, id) {
  const u = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(id).first();
  return u ? u.username : null;
}
async function queueState(env, me) {
  if (!me) return { status: 'none' };
  if (!me.partner_id) return { status: 'waiting', since: me.created_at };
  const partner = await queueRow(env, me.partner_id);
  // l'altro è uscito dalla coda: si torna a cercare
  if (!partner || partner.partner_id !== me.user_id) {
    await env.DB.prepare('UPDATE online_queue SET partner_id = NULL, role = NULL, room = NULL WHERE user_id = ?').bind(me.user_id).run();
    return { status: 'waiting', since: me.created_at, lost: true };
  }
  const opponent = await nameOf(env, me.partner_id);
  if (me.role === 'host') return { status: 'matched', role: 'host', opponent: opponent };
  if (partner.room) return { status: 'ready', role: 'guest', opponent: opponent, room: partner.room };
  return { status: 'matched', role: 'guest', opponent: opponent };
}
export async function onlineQueue(env, user, body, t) {
  const action = String(body && body.action || '');
  // pulizia: chi non si fa vivo esce dalla coda
  await env.DB.prepare('DELETE FROM online_queue WHERE (partner_id IS NULL AND last_seen < ?) OR last_seen < ?').bind(t - ONLINE.QUEUE_WAIT_MS, t - ONLINE.QUEUE_MATCH_MS).run();
  let me = await queueRow(env, user.id);
  if (action === 'leave') {
    await env.DB.prepare('DELETE FROM online_queue WHERE user_id = ?').bind(user.id).run();
    return { status: 'none' };
  }
  if (action === 'room') {
    const room = String(body.room || '');
    if (!/^[A-Z0-9]{4,8}$/.test(room)) fail(400, 'BAD_ROOM', 'Codice della stanza non valido');
    if (!me || me.role !== 'host') fail(409, 'NOT_HOST', 'Non stai aprendo una partita veloce');
    await env.DB.prepare('UPDATE online_queue SET room = ?, last_seen = ? WHERE user_id = ?').bind(room, t, user.id).run();
    return queueState(env, await queueRow(env, user.id));
  }
  if (action === 'poll') {
    if (!me) return { status: 'none' };
    await env.DB.prepare('UPDATE online_queue SET last_seen = ? WHERE user_id = ?').bind(t, user.id).run();
    return queueState(env, me);
  }
  if (action !== 'join') fail(400, 'BAD_ACTION', 'Azione non valida');
  if (me) {
    await env.DB.prepare('UPDATE online_queue SET last_seen = ? WHERE user_id = ?').bind(t, user.id).run();
    return queueState(env, me);
  }
  // c'è qualcuno che aspetta? il primo arrivato apre la stanza (host), io entro (guest)
  const { results } = await env.DB.prepare('SELECT user_id FROM online_queue WHERE partner_id IS NULL AND user_id <> ? ORDER BY created_at ASC LIMIT 5').bind(user.id).all();
  for (const other of results) {
    // prenoto l'altro: se intanto l'ha preso qualcun altro, changes è 0 e provo il prossimo
    const claim = await env.DB.prepare("UPDATE online_queue SET partner_id = ?, role = 'host', last_seen = ? WHERE user_id = ? AND partner_id IS NULL").bind(user.id, t, other.user_id).run();
    if (!claim.meta.changes) continue;
    await env.DB.prepare("INSERT INTO online_queue (user_id, partner_id, role, room, created_at, last_seen) VALUES (?, ?, 'guest', NULL, ?, ?)").bind(user.id, other.user_id, t, t).run();
    return queueState(env, await queueRow(env, user.id));
  }
  await env.DB.prepare('INSERT INTO online_queue (user_id, partner_id, role, room, created_at, last_seen) VALUES (?, NULL, NULL, NULL, ?, ?)').bind(user.id, t, t).run();
  return { status: 'waiting', since: t };
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
