// Worker di Campo Aperto: API JSON per account, monete, partite del server, scommesse, social, negozio.
// Richieste leggere (entro i 10 ms di CPU del piano gratuito); il lavoro pesante va al Durable Object Engine.
import { CORS, HttpError, fail, json, readJson, now, sha256hex, dayKey } from './util.js';
import { register, login, logout, authenticate, requireUser } from './auth.js';
import { listFixtures, fixtureDetail, fixtureEvents, fixtureByCode, phaseOf } from './fixtures.js';
import { placeBet, quoteSlip, getBet, shareBet, setBetVisibility, myBets } from './bets.js';
import { fixtureFeed, betStatuses, globalFeed, popular, fixtureStats, todayStats, leaderboard, react } from './social.js';
import { catalog, inventory, buy, equip, unequip, setAvatar, loadout } from './shop.js';
import { me, balance, transactions, setPrivacy, publicProfile } from './profile.js';
import { claimDaily, claimWatch } from './rewards.js';
import { engineVersion, gameVersion } from './simulate.js';
export { Engine } from './engine-do.js';
export { Relay } from './relay-do.js';
import { relayFetch } from './relay-do.js';

const API_VERSION = 1;
const tickEngine = env => env.ENGINE.get(env.ENGINE.idFromName('tick'));

// limite di registrazioni per rete al giorno: si salva solo un hash dell'indirizzo (con sale del server)
async function signupLimit(env, request, t) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return;
  const limit = Number(env.SIGNUP_PER_DAY || 5);
  const h = await sha256hex((env.SIGNUP_SALT || 'campo-aperto') + '|' + ip);
  const day = dayKey(t);
  const r = await env.DB.prepare('SELECT count FROM signup_limits WHERE ip_hash = ? AND day = ?').bind(h, day).first();
  if (r && r.count >= limit) fail(429, 'SIGNUP_LIMIT', 'Troppi account creati da questa rete oggi');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO signup_limits (ip_hash, day, count) VALUES (?, ?, 1) ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1').bind(h, day),
    env.DB.prepare('DELETE FROM signup_limits WHERE day < ?').bind(dayKey(t - 2 * 86400000)),
  ]);
}

// risposte pubbliche uguali per tutti (classifiche, statistiche): tenute in cache per pochi secondi
async function cached(request, ttl, make) {
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = json(await make(), 200, { 'cache-control': 'public, max-age=' + ttl });
  await cache.put(key, res.clone());
  return res;
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const q = url.searchParams;
  const t = await now(env);
  const seg = path.split('/').filter(Boolean);   // ['api', ...]
  if (seg[0] !== 'api') {
    if (path === '/') return json({ name: 'campo-aperto', api: API_VERSION, engine: engineVersion });
    fail(404, 'NOT_FOUND', 'Indirizzo sconosciuto');
  }
  const p = seg.slice(1);
  const is = (m, ...parts) => method === m && p.length === parts.length && parts.every((x, i) => x === '*' || x === p[i]);
  const body = method === 'POST' ? await readJson(request) : null;
  const user = () => requireUser(env, request, t);
  const viewer = () => authenticate(env, request, t);

  // ---- informazioni ----
  if (is('GET', 'status')) return json({ api: API_VERSION, engine: engineVersion, game: gameVersion, serverTime: t });

  // ---- account ----
  if (is('POST', 'auth', 'register')) { await signupLimit(env, request, t); return json(await register(env, body, t), 201); }
  if (is('POST', 'auth', 'login')) return json(await login(env, body, t));
  if (is('POST', 'auth', 'logout')) return json(await logout(env, await user()));
  if (is('GET', 'me')) return json(await me(env, await user(), t));
  if (is('GET', 'me', 'balance')) return json(await balance(env, await user()));
  if (is('GET', 'me', 'transactions')) return json(await transactions(env, await user(), q));
  if (is('GET', 'me', 'bets')) return json(await myBets(env, await user(), q));
  if (is('POST', 'me', 'privacy')) return json(await setPrivacy(env, await user(), body));
  if (is('POST', 'me', 'avatar')) return json(await setAvatar(env, await user(), body));
  if (is('POST', 'me', 'daily')) return json(await claimDaily(env, await user(), t));
  if (is('GET', 'players', '*')) return json(await publicProfile(env, p[1]));
  if (is('GET', 'players', '*', 'loadout')) return json(await loadout(env, p[1]));

  // ---- partite ----
  if (is('GET', 'fixtures')) {
    const r = await listFixtures(env, t);
    // riserva del cron: se mancano partite in programma (cron non ancora attivo o saltato) il giro parte da qui,
    // al massimo una volta al minuto. Il giro è idempotente e non cambia la risposta di questa richiesta.
    if (r.next.length < 2 || r.live.length + r.next.length + r.finished.length === 0) {
      const claim = await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('fallback_tick', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1 WHERE CAST(value AS INTEGER) < ?2")
        .bind(String(t), t - 60000).run();
      if (claim.meta.changes) ctx.waitUntil(tickEngine(env).tick());
    }
    return json(r);
  }
  if (is('GET', 'fixtures', '*')) return json(await fixtureDetail(env, p[1], t));
  if (is('GET', 'fixtures', '*', 'events')) return json(await fixtureEvents(env, p[1], Number(q.get('after')) || 0, t));
  if (is('GET', 'fixtures', '*', 'bets')) return json(await fixtureFeed(env, p[1], await viewer(), q));
  if (is('GET', 'fixtures', '*', 'popular')) return cached(request, 10, () => popular(env, p[1]));
  if (is('GET', 'fixtures', '*', 'stats')) return cached(request, 10, () => fixtureStats(env, p[1]));
  if (is('POST', 'fixtures', '*', 'watch-reward')) {
    const u = await user();
    const f = await fixtureByCode(env, p[1]);
    return json(await claimWatch(env, u, f, phaseOf(f, t), t - f.kickoff_at, t));
  }

  // ---- scommesse ----
  if (is('POST', 'slip', 'quote')) return json(await quoteSlip(env, body, t));
  if (is('POST', 'bets')) { const r = await placeBet(env, await user(), body, t); return json(r, r.duplicate ? 200 : 201); }
  if (is('POST', 'bets', 'status')) return json(await betStatuses(env, body.codes, await viewer()));
  if (is('GET', 'bets', '*')) return json(await getBet(env, p[1], await viewer(), t));
  if (is('POST', 'bets', '*', 'share')) return json(await shareBet(env, await user(), p[1]));
  if (is('POST', 'bets', '*', 'visibility')) return json(await setBetVisibility(env, await user(), p[1], body.visibility));
  if (is('POST', 'bets', '*', 'react')) return json(await react(env, await user(), p[1], body.emoji, t));
  if (is('GET', 'feed')) return json(await globalFeed(env, await viewer(), q));
  if (is('GET', 'stats', 'today')) return cached(request, 15, () => todayStats(env, t));
  if (is('GET', 'leaderboard')) return cached(request, 30, () => leaderboard(env, q.get('metric'), q.get('period'), t));

  // ---- negozio e personaggio ----
  if (is('GET', 'shop')) return json(await catalog(env, await viewer()));
  if (is('POST', 'shop', 'buy')) return json(await buy(env, await user(), body, t));
  if (is('GET', 'inventory')) return json(await inventory(env, await user()));
  if (is('POST', 'inventory', 'equip')) return json(await equip(env, await user(), body));
  if (is('POST', 'inventory', 'unequip')) return json(await unequip(env, await user(), body));

  // ---- solo in locale (TEST_MODE=1): orologio spostabile e giro manuale ----
  if (env.TEST_MODE === '1') {
    if (is('POST', '_test', 'clock')) {
      const off = Number(body.offsetMs);
      if (!Number.isFinite(off)) fail(400, 'BAD_VALUE', 'offsetMs');
      await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('clock_offset', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(String(off)).run();
      return json({ offsetMs: off, serverTime: await now(env) });
    }
    if (is('POST', '_test', 'tick')) return json(await tickEngine(env).tick());
  }
  fail(404, 'NOT_FOUND', 'Indirizzo sconosciuto');
}

export default {
  async fetch(request, env, ctx) {
    // partite online: stesso indirizzo per tutti, il codice sceglie la stanza (vedi relay-do.js)
    if (new URL(request.url).pathname === '/relay') return relayFetch(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json(Object.assign({ error: e.code, message: e.message }, e.extra || {}), e.status);
      console.error(e && e.stack || e);
      return json({ error: 'SERVER', message: 'Errore del server' }, 500);   // nessun dettaglio tecnico al client
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tickEngine(env).tick());
  },
};
