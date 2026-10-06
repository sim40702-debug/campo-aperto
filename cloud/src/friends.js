// Amici: elenco dei giocatori iscritti, richieste di amicizia, amici. Degli altri si vede solo il nome pubblico e
// la data di iscrizione: mai id interni, email, sessioni o altri dati dell'account.
// Gli account nascosti (users.hidden, es. "admin") non compaiono da nessuna parte e non possono avere amici.
import { fail } from './util.js';
import { USERNAME_RE } from './auth.js';

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

export async function myFriends(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT u.username, f.status, f.requested_by, f.created_at, f.accepted_at FROM friendships f JOIN users u ON u.id = (CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END) ' +
    'WHERE (f.user_a = ? OR f.user_b = ?) AND u.hidden = 0 ORDER BY u.username_lc').bind(user.id, user.id, user.id).all();
  return {
    friends: results.filter(r => r.status === 'ACCEPTED').map(r => ({ username: r.username, since: r.accepted_at })),
    incoming: results.filter(r => r.status === 'PENDING' && r.requested_by !== user.id).map(r => ({ username: r.username, at: r.created_at })),
    outgoing: results.filter(r => r.status === 'PENDING' && r.requested_by === user.id).map(r => ({ username: r.username, at: r.created_at })),
  };
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
