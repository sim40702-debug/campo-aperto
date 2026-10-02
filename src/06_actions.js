// ============================================================
// AZIONI CON LA PALLA — usate sia dall'IA che dal giocatore
// ============================================================

// simula un passaggio rasoterra: quanto tempo serve per percorrere "dist" partendo a v0
function groundTravelTime(v0, dist) {
  let v = v0, x = 0, t = 0;
  const dt = 0.02;
  while (x < dist) {
    v = Math.max(0, v - (CONFIG.ROLL_DECEL + v * CONFIG.ROLL_DRAG) * dt);
    x += v * dt; t += dt;
    if (v <= 0.05 || t > 8) return Infinity;
  }
  return t;
}
// velocità iniziale per arrivare a "dist" con circa vEnd m/s
function groundSpeedFor(dist, vEnd) {
  let lo = 1, hi = 40;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    // velocità residua dopo dist
    let v = mid, x = 0;
    const dt = 0.02;
    while (x < dist && v > 0.05) { v = Math.max(0, v - (CONFIG.ROLL_DECEL + v * CONFIG.ROLL_DRAG) * dt); x += v * dt; }
    if (x < dist || v < vEnd) lo = mid; else hi = mid;
  }
  return hi;
}

// ruota un vettore orizzontale di un angolo casuale
function withError(vx, vz, amount) {
  const a = (rand() * 2 - 1) * amount;
  const c = Math.cos(a), s = Math.sin(a);
  return [vx * c - vz * s, vx * s + vz * c];
}

function nearestOpponentDist(p) {
  let best = 99;
  for (const o of p.team.opponent().players) {
    const d = dist2(p.x, p.z, o.x, o.z);
    if (d < best) best = d;
  }
  return best;
}

// errore di passaggio: attributi, pressione, orientamento del corpo
function passErrorFor(p, tx, tz) {
  let e = 0.012 + (1 - p.attr.pass / 100) * 0.13;
  if (p.data.ability === 'Regista') e *= 0.7;
  if (nearestOpponentDist(p) < 1.6) e *= 1.5;
  const ang = Math.abs(angleDiff(p.facing, Math.atan2(tz - p.z, tx - p.x)));
  if (ang > Math.PI / 2) e *= 1.5;
  if (p.energy < 40) e *= 1.2;
  return e;
}

function kickBall(p, vx, vy, vz, spin, kind) {
  const m = p.team.match;
  m.ball.kick(vx, vy, vz, p, spin);
  p.anim.kick = 0.3;
  m.onKick(p, kind);
}

// passaggio rasoterra verso un punto
function doGroundPass(p, tx, tz, receiver) {
  const d = Math.max(2, dist2(p.x, p.z, tx, tz));
  const maxV = 17 + p.attr.pass * 0.1;
  let v = clamp(groundSpeedFor(d, d > 20 ? 7 : 5.5), 6, maxV);
  const dirx = (tx - p.x) / d, dirz = (tz - p.z) / d;
  const e = withError(dirx * v, dirz * v, passErrorFor(p, tx, tz));
  p.team.match.pendingPass = { from: p, to: receiver || null };
  kickBall(p, e[0], 0, e[1], 0, 'pass');
}

// passaggio alto (lancio lungo o cross)
function doLobPass(p, tx, tz, receiver, kind) {
  const d = Math.max(3, dist2(p.x, p.z, tx, tz));
  const T = clamp(d / 17, 0.9, 2.3);          // tempo di volo
  const vh = d / T * 1.06;
  const vy = CONFIG.GRAVITY * T / 2;
  const dirx = (tx - p.x) / d, dirz = (tz - p.z) / d;
  const e = withError(dirx * vh, dirz * vh, passErrorFor(p, tx, tz) * 0.9);
  p.team.match.pendingPass = { from: p, to: receiver || null };
  kickBall(p, e[0], vy * randRange(0.95, 1.05), e[1], 0, kind || 'lob');
}

// tiro in porta: aimZ = punto laterale mirato, power 0..1
function doShot(p, aimZ, power, inputPressure) {
  const m = p.team.match;
  const gx = p.team.oppGoalX();
  const d = dist2(p.x, p.z, gx, aimZ);
  const a = p.attr.shot / 100;
  const v = (15 + power * 15) * (0.75 + a * 0.3);
  let targetH = 0.25 + power * 1.5 + randRange(-0.35, 0.55) * (0.6 + power);
  if (power > 0.92) targetH += randRange(0, 1.6); // troppa potenza: rischio di tirare alto
  const t = d / v;
  const vy = (targetH - CONFIG.BALL_R + 0.5 * CONFIG.GRAVITY * t * t) / t;
  let err = 0.015 + (1 - a) * 0.08 + power * power * 0.025;
  if (p.data.ability === 'Bomber' && d < 18) err *= 0.7;
  if (nearestOpponentDist(p) < 1.5) err *= 1.4;
  if (p.energy < 40) err *= 1.2;
  const ang = Math.abs(angleDiff(p.facing, Math.atan2(aimZ - p.z, gx - p.x)));
  if (ang > Math.PI * 0.6) err *= 1.6;
  const dirx = (gx - p.x) / d, dirz = (aimZ - p.z) / d;
  const e = withError(dirx * v, dirz * v, err);
  const spin = randRange(-0.3, 0.3);
  p.stats.shots++;
  p.team.stats.shots++;
  m.pendingPass = null;
  kickBall(p, e[0], Math.max(0, vy), e[1], spin, 'shot');
}

// colpo di testa verso un punto
function doHeader(p, tx, tz, strength) {
  const d = Math.max(1, dist2(p.x, p.z, tx, tz));
  const v = strength * (0.8 + p.attr.physical / 400) * (p.data.ability === 'Colpo di testa' ? 1.12 : 1);
  const e = withError((tx - p.x) / d * v, (tz - p.z) / d * v, 0.05 + (1 - p.attr.shot / 100) * 0.08);
  p.anim.header = 0.35;
  kickBall(p, e[0], randRange(-1.5, 1.2), e[1], 0, 'header');
}

// scelta del punto dove tirare: angolo più lontano dal portiere
function chooseShotAim(p) {
  const gk = p.team.opponent().gk;
  const w = CONFIG.GOAL_HALF_W - 0.45;
  const left = -w, right = w;
  const dl = Math.abs(gk.z - left), dr = Math.abs(gk.z - right);
  return (dl > dr ? left : right) * randRange(0.68, 1.0);
}
