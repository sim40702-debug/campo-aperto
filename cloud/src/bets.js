// Scommesse: giocata, controllo della schedina, consultazione, condivisione.
// Il client manda solo: partite, mercati, selezioni, puntata e le quote che ha visto. Quote, etichette, saldo,
// stato delle partite e vincite li decide il server; se una quota è cambiata la giocata non parte (409).
import { fail, moveCoins, constraintKind, randomCode } from './util.js';
import { labelOf, payoutOf } from './markets.js';
import { phaseOf, stakesOf, oddsNow } from './fixtures.js';
import { award } from './rewards.js';

export const MAX_ITEMS = 10, MIN_STAKE = 1, MAX_STAKE = 10000, MAX_TOTAL_ODDS = 1000, BETS_PER_MINUTE = 30;
export const REACTIONS = ['🔥', '👏', '💀', '👀'];
const CODE_RE = /^BET-[A-Z0-9]{5}$/, FIX_RE = /^PA-[A-Z0-9]{5}$/, MKT_RE = /^[A-Z0-9]{1,6}$/, SEL_RE = /^[A-Za-z0-9.+-]{1,8}$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_ITEMS) fail(400, 'BAD_ITEMS', 'La schedina deve avere da 1 a ' + MAX_ITEMS + ' selezioni');
  return raw.map(x => {
    if (!x || !FIX_RE.test(x.fixture) || !MKT_RE.test(x.market) || !SEL_RE.test(x.selection)) fail(400, 'BAD_ITEMS', 'Selezione non valida');
    const odds = x.odds === undefined ? null : Number(x.odds);
    if (odds !== null && !(odds >= 1 && odds <= 1000)) fail(400, 'BAD_ITEMS', 'Quota non valida');
    return { fixture: x.fixture, market: x.market, selection: x.selection, odds: odds };
  });
}

// quote attuali delle selezioni (dal server) e se si possono ancora giocare
async function priceItems(env, items, t) {
  const codes = [...new Set(items.map(i => i.fixture))];
  const { results: fx } = await env.DB.prepare('SELECT id, code, home_name, away_name, kickoff_at, duration_ms, status, markets FROM fixtures WHERE code IN (' + codes.map(() => '?').join(',') + ')')
    .bind(...codes).all();
  const byCode = {};
  for (const f of fx) byCode[f.code] = { f: f, mk: JSON.parse(f.markets), stakes: (await stakesOf(env, f.id)).by };
  return items.map(i => {
    const x = byCode[i.fixture];
    if (!x) return Object.assign({}, i, { available: false, reason: 'NO_FIXTURE', current: null });
    const phase = phaseOf(x.f, t);
    const current = oddsNow(x.mk, x.stakes, i.market, i.selection);
    const lab = labelOf(x.mk, i.market, i.selection);
    return Object.assign({}, i, {
      fixtureId: x.f.id, home: x.f.home_name, away: x.f.away_name, kickoffAt: x.f.kickoff_at, phase: phase,
      marketLabel: lab.market, selectionLabel: lab.selection, current: current,
      available: phase === 'OPEN' && current !== null, reason: current === null ? 'BAD_SELECTION' : phase !== 'OPEN' ? 'CLOSED' : null,
    });
  });
}

// controllo della schedina (per "Copia scommessa" e prima di confermare): quote attuali e differenze
export async function quoteSlip(env, body, t) {
  const items = parseItems(body.items);
  const priced = await priceItems(env, items, t);
  const total = priced.every(p => p.available) ? Math.round(priced.reduce((s, p) => s * p.current, 1) * 100) / 100 : null;
  return {
    serverTime: t,
    items: priced.map(p => ({
      fixture: p.fixture, home: p.home, away: p.away, kickoffAt: p.kickoffAt, phase: p.phase || 'MISSING',
      market: p.market, selection: p.selection, marketLabel: p.marketLabel, selectionLabel: p.selectionLabel,
      odds: p.current, requestedOdds: p.odds, changed: p.odds !== null && p.current !== null && Math.abs(p.odds - p.current) > 1e-9,
      available: p.available, reason: p.reason,
    })),
    totalOdds: total,
  };
}

export async function placeBet(env, user, body, t) {
  const items = parseItems(body.items);
  const stake = Number(body.stake);
  if (!Number.isInteger(stake) || stake < MIN_STAKE || stake > MAX_STAKE) fail(400, 'BAD_STAKE', 'Puntata: un numero intero di monete da ' + MIN_STAKE + ' a ' + MAX_STAKE);
  if (typeof body.clientKey !== 'string' || !KEY_RE.test(body.clientKey)) fail(400, 'BAD_KEY', 'Richiesta senza chiave valida');
  if (items.some(i => i.odds === null)) fail(400, 'BAD_ITEMS', 'Manca la quota vista per una selezione');
  // stesso invio ripetuto (rete instabile, doppio clic): si restituisce la scommessa già fatta, senza addebitare di nuovo
  const dup = await env.DB.prepare('SELECT code FROM bets WHERE user_id = ? AND client_key = ?').bind(user.id, body.clientKey).first();
  if (dup) return { duplicate: true, bet: await getBet(env, dup.code, user, t) };
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM bets WHERE user_id = ? AND created_at > ?').bind(user.id, t - 60000).first();
  if (recent.n >= BETS_PER_MINUTE) fail(429, 'RATE_LIMIT', 'Troppe scommesse in poco tempo: aspetta un momento');
  if (new Set(items.map(i => i.fixture)).size !== items.length) fail(400, 'SAME_FIXTURE', 'In una multipla ogni partita può comparire una volta sola');

  const priced = await priceItems(env, items, t);
  const bad = priced.find(p => !p.available);
  if (bad) fail(409, bad.reason === 'CLOSED' ? 'BETTING_CLOSED' : 'BAD_SELECTION', bad.reason === 'CLOSED' ? 'Scommesse chiuse per ' + bad.home + ' - ' + bad.away : 'Selezione non disponibile');
  const changes = priced.filter(p => Math.abs(p.odds - p.current) > 1e-9);
  if (changes.length) fail(409, 'ODDS_CHANGED', 'Quota cambiata', { changes: changes.map(p => ({ fixture: p.fixture, market: p.market, selection: p.selection, old: p.odds, new: p.current })) });
  const oddsList = priced.map(p => p.current);
  const totalOdds = oddsList.reduce((s, o) => s * o, 1);
  if (totalOdds > MAX_TOTAL_ODDS) fail(400, 'ODDS_TOO_HIGH', 'Quota totale oltre ' + MAX_TOTAL_ODDS);
  const potential = payoutOf(stake, oddsList);

  const visibility = body.visibility === 'private' ? 'private' : body.visibility === 'public' ? 'public' : (user.publicBets ? 'public' : 'private');
  let copiedFrom = null;
  if (typeof body.copiedFrom === 'string' && CODE_RE.test(body.copiedFrom)) {
    const src = await betRow(env, body.copiedFrom);
    if (src && visibleTo(src, user) && src.user_id !== user.id) copiedFrom = src.code;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = 'BET-' + randomCode(5);
    const stmts = [
      env.DB.prepare('INSERT INTO bets (code, user_id, client_key, stake, odds, potential_payout, visibility, copied_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(code, user.id, body.clientKey, stake, Math.round(totalOdds * 100) / 100, potential, visibility, copiedFrom, t),
      ...moveCoins(env.DB, user.id, -stake, 'BET_PLACED', code, t),
      ...priced.map(p => env.DB.prepare('INSERT INTO bet_items (bet_id, fixture_id, market, selection, market_label, selection_label, odds) SELECT id, ?, ?, ?, ?, ?, ? FROM bets WHERE code = ?')
        .bind(p.fixtureId, p.market, p.selection, p.marketLabel, p.selectionLabel, p.current, code)),
    ];
    try {
      await env.DB.batch(stmts);
    } catch (e) {
      const k = constraintKind(e);
      if (k === 'CHECK') fail(402, 'INSUFFICIENT_FUNDS', 'Saldo insufficiente');
      if (k === 'UNIQUE') {
        const again = await env.DB.prepare('SELECT code FROM bets WHERE user_id = ? AND client_key = ?').bind(user.id, body.clientKey).first();
        if (again) return { duplicate: true, bet: await getBet(env, again.code, user, t) };
        continue;   // codice già usato da un'altra scommessa: se ne genera un altro
      }
      throw e;
    }
    await award(env, user.id, 'FIRST_BET', t);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM bets WHERE user_id = ?').bind(user.id).first();
    if (n.n >= 10) await award(env, user.id, 'BETS_10', t);
    return { duplicate: false, bet: await getBet(env, code, user, t) };
  }
  fail(503, 'RETRY', 'Riprova');
}

// ---------- lettura ----------
const BET_COLS = 'b.id, b.code, b.user_id, b.stake, b.odds, b.potential_payout, b.status, b.payout, b.visibility, b.shared, b.copied_from, b.created_at, b.settled_at, u.username, u.public_bets';

async function betRow(env, code) {
  return env.DB.prepare('SELECT ' + BET_COLS + ' FROM bets b JOIN users u ON u.id = b.user_id WHERE b.code = ?').bind(code).first();
}

// chi può vedere una scommessa: il proprietario; tutti se è pubblica e il profilo mostra le scommesse; chi ha
// il codice se il proprietario l'ha condivisa
export function visibleTo(b, viewer) {
  if (viewer && viewer.id === b.user_id) return true;
  if (b.shared) return true;
  return b.visibility === 'public' && !!b.public_bets;
}

// vista pubblica di più scommesse: niente id interni, niente dati dell'account oltre al nome
export async function betViews(env, rows, viewer) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id), ph = ids.map(() => '?').join(',');
  const { results: items } = await env.DB.prepare(
    'SELECT i.bet_id, i.market, i.selection, i.market_label, i.selection_label, i.odds, i.status, f.code, f.home_name, f.away_name, f.kickoff_at ' +
    'FROM bet_items i JOIN fixtures f ON f.id = i.fixture_id WHERE i.bet_id IN (' + ph + ') ORDER BY i.id').bind(...ids).all();
  const { results: reacts } = await env.DB.prepare('SELECT bet_id, emoji, COUNT(*) AS n, MAX(user_id = ?) AS me FROM bet_reactions WHERE bet_id IN (' + ph + ') GROUP BY bet_id, emoji')
    .bind(viewer ? viewer.id : 0, ...ids).all();
  const codes = rows.map(r => r.code);
  const { results: copies } = await env.DB.prepare('SELECT copied_from, COUNT(*) AS n FROM bets WHERE copied_from IN (' + codes.map(() => '?').join(',') + ') GROUP BY copied_from')
    .bind(...codes).all();
  return rows.map(b => {
    const mine = !!viewer && viewer.id === b.user_id;
    const v = {
      code: b.code, user: b.username, mine: mine,
      stake: b.stake, odds: b.odds, potentialPayout: b.potential_payout, status: b.status, payout: b.payout,
      createdAt: b.created_at, settledAt: b.settled_at, copiedFrom: b.copied_from,
      type: 0, items: [], reactions: {}, myReactions: [], copies: 0,
    };
    for (const i of items) if (i.bet_id === b.id) v.items.push({
      fixture: i.code, home: i.home_name, away: i.away_name, kickoffAt: i.kickoff_at,
      market: i.market, selection: i.selection, marketLabel: i.market_label, selectionLabel: i.selection_label, odds: i.odds, status: i.status,
    });
    v.type = v.items.length > 1 ? 'MULTIPLA' : 'SINGOLA';
    for (const r of reacts) if (r.bet_id === b.id) { v.reactions[r.emoji] = r.n; if (r.me) v.myReactions.push(r.emoji); }
    const c = copies.find(x => x.copied_from === b.code);
    v.copies = c ? c.n : 0;
    if (mine) { v.visibility = b.visibility; v.shared = !!b.shared; }
    return v;
  });
}

export async function getBet(env, code, viewer, t) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) fail(404, 'NO_BET', 'Scommessa non trovata');
  const b = await betRow(env, code);
  // una scommessa privata risponde come una inesistente: non si scopre nemmeno che esiste
  if (!b || !visibleTo(b, viewer)) fail(404, 'NO_BET', 'Scommessa non trovata');
  return (await betViews(env, [b], viewer))[0];
}

// condivisione: rende la scommessa leggibile a chi ha il codice (anche se privata). Solo il proprietario.
export async function shareBet(env, user, code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) fail(404, 'NO_BET', 'Scommessa non trovata');
  const r = await env.DB.prepare('UPDATE bets SET shared = 1 WHERE code = ? AND user_id = ?').bind(code, user.id).run();
  if (!r.meta.changes) fail(404, 'NO_BET', 'Scommessa non trovata');
  return { code: code, shared: true };
}

// visibilità di una singola scommessa (solo il proprietario)
export async function setBetVisibility(env, user, code, visibility) {
  if (visibility !== 'public' && visibility !== 'private') fail(400, 'BAD_VISIBILITY', 'Visibilità non valida');
  if (typeof code !== 'string' || !CODE_RE.test(code)) fail(404, 'NO_BET', 'Scommessa non trovata');
  const r = await env.DB.prepare('UPDATE bets SET visibility = ? WHERE code = ? AND user_id = ?').bind(visibility, code, user.id).run();
  if (!r.meta.changes) fail(404, 'NO_BET', 'Scommessa non trovata');
  return { code: code, visibility: visibility };
}

export async function myBets(env, user, q) {
  const before = Number(q.get('before')) || 2 ** 53;
  const status = q.get('status');
  const filter = status === 'open' ? " AND b.status = 'OPEN'" : status === 'settled' ? " AND b.status <> 'OPEN'" : '';
  const { results } = await env.DB.prepare('SELECT ' + BET_COLS + ' FROM bets b JOIN users u ON u.id = b.user_id WHERE b.user_id = ? AND b.id < ?' + filter + ' ORDER BY b.id DESC LIMIT 20')
    .bind(user.id, before).all();
  const bets = await betViews(env, results, user);
  return { bets, next: results.length === 20 ? results[results.length - 1].id : null };
}
