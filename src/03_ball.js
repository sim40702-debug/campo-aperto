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

// Un passo di fisica (usato anche per prevedere la traiettoria e per calcolare passaggi e tiri)
function stepBallPhysics(b, dt) {
  const C = CONFIG, R = C.BALL_R;
  const onGround = b.y <= R + 0.002 && Math.abs(b.vy) < 0.6;
  if (onGround) {
    b.y = R; b.vy = 0;
    const sp = len(b.vx, b.vz);
    if (sp > 0) {
      // rotolamento sull'erba: attrito costante più una parte proporzionale alla velocità
      const ns = Math.max(0, sp - (C.ROLL_DECEL + sp * C.ROLL_DRAG) * dt);
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
      b.vy = vin * clamp(C.BOUNCE - 0.012 * vin, 0.38, C.BOUNCE);
      const sh = len(b.vx, b.vz);
      if (sh > 0.01) {
        const ns = Math.max(0, sh * (1 - 0.16 * Math.min(1, vin / 8)) + clamp(b.topspin * R * 0.25, -sh * 0.3, sh * 0.3));
        b.vx *= ns / sh; b.vz *= ns / sh;
      }
      b.topspin *= 0.4; b.spin *= 0.7;
    } else b.vy = 0;
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
          if (vn < 0) { b.vx -= 1.7 * vn * nx; b.vz -= 1.7 * vn * nz; b.spin *= -0.5; hit = true; }
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
        // la rete trattiene il pallone: si ricorda dove e quanto forte l'ha colpita (la grafica la fa gonfiare)
        if (!b.netHit) b.netHit = { side: side, y: b.y, z: b.z, v: Math.abs(b.vx) };
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
