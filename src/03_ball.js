// ============================================================
// PALLONE — fisica semplice ma credibile
// ============================================================
class Ball {
  constructor() {
    this.reset(0, 0);
  }
  reset(x, z) {
    this.x = x; this.y = CONFIG.BALL_R; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.spin = 0;          // effetto laterale (rad/s di curvatura)
    this.owner = null;      // giocatore che ha la palla al piede
    this.lastTouch = null;  // ultimo giocatore che l'ha toccata
    this.inNet = false;
  }
  speed() { return len(this.vx, this.vz); }
  // calcio: la palla parte con la velocità indicata
  kick(vx, vy, vz, player, spin) {
    this.owner = null;
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.spin = spin || 0;
    this.lastTouch = player;
    if (player) player.kickCooldown = CONFIG.KICK_COOLDOWN;
  }
}

// Un passo di fisica (usato anche per prevedere la traiettoria)
function stepBallPhysics(b, dt) {
  const R = CONFIG.BALL_R;
  const onGround = b.y <= R + 0.002 && Math.abs(b.vy) < 0.6;
  if (onGround) {
    b.y = R; b.vy = 0;
    const sp = len(b.vx, b.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp - CONFIG.ROLL_DECEL * dt - sp * CONFIG.ROLL_DRAG * dt);
      b.vx *= ns / sp; b.vz *= ns / sp;
    }
    b.spin *= (1 - 3 * dt);
  } else {
    b.vy -= CONFIG.GRAVITY * dt;
    const f = 1 - CONFIG.AIR_DRAG * dt;
    b.vx *= f; b.vz *= f;
    if (b.spin) {
      // l'effetto fa curvare la traiettoria
      const a = b.spin * dt;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = b.vx * c - b.vz * s;
      b.vz = b.vx * s + b.vz * c;
      b.vx = nx;
      b.spin *= (1 - 0.6 * dt);
    }
  }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y < R) {
    b.y = R;
    if (b.vy < -0.6) { b.vy = -b.vy * CONFIG.BOUNCE; b.vx *= 0.9; b.vz *= 0.9; }
    else b.vy = 0;
  }
}

// Collisioni con pali, traversa e rete (per entrambe le porte)
function collideGoalFrame(b) {
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
          if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vz -= 1.7 * vn * nz; hit = true; }
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
        if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vy -= 1.7 * vn * ny; hit = true; }
        b.x = gx + nx * minD; b.y = C.GOAL_H + ny * minD;
      }
    }
    // rete: se la palla è dentro la porta resta dentro
    const insideX = side > 0 ? b.x > gx : b.x < gx;
    if (insideX && Math.abs(b.z) < C.GOAL_HALF_W && b.y < C.GOAL_H) {
      const backX = gx + side * C.GOAL_DEPTH;
      if ((side > 0 && b.x > backX - R) || (side < 0 && b.x < backX + R)) {
        b.x = backX - side * R; b.vx = -b.vx * 0.15; b.vz *= 0.5; b.vy *= 0.5;
      }
      if (Math.abs(b.z) > C.GOAL_HALF_W - R) { b.z = Math.sign(b.z) * (C.GOAL_HALF_W - R); b.vz = -b.vz * 0.2; }
      if (b.y > C.GOAL_H - R) { b.y = C.GOAL_H - R; b.vy = -Math.abs(b.vy) * 0.2; }
      b.inNet = true;
    }
  }
  return hit;
}

// Prevede la posizione del pallone nei prossimi secondi
function predictBall(ball, seconds, step) {
  const out = [];
  const b = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy, vz: ball.vz, spin: ball.spin };
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
