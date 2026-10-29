// Test del portiere (0.24) nel motore vero: tempo di reazione, lettura della traiettoria, passi laterali con
// accelerazione, tuffo fisico (spinta, volo, atterraggio, a terra, recupero senza teletrasporto), parate che dipendono
// da traiettoria, distanza e tempo di reazione (reattivo ma non imbattibile).
// uso: node tests/portiere_test.js
const fs = require('fs');
const { gameFiles } = require('../scripts/sorgenti.js');
let code = gameFiles(/^0[1-8]_/).map(f => fs.readFileSync(f, 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, makeRng, CONFIG, GK, gkReach, doShot };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let ok = 0, ko = 0;
function check(name, cond, extra) {
  if (cond) ok++; else ko++;
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined && !cond ? '  ' + JSON.stringify(extra) : ''));
}
const DT = A.CONFIG.DT, db = A.buildDatabase(2026);
// per regolare il portiere: GK_PROVA='{"DIVE_BASE":4.5}' node tests/portiere_test.js (solo i tassi di parata)
if (process.env.GK_PROVA) Object.assign(A.GK, JSON.parse(process.env.GK_PROVA));

// una situazione di tiro: attaccante della squadra 0 a (dist) metri dalla porta di destra, tira verso (aimZ, aimY)
function shot(seed, dist, aimZ, speed, lift, track) {
  const m = new A.Match(db[0], db[1], { humanTeam: -1, halfSeconds: 600, rng: A.makeRng(seed) });
  m.state = 'PLAY';
  const att = m.teams[0], def = m.teams[1], gk = def.gk, gx = att.oppGoalX();
  // tutti lontani tranne tiratore e portiere
  for (const p of m.allPlayers()) { if (p !== gk) { p.x = -30; p.z = (p.slotIndex % 10) * 3 - 15; p.vx = p.vz = 0; } }
  gk.x = gx - att.dir * 0.8; gk.z = 0; gk.vx = gk.vz = 0; gk.facing = att.dir > 0 ? Math.PI : 0;
  // il tiratore è appena dietro al pallone e non lo può toccare di nuovo (ha appena calciato)
  const s = att.players[9];
  s.x = gx - att.dir * (dist + 2.5); s.z = 0; s.kickCooldown = 5;
  const b = m.ball; b.owner = null; b.x = s.x + att.dir * 0.5; b.z = 0; b.y = 0.2;
  // direzione verso il punto mirato sulla linea di porta
  const dx = gx - b.x, dz = aimZ - b.z, d = Math.hypot(dx, dz);
  b.vx = dx / d * speed; b.vz = dz / d * speed; b.vy = lift; b.lastTouch = s;
  m.lastKick = { player: s, kind: 'shot', time: m.realTime + 0.001 };
  const log = [];
  let result = null;
  for (let i = 0; i < 60 * 3 && !result; i++) {
    m.update(DT, null);
    if (track) log.push({ t: i * DT, z: gk.z, x: gk.x, vz: gk.vz, dive: !!(gk.gkAi && gk.gkAi.dive), down: gk.gkAi ? gk.gkAi.down : 0, own: b.owner === gk, by: b.y });
    if (m.state === 'GOAL') result = 'gol';
    else if (b.owner === gk) result = 'presa';
    else if (b.lastTouch === gk && !result) {
      // toccata: si guarda come va a finire (una deviazione con la punta delle dita può entrare lo stesso)
      for (let j = 0; j < 90 && m.state === 'PLAY' && b.owner !== gk; j++) m.update(DT, null);
      result = m.state === 'GOAL' ? 'gol' : 'respinta';
    }
    else if (m.state !== 'PLAY') result = 'fuori';
  }
  // dopo: lascia che il portiere si rialzi e torni in posizione
  if (track) for (let i = 0; i < 60 * 3; i++) { m.state = 'PLAY'; if (b.owner === gk) b.owner = null; b.x = -40; b.z = 0; b.vx = b.vz = 0; m.update(DT, null); log.push({ t: (i + 180) * DT, z: gk.z, x: gk.x, vz: gk.vz, dive: !!(gk.gkAi && gk.gkAi.dive), down: gk.gkAi ? gk.gkAi.down : 0 }); }
  return { result, log, gk, m };
}

// ---- 1. reazione: per un attimo dopo il tiro il portiere non cambia direzione (non è una macchina)
{
  const r = shot(1, 16, 3.0, 26, 1.5, true);
  const first = r.log.findIndex(e => Math.abs(e.vz) > 0.3);
  check('tempo di reazione: si muove solo dopo 0,2–0,45 s (' + (first * DT).toFixed(2) + ' s)', first * DT >= 0.2 && first * DT <= 0.45, first * DT);
  // tuffo: si vede la spinta, il volo (spostamento laterale vero), l'atterraggio, poi a terra
  const dived = r.log.some(e => e.dive);
  const zs = r.log.map(e => e.z), maxZ = Math.max(...zs.map(Math.abs));
  const maxV = Math.max(...r.log.map(e => Math.abs(e.vz)));
  check('tiro all\'angolo: si tuffa e il corpo si sposta davvero di lato (' + maxZ.toFixed(2) + ' m)', dived && maxZ > 1.6, { dived, maxZ });
  check('velocità del tuffo credibile (' + maxV.toFixed(1) + ' m/s, sotto gli 8)', maxV > 3 && maxV < 8, maxV);
  const downAt = r.log.findIndex(e => e.down > 0);
  check('dopo il tuffo resta un attimo a terra', downAt > 0, downAt);
  // recupero: torna verso il centro senza teletrasporti (mai più di 0,15 m in un passo)
  let jump = 0; for (let i = 1; i < r.log.length; i++) jump = Math.max(jump, Math.hypot(r.log[i].z - r.log[i - 1].z, r.log[i].x - r.log[i - 1].x));
  const end = r.log[r.log.length - 1];
  check('si rialza e torna in posizione senza teletrasportarsi (salto massimo ' + jump.toFixed(3) + ' m)', jump < 0.15 && Math.abs(end.z) < Math.max(1.2, maxZ - 0.5), { jump, endZ: end.z, maxZ });
  // accelerazione graduale: la velocità laterale non cambia di colpo (tranne la spinta del tuffo)
  let acc = 0; for (let i = 1; i < r.log.length; i++) if (!r.log[i].dive && !r.log[i - 1].dive) acc = Math.max(acc, Math.abs(r.log[i].vz - r.log[i - 1].vz) / DT);
  check('passi laterali e recupero con accelerazione graduale (' + acc.toFixed(1) + ' m/s²)', acc <= A.GK.SHUFFLE_ACCEL + 0.5, acc);
}

// ---- 2. tiro centrale e lento: presa senza tuffo
{
  const r = shot(2, 18, 0.2, 15, 1.2, true);
  check('tiro centrale lento: lo prende senza tuffarsi', r.result === 'presa' && !r.log.some(e => e.dive), r.result);
}

// ---- 3. parate per tipo di tiro: dipendono da traiettoria e distanza (molti tiri con semi diversi)
function rate(dist, aimZ, speed, lift, n) {
  let saved = 0, goals = 0;
  for (let s = 0; s < n; s++) {
    // tiri un po' diversi tra loro: mira e potenza cambiano come per un giocatore vero
    const az = aimZ + ((s % 5) - 2) * 0.18, sp = speed * (0.9 + ((s * 7) % 5) * 0.05);
    const r = shot(100 + s, dist, az, sp, lift, false);
    if (r.result === 'presa' || r.result === 'respinta') saved++;
    if (r.result === 'gol') goals++;
  }
  return { saved: saved / n, goals: goals / n };
}
if (process.env.GK_PROVA) {
  const show = (n, r) => n + ' parate ' + r.saved.toFixed(2) + ' gol ' + r.goals.toFixed(2);
  console.log(process.env.GK_PROVA, '|', show('lontano 25', rate(25, 3.1, 25, 1.4, 40)), '|', show('vicino 8', rate(8, 3.1, 25, 0.6, 40)), '|',
    show('centrale', rate(20, 0.4, 22, 1.2, 40)), '|', show('basso 18', rate(18, 3.2, 24, 0.2, 40)), '|', show('alto 18', rate(18, 3.0, 26, 4.0, 40)));
  process.exit(0);
}
const farCorner = rate(25, 3.1, 25, 1.4, 40);
const nearCorner = rate(8, 3.1, 25, 0.6, 40);
const central = rate(20, 0.4, 22, 1.2, 40);
const lowCorner = rate(18, 3.2, 24, 0.2, 40);
check('da lontano all\'angolo para più spesso che da vicino (tempo di reazione): ' + farCorner.saved.toFixed(2) + ' contro ' + nearCorner.saved.toFixed(2), farCorner.saved > nearCorner.saved + 0.15, [farCorner, nearCorner]);
check('tiro centrale: quasi sempre parato (' + central.saved.toFixed(2) + ')', central.saved >= 0.85, central);
check('reattivo ma non imbattibile: i tiri angolati e forti a volte entrano (gol ' + lowCorner.goals.toFixed(2) + ', ' + nearCorner.goals.toFixed(2) + ')', lowCorner.goals > 0.1 && nearCorner.goals > 0.3, [lowCorner, nearCorner]);
check('e para anche quelli angolati, a volte (' + lowCorner.saved.toFixed(2) + ')', lowCorner.saved > 0.15, lowCorner);

// ---- 4. pallone alto sopra la testa: in piedi non ci arriva oltre 2,6 m
{
  const m = new A.Match(db[0], db[1], { humanTeam: -1, rng: A.makeRng(5) });
  const gk = m.teams[1].gk;
  gk.gkAi = null; gk.x = 50; gk.z = 0;
  const reachAt = (y, z) => A.gkReach(gk, { x: 50, y: y, z: z, vx: 20, vz: 0 });
  check('portata in piedi: petto sì, sopra 2,62 m no, a più di 1 m di lato no', reachAt(1.2, 0.2) > 0.8 && reachAt(2.7, 0) === 0 && reachAt(1.2, 1.1) === 0, [reachAt(1.2, 0.2), reachAt(2.7, 0), reachAt(1.2, 1.1)]);
  check('presa al limite (punta delle dita) più difficile che al centro', reachAt(1.2, 0.85) < reachAt(1.2, 0.2), [reachAt(1.2, 0.85), reachAt(1.2, 0.2)]);
}

// ---- 5. stessa partita con lo stesso seme (il server rigioca le partite uguali)
{
  const a = shot(7, 16, 2.5, 24, 1.2, true), b = shot(7, 16, 2.5, 24, 1.2, true);
  check('stesso seme: stesso tuffo e stesso risultato', a.result === b.result && a.log.length === b.log.length && a.log.every((e, i) => e.z === b.log[i].z));
}

console.log('\nRisultato: ' + ok + ' superati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
