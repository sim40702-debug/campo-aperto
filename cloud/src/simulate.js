// Calcolo delle partite del server con il motore del gioco (stesso codice di src/01..08, vedi build.js engine).
// Usato solo dal Durable Object: una partita costa circa un secondo di CPU, troppo per una richiesta Worker gratuita.
import { Match, buildDatabase, makeRng, GAME_VERSION, ENGINE_ID } from './engine.gen.js';
import { factsFromMatch } from './markets.js';

export const TEAM_DB_SEED = 2026;   // lo stesso seme del database squadre del gioco (Game: buildDatabase(2026))
let db = null;
export const teamDb = () => db || (db = buildDatabase(TEAM_DB_SEED));
// impronta della simulazione (vedi build.js): il gioco rigioca una partita solo se ha la stessa
export const engineVersion = ENGINE_ID;
export const gameVersion = GAME_VERSION;

export function teamInfo(i) {
  const t = teamDb()[i];
  return { name: t.name, short: t.short, kit: t.kits.home[0], kit2: t.kits.home[1] };
}

// la partita intera con il seme dato: fatti per la liquidazione, eventi con il loro istante, durata reale
export function simulateFixture(home, away, seed, halfSeconds) {
  const d = teamDb();
  const m = new Match(d[home], d[away], { halfSeconds: halfSeconds, humanTeam: -1, rng: makeRng(seed) });
  // tutti gli eventi dell'arbitro (la timeline della partita tiene solo gli ultimi 300)
  const all = [];
  let steps = 0;
  while (m.state !== 'FULLTIME' && steps < 60 * 60 * 30) {
    m.update(1 / 60, null);
    for (const e of m.events) if (e.type === 'ref') all.push(e.data);
    m.events.length = 0; steps++;
  }
  if (m.state !== 'FULLTIME') return null;
  return {
    facts: factsFromMatch(m, all),
    events: all.map(e => ({
      t_ms: Math.round(e.t * 1000), type: e.type, minute: e.minute, half: e.half,
      team: e.team, player: e.player ? e.player.name : '', detail: (e.reason || '').slice(0, 80),
    })),
    durationMs: Math.round(m.realTime * 1000),
    engine: ENGINE_ID,
  };
}
