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
// Dalla 0.23:
// - "set": quando un avversario arriva con la palla vicino alla porta (o un giocatore carica il tiro) il portiere fa
//   un saltello sul posto e si abbassa, pesato sulle punte, braccia larghe e basse;
// - tiro centrale (niente tuffo): va incontro al pallone con le mani; basso si china a raccoglierlo, alto alza le
//   braccia, a mezza altezza lo blocca sul petto;
// - rilancio con le mani: quando passa corto a un compagno lo fa rotolare con il braccio, come i portieri veri;
// - si sposta lungo la linea con i passi laterali (09_render.js), non correndo di traverso.
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

// posa del portiere (0.24): prima si calcola la posa voluta (poseKeeperRaw), poi si fonde con quella del fotogramma
// prima (blending): niente scatti tra fermo, passi laterali, pronto, parata, tuffo e recupero
Renderer.prototype.poseKeeper = function (pm, p, m, dt, bx, by, bz) {
  if (!p.isGK) return;
  this.poseKeeperRaw(pm, p, m, dt, bx, by, bz);
  this.blendKeeperPose(pm, dt, p.anim.dive > 0 ? 30 : 16);
};

// le articolazioni del portiere che si fondono tra un fotogramma e l'altro
function gkJoints(pm) {
  if (pm._gkJ) return pm._gkJ;
  const list = [pm.body.position, pm.body.rotation, pm.chest.rotation, pm.neck.rotation];
  for (const A of pm.arms) list.push(A.sh.rotation, A.elbow.rotation);
  for (const L of pm.legs) { list.push(L.hip.rotation, L.knee.rotation); if (L.ankle) list.push(L.ankle.rotation); }
  return (pm._gkJ = list);
}
// avvicina ogni articolazione alla posa voluta con un'interpolazione esponenziale (rate più alto = più pronto);
// il tuffo usa un rate alto: la spinta deve essere esplosiva, ma senza salti da un fotogramma all'altro
Renderer.prototype.blendKeeperPose = function (pm, dt, rate) {
  const J = gkJoints(pm), n = J.length * 3;
  if (!pm._gkPrev) {   // prima volta o dopo resetPoses(): si parte dalla posa voluta
    pm._gkPrev = new Float32Array(n);
    J.forEach((v, i) => { pm._gkPrev[i * 3] = v.x; pm._gkPrev[i * 3 + 1] = v.y; pm._gkPrev[i * 3 + 2] = v.z; });
    return;
  }
  const k = 1 - Math.exp(-rate * dt), P = pm._gkPrev;
  J.forEach((v, i) => {
    const o = i * 3;
    v.x = P[o] + (v.x - P[o]) * k; v.y = P[o + 1] + (v.y - P[o + 1]) * k; v.z = P[o + 2] + (v.z - P[o + 2]) * k;
    P[o] = v.x; P[o + 1] = v.y; P[o + 2] = v.z;
  });
};

Renderer.prototype.poseKeeperRaw = function (pm, p, m, dt, bx, by, bz) {
  const b = m.ball;
  const body = pm.body, chest = pm.chest, neck = pm.neck;
  const L0 = pm.legs[0], L1 = pm.legs[1], A0 = pm.arms[0], A1 = pm.arms[1];
  const ss = x => x * x * (3 - 2 * x);
  // ---- tuffo
  if (p.anim.dive > 0) {
    // diveDir = lato del tuffo × direzione della squadra (07_ai.js): con questo segno il corpo cade dalla parte dove il
    // motore lo sposta, cioè verso il pallone (prima era al contrario: si buttava dall'altra parte, 0.24.4)
    if (!pm.dv || pm.dv.done) pm.dv = { h: gkDiveHeight(p, b), side: p.anim.diveDir || 1, up: 1, done: false };
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
      y = lift * Math.sin(Math.PI * Math.min(1, s * 1.1)) + 0.12 * s;
      // il corpo si adatta al pallone mentre vola: con le braccia tese sopra la testa le mani stanno a circa 2,3 m
      // dai piedi; l'inclinazione giusta porta le mani all'altezza del pallone (se è vicino)
      let want = rot;
      const near = Math.hypot(bx - p.x, bz - p.z);
      if (near < 2.6) want = clamp(Math.acos(clamp((by - y) / 2.3, -1, 1)), 0.85, 1.55);
      dv.rot = dv.rot === undefined ? rot : dv.rot + (want - dv.rot) * Math.min(1, dt * 10);
      tilt = dv.side * (0.15 + (dv.rot - 0.15) * s);
      A0.sh.rotation.x = -2.9; A1.sh.rotation.x = 2.9; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.05;
      // la gamba di spinta resta indietro, l'altra si piega
      L0.hip.rotation.z = -0.2; L0.knee.rotation.z = -0.15; L1.hip.rotation.z = 0.35; L1.knee.rotation.z = -0.7;
    } else {
      // a terra sul fianco
      const s = ss(Math.min(1, (u - 0.55) / 0.2));
      const r0 = dv.rot === undefined ? rot : dv.rot;
      tilt = dv.side * (r0 + (1.5 - r0) * s); y = 0.12;
      A0.sh.rotation.x = -2.9 + 0.7 * s; A1.sh.rotation.x = 2.9 - 0.7 * s; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.05 + 0.6 * s;
      L0.knee.rotation.z = -0.3; L1.hip.rotation.z = 0.4; L1.knee.rotation.z = -0.9;
    }
    body.rotation.x = tilt; body.position.y = y;
    chest.rotation.z = -0.1; neck.rotation.z = 0;
    dv.lastTilt = tilt;
    return;
  }
  // ---- si rialza dopo il tuffo: resta un attimo a terra (come nel motore), poi si spinge con le mani, porta le
  // ginocchia sotto il corpo e si alza (0,85 s in tutto)
  if (pm.dv && !pm.dv.done) { pm.dv.done = true; pm.dv.upT = 0; }
  if (pm.dv && pm.dv.up > 0) {
    pm.dv.upT = (pm.dv.upT || 0) + dt;
    const t = pm.dv.upT;
    pm.dv.up = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.5);
    const k = ss(pm.dv.up), push = Math.sin(clamp((t - 0.3) / 0.55, 0, 1) * Math.PI);
    body.rotation.x = (pm.dv.lastTilt || 0) * k; body.position.y = body.position.y * (1 - k) + 0.1 * k;
    for (const L of pm.legs) L.knee.rotation.z += -0.9 * k - 0.6 * push;
    // le braccia spingono a terra per rialzarsi
    A0.sh.rotation.z = A1.sh.rotation.z = 0.6 * push; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.4 * push;
    chest.rotation.z -= 0.35 * push;
  }
  // ---- rilancio con le mani: aveva la palla in mano e la passa corta (palla bassa): la fa rotolare
  const holding = b.owner === p && !(p.anim.kick > 0);
  if (pm.held && !holding && p.anim.kick > 0 && b.owner !== p && Math.abs(b.vy || 0) < 2 && Math.hypot(b.vx || 0, b.vz || 0) < 22) { pm.release = { t: 0 }; pm.held = false; }
  if (pm.release) {
    pm.release.t += dt;
    const u = pm.release.t / 0.55;
    if (u >= 1) pm.release = null;
    else {
      const e = Math.sin(Math.min(1, u * 1.3) * Math.PI * 0.5), down = Math.sin(u * Math.PI);
      // passo avanti, ginocchio dietro quasi a terra, busto giù, braccio che passa da dietro a davanti rasoterra
      L0.hip.rotation.z = 0.55 * down; L0.knee.rotation.z = -0.7 * down;
      L1.hip.rotation.z = -0.3 * down; L1.knee.rotation.z = -1.3 * down;
      body.position.y = -0.3 * down; chest.rotation.z = -0.55 * down;
      A1.sh.rotation.z = -0.9 + 2.0 * e; A1.sh.rotation.x = 0.1; A1.elbow.rotation.z = 0.1;
      A0.sh.rotation.z = -0.3 * down; A0.sh.rotation.x = -0.6 * down;
      chest.rotation.y = 0.25 * (1 - e);
      return;
    }
  }
  // ---- "set" e parata centrale: solo in piedi, senza la palla
  const carrier = b.owner && b.owner.team !== p.team ? b.owner : null;
  const gx = p.team.ownGoalX();
  const danger = !!carrier && Math.hypot(carrier.x - gx, carrier.z) < 24 && Math.hypot(carrier.x - p.x, carrier.z - p.z) > 3;
  const charging = !!carrier && (m.humans || []).some(h => h.player === carrier && h.shootCharge > 0);
  if ((danger && !pm.wasDanger) || (charging && !pm.wasCharging)) pm.setHop = 0.3;
  pm.wasDanger = danger; pm.wasCharging = charging;
  pm.setK = (pm.setK || 0) + ((danger && p.speed() < 2.5 ? (charging ? 1 : 0.6) : 0) - (pm.setK || 0)) * Math.min(1, dt * 6);
  if (!holding && b.owner !== p) {
    if (pm.setHop > 0) {
      // saltello sul posto: si stacca appena da terra con le gambe tese, poi atterra piegato
      pm.setHop = Math.max(0, pm.setHop - dt);
      const h = Math.sin((1 - pm.setHop / 0.3) * Math.PI);
      body.position.y += 0.09 * h;
      for (const L of pm.legs) { L.knee.rotation.z *= 1 - 0.6 * h; if (L.ankle) L.ankle.rotation.z -= 0.35 * h; }
    }
    if (pm.setK > 0.02) {
      const k = pm.setK;
      for (const L of pm.legs) { L.hip.rotation.z += 0.18 * k; L.knee.rotation.z -= 0.35 * k; }
      chest.rotation.z -= 0.12 * k; body.position.y -= 0.06 * k;
      A0.sh.rotation.z += 0.25 * k; A1.sh.rotation.z += 0.25 * k;
      A0.sh.rotation.x -= 0.35 * k; A1.sh.rotation.x += 0.35 * k;
    }
    // tiro che arriva addosso (senza tuffo): mani incontro al pallone all'altezza giusta
    const toGoal = (b.vx || 0) * Math.sign(gx);
    const dBall = Math.hypot(bx - p.x, bz - p.z);
    const incoming = !b.owner && toGoal > 7 && dBall < 7 && Math.abs(bz - p.z) < 1.4;
    pm.block = (pm.block || 0) + ((incoming ? 1 : 0) - (pm.block || 0)) * Math.min(1, dt * 12);
    if (incoming) pm.blockH = by;
    if (pm.block > 0.02) {
      const k = pm.block, hgt = pm.blockH || 1;
      if (hgt < 0.55) {
        // palla bassa: si china, ginocchio a terra, mani a cucchiaio davanti ai piedi
        for (const L of pm.legs) { L.hip.rotation.z += 0.5 * k; L.knee.rotation.z -= 1.0 * k; }
        chest.rotation.z -= 0.75 * k; body.position.y -= 0.22 * k;
        A0.sh.rotation.z = A1.sh.rotation.z = 0.5 * k; A0.sh.rotation.x = -0.15 * k; A1.sh.rotation.x = 0.15 * k;
        A0.elbow.rotation.z = A1.elbow.rotation.z = 0.2 * k;
      } else if (hgt > 1.6) {
        // palla alta: braccia in alto, sulle punte
        A0.sh.rotation.x = -2.75 * k; A1.sh.rotation.x = 2.75 * k; A0.sh.rotation.z = A1.sh.rotation.z = 0.35 * k;
        A0.elbow.rotation.z = A1.elbow.rotation.z = 0.15;
        body.position.y += 0.12 * k;
      } else {
        // a mezza altezza: braccia avanti, la palla si blocca sul petto
        A0.sh.rotation.z = A1.sh.rotation.z = 1.25 * k; A0.sh.rotation.x = 0.25 * k; A1.sh.rotation.x = -0.25 * k;
        A0.elbow.rotation.z = A1.elbow.rotation.z = 0.7 * k;
        chest.rotation.z -= 0.2 * k;
      }
    }
  }
  // ---- palla in mano: davanti al petto (presa alta: un salto con le braccia in alto)
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
Renderer.prototype.onSave = function () {
  this.saveAt = performance.now();
  // parata in tuffo: un po' d'erba che salta dove atterra il portiere (effetto discreto, 0.24)
  const pm = this.playerMeshes.find(q => q.player.isGK && q.player.anim.dive > 0);
  if (pm) this.burst('grass', pm.root.position.x, pm.root.position.z, { amount: 0.6 });
};
