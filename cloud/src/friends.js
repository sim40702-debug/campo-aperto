// Amici: elenco dei giocatori iscritti, richieste di amicizia, amici. Degli altri si vede solo il nome pubblico e
// la data di iscrizione: mai id interni, email, sessioni o altri dati dell'account.
// Gli account nascosti (users.hidden, es. "admin") non compaiono da nessuna parte e non possono avere amici.
import { fail } from './util.js';
import { USERNAME_RE } from './auth.js';
import { pointsOf, levelOf, friendStatus } from './online.js';

const PAGE = 50;
const MAX_PENDING = 50;
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

export async function userByName(env, username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) fail(404, 'NO_USER', 'Giocatore non trovato');
  const u = await env.DB.prepare('SELECT id, username FROM users WHERE username_lc = ? AND hidden = 0').bind(username.toLowerCase()).first();
  if (!u) fail(404, 'NO_USER', 'Giocatore non trovato');
  return u;
}

// relazione con ogni altro giocatore: 'friend' (amici), 'sent' (richiesta mandata), 'received' (richiesta ricevuta)
export async function relations(env, me) {
  const { results } = await env.DB.prepare('SELECT user_a, user_b, requested_by, status FROM friendships WHERE user_a = ? OR user_b = ?').bind(me, me).all();
  const map = new Map();
  for (const r of results) map.set(r.user_a === me ? r.user_b : r.user_a, r.status === 'ACCEPTED' ? 'friend' : r.requested_by === me ? 'sent' : 'received');
  return map;
}
export async function areFriends(env, x, y) {
  const [a, b] = pair(x, y);
  const r = await env.DB.prepare("SELECT 1 AS ok FROM friendships WHERE user_a = ? AND user_b = ? AND status = 'ACCEPTED'").bind(a, b).first();
  return !!r;
}

// tutti i giocatori iscritti (in ordine di nome), con la relazione con chi guarda. q: parte del nome
export async function listUsers(env, user, q) {
  const search = String(q.get('q') || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
  const after = String(q.get('after') || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
  const { results } = await env.DB.prepare('SELECT id, username, username_lc, created_at FROM users WHERE (hidden = 0 OR id = ?) AND username_lc > ? AND instr(username_lc, ?) > 0 ORDER BY username_lc LIMIT ' + (PAGE + 1))
    .bind(user.id, after, search).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE hidden = 0').first();
  const rel = await relations(env, user.id);
  const page = results.slice(0, PAGE);
  return {
    users: page.map(u => ({ username: u.username, since: u.created_at, me: u.id === user.id, relation: rel.get(u.id) || null })),
    total: total.n,
    next: results.length > PAGE ? page[page.length - 1].username_lc : null,
  };
}

export async function myFriends(env, user, t) {
  const { results } = await env.DB.prepare(
    'SELECT u.id AS uid, u.username, u.last_seen, u.presence, f.status, f.requested_by, f.created_at, f.accepted_at FROM friendships f JOIN users u ON u.id = (CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END) ' +
    'WHERE (f.user_a = ? OR f.user_b = ?) AND u.hidden = 0 ORDER BY u.username_lc').bind(user.id, user.id, user.id).all();
  // chi apre la lista è online (nel menu)
  await env.DB.prepare("UPDATE users SET last_seen = ?, presence = 'menu' WHERE id = ?").bind(t, user.id).run();
  const accepted = results.filter(r => r.status === 'ACCEPTED');
  // livello nella classifica online e chi è online adesso (in partita o nel menu)
  const pts = await pointsOf(env, accepted.map(r => r.uid));
  return {
    friends: accepted.map(r => ({ username: r.username, since: r.accepted_at, level: levelOf(pts.get(r.uid) || 0),
      status: friendStatus(r.last_seen, r.presence, t), lastSeen: r.last_seen || null })),
    incoming: results.filter(r => r.status === 'PENDING' && r.requested_by !== user.id).map(r => ({ username: r.username, at: r.created_at })),
    outgoing: results.filter(r => r.status === 'PENDING' && r.requested_by === user.id).map(r => ({ username: r.username, at: r.created_at })),
    // inviti a partite online ricevuti (nella stessa risposta: nessuna richiesta in più per il pannello)
    games: await incomingGames(env, user, t),
  };
}

// ---------- inviti alle partite online ----------
const INVITE_TTL = 15 * 60 * 1000;
const ROOM_RE = /^[A-HJ-NP-Z2-9]{6}$/;
async function incomingGames(env, user, t) {
  const { results } = await env.DB.prepare("SELECT g.id, g.room, g.created_at, u.username FROM game_invites g JOIN users u ON u.id = g.from_id " +
    "WHERE g.to_id = ? AND g.status = 'PENDING' AND g.created_at > ? AND u.hidden = 0 ORDER BY g.id DESC LIMIT 10").bind(user.id, t - INVITE_TTL).all();
  return results.map(r => ({ id: r.id, from: r.username, room: r.room, at: r.created_at }));
}
// invito di un amico nella stanza che ho aperto (codice del relay). Un nuovo invito sostituisce quello vecchio
export async function inviteToGame(env, user, body, t) {
  const other = await userByName(env, body.username);
  if (other.id === user.id) fail(400, 'SELF', 'Non puoi invitare te stesso');
  if (typeof body.room !== 'string' || !ROOM_RE.test(body.room)) fail(400, 'BAD_ROOM', 'Codice della partita non valido');
  if (!(await areFriends(env, user.id, other.id))) fail(403, 'NOT_FRIEND', other.username + ' non è tra i tuoi amici');
  const r = await env.DB.batch([
    env.DB.prepare("UPDATE game_invites SET status = 'CANCELLED' WHERE from_id = ? AND to_id = ? AND status = 'PENDING'").bind(user.id, other.id),
    env.DB.prepare("INSERT INTO game_invites (from_id, to_id, room, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)").bind(user.id, other.id, body.room, t),
  ]);
  return { username: other.username, room: body.room, sent: !!r[1].meta.changes };
}
// risposta a un invito ricevuto: accept (si entra nella stanza) o decline
export async function answerGameInvite(env, user, id, accept) {
  const r = await env.DB.prepare("UPDATE game_invites SET status = ? WHERE id = ? AND to_id = ? AND status = 'PENDING' RETURNING room")
    .bind(accept ? 'ACCEPTED' : 'DECLINED', Number(id) || 0, user.id).first();
  if (!r) fail(404, 'NO_INVITE', 'Invito non più valido');
  return { room: r.room };
}

// richiesta di amicizia; se l'altro l'aveva già chiesta a me, diventa amicizia subito
export async function requestFriend(env, user, body, t) {
  const other = await userByName(env, body.username);
  if (other.id === user.id) fail(400, 'SELF', 'Non puoi aggiungere te stesso');
  const me = await env.DB.prepare('SELECT hidden FROM users WHERE id = ?').bind(user.id).first();
  if (me && me.hidden) fail(403, 'HIDDEN', 'Questo account è nascosto: non può avere amici');
  const [a, b] = pair(user.id, other.id);
  const row = await env.DB.prepare('SELECT requested_by, status FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, b).first();
  if (row && row.status === 'ACCEPTED') return { username: other.username, relation: 'friend' };
  if (row && row.requested_by === user.id) return { username: other.username, relation: 'sent' };
  if (row) {
    await env.DB.prepare("UPDATE friendships SET status = 'ACCEPTED', accepted_at = ? WHERE user_a = ? AND user_b = ?").bind(t, a, b).run();
    return { username: other.username, relation: 'friend' };
  }
  const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM friendships WHERE requested_by = ? AND status = 'PENDING'").bind(user.id).first();
  if (pend.n >= MAX_PENDING) fail(429, 'TOO_MANY', 'Troppe richieste in attesa');
  await env.DB.prepare("INSERT INTO friendships (user_a, user_b, requested_by, status, created_at) VALUES (?, ?, ?, 'PENDING', ?) ON CONFLICT DO NOTHING").bind(a, b, user.id, t).run();
  return { username: other.username, relation: 'sent' };
}

export async function acceptFriend(env, user, body, t) {
  const other = await userByName(env, body.username);
  const [a, b] = pair(user.id, other.id);
  const r = await env.DB.prepare("UPDATE friendships SET status = 'ACCEPTED', accepted_at = ? WHERE user_a = ? AND user_b = ? AND status = 'PENDING' AND requested_by = ?")
    .bind(t, a, b, other.id).run();
  if (!r.meta.changes) fail(404, 'NO_REQUEST', 'Nessuna richiesta da ' + other.username);
  return { username: other.username, relation: 'friend' };
}

// toglie un amico, ritira una richiesta mandata o rifiuta una ricevuta
export async function removeFriend(env, user, body) {
  const other = await userByName(env, body.username);
  const [a, b] = pair(user.id, other.id);
  await env.DB.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').bind(a, b).run();
  return { username: other.username, relation: null };
}
