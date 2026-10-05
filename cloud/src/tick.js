// Lavoro periodico del server (eseguito solo dal Durable Object, uno alla volta):
// crea le prossime partite calcolandole con il motore, liquida quelle finite, paga i premi di stagione.
import { randomCode, randomInt31, moveCoins, constraintKind } from './util.js';
import { buildMarkets, settleSelection, settleBet } from './markets.js';
import { simulateFixture, teamDb, teamInfo, engineVersion } from './simulate.js';
import { award, paySeasonPrizes } from './rewards.js';
import model from './odds-model.json';

const MAX_NEW_PER_TICK = 3;          // ~1 s di CPU ciascuna
const MIN_LEAD_MS = 90 * 1000;       // una partita nuova deve restare aperta alle scommesse almeno 90 s
const BET_BATCH = 40;

export async function ensureFixtures(env, t) {
  const interval = Number(env.FIXTURE_INTERVAL_MIN || 10) * 60000;
  const ahead = Number(env.FIXTURES_AHEAD || 6);
  const first = Math.ceil((t + MIN_LEAD_MS) / interval) * interval;
  const slots = [];
  for (let k = 0; k < ahead; k++) slots.push(first + k * interval);
  const { results } = await env.DB.prepare('SELECT kickoff_at FROM fixtures WHERE kickoff_at >= ?').bind(first).all();
  const have = new Set(results.map(r => r.kickoff_at));
  const nTeams = teamDb().length;
  let created = 0;
  for (const kickoff of slots) {
    if (have.has(kickoff) || created >= MAX_NEW_PER_TICK) continue;
    const home = randomInt31() % nTeams;
    let away = randomInt31() % (nTeams - 1);
    if (away >= home) away++;
    const seed = randomInt31() || 1;
    const half = Number(model.halfSeconds);
    const sim = simulateFixture(home, away, seed, half);
    if (!sim) continue;
    const teams = { home: teamInfo(home), away: teamInfo(away) };
    const mk = buildMarkets(model, home, away, { home: teams.home.name, away: teams.away.name });
    mk.teams = teams;
    const code = 'PA-' + randomCode(5);
    const stmts = [
      env.DB.prepare('INSERT INTO fixtures (code, home, away, home_name, away_name, kickoff_at, half_seconds, seed, engine, status, duration_ms, facts, markets, created_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?, ?)")
        .bind(code, home, away, teams.home.name, teams.away.name, kickoff, half, seed, sim.engine, sim.durationMs, JSON.stringify(sim.facts), JSON.stringify(mk), t),
    ];
    sim.events.forEach((e, i) => stmts.push(env.DB.prepare(
      'INSERT INTO match_events (fixture_id, seq, t_ms, type, minute, half, team, player, detail) SELECT id, ?, ?, ?, ?, ?, ?, ?, ? FROM fixtures WHERE code = ?')
      .bind(i + 1, e.t_ms, e.type, e.minute, e.half, e.team, e.player, e.detail, code)));
    try {
      await env.DB.batch(stmts);
      created++;
    } catch (e) {
      if (constraintKind(e) !== 'UNIQUE') throw e;   // orario già preso (giro doppio): va bene così
    }
  }
  return created;
}

// liquida una partita finita (o annullata a mano con status = 'VOID': tutte le sue selezioni diventano nulle e
// le puntate tornano indietro). Ogni passo è ripetibile: le selezioni e le scommesse già chiuse non si toccano più,
// e l'accredito ha riferimento unico (codice della scommessa), quindi un giro interrotto si riprende senza doppioni.
export async function settleFixture(env, f, t) {
  const F = JSON.parse(f.facts);
  const { results: sels } = await env.DB.prepare("SELECT DISTINCT market, selection FROM bet_items WHERE fixture_id = ? AND status = 'OPEN'").bind(f.id).all();
  if (sels.length) {
    await env.DB.batch(sels.map(s => env.DB.prepare("UPDATE bet_items SET status = ? WHERE fixture_id = ? AND market = ? AND selection = ? AND status = 'OPEN'")
      .bind(f.status === 'VOID' ? 'VOID' : settleSelection(s.market, s.selection, F), f.id, s.market, s.selection)));
  }
  // scommesse ancora aperte che toccano questa partita (le multiple restano aperte finché non finiscono tutte)
  let lastId = 0, settled = 0;
  for (;;) {
    const { results: bets } = await env.DB.prepare(
      "SELECT DISTINCT b.id, b.code, b.user_id, b.stake, b.odds, b.bonus_pct FROM bet_items i JOIN bets b ON b.id = i.bet_id WHERE i.fixture_id = ? AND b.status = 'OPEN' AND b.id > ? ORDER BY b.id LIMIT ?")
      .bind(f.id, lastId, BET_BATCH).all();
    if (!bets.length) break;
    lastId = bets[bets.length - 1].id;
    const { results: items } = await env.DB.prepare('SELECT bet_id, odds, eff_odds, bonus_flag, status FROM bet_items WHERE bet_id IN (' + bets.map(() => '?').join(',') + ')')
      .bind(...bets.map(b => b.id)).all();
    const done = [];
    for (const b of bets) {
      // quota effettiva (selezioni collegate della stessa partita) se c'è, altrimenti quella della selezione
      const r = settleBet(b.stake, items.filter(i => i.bet_id === b.id).map(i => ({ status: i.status, odds: i.eff_odds || i.odds, bonusFlag: i.bonus_flag })), b.bonus_pct);
      if (r) done.push(Object.assign({}, b, r));
    }
    const stmtsFor = b => {
      const s = [env.DB.prepare("UPDATE bets SET status = ?, payout = ?, settled_at = ? WHERE id = ? AND status = 'OPEN'").bind(b.status, b.payout, t, b.id)];
      if (b.payout > 0) s.push(...moveCoins(env.DB, b.user_id, b.payout, b.status === 'VOID' ? 'BET_REFUND' : 'BET_WON', b.code, t));
      if (b.status === 'WON') s.push(env.DB.prepare('UPDATE users SET streak = streak + 1, best_streak = MAX(best_streak, streak + 1) WHERE id = ?').bind(b.user_id));
      if (b.status === 'LOST') s.push(env.DB.prepare('UPDATE users SET streak = 0 WHERE id = ?').bind(b.user_id));
      return s;
    };
    if (!done.length) continue;
    try {
      await env.DB.batch(done.flatMap(stmtsFor));
    } catch (e) {
      // una sola scommessa già pagata non deve bloccare le altre: si riprova una per una
      if (constraintKind(e) !== 'UNIQUE') throw e;
      for (const b of done) {
        try { await env.DB.batch(stmtsFor(b)); } catch (e2) { if (constraintKind(e2) !== 'UNIQUE') throw e2; }
      }
    }
    settled += done.length;
    for (const b of done) {
      if (b.status !== 'WON') continue;
      await award(env, b.user_id, 'FIRST_WIN', t);
      if (b.odds >= 10) await award(env, b.user_id, 'BIG_ODDS', t);
      const u = await env.DB.prepare('SELECT streak FROM users WHERE id = ?').bind(b.user_id).first();
      if (u && u.streak >= 5) await award(env, b.user_id, 'STREAK_5', t);
    }
  }
  await env.DB.prepare("UPDATE fixtures SET status = CASE WHEN status = 'VOID' THEN 'VOID' ELSE 'SETTLED' END, settled_at = ? WHERE id = ? AND settled_at IS NULL").bind(t, f.id).run();
  return settled;
}

export async function settleDue(env, t) {
  const { results } = await env.DB.prepare(
    "SELECT id, code, home, away, home_name, away_name, status, facts FROM fixtures WHERE (status = 'READY' AND kickoff_at + duration_ms <= ?1) OR (status = 'VOID' AND settled_at IS NULL) ORDER BY kickoff_at LIMIT 5")
    .bind(t).all();
  let n = 0;
  for (const f of results) n += await settleFixture(env, f, t);
  return { fixtures: results.length, bets: n };
}

// pulizia leggera: eventi delle partite vecchie senza scommesse e sessioni scadute
export async function cleanup(env, t) {
  const old = t - 14 * 86400000;
  await env.DB.prepare('DELETE FROM match_events WHERE fixture_id IN (SELECT f.id FROM fixtures f WHERE f.kickoff_at < ? AND NOT EXISTS (SELECT 1 FROM bet_items i WHERE i.fixture_id = f.id) LIMIT 50)')
    .bind(old).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t).run();
}

export async function runTick(env, t) {
  const created = await ensureFixtures(env, t);
  const settled = await settleDue(env, t);
  const prizes = await paySeasonPrizes(env, t);
  await cleanup(env, t);
  return { t, created, settled, prizes, engine: engineVersion };
}
