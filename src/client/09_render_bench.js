// ============================================================
// PANCHINE, ALLENATORI E TUNNEL (0.24.8)
// Sul lato lontano del campo, davanti ai cartelloni: due panchine coperte (a sinistra quella della squadra di casa,
// a destra quella degli ospiti) con le riserve sedute nei colori della squadra, l'allenatore in piedi nell'area
// tecnica che segue il gioco, e il tunnel degli spogliatoi con la copertura (a sinistra: in mezzo c'è l'albero).
// Tutto fatto di forme semplici unite (un disegno per pezzo) e materiali condivisi: costa pochissimo.
// ============================================================
const BENCH_X = 11, BENCH_Z = -36.4, TUNNEL_X = -24;   // il tunnel non sta in mezzo: lì c'è l'albero di Natale

Renderer.prototype.buildBenches = function () {
  const g = this.benchGroup = new THREE.Group();
  const D = this.Q.detail, seg = n => Math.max(5, Math.round(n * D));
  const frame = new THREE.MeshStandardMaterial({ color: '#3a4350', roughness: 0.5, metalness: 0.4 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#cfe6ff', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#1d2733', roughness: 0.6 });
  const L = 7, Dp = 1.6, H = 2.1;
  this.benches = [];
  for (const side of [-1, 1]) {
    const b = new THREE.Group();
    b.position.set(side * BENCH_X, 0, BENCH_Z);
    // pedana, parete di fondo, montanti e tetto trasparente curvo (si vede chi c'è sotto)
    const base = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, Dp), frame); base.position.y = 0.06; b.add(base);
    const back = new THREE.Mesh(new THREE.BoxGeometry(L, H, 0.08), frame); back.position.set(0, H / 2, -Dp / 2); b.add(back);
    for (const sx of [-1, 1]) { const side2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, H, Dp), frame); side2.position.set(sx * L / 2, H / 2, 0); b.add(side2); }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(Dp * 1.1, Dp * 1.1, L, seg(14), 1, true, Math.PI * 1.02, Math.PI * 0.48), roofMat);
    roof.rotation.z = Math.PI / 2; roof.position.set(0, H - 0.9, -Dp * 0.45); b.add(roof);
    // seggiolini
    const seats = new THREE.Mesh(new THREE.BoxGeometry(L - 0.4, 0.45, 0.55), seatMat); seats.position.set(0, 0.35, -Dp / 2 + 0.38); b.add(seats);
    b.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(b);
    this.benches.push({ group: b, side: side, subs: null, coach: null });
  }
  // tunnel degli spogliatoi: apertura scura nella tribuna e copertura a soffietto fino ai cartelloni
  const tunnelMat = new THREE.MeshStandardMaterial({ color: '#e9edf2', roughness: 0.55, side: THREE.DoubleSide });
  const dark = new THREE.MeshBasicMaterial({ color: '#05080c' });
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.8), dark); mouth.position.set(TUNNEL_X, 1.4, -43.9); g.add(mouth);
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 5.2, seg(18), 1, true, -Math.PI / 2, Math.PI), tunnelMat);
  cover.rotation.x = Math.PI / 2; cover.rotation.z = Math.PI; cover.position.set(TUNNEL_X, 0.4, -41.3); cover.castShadow = true; g.add(cover);
  // anelli della copertura
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.32, 0.05, 6, seg(18), Math.PI), frame);
    ring.position.set(TUNNEL_X, 0.4, -43.7 + i * 1.7); g.add(ring);
  }
  this.scene.add(g);
};

// riserve e allenatori con i colori delle squadre della partita
Renderer.prototype.setupBenches = function (match) {
  if (!this.benches) return;
  const mat = this.benchPeopleMat || (this.benchPeopleMat = new THREE.MeshLambertMaterial({ vertexColors: true }));
  for (const bn of this.benches) {
    for (const o of [bn.subs, bn.coach]) if (o) { bn.group.remove(o); o.geometry.dispose(); }
    bn.subs = bn.coach = null;
    if (!match || match.training) continue;   // in allenamento le panchine restano vuote
    const team = match.teams[bn.side < 0 ? 0 : 1], kit = team.kit, skin = ['#f1d3b8', '#c68c62', '#8a5a3c', '#e0b48f'];
    // 6 riserve sedute (pettorina sopra la maglia: il colore della squadra)
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const x = -2.6 + i * 1.04, s = skin[(i * 7 + bn.side + 4) % 4];
      parts.push({ geo: new THREE.BoxGeometry(0.34, 0.5, 0.26), color: kit[0], pos: [x, 0.86, -0.42] });
      parts.push({ geo: new THREE.BoxGeometry(0.36, 0.14, 0.5), color: kit[1], pos: [x, 0.62, -0.25] });
      parts.push({ geo: new THREE.BoxGeometry(0.3, 0.45, 0.14), color: kit[2], pos: [x, 0.36, 0.0] });
      parts.push({ geo: new THREE.SphereGeometry(0.12, 8, 6), color: s, pos: [x, 1.22, -0.42] });
    }
    bn.subs = new THREE.Mesh(this.mergeColored(parts), mat);
    bn.subs.castShadow = true;
    bn.group.add(bn.subs);
    // allenatore in piedi davanti alla panchina (giacca scura)
    const c = [
      { geo: new THREE.BoxGeometry(0.42, 0.7, 0.28), color: '#1c2430', pos: [0, 1.25, 0] },
      { geo: new THREE.BoxGeometry(0.34, 0.85, 0.24), color: '#2a2f38', pos: [0, 0.45, 0] },
      { geo: new THREE.SphereGeometry(0.13, 8, 6), color: skin[(bn.side + 5) % 4], pos: [0, 1.75, 0] },
    ];
    bn.coach = new THREE.Mesh(this.mergeColored(c), mat);
    bn.coach.position.set(-bn.side * 1.5, 0, 2.2);
    bn.coach.castShadow = true;
    bn.group.add(bn.coach);
  }
};

// l'allenatore segue il gioco: si gira verso il pallone e si sposta un po' nell'area tecnica
Renderer.prototype.updateBenches = function (dt, bx, bz) {
  if (!this.benches) return;
  for (const bn of this.benches) {
    const c = bn.coach;
    if (!c) continue;
    const wx = bn.side * BENCH_X + c.position.x, wz = BENCH_Z + c.position.z;
    const want = clamp((bx - bn.side * BENCH_X) * 0.06, -1.8, 1.8) - bn.side * 0.6;
    c.position.x += (want - c.position.x) * Math.min(1, dt * 0.8);
    c.rotation.y = Math.atan2(bx - wx, bz - wz);
  }
};
