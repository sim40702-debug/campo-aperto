// Rete della porta nel motore (0.24): rete elastica che cede e frena il pallone, nessun pallone che la attraversa
// (né da dentro né da fuori), gol ancora riconosciuti come prima.
// Uso: node tests/rete_test.js
const fs = require('fs');
const files = require('../scripts/sorgenti.js').gameFiles(/^0[1-8]_/);
let code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, CONFIG, Ball, stepBallPhysics, collideGoalFrame, goalRoofY, GOAL_NET };';
require('vm').runInThisContext(code);
const A = globalThis.__api, C = A.CONFIG;
let ok = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// fa volare un pallone per qualche secondo con la stessa fisica della partita (4 sotto-passi per fotogramma)
function fly(x, y, z, vx, vy, vz, secs) {
  const b = new A.Ball(); b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz;
  const tr = { maxDepth: -99, maxAbsZ: 0, maxY: 0, minStepV: 0, frames: [] };
  const sub = 4, dt = 1 / 60;
  for (let f = 0; f < secs * 60; f++) {
    for (let i = 0; i < sub; i++) { A.stepBallPhysics(b, dt / sub); A.collideGoalFrame(b, dt / sub); }
    const depth = b.x - C.HALF_L;
    tr.maxDepth = Math.max(tr.maxDepth, depth);
    if (depth > 0) { tr.maxAbsZ = Math.max(tr.maxAbsZ, Math.abs(b.z)); tr.maxY = Math.max(tr.maxY, b.y); }
    tr.frames.push({ x: b.x, y: b.y, z: b.z, vx: b.vx });
  }
  tr.b = b;
  return tr;
}
const D = C.GOAL_DEPTH, W = C.GOAL_HALF_W, R = C.BALL_R;

// tiro fortissimo centrale: la rete cede ma il pallone resta dentro e si ferma
let t = fly(C.HALF_L - 11, 1.0, 0, 34, 1.5, 0, 4);
check('tiro forte: il fondo della rete cede (oltre la profondità della porta)', t.maxDepth > D - R + 0.1, t.maxDepth);
check('tiro forte: ma non più di mezzo metro e il pallone non esce mai dal fondo', t.maxDepth <= D - R + A.GOAL_NET.MAX + 0.03, t.maxDepth);
check('tiro forte: il pallone resta dentro la porta e si ferma', t.b.inNet && t.b.x > C.HALF_L && Math.hypot(t.b.vx, t.b.vz) < 1, [t.b.x, t.b.vx]);
// non rimbalza indietro come una fionda: velocità di ritorno bassa
const back = Math.min(...t.frames.map(f => f.vx));
check('tiro forte: la rete non fa da fionda (ritorno lento)', back > -3, back);
// il pallone non si ferma di colpo: a metà frenata (fotogramma con velocità intermedia) la rete sta ancora cedendo
const hitF = t.frames.findIndex(f => f.x - C.HALF_L > D - R);
const mid = t.frames.slice(hitF).some(f => f.vx > 3 && f.vx < 25);
check('tiro forte: la rete frena il pallone gradualmente (non si ferma di colpo)', hitF >= 0 && mid, hitF);

// tiro debole: cede poco
t = fly(C.HALF_L - 3, 0.3, 0, 8, 1, 0, 3);
check('tiro debole: entra, la rete cede poco', t.b.inNet && t.maxDepth < D - R + 0.25, t.maxDepth);

// tiro angolato nell'angolo alto: lati e tetto lo trattengono
t = fly(C.HALF_L - 10, 1.2, 0, 26, 3.6, 7.5, 4);
check('tiro all\'incrocio: dentro la porta il pallone non passa i lati né il tetto', t.b.inNet && t.maxAbsZ <= W - R + A.GOAL_NET.SIDE_MAX + 0.03 && t.maxY <= C.GOAL_H, [t.maxAbsZ, t.maxY, t.b.inNet]);

// esterno della rete: tiro da fuori sul lato della porta, non deve entrare
t = fly(C.HALF_L - 6, 0.5, 9, 22, 1, -2.0, 3);
const into = t.frames.some(f => f.x > C.HALF_L + 0.15 && f.x < C.HALF_L + D && Math.abs(f.z) < W - 0.05 && f.y < A.goalRoofY(f.x - C.HALF_L));
check('esterno della rete: il pallone che arriva di lato non entra mai nella porta', !into && !t.b.inNet);
// pallone lanciato contro il lato della rete da fuori: rimbalza piano
t = fly(C.HALF_L + 1.2, 0.5, 6, 0, 0.5, -15, 2);
check('lato della rete preso da fuori: si ferma fuori, rimbalzo debole', Math.abs(t.b.z) >= W && Math.abs(t.b.vz) < 3, [t.b.z, t.b.vz]);
// pallone che cade sul tetto
t = fly(C.HALF_L + 1.0, 5, 0, 0.3, 0, 0, 2);
const roofMin = Math.min(...t.frames.filter(f => f.x < C.HALF_L + D).map(f => f.y - A.goalRoofY(f.x - C.HALF_L) - R));
check('tetto: il pallone che cade dall\'alto resta sopra la rete (poi rotola giù)', roofMin >= -0.02 && !t.b.inNet, roofMin);
// da dietro la porta
t = fly(C.HALF_L + D + 3, 0.5, 0, -15, 1, 0, 2);
check('fondo preso da dietro: non entra', !t.b.inNet && t.b.x >= C.HALF_L + D, t.b.x);

// partita: il gol si conta come prima
A.setSeed(3);
const db = A.buildDatabase(2026);
for (const [y, z] of [[0.3, 0], [2.1, 3.2], [1.2, -3.3]]) {
  const m = new A.Match(db[0], db[1], { halfSeconds: 180 });
  m.setState('PLAY');
  const tm = m.teams.find(q => q.dir > 0), b = m.ball, k = tm.opponent().gk;
  k.x = -50; k.z = 30;   // portiere lontano: si prova solo la rete
  b.owner = null; b.x = C.HALF_L - 1.2; b.y = y; b.z = z; b.vx = 25; b.vy = 0; b.vz = 0; b.lastTouch = tm.players[9];
  let goal = false;
  for (let i = 0; i < 60 && !goal; i++) { m.update(1 / 60); if (m.state === 'GOAL' || tm.score > 0) goal = true; }
  check('gol riconosciuto (altezza ' + y + ', z ' + z + ')', goal && tm.score === 1, [m.state, tm.score]);
}

console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
