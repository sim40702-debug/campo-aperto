// Reattività dei comandi sul motore vero (calciatore guidato da una persona): tempi di risposta del movimento,
// buffer dei comandi (passaggio e tiro premuti un istante prima di ricevere), nessun comando "automatico".
// Uso: node tests/feel_test.js
const fs = require('fs'), path = require('path');
const files = fs.readdirSync(path.join(__dirname, '../src')).filter(f => /^0[1-8]_/.test(f)).sort();
let code = files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, CONFIG };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let ok = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
A.setSeed(5);
const db = A.buildDatabase(2026);
const dt = 1 / 60;

// ---------- movimento ----------
function mover() {
  const m = new A.Match(db[0], db[1], { humanTeam: 0, halfSeconds: 180 }); m.setState('PLAY');
  const p = m.teams[0].players[7]; p.energy = 100; m.ball.owner = null; m.ball.x = 40;
  return p;
}
const p = mover(), top = p.maxSpeed(true), jog = p.maxSpeed(false);
const reset = () => { p.vx = p.vz = 0; p.x = 0; p.z = 0; p.facing = 0; };
const step = (dx, dz, spr) => { p.moveDir(dx, dz, spr, dt); p.update(dt); };
const timeUntil = (cond, dx, dz, spr) => { let t = 0; while (!cond() && t < 5) { step(dx, dz, spr); t += dt; } return t; };
reset(); step(1, 0, false);
check('primo fotogramma: il calciatore si muove già (risposta immediata)', p.vx > 0.25 && p.x > 0, p.vx.toFixed(2));
reset(); const t1 = timeUntil(() => p.speed() > 1, 1, 0, false);
check('da fermo a 1 m/s in meno di 0,1 s (' + Math.round(t1 * 1000) + ' ms)', t1 <= 0.1);
reset(); const tS = timeUntil(() => p.speed() > top * 0.9, 1, 0, true);
check('scatto: il 90% della velocità massima in circa un secondo, con peso (' + tS.toFixed(2) + ' s)', tS > 0.8 && tS < 1.3);
reset(); for (let i = 0; i < 120; i++) step(1, 0, false);
const tR = timeUntil(() => p.vx < -1, -1, 0, false);
check('inversione di direzione dalla corsa in meno di 0,45 s (' + tR.toFixed(2) + ')', tR < 0.45);
reset(); for (let i = 0; i < 120; i++) step(1, 0, false);
const tT = timeUntil(() => Math.abs(Math.atan2(p.vz, p.vx) - Math.PI / 2) < 0.35, 0, 1, false);
check('curva di 90°: nuova direzione in meno di 0,35 s (' + tT.toFixed(2) + ')', tT < 0.35);
reset(); for (let i = 0; i < 120; i++) step(1, 0, false);
const tF = timeUntil(() => Math.abs(p.facing - Math.PI / 2) < 0.35, 0, 1, false);
check('il corpo si gira subito verso la nuova direzione (' + tF.toFixed(2) + ' s)', tF < 0.35);
reset(); for (let i = 0; i < 120; i++) step(1, 0, false);
const tStop = timeUntil(() => p.speed() < 0.3, 0, 0, false);
check('frenata dalla corsa: rapida ma non istantanea (' + tStop.toFixed(2) + ' s)', tStop > 0.15 && tStop < 0.4);
reset(); for (let i = 0; i < 180; i++) step(1, 0, true);
const tStopS = timeUntil(() => p.speed() < 0.3, 0, 0, true);
check('dallo scatto ci vuole di più (inerzia: ' + tStopS.toFixed(2) + ' s)', tStopS > tStop && tStopS < 0.7);
reset(); for (let i = 0; i < 180; i++) step(1, 0, true);
let tSp = 0; while (Math.abs(Math.atan2(p.vz, p.vx) - Math.PI / 2) > 0.35 && tSp < 5) { step(0, 1, true); tSp += dt; }
check('in scatto le curve sono più larghe che in corsa', tSp > tT, tSp.toFixed(2) + ' / ' + tT.toFixed(2));

// ---------- buffer dei comandi ----------
// palla che arriva al calciatore guidato da una persona: il comando premuto un istante prima parte appena la controlla
function receive(pressAtDist, kind) {
  A.setSeed(9);
  const m = new A.Match(db[0], db[1], { humanTeam: 0, halfSeconds: 180 });
  m.setState('PLAY');
  for (const q of m.allPlayers()) { q.x = -45; q.z = (q.slotIndex - 5) * 4; q.vx = q.vz = 0; q.stunned = 0; }
  const me = m.teams[0].players[8], mate = m.teams[0].players[6];
  me.x = 10; me.z = 0; mate.x = 0; mate.z = 0;
  m.humans[0].player = me;
  const b = m.ball; b.owner = null; b.x = 10 - 7; b.z = 0; b.y = A.CONFIG.BALL_R; b.vx = 6.5; b.vz = 0; b.vy = 0; b.lastTouch = mate;
  m.pendingPass = { from: mate, to: me };
  let pressed = false, t = 0, owned = null, kickedAt = null;
  const kicksBefore = me.stats.passes;
  while (t < 2.5) {
    const d = Math.hypot(b.x - me.x, b.z - me.z);
    const input = { mx: 0, mz: 0, sprint: false, shoot: false, pressed: {} };
    if (!pressed && d <= pressAtDist) {
      pressed = true;
      if (kind === 'shot') { input.shoot = true; input.pressed.shootDown = true; } else input.pressed[kind] = true;
    } else if (kind === 'shot' && pressed && t < 0.05) input.shoot = true;
    m.update(dt, input);
    t += dt;
    if (owned === null && b.owner === me) owned = t;
    if (kickedAt === null && m.lastKick && m.lastKick.player === me) { kickedAt = t; break; }
  }
  return { owned, kickedAt, passes: me.stats.passes - kicksBefore, shots: me.stats.shots };
}
const early = receive(1.6, 'pass');
check('passaggio premuto un istante prima di ricevere: parte appena si controlla la palla', early.kickedAt !== null && early.passes === 1, early);
const tooEarly = receive(6.5, 'pass');
check('premuto troppo prima (oltre 0,2 s): nessun passaggio automatico, la palla resta al giocatore', tooEarly.kickedAt === null && tooEarly.owned !== null, tooEarly);
const shot = receive(1.6, 'shot');
check('tiro rilasciato un istante prima di ricevere: tiro al volo appena arriva', shot.kickedAt !== null && shot.shots === 1, shot);

console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
