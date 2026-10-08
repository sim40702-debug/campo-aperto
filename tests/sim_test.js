// Test automatico della simulazione: partite IA vs IA, controlli di coerenza
const fs = require('fs');
const path = require('path');
const files = require('../scripts/sorgenti.js').gameFiles(/^0[1-8]_/);
let code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, CONFIG };';
require('vm').runInThisContext(code);
const API = globalThis.__api;

function runMatch(seed, halfSeconds, humanTeam, inputFn) {
  const db = API.buildDatabase(seed);
  API.setSeed(seed * 7 + 1);
  const a = db[seed % 8], b = db[(seed + 3) % 8];
  const m = new API.Match(a, b, { halfSeconds, humanTeam, difficulty: 1 });
  const dt = API.CONFIG.DT;
  const counts = {}; let steps = 0; let stateTimeMax = {};
  const errors = [];
  let lastState = m.state, sameStateFor = 0;
  while (m.state !== 'FULLTIME' && steps < 60 * 60 * 20) {
    const input = inputFn ? inputFn(m, steps) : null;
    m.update(dt, input);
    steps++;
    for (const e of m.events) counts[e.type + (e.data && e.data.type ? ':' + e.data.type : '')] = (counts[e.type + (e.data && e.data.type ? ':' + e.data.type : '')] || 0) + 1;
    m.events.length = 0;
    const bl = m.ball;
    if (!isFinite(bl.x) || !isFinite(bl.y) || !isFinite(bl.z)) { errors.push('NaN palla @' + steps); break; }
    if (Math.abs(bl.x) > 60 || Math.abs(bl.z) > 42 || bl.y > 40) errors.push('palla fuori limiti ' + bl.x.toFixed(1) + ',' + bl.y.toFixed(1) + ',' + bl.z.toFixed(1) + ' stato ' + m.state);
    for (const p of m.allPlayers()) if (!isFinite(p.x) || !isFinite(p.z)) { errors.push('NaN giocatore'); break; }
    if (m.state === lastState && m.state !== 'PLAY') sameStateFor += dt; else sameStateFor = 0;
    lastState = m.state;
    if (sameStateFor > 20) { errors.push('bloccato nello stato ' + m.state); break; }
  }
  const t = m.teams;
  const pos = t[0].stats.possession / (t[0].stats.possession + t[1].stats.possession);
  return { score: t[0].score + '-' + t[1].score, steps, counts, errors: errors.slice(0, 5), nErr: errors.length, possession: Math.round(pos * 100),
    stats: t.map(x => ({ tiri: x.stats.shots, inPorta: x.stats.onTarget, pass: x.stats.passes, passOk: x.stats.passesOk, falli: x.stats.fouls, corner: x.stats.corners, fg: x.stats.offsides })),
    final: m.state, log: m.log.map(g => g.minute + "' " + g.team.data.short + (g.own ? ' (autogol)' : '')) };
}
module.exports = { runMatch };
if (require.main === module) {
  const seeds = [1, 2, 3, 4, 5, 6];
  let totalGoals = 0, bad = 0;
  for (const s of seeds) {
    const t0 = Date.now();
    const r = runMatch(s, 90, -1);
    totalGoals += r.score.split('-').map(Number).reduce((a, b) => a + b);
    if (r.nErr || r.final !== 'FULLTIME') bad++;
    console.log('seed', s, 'risultato', r.score, 'possesso casa', r.possession + '%', 'ms', Date.now() - t0, 'stato', r.final);
    console.log('  eventi', JSON.stringify(r.counts));
    console.log('  stats', JSON.stringify(r.stats));
    console.log('  gol', r.log.join(', '));
    if (r.nErr) console.log('  ERRORI', r.nErr, r.errors);
  }
  console.log('media gol per partita', (totalGoals / seeds.length).toFixed(2), 'partite con problemi', bad);
}
