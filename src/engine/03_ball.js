// ============================================================
// PALLONE — gravità, resistenza dell'aria, effetto (Magnus), rimbalzo, rotolamento
// La resistenza cresce con il quadrato della velocità: un tiro potente perde molta più velocità di un passaggio,
// e i calci (passaggi alti e tiri) si calcolano simulando il volo vero con la stessa fisica.
// ============================================================
class Ball {
  constructor() {
    this.reset(0, 0);
  }
  reset(x, z) {
    this.x = x; this.y = CONFIG.BALL_R; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.spin = 0;          // effetto laterale ω (rad/s): positivo curva verso +z per un pallone che va verso +x
    this.topspin = 0;       // effetto in avanti (rad/s): positivo scende prima e rimbalza lungo, negativo galleggia e frena
    this.owner = null;      // giocatore che ha la palla al piede
    this.lastTouch = null;  // ultimo giocatore che l'ha toccata
    this.inNet = false;
    this.netHit = null;     // punto in cui il pallone ha colpito la rete (per la grafica)
  }
  speed() { return len(this.vx, this.vz); }
  // calcio: la palla parte con la velocità e l'effetto indicati
  kick(vx, vy, vz, player, spin, topspin) {
    this.owner = null;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.spin = spin || 0;
    this.topspin = topspin || 0;
    this.lastTouch = player;
    if (player) player.kickCooldown = CONFIG.KICK_COOLDOWN;
  }
}

// METEO — quanto cambia il pallone (1 = come sempre). Con la pioggia l'erba bagnata fa scivolare la palla più veloce
// e la fa rimbalzare meno; con la neve la palla frena molto di più e rimbalza poco.
// La partita mette i valori del suo meteo mentre si calcola (Match.withRng), così più partite insieme non si mescolano.
const WEATHER_BALL = {
  clear: { roll: 1, drag: 1, bounce: 1 },
  rain: { roll: 0.8, drag: 0.85, bounce: 0.85 },
  snow: { roll: 1.45, drag: 1.3, bounce: 0.7 },
};
const WEATHERS = ['clear', 'rain', 'snow'];
const TIMES_OF_DAY = ['day', 'sunset', 'night'];
let BALL_ENV = WEATHER_BALL.clear;

// Un passo di fisica (usato anche per prevedere la traiettoria e per calcolare passaggi e tiri)
function stepBallPhysics(b, dt) {
  const C = CONFIG, R = C.BALL_R, E = BALL_ENV;
  const onGround = b.y <= R + 0.002 && Math.abs(b.vy) < 0.6;
  if (onGround) {
    b.y = R; b.vy = 0;
    const sp = len(b.vx, b.vz);
    if (sp > 0) {
      // rotolamento sull'erba: attrito costante più una parte proporzionale alla velocità
      const ns = Math.max(0, sp - (C.ROLL_DECEL * E.roll + sp * C.ROLL_DRAG * E.drag) * dt);
      b.vx *= ns / sp; b.vz *= ns / sp;
      // a terra l'effetto laterale fa ancora girare un poco il pallone
      if (b.spin && ns > 0.5) { const a = C.MAGNUS * 0.3 * b.spin * dt, vx = b.vx; b.vx -= b.vz * a; b.vz += vx * a; }
    }
    b.spin *= Math.exp(-3 * dt);
    b.topspin = 0;
  } else {
    // resistenza dell'aria proporzionale al quadrato della velocità (forma implicita: stabile anche a passi lunghi)
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    const k = 1 / (1 + C.AIR_DRAG * sp * dt);
    b.vx *= k; b.vy *= k; b.vz *= k;
    b.vy -= C.GRAVITY * dt;
    // effetto Magnus: laterale (tiro a giro) e verticale (il topspin fa scendere, il backspin sostiene)
    const sh = len(b.vx, b.vz);
    if (sh > 0.5) {
      if (b.spin) { const a = C.MAGNUS * b.spin * dt, vx = b.vx; b.vx -= b.vz * a; b.vz += vx * a; }
      if (b.topspin) b.vy -= C.MAGNUS * b.topspin * sh * dt;
    }
    const decay = Math.exp(-0.35 * dt);
    b.spin *= decay; b.topspin *= decay;
  }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y < R) {
    b.y = R;
    if (b.vy < -0.6) {
      // rimbalzo: più forte l'impatto, meno energia torna indietro; l'erba frena e l'effetto cambia la corsa
      const vin = -b.vy;
      b.vy = vin * clamp(C.BOUNCE * E.bounce - 0.012 * vin, 0.38 * E.bounce, C.BOUNCE * E.bounce);
      const sh = len(b.vx, b.vz);
      if (sh > 0.01) {
        const ns = Math.max(0, sh * (1 - 0.16 * Math.min(1, vin / 8)) + clamp(b.topspin * R * 0.25, -sh * 0.3, sh * 0.3));
        b.vx *= ns / sh; b.vz *= ns / sh;
      }
      b.topspin *= 0.4; b.spin *= 0.7;
    } else b.vy = 0;
  }
}

// Collisioni con pali, traversa e rete (per entrambe le porte). Restituisce 'post' (palo), 'bar' (traversa) o false.
// Il colpo conta solo se il pallone andava contro il legno (vn < 0): mentre resta a contatto non si ripete.
function collideGoalFrame(b, dt) {
  const C = CONFIG, R = C.BALL_R;
  let hit = false;
  for (let side = -1; side <= 1; side += 2) {
    const gx = side * C.HALF_L;
    // pali verticali
    for (let ps = -1; ps <= 1; ps += 2) {
      const pz = ps * C.GOAL_HALF_W;
      if (b.y < C.GOAL_H + R) {
        const dx = b.x - gx, dz = b.z - pz;
        const d = len(dx, dz);
        const minD = R + C.POST_R;
        if (d < minD && d > 0.0001) {
          const nx = dx / d, nz = dz / d;
          const vn = b.vx * nx + b.vz * nz;
          if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vz -= 1.7 * vn * nz; b.spin *= -0.5; hit = 'post'; }
          b.x = gx + nx * minD; b.z = pz + nz * minD;
        }
      }
    }
    // traversa (asse lungo z)
    if (Math.abs(b.z) < C.GOAL_HALF_W) {
      const dx = b.x - gx, dy = b.y - C.GOAL_H;
      const d = Math.sqrt(dx * dx + dy * dy);
      const minD = R + C.POST_R;
      if (d < minD && d > 0.0001) {
        const nx = dx / d, ny = dy / d;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vy -= 1.7 * vn * ny; hit = 'bar'; }
        b.x = gx + nx * minD; b.y = C.GOAL_H + ny * minD;
      }
    }
    // rete (0.24): la rete è elastica. Il pallone entra solo dalla bocca della porta; dentro, il fondo, i lati e il
    // tetto lo frenano come una molla che cede (fino a 55 cm sul fondo) e lo lasciano ricadere; da fuori (tiro
    // sull'esterno della rete, pallone che cade sul tetto) rimbalza piano e non entra mai
    collideNet(b, side, gx, dt || 1 / 240);
  }
  return hit;
}

// forma e "morbidezza" della rete (la stessa forma è disegnata in 09_render_net.js)
const GOAL_NET = {
  ROOF_DROP: 0.37,  // il tetto scende di tanto dalla traversa al fondo della porta
  K: 1500,          // forza della molla del fondo (più alta = rete più rigida)
  SIDE_K: 3200,     // lati e tetto: un po' più rigidi
  MAX: 0.55,        // quanto può cedere il fondo al massimo (m)
  SIDE_MAX: 0.3,    // quanto possono cedere lati e tetto
  DAMP: 5,          // quanto la rete assorbe la velocità del pallone mentre cede
  OUT_BOUNCE: 0.15, // rimbalzo sulla rete presa da fuori
};
// altezza del tetto della rete a una certa profondità dentro la porta
function goalRoofY(depth) { return CONFIG.GOAL_H - GOAL_NET.ROOF_DROP * clamp(depth / CONFIG.GOAL_DEPTH, 0, 1); }

// una parete della rete che cede: pen = quanto il pallone è andato oltre la parete, n = verso fuori (+1/-1),
// v = velocità del pallone su quell'asse. Restituisce la nuova velocità.
function netGive(pen, n, v, dt, K, max) {
  let out = v * n;   // velocità verso fuori dalla porta
  if (out > 0) out = (out - K * pen * dt) * Math.exp(-GOAL_NET.DAMP * dt);   // la rete si tende e frena il pallone
  else out = Math.max(out - K * pen * dt * 0.25, -1.2);                 // la rete torna indietro piano, senza fionda
  if (pen > max && out > 0) out = 0;                                    // rete tesa al massimo
  return out * n;
}

function collideNet(b, side, gx, dt) {
  const C = CONFIG, R = C.BALL_R, W = C.GOAL_HALF_W, D = C.GOAL_DEPTH;
  const depth = (b.x - gx) * side;           // quanto il pallone è dentro la porta (negativo = in campo)
  if (depth <= 0 || depth > D + GOAL_NET.MAX + R) { if (b.netOut === side) b.netOut = 0; return; }
  const roof = goalRoofY(depth), az = Math.abs(b.z), sz = Math.sign(b.z) || 1;
  // entra dalla bocca della porta: nell'ultimo passo ha attraversato la linea di porta tra i pali e sotto la traversa
  // (non se sta spingendo la rete da fuori: lì il pallone può trovarsi un poco dentro la sagoma della porta)
  if (!b.inNet && b.netOut !== side && az < W && b.y < C.GOAL_H && depth <= Math.abs(b.vx) * dt + 0.05) b.inNet = true;
  if (b.inNet) {
    // dentro la porta: fondo, lati e tetto cedono come molle
    const hit = (v) => { if (!b.netHit) b.netHit = { side: side, y: b.y, z: b.z, v: v }; netTouch(b, v); };
    const penB = depth - (D - R);
    if (penB > 0) {
      hit(Math.abs(b.vx));
      b.vx = netGive(penB, side, b.vx, dt, GOAL_NET.K, GOAL_NET.MAX);
      if (penB > GOAL_NET.MAX + 0.02) b.x = gx + side * (D - R + GOAL_NET.MAX + 0.02);
      const f = Math.exp(-3 * dt); b.vz *= f; b.vy *= f;   // la rete trattiene anche di lato
    }
    const penS = az - (W - R);
    if (penS > 0) {
      hit(Math.abs(b.vz));
      b.vz = netGive(penS, sz, b.vz, dt, GOAL_NET.SIDE_K, GOAL_NET.SIDE_MAX);
      if (penS > GOAL_NET.SIDE_MAX + 0.02) b.z = sz * (W - R + GOAL_NET.SIDE_MAX + 0.02);
    }
    const penR = b.y - (roof - R);
    if (penR > 0) {
      hit(Math.abs(b.vy));
      b.vy = netGive(penR, 1, b.vy, dt, GOAL_NET.SIDE_K, GOAL_NET.SIDE_MAX);
      if (penR > GOAL_NET.SIDE_MAX + 0.02) b.y = roof - R + GOAL_NET.SIDE_MAX + 0.02;
    }
    return;
  }
  // fuori dalla porta: si cerca la parete da cui il pallone arriva (quella da cui è "più fuori"). Anche da fuori la
  // rete cede (0.25.0): il pallone la spinge verso l'interno (al massimo 30 cm), viene frenato e torna indietro piano
  const outS = az - W, outB = depth - D, outR = b.y - roof;
  const best = Math.max(outS, outB, outR);
  if (best >= R || b.y > C.GOAL_H + R || best < -GOAL_NET.SIDE_MAX - R) { if (b.netOut === side) b.netOut = 0; return; }   // lontano dalla rete
  b.netOut = side;
  const pen = R - best, lim = GOAL_NET.SIDE_MAX + 0.02;
  if (best === outS) {
    if (b.vz * sz < 0) netTouch(b, Math.abs(b.vz));
    b.vz = netGive(pen, -sz, b.vz, dt, GOAL_NET.SIDE_K, GOAL_NET.SIDE_MAX);
    if (pen > lim) b.z = sz * (W + R - lim);
    const f = Math.exp(-4 * dt); b.vx *= f; b.vy *= f;   // la rete trattiene il pallone
  } else if (best === outB) {
    if (b.vx * side < 0) netTouch(b, Math.abs(b.vx));
    b.vx = netGive(pen, -side, b.vx, dt, GOAL_NET.SIDE_K, GOAL_NET.SIDE_MAX);
    if (pen > lim) b.x = gx + side * (D + R - lim);
    const f = Math.exp(-4 * dt); b.vz *= f; b.vy *= f;
  } else {
    if (b.vy < 0) netTouch(b, Math.abs(b.vy));
    b.vy = netGive(pen, -1, b.vy, dt, GOAL_NET.SIDE_K, GOAL_NET.SIDE_MAX);
    if (pen > lim) b.y = roof + R - lim;
    const f = Math.exp(-3 * dt); b.vx *= f; b.vz *= f;
  }
}

// il pallone tocca la rete (0.25.0): si ricorda il colpo più forte del passo; 08_match.js ne fa l'evento 'net'
// (suono della rete), uno solo per colpo
function netTouch(b, v) { if (v > (b.netTouchV || 0)) b.netTouchV = v; }

// Prevede la posizione del pallone nei prossimi secondi
function predictBall(ball, seconds, step) {
  const out = [];
  const b = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy, vz: ball.vz, spin: ball.spin, topspin: ball.topspin || 0 };
  const sub = 3; // sotto-passi per precisione
  let t = 0;
  out.push({ t: 0, x: b.x, y: b.y, z: b.z });
  while (t < seconds) {
    for (let i = 0; i < sub; i++) stepBallPhysics(b, step / sub);
    t += step;
    out.push({ t: t, x: b.x, y: b.y, z: b.z });
  }
  return out;
}
