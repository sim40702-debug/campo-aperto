// Negozio, inventario, personaggio. Prezzi solo dal database; un oggetto si indossa solo se è nell'inventario.
import { fail, moveCoins, constraintKind } from './util.js';
import { award } from './rewards.js';
import { USERNAME_RE } from './auth.js';

export const SLOTS = ['maglia', 'pantaloncini', 'calzettoni', 'scarpe', 'guanti', 'capelli', 'accessori'];
const ITEM_RE = /^[a-z0-9_]{2,40}$/;
const NAME_RE = /^[A-Z0-9 .'-]{0,12}$/;

const itemView = (r, owned, equipped) => ({
  id: r.id, category: r.category, name: r.name, rarity: r.rarity, price: r.price, data: JSON.parse(r.data),
  owned: !!owned, equipped: !!equipped, available: !!r.active,
});

export async function catalog(env, user) {
  const { results } = await env.DB.prepare('SELECT id, category, name, rarity, price, data, active FROM shop_items WHERE active = 1 ORDER BY category, sort, price').all();
  let owned = new Set(), eq = new Set();
  if (user) {
    const inv = await env.DB.prepare('SELECT item_id FROM inventory WHERE user_id = ?').bind(user.id).all();
    owned = new Set(inv.results.map(r => r.item_id));
    const e = await env.DB.prepare('SELECT item_id FROM equipped WHERE user_id = ?').bind(user.id).all();
    eq = new Set(e.results.map(r => r.item_id));
  }
  return { categories: SLOTS, items: results.map(r => itemView(r, owned.has(r.id), eq.has(r.id))) };
}

export async function inventory(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT s.id, s.category, s.name, s.rarity, s.price, s.data, s.active, i.acquired_at, (e.item_id IS NOT NULL) AS eq FROM inventory i JOIN shop_items s ON s.id = i.item_id ' +
    'LEFT JOIN equipped e ON e.user_id = i.user_id AND e.item_id = i.item_id WHERE i.user_id = ? ORDER BY s.category, s.sort').bind(user.id).all();
  return { items: results.map(r => Object.assign(itemView(r, true, r.eq), { acquiredAt: r.acquired_at })) };
}

export async function buy(env, user, body, t) {
  const id = body.item;
  if (typeof id !== 'string' || !ITEM_RE.test(id)) fail(400, 'BAD_ITEM', 'Oggetto non valido');
  const item = await env.DB.prepare('SELECT id, price, active FROM shop_items WHERE id = ?').bind(id).first();
  if (!item || !item.active) fail(404, 'NO_ITEM', 'Oggetto non in vendita');
  try {
    // il prezzo è quello del database, non quello mandato dal client
    await env.DB.batch([
      env.DB.prepare('INSERT INTO inventory (user_id, item_id, acquired_at) VALUES (?, ?, ?)').bind(user.id, id, t),
      ...moveCoins(env.DB, user.id, -item.price, 'SHOP_PURCHASE', user.id + ':' + id, t),
    ]);
  } catch (e) {
    const k = constraintKind(e);
    if (k === 'CHECK') fail(402, 'INSUFFICIENT_FUNDS', 'Saldo insufficiente');
    if (k === 'UNIQUE') fail(409, 'ALREADY_OWNED', 'Hai già questo oggetto');
    throw e;
  }
  await award(env, user.id, 'FIRST_PURCHASE', t);
  return { item: id, price: item.price };
}

export async function equip(env, user, body) {
  const id = body.item;
  if (typeof id !== 'string' || !ITEM_RE.test(id)) fail(400, 'BAD_ITEM', 'Oggetto non valido');
  // si inserisce solo se l'oggetto è nell'inventario dell'utente
  const r = await env.DB.prepare('INSERT OR REPLACE INTO equipped (user_id, slot, item_id) SELECT i.user_id, s.category, s.id FROM inventory i JOIN shop_items s ON s.id = i.item_id WHERE i.user_id = ? AND i.item_id = ?')
    .bind(user.id, id).run();
  if (!r.meta.changes) fail(403, 'NOT_OWNED', 'Non possiedi questo oggetto');
  return { item: id, equipped: true };
}

export async function unequip(env, user, body) {
  if (!SLOTS.includes(body.slot)) fail(400, 'BAD_SLOT', 'Categoria non valida');
  await env.DB.prepare('DELETE FROM equipped WHERE user_id = ? AND slot = ?').bind(user.id, body.slot).run();
  return { slot: body.slot, equipped: false };
}

export async function setAvatar(env, user, body) {
  const number = Number(body.number);
  if (!Number.isInteger(number) || number < 1 || number > 99) fail(400, 'BAD_NUMBER', 'Numero di maglia da 1 a 99');
  const name = typeof body.name === 'string' ? body.name.trim().toUpperCase() : '';
  if (!NAME_RE.test(name)) fail(400, 'BAD_NAME', 'Nome sulla maglia: massimo 12 caratteri tra lettere, numeri, spazio . \' -');
  await env.DB.prepare('UPDATE users SET shirt_number = ?, shirt_name = ? WHERE id = ?').bind(number, name, user.id).run();
  return { number, name };
}

// aspetto di un giocatore (pubblico: è quello che si vede in campo). Lo legge ogni client dal server,
// così nessuno può mostrare agli altri oggetti che non ha comprato
export async function loadout(env, username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) fail(404, 'NO_USER', 'Giocatore non trovato');
  const u = await env.DB.prepare('SELECT id, username, shirt_number, shirt_name FROM users WHERE username_lc = ?').bind(username.toLowerCase()).first();
  if (!u) fail(404, 'NO_USER', 'Giocatore non trovato');
  const { results } = await env.DB.prepare('SELECT e.slot, s.id, s.data FROM equipped e JOIN shop_items s ON s.id = e.item_id WHERE e.user_id = ?').bind(u.id).all();
  const items = {};
  for (const r of results) items[r.slot] = Object.assign({ id: r.id }, JSON.parse(r.data));
  return { username: u.username, number: u.shirt_number, name: u.shirt_name, items };
}
