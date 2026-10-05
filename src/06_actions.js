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

function kickBall(p, vx, vy, vz, spin, kind, topspin) {
  const m = p.team.match;
  m.ball.kick(vx, vy, vz, p, spin, topspin);
  p.anim.kick = 0.3;
  m.onKick(p, kind);
}

// ---------- VOLO DEL PALLONE ----------
// simula il volo con la fisica della partita: dove e quando il pallone torna all'altezza "y"
// (o attraversa la distanza "untilDist", se data) partendo dall'origine verso +x
function simulateFlight(vh, vy, spin, topspin, y, untilDist) {
  const b = { x: 0, y: CONFIG.BALL_R, z: 0, vx: vh, vy: vy, vz: 0, spin: spin || 0, topspin: topspin || 0 };
  const dt = 1 / 120;
  for (let t = 0; t < 6; t += dt) {
    stepBallPhysics(b, dt);
    if (untilDist !== undefined ? b.x >= untilDist : (t > 0.05 && b.vy < 0 && b.y <= y)) return { range: len(b.x, b.z), t: t + dt, side: b.z, y: b.y, x: b.x };
  }
  return null;
}
// velocità per far arrivare il pallone in (tx, tz), all'altezza di ricezione, in circa T secondi: si parte dalla
// parabola senza aria e la si corregge con il volo simulato; con l'effetto si mira di lato per compensare la curva
function solveFlight(p, tx, tz, T, spin, topspin) {
  const d = Math.max(1, dist2(p.x, p.z, tx, tz));
  let vh = d / T, vy = CONFIG.GRAVITY * T / 2, turn = 0;
  for (let i = 0; i < 5; i++) {
    const r = simulateFlight(vh, vy, spin, topspin, 0.5);
    if (!r) break;
    vh *= clamp(d / r.range, 0.7, 1.4);
    vy *= clamp(T / r.t, 0.7, 1.4);
    turn = -Math.atan2(r.side, len(r.range, 0) || 1);
  }
  const a = Math.atan2(tz - p.z, tx - p.x) + turn;
  return { vx: Math.cos(a) * vh, vy: vy, vz: Math.sin(a) * vh };
}

// passaggio rasoterra verso un punto. driven: passaggio teso, arriva più veloce (più difficile da intercettare)
function doGroundPass(p, tx, tz, receiver, driven) {
  const d = Math.max(2, dist2(p.x, p.z, tx, tz));
  const maxV = 17 + p.attr.pass * 0.1 + (driven ? 4 : 0);
  const vEnd = driven ? (d > 20 ? 10 : 8.5) : (d > 20 ? 7 : 5.5);
  let v = clamp(groundSpeedFor(d, vEnd), 6, maxV);
  const dirx = (tx - p.x) / d, dirz = (tz - p.z) / d;
  const e = withError(dirx * v, dirz * v, passErrorFor(p, tx, tz) * (driven ? 1.15 : 1));
  p.team.match.pendingPass = { from: p, to: receiver || null };
  kickBall(p, e[0], 0, e[1], 0, 'pass');
}

// passaggio alto: lancio lungo (backspin, scende morbido), cross (un po' di effetto verso la porta)
// o filtrante alto ("lofted", più rapido e basso). Il volo tiene conto di aria ed effetto.
function doLobPass(p, tx, tz, receiver, kind) {
  const d = Math.max(3, dist2(p.x, p.z, tx, tz));
  const lofted = kind === 'lofted';
  const T = lofted ? clamp(d / 21, 0.8, 1.7) : clamp(d / 17, 0.9, 2.3);   // tempo di volo
  let spin = 0, topspin = lofted ? -14 : -20;
  if (kind === 'cross') {
    // il cross gira verso la porta: l'effetto ha il segno che porta la curva verso il centro dell'area
    const goalX = p.team.oppGoalX(), dirx = tx - p.x, dirz = tz - p.z;
    const cross = dirx * (0 - p.z) - dirz * (goalX - p.x);
    spin = -Math.sign(cross || 1) * randRange(10, 18);
    topspin = -8;
  }
  const v = solveFlight(p, tx, tz, T, spin, topspin);
  const e = withError(v.vx, v.vz, passErrorFor(p, tx, tz) * 0.9);
  p.team.match.pendingPass = { from: p, to: receiver || null };
  kickBall(p, e[0], v.vy * randRange(0.96, 1.04), e[1], spin, lofted ? 'lob' : kind || 'lob', topspin);
}

// tiro in porta: aimZ = punto laterale mirato, power 0..1.
// opts.curl: tiro a giro (più lento, con molto effetto verso l'interno della porta, più preciso negli angoli).
// power sotto 0.35: piatto rasoterra; sopra 0.85: tiro potente, con topspin che lo fa scendere ma più impreciso e
// con il rischio di finire alto. La direzione dipende anche da come è girato e quanto corre chi tira.
function doShot(p, aimZ, power, opts) {
  opts = opts || {};
  const m = p.team.match;
  const gx = p.team.oppGoalX();
  const d = dist2(p.x, p.z, gx, aimZ);
  const a = p.attr.shot / 100;
  const low = power < 0.35 && !opts.curl;
  let v = (17 + power * 17) * (0.75 + a * 0.3) * (opts.curl ? 0.82 : 1);
  let spin = randRange(-6, 6), topspin = power > 0.85 ? 18 : power > 0.5 ? 8 : 0;
  if (opts.curl) {
    // l'effetto porta il pallone dall'esterno verso il centro della porta: si mira un po' fuori e il volo lo riporta dentro
    const toward = Math.sign((0 - aimZ) * (gx - p.x)) || 1;
    spin = toward * (32 + a * 22); topspin = 4;
  }
  let targetH = low ? 0 : 0.3 + power * 1.45 + randRange(-0.35, 0.5) * (0.6 + power);
  if (power > 0.92) targetH += randRange(0, 1.6);   // troppa potenza: rischio di tirare alto
  let err = 0.015 + (1 - a) * 0.08 + power * power * 0.03;
  if (opts.curl) err *= 0.75;
  if (p.data.ability === 'Bomber' && d < 18) err *= 0.7;
  if (nearestOpponentDist(p) < 1.5) err *= 1.4;
  if (p.energy < 40) err *= 1.2;
  if (p.sprinting) err *= 1.25;
  const ang = Math.abs(angleDiff(p.facing, Math.atan2(aimZ - p.z, gx - p.x)));
  if (ang > Math.PI * 0.6) err *= 1.6;
  // velocità verticale per arrivare sulla linea di porta all'altezza voluta, con aria ed effetto veri
  let vy = 0, turn = 0;
  if (!low) {
    const t0 = d / v;
    vy = Math.max(0, (targetH - CONFIG.BALL_R + 0.5 * CONFIG.GRAVITY * t0 * t0) / t0);
    for (let i = 0; i < 4; i++) {
      const r = simulateFlight(v, vy, spin, topspin, 0, d);
      if (!r) break;
      vy = Math.max(0, vy + (targetH + CONFIG.BALL_R - r.y) / r.t);
      if (opts.curl) turn = -Math.atan2(r.side, r.x);
    }
  }
  const dirA = Math.atan2(aimZ - p.z, gx - p.x) + turn;
  const e = withError(Math.cos(dirA) * v, Math.sin(dirA) * v, err);
  p.stats.shots++;
  p.team.stats.shots++;
  m.pendingPass = null;
  kickBall(p, e[0], vy, e[1], spin, 'shot', topspin);
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
