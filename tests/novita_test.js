// Test delle novità della 0.14: meteo (pallone e partite ripetibili), statistiche per tempo e dei giocatori,
// allenamento (TrainingMatch con il motore vero e un "giocatore" finto che tira).
// uso: node tests/novita_test.js
const fs = require('fs');
const { gameFiles, gameFile } = require('../scripts/sorgenti.js');
let code = gameFiles(/^0[1-8]_/).map(f => fs.readFileSync(f, 'utf8')).join('\n');
// l'allenamento è nel gioco (src/game/28_training.js): servono solo Game e localStorage finti
code += '\nclass Game {}\nvar __store = {}; var localStorage = { getItem: k => __store[k] || null, setItem: (k, v) => { __store[k] = String(v); } };\n';
code += 'function tr(s) { return s; } function trf(s) { return s; } function esc(s) { return s; }\n';
code += fs.readFileSync(gameFile('28_training.js'), 'utf8');
code += '\n;globalThis.__api = { Match, TrainingMatch, Ball, stepBallPhysics, buildDatabase, makeRng, CONFIG, WEATHER_BALL, DRILLS, loadTrainingRecords, groundTravelTime, getEnv: () => BALL_ENV };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let ok = 0, ko = 0;
function check(name, cond, extra) {
  if (cond) ok++; else ko++;
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
}
const DT = A.CONFIG.DT;
const db = A.buildDatabase(2026);

// ---- 1. meteo: quanto rotola un passaggio da 15 m/s
function roll(weather) {
  const m = new A.Match(db[0], db[1], { humanTeam: -1, weather: weather, rng: A.makeRng(1) });
  let dist = 0;
  m.withRng(() => {
    const b = new A.Ball(); b.vx = 15;
    for (let i = 0; i < 600; i++) A.stepBallPhysics(b, DT);
    dist = b.x;
  });
  return dist;
}
const dc = roll('clear'), dr = roll('rain'), ds = roll('snow');
check('pioggia: la palla scivola più lontano (' + dr.toFixed(1) + ' m contro ' + dc.toFixed(1) + ')', dr > dc + 3, [dr, dc]);
check('neve: la palla si ferma prima (' + ds.toFixed(1) + ' m)', ds < dc - 3, [ds, dc]);
check('dopo la partita il pallone torna normale (le altre partite non cambiano)', A.getEnv() === A.WEATHER_BALL.clear);
// rimbalzo
function bounce(weather) {
  const m = new A.Match(db[0], db[1], { humanTeam: -1, weather: weather, rng: A.makeRng(1) });
  let top = 0;
  m.withRng(() => {
    const b = new A.Ball(); b.y = 8; let fell = false;
    for (let i = 0; i < 400; i++) { A.stepBallPhysics(b, DT); if (b.vy < 0) fell = true; if (fell && b.vy > 0) top = Math.max(top, b.y); }
  });
  return top;
}
check('neve e pioggia: rimbalzi più bassi', bounce('snow') < bounce('rain') && bounce('rain') < bounce('clear'), [bounce('clear'), bounce('rain'), bounce('snow')]);
check('meteo sconosciuto: sereno; ora sconosciuta: sera', (() => { const m = new A.Match(db[0], db[1], { humanTeam: -1, weather: 'xx', timeOfDay: 'yy' }); return m.weather === 'clear' && m.timeOfDay === 'night'; })());
// stessa partita con lo stesso seme e lo stesso meteo (server e gioco), diversa con un altro meteo
function play(seed, weather) {
  const m = new A.Match(db[seed % 8], db[(seed + 3) % 8], { halfSeconds: 120, humanTeam: -1, rng: A.makeRng(seed), weather: weather });
  let steps = 0;
  while (m.state !== 'FULLTIME' && steps < 60 * 60 * 10) { m.update(DT, null); m.events.length = 0; steps++; }
  return { m, sig: [m.teams[0].score, m.teams[1].score, m.teams[0].stats.shots, m.teams[1].stats.shots, m.teams[0].stats.passes, m.timeline.length, steps].join(',') };
}
const r1 = play(21, 'rain'), r2 = play(21, 'rain'), s1 = play(21, 'snow');
check('pioggia: stesso seme, stessa partita', r1.sig === r2.sig, [r1.sig, r2.sig]);
check('neve: un\'altra partita con lo stesso seme', s1.sig !== r1.sig);

// ---- 2. statistiche: possesso per tempo e numeri dei giocatori
const st = r1.m.teams.map(t => t.stats);
const sum = k => st[0][k] + st[1][k];
check('possesso del 1º e del 2º tempo = possesso totale', Math.abs(sum('possH1') + sum('possH2') - sum('possession')) < 0.01 && sum('possH1') > 10 && sum('possH2') > 10, st.map(s => [s.possession, s.possH1, s.possH2]));
const players = r1.m.allSlots();
// parate: in più partite, mai più dei tiri in porta
let saves = 0, onT = 0;
for (const sd of [21, 3, 11]) { const g = sd === 21 ? r1 : play(sd, 'clear'); for (const t of g.m.teams) { saves += t.roster[0].stats.saves || 0; onT += t.opponent().stats.onTarget; } }
check('parate dei portieri contate (' + saves + ' su ' + onT + ' tiri in porta)', saves > 0 && saves <= onT, [saves, onT]);
check('gol dei giocatori = gol della squadra (senza autogol)', players.reduce((s, p) => s + p.stats.goals, 0) <= r1.m.teams[0].score + r1.m.teams[1].score);
check('replayCount: fotogrammi registrati in tutto', r1.m.replayCount > 1000 && r1.m.replay.length <= r1.m.replayMax);

// ---- 3. allenamento: il giocatore finto tira verso la porta
function train(drill, maxSec) {
  const m = new A.TrainingMatch(db[0], db[5], { drill: drill, rng: A.makeRng(7) });
  const h = m.humans[0];
  let hold = 0, steps = 0;
  const gx = m.teams[0].oppGoalX();
  while (m.tr.phase !== 'over' && steps < maxSec * 60) {
    const p = h.player, b = m.ball;
    let input = { mx: 0, mz: 0, shoot: false, pressed: {} };
    const ready = m.state === 'SETPIECE' ? m.setPieceReady : m.state === 'PLAY' && b.owner === p;
    if (p && ready && m.tr.phase === 'live') {
      const dx = gx - p.x, dz = (drill === 'penalty' ? 2.6 : 2.2) - p.z, l = Math.hypot(dx, dz);
      input = { mx: dx / l, mz: dz / l, shoot: hold < 0.42, pressed: {} };
      hold += DT;
    } else hold = 0;
    if (drill === 'pass' && p && b.owner === p && m.tr.phase === 'live') input = { mx: 0, mz: 0, pressed: { pass: steps % 40 === 0 } };
    m.update(DT, input);
    m.events.length = 0;
    steps++;
  }
  return m;
}
for (const d of A.DRILLS) {
  const m = train(d.id, 600);
  const t = m.tr;
  check(d.name + ': l\'esercizio arriva alla fine (' + t.score + (d.seconds ? ' passaggi' : ' su ' + t.done) + ')', t.phase === 'over' && (d.seconds ? true : t.done === d.tries), [t.phase, t.done, t.score]);
  check(d.name + ': solo i giocatori dell\'esercizio in campo', m.allSlots().filter(p => !p.gone).length === m.allPlayers().length && m.allPlayers().length <= 7);
  if (d.id === 'shots' || d.id === 'penalty') check(d.name + ': tirando bene si segna (' + t.score + ')', t.score >= 1, t.score);
  if (d.id === 'pass') check('Passaggi: i passaggi riusciti si contano (' + t.score + ')', t.score >= 1, t.score);
}
const rec = A.loadTrainingRecords();
check('record salvati per ogni esercizio', A.DRILLS.every(d => Number.isFinite(rec[d.id])), rec);
check('allenamento: niente orologio (resta al minuto 0)', train('penalty', 30).minute() === 0);

console.log('\nRisultato: ' + ok + ' superati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
