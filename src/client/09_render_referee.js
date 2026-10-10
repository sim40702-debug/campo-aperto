// ============================================================
// ARBITRO, CARTELLINI E INFORTUNI — solo grafica
// L'arbitro in campo, i barellieri e le pose dei giocatori a terra non fanno parte della partita: il motore non li
// conosce. Si muovono qui, partendo dalla palla e dagli eventi dell'arbitro ('ref': FOUL, YELLOW_CARD, RED_CARD),
// che arrivano uguali in locale e ai client online. Così le partite restano identiche e il server non cambia.
// - arbitro: segue l'azione in diagonale, fischia indicando la direzione della punizione, corre dal giocatore e
//   alza il cartellino (giallo o rosso); sopra la testa del giocatore compare il cartellino
// - infortunio (fallo duro): il giocatore resta a terra tenendosi la gamba, poi si rialza e zoppica per un po'
// - fallo molto duro: arrivano due barellieri con la barella dalla linea laterale
// ============================================================
const OFFICIALS = {
  REF_KIT: ['#151515', '#151515', '#151515'],
  MEDIC_KIT: ['#f2f2f2', '#2a4f9e', '#f2f2f2'],
  REF_SPEED: 7.2,        // velocità massima dell'arbitro (m/s)
  HURT: 0.55,            // stesse soglie degli infortuni del motore (INJURY in 08_referee.js)
  STRETCHER: 0.82,
  CARD_SECS: 1.9,        // quanto resta alzato il cartellino
};

// figura umana con il modello dei calciatori (arbitro, barellieri): una maglia, nessun numero
Renderer.prototype.makeFigure = function (kit, look, seed) {
  const fake = {
    data: { number: '', look: Object.assign({ skin: '#c99a76', hair: '#2b2018', hairStyle: 'corti', beard: false, height: 1.8, build: 1, boots: '#111111' }, look || {}) },
    isGK: false, team: { kit: kit, index: 0 }, slotIndex: seed || 0,
  };
  const pm = this.makePlayerMesh(fake);
  // il numero sulla schiena è l'unico pezzo con un materiale suo: si nasconde
  pm.root.traverse(o => { if (o.isMesh && o.material !== this.playerMat) o.visible = false; });
  return pm;
};

Renderer.prototype.setupOfficials = function (match) {
  this.clearOfficials();
  const ref = this.makeFigure(OFFICIALS.REF_KIT, { skin: '#d7a986', hair: '#1b1410', hairStyle: 'rasati', height: 1.82 }, 3);
  // cartellino in mano (si vede solo quando lo alza)
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.075), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
  card.position.set(0.02, -0.33, 0); card.visible = false;
  ref.arms[1].elbow.add(card);
  this.officials = {
    ref: ref, card: card,
    x: -8, z: -12, vx: 0, vz: 0, facing: 0, phase: 0,
    tasks: [],          // cartellini da mostrare, in ordine
    point: null,        // { dir, t }: braccio teso verso la direzione della punizione
    rush: null,         // { x, z, t }: corre verso il punto del fallo
    medics: null,       // barellieri in campo
    icons: [],          // cartellini sopra la testa dei giocatori
  };
};

Renderer.prototype.clearOfficials = function () {
  const o = this.officials;
  if (!o) return;
  this.disposePlayerMesh(o.ref);
  if (o.medics) this.removeMedics();
  for (const ic of o.icons) { this.scene.remove(ic.mesh); ic.mesh.geometry.dispose(); ic.mesh.material.dispose(); }
  this.officials = null;
};

// evento dell'arbitro (dal gioco, 14_game.js refereeFeedback)
Renderer.prototype.officialsEvent = function (r, match) {
  const o = this.officials;
  if (!o || !r || !match) return;
  const slots = match.allSlots();
  const who = q => (q && q.id >= 0 ? slots[q.id] : null);
  if (r.type === 'FOUL') {
    const victim = who(r.victim);
    // l'arbitro fischia e indica la direzione dell'attacco di chi ha subito il fallo
    if (victim && r.consequence !== 'ADVANTAGE') o.point = { dir: victim.team.dir, t: 1.3 };
    o.rush = { x: r.x, z: r.z, t: 2.2 };
    // fallo duro: a terra, poi zoppica (con la barella se è molto duro)
    if (victim && r.severity >= OFFICIALS.HURT) {
      const pm = this.playerMeshes.find(m => m.player === victim);
      if (pm) {
        const big = r.severity >= OFFICIALS.STRETCHER;
        pm.hurtT = big ? 9.5 : 4.2;
        pm.limpT = big ? 45 : 25;
        if (big) this.callMedics(victim, pm);
      }
    }
  } else if (r.type === 'YELLOW_CARD' || r.type === 'RED_CARD') {
    const p = who(r.player);
    if (p) o.tasks.push({ p: p, red: r.type === 'RED_CARD', t: 0, shown: 0 });
  }
};

// ---- barellieri ----
Renderer.prototype.callMedics = function (victim, pm) {
  const o = this.officials;
  if (o.medics) this.removeMedics();
  const side = victim.z >= 0 ? 1 : -1;
  const start = { x: clamp(victim.x, -48, 48), z: side * (CONFIG.HALF_W + 3) };
  const a = this.makeFigure(OFFICIALS.MEDIC_KIT, { skin: '#e0b896', hair: '#5a3a22' }, 1);
  const b = this.makeFigure(OFFICIALS.MEDIC_KIT, { skin: '#a8754f', hair: '#111111', hairStyle: 'ricci' }, 2);
  // barella: telo arancione tra due aste
  const st = new THREE.Group();
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 0.52), new THREE.MeshLambertMaterial({ color: 0xff7a2a }));
  st.add(cloth);
  for (const z of [-0.29, 0.29]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0xcfd6dc }));
    pole.rotation.z = Math.PI / 2; pole.position.z = z; st.add(pole);
  }
  st.traverse(m => { if (m.isMesh) m.castShadow = true; });
  this.scene.add(st);
  o.medics = { a: a, b: b, st: st, pm: pm, x: start.x, z: start.z, home: start, phase: 0, state: 'wait', t: 0 };
};
Renderer.prototype.removeMedics = function () {
  const m = this.officials.medics;
  this.disposePlayerMesh(m.a); this.disposePlayerMesh(m.b);
  this.scene.remove(m.st);
  m.st.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  this.officials.medics = null;
};
Renderer.prototype.updateMedics = function (dt) {
  const M = this.officials.medics;
  if (!M) return;
  M.t += dt;
  const p = M.pm.player;
  const px = p.rx !== undefined ? p.rx : p.x, pz = p.rz !== undefined ? p.rz : p.z;
  let tx = M.home.x, tz = M.home.z, speed = 0;
  if (M.state === 'wait' && M.t > 0.8) M.state = 'go';
  if (M.state === 'go') {
    // corrono verso il giocatore e si fermano accanto a lui (dal lato della linea laterale)
    tx = px; tz = pz + Math.sign(M.home.z) * 1.4;
    if (Math.hypot(tx - M.x, tz - M.z) < 0.4) { M.state = 'help'; M.t = 0; }
    if (!(M.pm.hurtT > 0)) M.state = 'back';    // si è già rialzato: tornano indietro
  } else if (M.state === 'help') {
    tx = M.x; tz = M.z;
    if (!(M.pm.hurtT > 0) || M.t > 3) { M.state = 'back'; M.pm.hurtT = Math.min(M.pm.hurtT || 0, 0.6); }
  }
  if (M.state === 'back' && Math.hypot(M.home.x - M.x, M.home.z - M.z) < 0.5) { this.removeMedics(); return; }
  const dx = tx - M.x, dz = tz - M.z, d = Math.hypot(dx, dz);
  if (M.state === 'go' || M.state === 'back') {
    speed = Math.min(M.state === 'go' ? 6.5 : 4.5, d * 2);
    if (d > 0.01) { M.x += dx / d * speed * dt; M.z += dz / d * speed * dt; }
  }
  // la barella si porta di lato, parallela alla linea laterale: un barelliere davanti e uno dietro
  const f = speed > 0.2 ? Math.atan2(dz, dx) : Math.atan2(pz - M.z, px - M.x);
  M.phase += speed * dt * 1.9;
  const kneel = M.state === 'help' ? 1 : 0;
  const ax = M.x - 1.25, bx2 = M.x + 1.25;
  this.poseMesh(M.a, ax, M.z, speed > 0.2 ? f : 0, M.phase, speed, 0, 0, null);
  this.poseMesh(M.b, bx2, M.z, speed > 0.2 ? f : Math.PI, M.phase + Math.PI, speed, 0, 0, null);
  for (const fig of [M.a, M.b]) {
    // braccia giù a tenere le aste; accanto al giocatore si inginocchiano
    fig.arms[0].sh.rotation.x = -0.15; fig.arms[1].sh.rotation.x = 0.15;
    fig.arms[0].elbow.rotation.z = fig.arms[1].elbow.rotation.z = 0.25;
    if (kneel) {
      fig.body.position.y = -0.45;
      for (const L of fig.legs) { L.hip.rotation.z = 0.9; L.knee.rotation.z = -1.9; }
      fig.chest.rotation.z = -0.35;
    }
  }
  M.st.position.set(M.x, kneel ? 0.12 : 0.72, M.z);
  M.st.rotation.y = 0;
};

// ---- pose del giocatore a terra e zoppia (dopo poseMesh) ----
Renderer.prototype.poseHurt = function (pm, dt, speed, ph) {
  if (pm.hurtT > 0) pm.hurtT -= dt;
  if (pm.limpT > 0) pm.limpT -= dt;
  // a terra solo finché è quasi fermo: se la partita lo fa muovere (ripresa del gioco) si rialza
  const want = pm.hurtT > 0 && speed < 1.6 ? 1 : 0;
  pm.hurtAmt = (pm.hurtAmt || 0) + (want - (pm.hurtAmt || 0)) * Math.min(1, dt * (want ? 3 : 2.2));
  const k = pm.hurtAmt * pm.hurtAmt * (3 - 2 * pm.hurtAmt);
  const L0 = pm.legs[0], L1 = pm.legs[1], A0 = pm.arms[0], A1 = pm.arms[1];
  const mix = (v, to) => v + (to - v) * k;
  if (k > 0.01) {
    // sdraiato sulla schiena, il ginocchio piegato verso il petto, le mani sulla gamba, si dondola
    const t = pm.t || 0;
    pm.body.rotation.z = mix(pm.body.rotation.z, 1.42);
    pm.body.rotation.x = mix(pm.body.rotation.x, Math.sin(t * 2.6) * 0.16);
    pm.body.position.y = mix(pm.body.position.y, 0.13);
    L1.hip.rotation.z = mix(L1.hip.rotation.z, 1.35 + Math.sin(t * 2.6) * 0.1); L1.knee.rotation.z = mix(L1.knee.rotation.z, -2.05);
    L0.hip.rotation.z = mix(L0.hip.rotation.z, 0.2); L0.knee.rotation.z = mix(L0.knee.rotation.z, -0.25);
    A0.sh.rotation.z = mix(A0.sh.rotation.z, 1.25); A1.sh.rotation.z = mix(A1.sh.rotation.z, 1.25);
    A0.sh.rotation.x = mix(A0.sh.rotation.x, 0.15); A1.sh.rotation.x = mix(A1.sh.rotation.x, -0.15);
    A0.elbow.rotation.z = mix(A0.elbow.rotation.z, 0.7); A1.elbow.rotation.z = mix(A1.elbow.rotation.z, 0.7);
    pm.chest.rotation.z = mix(pm.chest.rotation.z, -0.35);
    pm.neck.rotation.z = mix(pm.neck.rotation.z, -0.5);
  }
  // zoppica: passo corto con la gamba dolorante, il corpo che si abbassa quando ci si appoggia sopra
  if (pm.limpT > 0 && k < 0.5 && speed > 0.4) {
    const fade = Math.min(1, pm.limpT / 4) * (1 - k * 2);
    L1.hip.rotation.z *= 1 - 0.45 * fade; L1.knee.rotation.z *= 1 - 0.5 * fade;
    pm.body.position.y -= Math.max(0, Math.sin(ph)) * 0.045 * fade;
    pm.pelvis.rotation.x += Math.sin(ph) * 0.07 * fade;
    pm.chest.rotation.x -= Math.sin(ph) * 0.08 * fade;
  }
};

// ---- arbitro: un fotogramma ----
Renderer.prototype.updateOfficials = function (m, dt, bx, bz) {
  const o = this.officials;
  if (!o) return;
  const ref = o.ref;
  const show = !m.training;
  ref.root.visible = show;
  this.updateMedics(dt);
  this.updateCardIcons(dt);
  if (!show) return;
  // dove vuole andare
  let tx, tz, look = Math.atan2(bz - o.z, bx - o.x), maxSp = OFFICIALS.REF_SPEED;
  const task = o.tasks[0];
  if (task && !task.p.gone) {
    // cartellino: va dal giocatore (si ferma un paio di metri prima) e lo alza
    task.t += dt;
    const px = task.p.rx !== undefined ? task.p.rx : task.p.x, pz = task.p.rz !== undefined ? task.p.rz : task.p.z;
    const d = Math.hypot(px - o.x, pz - o.z) || 1;
    tx = px - (px - o.x) / d * 2.2; tz = pz - (pz - o.z) / d * 2.2;
    look = Math.atan2(pz - o.z, px - o.x);
    maxSp = 8;
    if (!task.shown && (d < 4 || task.t > 1.4)) { task.shown = OFFICIALS.CARD_SECS; this.addCardIcon(task.p, task.red); }
    if (task.shown) { task.shown -= dt; tx = o.x; tz = o.z; if (task.shown <= 0) o.tasks.shift(); }   // fermo mentre lo mostra
  } else {
    if (task) o.tasks.shift();
    if (m.so) { tx = CONFIG.HALF_L - 15; tz = -7; look = 0; }
    else if (o.rush && o.rush.t > 0) { o.rush.t -= dt; tx = o.rush.x - 5; tz = o.rush.z - 6; }
    else {
      // segue l'azione in diagonale, a una quindicina di metri, senza uscire dal campo
      tx = bx * 0.85 - Math.sign(bx || 1) * 6; tz = bz * 0.55 - 11;
    }
    tx = clamp(tx, -CONFIG.HALF_L + 4, CONFIG.HALF_L - 4); tz = clamp(tz, -CONFIG.HALF_W + 2, CONFIG.HALF_W - 2);
  }
  // corsa morbida: accelera e frena come un giocatore
  const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
  const wantSp = d < 0.6 ? 0 : Math.min(maxSp, d * 0.9);
  const wvx = d > 0.01 ? dx / d * wantSp : 0, wvz = d > 0.01 ? dz / d * wantSp : 0;
  const a = Math.min(1, dt * 2.5);
  o.vx += (wvx - o.vx) * a; o.vz += (wvz - o.vz) * a;
  o.x += o.vx * dt; o.z += o.vz * dt;
  const sp = Math.hypot(o.vx, o.vz);
  // di corsa guarda dove va, da fermo guarda il gioco
  const moveF = Math.atan2(o.vz, o.vx);
  let face = sp > 2.5 ? moveF : look;
  if (o.point && o.point.t > 0) { o.point.t -= dt; face = o.point.dir * Math.PI / 2; }
  o.facing += angleDiff(o.facing, face) * Math.min(1, dt * 6);
  o.phase += sp * dt * 1.9;
  this.poseMesh(ref, o.x, o.z, o.facing, o.phase, sp, 0, 0, { vx: o.vx, vz: o.vz, bx: bx, bz: bz });
  // braccio teso: indica la punizione (braccio sinistro, girato verso l'attacco)
  if (o.point && o.point.t > 0) {
    const k = Math.min(1, o.point.t / 0.3, (1.3 - o.point.t) / 0.2);
    ref.arms[0].sh.rotation.x = -1.45 * k; ref.arms[0].elbow.rotation.z = 0.05;
  }
  // cartellino alzato sopra la testa
  const up = task && task.shown > 0 ? Math.min(1, (OFFICIALS.CARD_SECS - task.shown) / 0.2, task.shown / 0.25) : 0;
  o.card.visible = up > 0.3;
  if (up > 0) {
    o.card.material.color.set(task.red ? 0xe0262f : 0xffd23a);
    ref.arms[1].sh.rotation.x = 2.95 * up; ref.arms[1].sh.rotation.z = 0.15 * up; ref.arms[1].elbow.rotation.z = 0.05;
  }
};

// cartellino sopra la testa del giocatore ammonito o espulso, sempre girato verso la telecamera
Renderer.prototype.addCardIcon = function (p, red) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.6), new THREE.MeshBasicMaterial({ color: red ? 0xe0262f : 0xffd23a, depthTest: false, transparent: true }));
  mesh.renderOrder = 12;
  this.scene.add(mesh);
  this.officials.icons.push({ mesh: mesh, p: p, t: 2.6 });
};
Renderer.prototype.updateCardIcons = function (dt) {
  const list = this.officials.icons;
  for (let i = list.length - 1; i >= 0; i--) {
    const ic = list[i];
    ic.t -= dt;
    if (ic.t <= 0) { this.scene.remove(ic.mesh); ic.mesh.geometry.dispose(); ic.mesh.material.dispose(); list.splice(i, 1); continue; }
    const p = ic.p, x = p.rx !== undefined ? p.rx : p.x, z = p.rz !== undefined ? p.rz : p.z;
    ic.mesh.position.set(x, 2.55 + Math.sin(ic.t * 4) * 0.05, z);
    ic.mesh.quaternion.copy(this.camera.quaternion);
    ic.mesh.rotation.z += 0.12;
    ic.mesh.material.opacity = Math.min(1, ic.t / 0.4, (2.6 - ic.t) / 0.15);
  }
};
