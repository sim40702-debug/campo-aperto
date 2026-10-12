// ============================================================
// PORTIERE — tuffi, prese, pugni e uscite (solo grafica)
// Il motore dice solo "si tuffa a destra o a sinistra" (anim.dive per 0,9 s, anim.diveDir). Qui il tuffo diventa vero:
// - caricamento sulle gambe, volo e atterraggio sul fianco, poi si rialza;
// - l'altezza del tuffo dipende da dove arriva il pallone: rasoterra (quasi sdraiato, braccia lungo l'erba),
//   a mezza altezza, oppure alto (più dritto, braccia tese sopra la testa);
// - con la palla in mano la tiene davanti al petto (il pallone si disegna nelle mani);
// - presa alta: se prende un pallone alto salta con le braccia in alto;
// - respinta: dopo una parata senza presa colpisce con i pugni;
// - uscita bassa: quando esce sui piedi dell'attaccante si butta basso con le braccia larghe.
// ============================================================
const GK_DIVE_SECS = 0.9;   // durata del tuffo nel motore (07_ai.js, 08_match.js)

// altezza a cui il pallone arriverà sulla linea del portiere (per scegliere il tipo di tuffo)
function gkDiveHeight(p, b) {
  const by = b.ry !== undefined ? b.ry : b.y;
  const vx = b.vx || 0, vy = b.vy || 0;
  if (Math.abs(vx) < 1) return by;
  const t = Math.min(1.2, Math.abs((p.x - b.x) / vx));
  return clamp(by + vy * t - 4.9 * t * t, 0, 2.8);
}

Renderer.prototype.poseKeeper = function (pm, p, m, dt, bx, by, bz) {
  if (!p.isGK) return;
  const b = m.ball;
  const body = pm.body, chest = pm.chest, neck = pm.neck;
  const L0 = pm.legs[0], L1 = pm.legs[1], A0 = pm.arms[0], A1 = pm.arms[1];
  const ss = x => x * x * (3 - 2 * x);
  // ---- tuffo
  if (p.anim.dive > 0) {
    if (!pm.dv || pm.dv.done) pm.dv = { h: gkDiveHeight(p, b), side: -(p.anim.diveDir || 1), up: 1, done: false };
    const dv = pm.dv, u = clamp(1 - p.anim.dive / GK_DIVE_SECS, 0, 1);
    const high = dv.h > 1.7, low = dv.h < 0.55;
    const rot = high ? 1.1 : low ? 1.52 : 1.35, lift = high ? 0.55 : low ? 0.1 : 0.38;
    // niente posa del portiere pronto durante il tuffo
    A0.sh.rotation.z = A1.sh.rotation.z = 0; L0.hip.rotation.x = L1.hip.rotation.x = 0;
    let tilt, y;
    if (u < 0.12) {
      // carica: si abbassa sulle gambe
      const k = ss(u / 0.12);
      tilt = dv.side * 0.15 * k; y = -0.12 * k;
      for (const L of pm.legs) { L.hip.rotation.z = 0.4 * k; L.knee.rotation.z = -0.8 * k; }
      A0.sh.rotation.x = -0.6 * k; A1.sh.rotation.x = 0.6 * k;
    } else if (u < 0.55) {
      // in volo verso il pallone, il corpo si stende
      const s = ss((u - 0.12) / 0.43);
      tilt = dv.side * (0.15 + (rot - 0.15) * s); y = lift * Math.sin(Math.PI * Math.min(1, s * 1.1)) + 0.12 * s;
      A0.sh.rotation.x = -2.9; A1.sh.rotation.x = 2.9; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.05;
      // la gamba di spinta resta indietro, l'altra si piega
      L0.hip.rotation.z = -0.2; L0.knee.rotation.z = -0.15; L1.hip.rotation.z = 0.35; L1.knee.rotation.z = -0.7;
    } else {
      // a terra sul fianco
      const s = ss(Math.min(1, (u - 0.55) / 0.2));
      tilt = dv.side * (rot + (1.5 - rot) * s); y = 0.12;
      A0.sh.rotation.x = -2.9 + 0.7 * s; A1.sh.rotation.x = 2.9 - 0.7 * s; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.05 + 0.6 * s;
      L0.knee.rotation.z = -0.3; L1.hip.rotation.z = 0.4; L1.knee.rotation.z = -0.9;
    }
    body.rotation.x = tilt; body.position.y = y;
    chest.rotation.z = -0.1; neck.rotation.z = 0;
    dv.lastTilt = tilt;
    return;
  }
  // ---- si rialza dopo il tuffo
  if (pm.dv && !pm.dv.done) pm.dv.done = true;
  if (pm.dv && pm.dv.up > 0) {
    pm.dv.up = Math.max(0, pm.dv.up - dt / 0.45);
    const k = ss(pm.dv.up);
    body.rotation.x = (pm.dv.lastTilt || 0) * k; body.position.y = body.position.y * (1 - k) + 0.1 * k;
    for (const L of pm.legs) L.knee.rotation.z += -0.9 * k;
  }
  // ---- palla in mano: davanti al petto (presa alta: un salto con le braccia in alto)
  const holding = b.owner === p && !(p.anim.kick > 0);
  if (holding && !pm.held) {
    const prevY = b.py !== undefined ? b.py : by;
    pm.catchHigh = prevY > 1.5 || (pm.lastBallY || 0) > 1.5 ? 0.5 : 0;
  }
  pm.held = holding;
  pm.lastBallY = by;
  if (pm.catchHigh > 0) {
    pm.catchHigh -= dt;
    const k = Math.sin(clamp(pm.catchHigh / 0.5, 0, 1) * Math.PI);
    body.position.y += 0.28 * k;
    A0.sh.rotation.x = -2.7 * k; A1.sh.rotation.x = 2.7 * k; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.3;
    L1.hip.rotation.z = 0.5 * k; L1.knee.rotation.z = -1.0 * k;
  } else if (holding) {
    A0.sh.rotation.z = A1.sh.rotation.z = 0.95;
    A0.sh.rotation.x = 0.28; A1.sh.rotation.x = -0.28;
    A0.elbow.rotation.z = A1.elbow.rotation.z = 1.25;
  }
  if (holding) {
    // il pallone nelle mani (davanti al petto, o sopra la testa nella presa alta)
    const f = -pm.root.rotation.y;
    const hi = pm.catchHigh > 0 ? Math.sin(clamp(pm.catchHigh / 0.5, 0, 1) * Math.PI) : 0;
    const fx = pm.root.position.x + Math.cos(f) * (0.34 - 0.2 * hi), fz = pm.root.position.z + Math.sin(f) * (0.34 - 0.2 * hi);
    this.ballMesh.position.set(fx, 1.05 + body.position.y + 1.1 * hi, fz);
    this.placeBallShadow(fx, 0, fz);
  }
  // ---- respinta con i pugni (subito dopo una parata senza presa)
  if (this.saveAt && performance.now() - this.saveAt < 80 && !b.owner && !pm.punch) {
    const d = Math.hypot(bx - p.x, bz - p.z);
    if (d < 3) pm.punch = 0.4;
  }
  if (pm.punch > 0) {
    pm.punch = Math.max(0, pm.punch - dt);
    const k = Math.sin((1 - pm.punch / 0.4) * Math.PI);
    A0.sh.rotation.z = A1.sh.rotation.z = 2.4 * k; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.2;
    body.position.y += 0.2 * k;
  }
  // ---- uscita bassa sui piedi dell'attaccante
  const opp = b.owner && b.owner.team !== p.team;
  const want = !holding && (opp || !b.owner) && p.speed() > 2.4 && Math.hypot(bx - p.x, bz - p.z) < 2.8 && by < 0.6 ? 1 : 0;
  pm.smother = (pm.smother || 0) + (want - (pm.smother || 0)) * Math.min(1, dt * 7);
  if (pm.smother > 0.02) {
    const k = pm.smother;
    for (const L of pm.legs) { L.hip.rotation.z += 0.75 * k; L.knee.rotation.z -= 1.15 * k; }
    L0.hip.rotation.x = -0.25 * k; L1.hip.rotation.x = 0.25 * k;
    chest.rotation.z -= 0.55 * k;
    body.position.y -= 0.28 * k;
    A0.sh.rotation.z = A1.sh.rotation.z = 0.9 * k; A0.sh.rotation.x = -1.0 * k; A1.sh.rotation.x = 1.0 * k;
  }
};

// parata (evento 'save' dal gioco): il portiere vicino al pallone respinge con i pugni se non l'ha presa
Renderer.prototype.onSave = function () { this.saveAt = performance.now(); };
