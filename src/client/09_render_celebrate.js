// ============================================================
// ESULTANZE DOPO IL GOL — solo grafica, mentre la partita è nello stato GOAL (circa 3,5 s, replay a parte)
// - chi ha segnato corre via esultando: braccia larghe, poi un gesto (pugno al cielo, braccia in alto, aeroplano)
//   oppure la scivolata in ginocchio;
// - i compagni vicini gli corrono incontro e lo abbracciano;
// - il portiere della squadra che segna alza le braccia, quello che subisce si inginocchia con le mani in testa;
// - chi ha subito il gol si ferma con le mani sui fianchi e la testa bassa.
// Le posizioni disegnate si spostano un poco da quelle del motore; al calcio d'inizio tutto torna com'era.
// ============================================================
const CELEB_RUN = 6.2;   // velocità della corsa di festa del marcatore (m/s)
const CELEB_MATES = 8;   // i compagni corrono più forte per raggiungerlo

// il marcatore e i ruoli di tutti per il gol in corso (si calcola una volta per gol)
Renderer.prototype.celebrationSetup = function (m) {
  const g = m.lastGoal, key = m.log.length;
  if (this.celeb && this.celeb.key === key) return this.celeb;
  const scoring = g.team, conceding = g.team.opponent();
  const scorerTeam = g.own ? conceding : scoring;
  const scorer = g.own ? null : scorerTeam.players.find(p => p.data.name === g.scorer) || null;
  // il gesto del marcatore: 0 braccia in alto, 1 aeroplano, 2 scivolata in ginocchio, 3 pugno al cielo, 4 scivolata
  const style = scorer ? ((scorer.slotIndex || 0) + key) % 5 : 0;
  this.celeb = { key: key, scoring: scoring, conceding: conceding, scorer: scorer, style: style };
  for (const pm of this.playerMeshes) pm.cel = null;
  return this.celeb;
};

// posizione, direzione e velocità disegnate durante l'esultanza (null = come dice il motore)
Renderer.prototype.celebrationFor = function (pm, p, m, dt) {
  if (m.state !== 'GOAL' || !m.lastGoal || m.training || m.so) { pm.cel = null; return null; }
  const C = this.celebrationSetup(m);
  const t = m.stateTime;
  const c = pm.cel || (pm.cel = { ox: 0, oz: 0, phase: p.anim.phase, speed: 0, f: p.facing, arrived: false });
  const x0 = p.rx !== undefined ? p.rx : p.x, z0 = p.rz !== undefined ? p.rz : p.z;
  let speed = 0, f = c.f;
  if (p === C.scorer) {
    c.role = 'scorer';
    // corre via per un secondo e mezzo nella direzione in cui guarda (verso la bandierina se è vicino alla porta)
    if (t < 1.1) {
      const tx = Math.sign(p.team.dir) * (CONFIG.HALF_L - 4), tz = Math.sign(z0 || 1) * (CONFIG.HALF_W - 4);
      const want = Math.atan2(tz - (z0 + c.oz), tx - (x0 + c.ox));
      if (t < dt * 2) c.f = p.facing;
      c.f += angleDiff(c.f, want) * Math.min(1, dt * 2.5);
      speed = CELEB_RUN * (C.style === 2 || C.style === 4 ? 1 : Math.min(1, (1.1 - t) / 0.4 + 0.2));
    } else if ((C.style === 2 || C.style === 4) && t < 1.7) speed = CELEB_RUN * (1.7 - t) / 0.6;   // scivolata: frena sulle ginocchia
    f = c.f;
  } else if (p.team === C.scorerTeamFor || (C.scorer && p.team === C.scorer.team && !p.isGK)) {
    c.role = 'mate';
    // i compagni vicini corrono dal marcatore e si fermano attorno a lui
    const sp = this.playerMeshes.find(q => q.player === C.scorer);
    const sx = sp && sp.cel ? (C.scorer.rx + sp.cel.ox) : C.scorer.rx, sz = sp && sp.cel ? (C.scorer.rz + sp.cel.oz) : C.scorer.rz;
    const ang = (p.slotIndex || 0) * 1.7;
    const tx = sx + Math.cos(ang) * 1.05, tz = sz + Math.sin(ang) * 1.05;
    const dx = tx - (x0 + c.ox), dz = tz - (z0 + c.oz), d = Math.hypot(dx, dz);
    if (c.far === undefined) c.far = Math.hypot(C.scorer.x - p.x, C.scorer.z - p.z) > 26;   // chi è lontano esulta dove si trova
    if (!c.far && t > 0.2 && d > 0.15) {
      speed = Math.min(CELEB_MATES, d * 3);
      f = Math.atan2(dz, dx);
    } else if (!c.far) f = Math.atan2(sz - (z0 + c.oz), sx - (x0 + c.ox));
    c.arrived = !c.far && d < 0.4;
    if (c.far) c.role = 'cheer';
  } else if (p.team === C.scoring || (C.scorer && p.team === C.scorer.team)) {
    c.role = p.isGK ? 'gkcheer' : 'cheer';
  } else {
    c.role = p.isGK ? 'despair' : 'down';
  }
  // passo della corsa
  const a = Math.min(1, dt * 8);
  c.speed += (speed - c.speed) * a;
  c.ox += Math.cos(f) * c.speed * dt; c.oz += Math.sin(f) * c.speed * dt;
  c.phase += c.speed * dt * 1.9;
  c.f = f;
  return { x: x0 + c.ox, z: z0 + c.oz, f: speed > 0.3 || c.role === 'scorer' || c.role === 'mate' ? f : p.facing, speed: c.speed, phase: c.phase, role: c.role, t: t, style: C.style };
};

// posa dell'esultanza (dopo poseMesh)
Renderer.prototype.poseCelebration = function (pm, cel) {
  const body = pm.body, chest = pm.chest, neck = pm.neck;
  const L0 = pm.legs[0], L1 = pm.legs[1], A0 = pm.arms[0], A1 = pm.arms[1];
  const t = cel.t, k = Math.min(1, t / 0.4);
  if (cel.role === 'scorer') {
    if (t < 1.0 && !(cel.style === 2 || cel.style === 4)) {
      // corsa a braccia larghe
      A0.sh.rotation.x = -1.4 * k; A1.sh.rotation.x = 1.4 * k; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.15;
      return;
    }
    if (cel.style === 2 || cel.style === 4) {
      if (t < 0.9) { A0.sh.rotation.x = -1.2 * k; A1.sh.rotation.x = 1.2 * k; return; }
      // scivolata in ginocchio, il busto indietro e le braccia aperte al cielo
      const s = Math.min(1, (t - 0.9) / 0.25);
      body.position.y = -0.42 * s;
      L0.hip.rotation.z = L1.hip.rotation.z = 0.15 * s; L0.knee.rotation.z = L1.knee.rotation.z = -1.95 * s;
      L0.ankle.rotation.z = L1.ankle.rotation.z = -0.6 * s;
      chest.rotation.z = 0.35 * s; neck.rotation.z = 0.4 * s;
      A0.sh.rotation.x = -2.3 * s; A1.sh.rotation.x = 2.3 * s; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.1;
      return;
    }
    const v = cel.style === 1 ? 1 : cel.style === 3 ? 3 : 0, b = t * 6;
    if (v === 0) {
      A0.sh.rotation.x = -2.8; A1.sh.rotation.x = 2.8; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.2;
      body.position.y = Math.abs(Math.sin(b)) * 0.3;
    } else if (v === 1) {
      A0.sh.rotation.x = -1.5; A1.sh.rotation.x = 1.5; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.05;
      body.rotation.x = Math.sin(t * 2) * 0.2;
    } else {
      A1.sh.rotation.x = 2.9; A1.elbow.rotation.z = 0.3 + 0.6 * Math.abs(Math.sin(t * 8));
      A0.sh.rotation.x = -0.3; A0.elbow.rotation.z = 0.5;
      body.position.y += Math.abs(Math.sin(t * 5)) * 0.12;
    }
  } else if (cel.role === 'mate') {
    if (cel.speed > 1) {
      // corre con un braccio alzato
      A1.sh.rotation.x = 2.5; A1.elbow.rotation.z = 0.3;
    } else {
      // abbraccio: braccia avanti attorno al compagno, si saltella
      A0.sh.rotation.z = A1.sh.rotation.z = 1.35; A0.sh.rotation.x = 0.45; A1.sh.rotation.x = -0.45;
      A0.elbow.rotation.z = A1.elbow.rotation.z = 1.1;
      chest.rotation.z = -0.25;
      body.position.y = Math.abs(Math.sin(t * 7 + (pm.player.slotIndex || 0))) * 0.08;
    }
  } else if (cel.role === 'cheer' || cel.role === 'gkcheer') {
    A0.sh.rotation.x = -2.6 * k; A1.sh.rotation.x = 2.6 * k; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.3;
    body.position.y = Math.abs(Math.sin(t * 6 + (pm.player.slotIndex || 0))) * 0.15 * k;
  } else if (cel.role === 'despair') {
    // portiere a terra in ginocchio, mani sulla testa
    const s = Math.min(1, Math.max(0, (t - 0.4) / 0.4));
    body.position.y = -0.42 * s;
    L0.hip.rotation.z = L1.hip.rotation.z = 0.15 * s; L0.knee.rotation.z = L1.knee.rotation.z = -1.9 * s;
    chest.rotation.z = -0.35 * s; neck.rotation.z = -0.4 * s;
    A0.sh.rotation.x = -2.5 * s; A1.sh.rotation.x = 2.5 * s; A0.elbow.rotation.z = A1.elbow.rotation.z = 2.2 * s;
  } else if (cel.role === 'down') {
    // mani sui fianchi, testa bassa
    A0.sh.rotation.x = -0.55 * k; A1.sh.rotation.x = 0.55 * k; A0.sh.rotation.z = A1.sh.rotation.z = -0.3 * k;
    A0.elbow.rotation.z = A1.elbow.rotation.z = 1.7 * k;
    neck.rotation.z = -0.35 * k; chest.rotation.z = -0.1 * k;
  }
};
