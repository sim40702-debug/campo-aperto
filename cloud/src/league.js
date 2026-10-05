// Campionato del server ("Serie del server"): le partite del server seguono un calendario all'italiana con andata e
// ritorno tra le squadre del database. Una partita per orario: quando tutte le partite di una stagione sono state
// create, la stagione dopo comincia subito (la classifica di quella vecchia si completa man mano che finiscono).
// La classifica e i marcatori si calcolano solo dalle partite già finite: niente risultati futuri rivelati.
import { roundRobin, standings, compRng, seedFor } from './complogic.js';
import { randomInt31 } from './util.js';
import { teamDb, teamInfo } from './simulate.js';

export const LEAGUE_NAME = 'Serie del server';

function order(teamsJson) { return JSON.parse(teamsJson); }
export function scheduleOf(league) { return roundRobin(order(league.teams), 2); }

async function createSeason(env, season, t) {
  const n = teamDb().length;
  const rng = compRng(seedFor(randomInt31() || 1, 'serie' + season));
  const teams = Array.from({ length: n }, (_, i) => i);
  for (let i = teams.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [teams[i], teams[j]] = [teams[j], teams[i]]; }
  const rounds = roundRobin(teams, 2);
  await env.DB.prepare("INSERT INTO competitions (kind, name, season, teams, rounds, per_round, status, created_at) VALUES ('league', ?, ?, ?, ?, ?, 'ACTIVE', ?)")
    .bind(LEAGUE_NAME, season, JSON.stringify(teams), rounds.length, rounds[0].length, t).run();
  return env.DB.prepare("SELECT * FROM competitions WHERE kind = 'league' AND season = ?").bind(season).first();
}

// prossima partita da creare: { league, round, slot, home, away, label }
export async function nextLeagueMatch(env, t) {
  for (let guard = 0; guard < 3; guard++) {
    let lg = await env.DB.prepare("SELECT * FROM competitions WHERE kind = 'league' AND status = 'ACTIVE' ORDER BY id DESC LIMIT 1").first();
    if (!lg) {
      const last = await env.DB.prepare("SELECT MAX(season) AS s FROM competitions WHERE kind = 'league'").first();
      lg = await createSeason(env, (last && last.s ? last.s : 0) + 1, t);
    }
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM fixtures WHERE comp_id = ?').bind(lg.id).first();
    const k = c.n, total = lg.rounds * lg.per_round;
    if (k < total) {
      const round = Math.floor(k / lg.per_round), slot = k % lg.per_round;
      const g = scheduleOf(lg)[round][slot];
      return { league: lg, round: round, slot: slot, home: g.home, away: g.away, label: lg.name + ' · stagione ' + lg.season + ' · giornata ' + (round + 1) };
    }
    await env.DB.prepare("UPDATE competitions SET status = 'SCHEDULED' WHERE id = ? AND status = 'ACTIVE'").bind(lg.id).run();
  }
  return null;
}

// stato pubblico del campionato all'istante t: stagione in corso (quella con partite non ancora finite), classifica
// dalle partite finite, giornata in corso con le sue partite, marcatori, campione della stagione precedente
export async function leagueView(env, t) {
  let lg = await env.DB.prepare("SELECT c.* FROM competitions c WHERE c.kind = 'league' AND EXISTS (SELECT 1 FROM fixtures f WHERE f.comp_id = c.id AND f.kickoff_at + f.duration_ms > ?) ORDER BY c.id LIMIT 1").bind(t).first();
  if (!lg) lg = await env.DB.prepare("SELECT * FROM competitions WHERE kind = 'league' ORDER BY id DESC LIMIT 1").first();
  if (!lg) return { name: LEAGUE_NAME, season: null, standings: [], round: null, fixtures: [] };
  const { results } = await env.DB.prepare('SELECT id, code, home, away, kickoff_at, duration_ms, status, facts, comp_round, comp_slot FROM fixtures WHERE comp_id = ? ORDER BY comp_round, comp_slot')
    .bind(lg.id).all();
  const finished = results.filter(f => f.status !== 'VOID' && t >= f.kickoff_at + f.duration_ms);
  const teams = order(lg.teams);
  const res = finished.map(f => { const g = JSON.parse(f.facts).g; return { home: f.home, away: f.away, h: g[0], a: g[1] }; });
  const table = standings(teams, res).map(r => Object.assign({ name: teamInfo(r.team).name, short: teamInfo(r.team).short, kit: teamInfo(r.team).kit }, r));
  // giornata in corso: la prima con partite non ancora finite (o l'ultima creata)
  const open = results.find(f => t < f.kickoff_at + f.duration_ms);
  const round = open ? open.comp_round : (results.length ? results[results.length - 1].comp_round : 0);
  const fixtures = results.filter(f => f.comp_round === round).map(f => {
    const done = t >= f.kickoff_at + f.duration_ms;
    return { code: f.code, home: teamInfo(f.home).name, away: teamInfo(f.away).name, kickoffAt: f.kickoff_at,
      phase: f.status === 'VOID' ? 'VOID' : done ? 'FINISHED' : t >= f.kickoff_at ? 'LIVE' : 'OPEN', score: done && f.status !== 'VOID' ? JSON.parse(f.facts).g : null };
  });
  // marcatori: gol delle partite finite
  let scorers = [];
  if (finished.length) {
    const { results: goals } = await env.DB.prepare(
      "SELECT e.player, e.team, f.home, f.away, COUNT(*) AS n FROM match_events e JOIN fixtures f ON f.id = e.fixture_id WHERE f.comp_id = ? AND e.type = 'GOAL' AND f.kickoff_at + f.duration_ms <= ? AND e.player <> '' GROUP BY e.player, e.team, f.home, f.away"
    ).bind(lg.id, t).all();
    const by = new Map();
    for (const g of goals) {
      const team = g.team === 0 ? g.home : g.away, k = team + '|' + g.player;
      by.set(k, (by.get(k) || 0) + g.n);
    }
    scorers = [...by.entries()].map(([k, n]) => { const [team, name] = k.split('|'); return { name: name, team: teamInfo(Number(team)).name, goals: n }; })
      .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 10);
  }
  const prev = await env.DB.prepare("SELECT id, season, teams FROM competitions WHERE kind = 'league' AND season = ?").bind(lg.season - 1).first();
  let prevChampion = null;
  if (prev) {
    const { results: pf } = await env.DB.prepare('SELECT home, away, facts, status, kickoff_at, duration_ms FROM fixtures WHERE comp_id = ?').bind(prev.id).all();
    if (pf.length && pf.every(f => t >= f.kickoff_at + f.duration_ms)) {
      const tb = standings(order(prev.teams), pf.filter(f => f.status !== 'VOID').map(f => { const g = JSON.parse(f.facts).g; return { home: f.home, away: f.away, h: g[0], a: g[1] }; }));
      prevChampion = { season: prev.season, name: teamInfo(tb[0].team).name };
    }
  }
  return {
    name: lg.name, season: lg.season, rounds: lg.rounds, round: round + 1, played: finished.length, total: lg.rounds * lg.per_round,
    standings: table, fixtures: fixtures, scorers: scorers, previousChampion: prevChampion, serverTime: t,
  };
}
