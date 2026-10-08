// Partite del server: stato, dati pubblici (rivelati poco alla volta), quote attuali.
// Prima del calcio d'inizio si vedono squadre e quote; seme e risultato restano nel database.
// Le scommesse chiudono 10 s prima del calcio d'inizio; al calcio d'inizio si rivela il seme (per guardarla
// nel gioco) e durante la partita solo gli eventi già avvenuti; a fine partita il risultato e la liquidazione.
import { fail } from './util.js';
import { currentOdds } from './markets.js';

export const CLOSE_BEFORE_MS = 10000;

export function phaseOf(f, t) {
  if (f.status === 'VOID') return 'VOID';
  if (t < f.kickoff_at - CLOSE_BEFORE_MS) return 'OPEN';
  if (t < f.kickoff_at) return 'CLOSED';
  if (t < f.kickoff_at + f.duration_ms) return 'LIVE';
  return 'FINISHED';
}

const FIX_COLS = 'id, code, home, away, home_name, away_name, kickoff_at, half_seconds, seed, engine, status, duration_ms, facts, markets, settled_at, comp_label, weather, time_of_day';

export async function fixtureByCode(env, code) {
  if (typeof code !== 'string' || !/^PA-[A-Z0-9]{5}$/.test(code)) fail(404, 'NO_FIXTURE', 'Partita non trovata');
  const f = await env.DB.prepare('SELECT ' + FIX_COLS + ' FROM fixtures WHERE code = ?').bind(code).first();
  if (!f) fail(404, 'NO_FIXTURE', 'Partita non trovata');
  return f;
}

// puntate per selezione (tutte le scommesse, anonime) → quote attuali di ogni selezione della partita
export async function stakesOf(env, fixtureId) {
  const { results } = await env.DB.prepare(
    'SELECT i.market, i.selection, SUM(b.stake) AS stake, COUNT(*) AS n FROM bet_items i JOIN bets b ON b.id = i.bet_id ' +
    'WHERE i.fixture_id = ? GROUP BY i.market, i.selection').bind(fixtureId).all();
  const by = {};
  for (const r of results) (by[r.market] || (by[r.market] = {}))[r.selection] = r.stake;
  return { by, rows: results };
}

export function oddsNow(mk, stakes, market, selection) {
  const b = mk.book[market + ':' + selection];
  if (!b) return null;
  return currentOdds(b.o, b.p, selection, stakes[market]);
}

// dati pubblici di una partita all'istante t. opts.markets: aggiunge i mercati con le quote attuali
export function publicFixture(f, t, opts) {
  opts = opts || {};
  const mk = JSON.parse(f.markets);
  const phase = phaseOf(f, t);
  const started = t >= f.kickoff_at && f.status !== 'VOID';
  const out = {
    code: f.code,
    home: Object.assign({ id: f.home }, mk.teams.home),
    away: Object.assign({ id: f.away }, mk.teams.away),
    kickoffAt: f.kickoff_at, closesAt: f.kickoff_at - CLOSE_BEFORE_MS,
    halfSeconds: f.half_seconds, engine: f.engine, phase: phase,
    settled: f.status === 'SETTLED', serverTime: t,
    comp: f.comp_label || null,              // competizione e giornata (campionato del server)
    weather: f.weather || 'clear',           // meteo e ora del giorno: il gioco rigioca la partita con lo stesso pallone
    timeOfDay: f.time_of_day || 'night',
  };
  if (started) {
    out.seed = f.seed;                       // da qui le scommesse sono chiuse: il gioco può rigiocarla uguale
    out.durationMs = f.duration_ms;
    out.elapsedMs = Math.min(t - f.kickoff_at, f.duration_ms);
  }
  if (opts.score) out.score = opts.score;
  if (phase === 'FINISHED') {
    const F = JSON.parse(f.facts);
    out.result = { goals: F.g, firstHalf: F.g1, corners: F.c, cards: F.k, shots: F.s, onTarget: F.o, possession: F.pos, red: F.red, penalty: F.pen };
    out.score = F.g;
  }
  if (opts.stakes) {
    out.markets = mk.markets.map(m => ({
      id: m.id, group: m.group, label: m.label,
      sels: m.sels.map(s => ({ id: s.id, label: s.label, odds: oddsNow(mk, opts.stakes, m.id, s.id) })).filter(s => s.odds),
    }));
  }
  return out;
}

// punteggio dagli eventi già avvenuti (mai quelli futuri)
export async function liveScores(env, fixtures, t) {
  const live = fixtures.filter(f => t >= f.kickoff_at && t < f.kickoff_at + f.duration_ms);
  const out = {};
  for (const f of live) {
    const r = await env.DB.prepare(
      "SELECT SUM(CASE WHEN team = 0 THEN 1 ELSE 0 END) AS h, SUM(CASE WHEN team = 1 THEN 1 ELSE 0 END) AS a " +
      "FROM match_events WHERE fixture_id = ? AND type = 'GOAL' AND t_ms <= ?").bind(f.id, t - f.kickoff_at).first();
    out[f.id] = [r.h || 0, r.a || 0];
  }
  return out;
}

// elenco: partite in corso e prossime, più le ultime finite
export async function listFixtures(env, t) {
  const DUR_MAX = 15 * 60 * 1000;
  const { results: upcoming } = await env.DB.prepare('SELECT ' + FIX_COLS + ' FROM fixtures WHERE kickoff_at >= ? ORDER BY kickoff_at LIMIT 12')
    .bind(t - DUR_MAX).all();
  const { results: recent } = await env.DB.prepare('SELECT ' + FIX_COLS + ' FROM fixtures WHERE kickoff_at < ? ORDER BY kickoff_at DESC LIMIT 6')
    .bind(t - DUR_MAX).all();
  const all = upcoming.concat(recent);
  const scores = await liveScores(env, all, t);
  const counts = {};
  if (all.length) {
    const { results } = await env.DB.prepare('SELECT fixture_id, COUNT(DISTINCT bet_id) AS n FROM bet_items WHERE fixture_id IN (' + all.map(() => '?').join(',') + ') GROUP BY fixture_id')
      .bind(...all.map(f => f.id)).all();
    for (const r of results) counts[r.fixture_id] = r.n;
  }
  const pub = f => Object.assign(publicFixture(f, t, { score: scores[f.id] }), { bets: counts[f.id] || 0 });
  const live = [], next = [], done = [];
  for (const f of all) {
    const p = pub(f);
    (p.phase === 'LIVE' ? live : p.phase === 'OPEN' || p.phase === 'CLOSED' ? next : done).push(p);
  }
  done.sort((a, b) => b.kickoffAt - a.kickoffAt);
  return { serverTime: t, live, next, finished: done.slice(0, 6) };
}

// dettaglio: mercati con quote attuali e gli eventi avvenuti fino a ora
export async function fixtureDetail(env, code, t) {
  const f = await fixtureByCode(env, code);
  const phase = phaseOf(f, t);
  const st = await stakesOf(env, f.id);
  let events = [];
  if (t >= f.kickoff_at) {
    const { results } = await env.DB.prepare('SELECT seq, t_ms, type, minute, half, team, player, detail FROM match_events WHERE fixture_id = ? AND t_ms <= ? ORDER BY seq')
      .bind(f.id, t - f.kickoff_at).all();
    events = results;
  }
  const score = [0, 1].map(s => events.filter(e => e.type === 'GOAL' && e.team === s).length);
  const out = publicFixture(f, t, { stakes: st.by, score: t >= f.kickoff_at ? score : undefined });
  out.events = events;
  out.bettingOpen = phase === 'OPEN';
  return out;
}

// nuovi eventi dopo seq (per l'aggiornamento leggero mentre si guarda)
export async function fixtureEvents(env, code, afterSeq, t) {
  const f = await fixtureByCode(env, code);
  if (t < f.kickoff_at) return { phase: phaseOf(f, t), events: [], serverTime: t };
  const { results } = await env.DB.prepare('SELECT seq, t_ms, type, minute, half, team, player, detail FROM match_events WHERE fixture_id = ? AND seq > ? AND t_ms <= ? ORDER BY seq LIMIT 100')
    .bind(f.id, afterSeq, t - f.kickoff_at).all();
  return { phase: phaseOf(f, t), events: results, serverTime: t };
}
