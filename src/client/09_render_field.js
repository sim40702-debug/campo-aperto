// ============================================================
// CAMPO, TELECAMERA ED EFFETTI (0.24)
// - Linee del campo vere (geometria): prima erano disegnate nella texture del prato e da vicino diventavano sfocate;
//   ora sono strisce sottili (12 cm) appena sopra l'erba, nitide a ogni distanza e a ogni qualità, che ricevono le
//   ombre dei giocatori. Tutte insieme sono un solo oggetto (un solo disegno per la scheda grafica).
// - Telecamera televisiva cinematografica: guarda un po' avanti nella direzione in cui va il pallone (anticipa
//   l'azione), e vicino alle aree si abbassa e si avvicina un poco; tutto con movimenti morbidi.
// - Effetti discreti: palo (sbuffo bianco e un piccolo scossone) e parata in tuffo (zolle d'erba).
// ============================================================
Renderer.prototype.buildFieldLines = function () {
  const C = CONFIG, LW = 0.12, Y = 0.008, verts = [];
  // segmento dritto da (x1,z1) a (x2,z2)
  const seg = (x1, z1, x2, z2) => {
    const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1, nx = -dz / l * LW / 2, nz = dx / l * LW / 2;
    verts.push(x1 + nx, Y, z1 + nz, x2 + nx, Y, z2 + nz, x2 - nx, Y, z2 - nz, x1 + nx, Y, z1 + nz, x2 - nx, Y, z2 - nz, x1 - nx, Y, z1 - nz);
  };
  // arco di cerchio (centro, raggio, angoli in radianti) fatto di tanti piccoli trapezi
  const arc = (cx, cz, r, a0, a1, n) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
      const ri = r - LW / 2, ro = r + LW / 2;
      const p = (rr, t) => [cx + Math.cos(t) * rr, cz + Math.sin(t) * rr];
      const [ax, az] = p(ri, t0), [bx, bz] = p(ro, t0), [cx2, cz2] = p(ro, t1), [dx, dz] = p(ri, t1);
      verts.push(ax, Y, az, cx2, Y, cz2, bx, Y, bz, ax, Y, az, dx, Y, dz, cx2, Y, cz2);
    }
  };
  const disc = (cx, cz, r) => arc(cx, cz, r / 2, 0, Math.PI * 2, 16);   // dischetto: un anello pieno
  const L = C.HALF_L, W = C.HALF_W;
  seg(-L, -W, L, -W); seg(-L, W, L, W); seg(-L, -W, -L, W); seg(L, -W, L, W); seg(0, -W, 0, W);
  arc(0, 0, C.CENTER_R, 0, Math.PI * 2, 96);
  disc(0, 0, 0.25);
  for (const s of [-1, 1]) {
    const gx = s * L, bx = gx - s * C.BOX_DEPTH, sbx = gx - s * C.SMALL_BOX_DEPTH;
    seg(bx, -C.BOX_HALF_W, bx, C.BOX_HALF_W); seg(gx, -C.BOX_HALF_W, bx, -C.BOX_HALF_W); seg(gx, C.BOX_HALF_W, bx, C.BOX_HALF_W);
    seg(sbx, -C.SMALL_BOX_HALF_W, sbx, C.SMALL_BOX_HALF_W); seg(gx, -C.SMALL_BOX_HALF_W, sbx, -C.SMALL_BOX_HALF_W); seg(gx, C.SMALL_BOX_HALF_W, sbx, C.SMALL_BOX_HALF_W);
    const px = gx - s * C.PENALTY_SPOT;
    disc(px, 0, 0.22);
    // lunetta dell'area: la parte del cerchio fuori dall'area
    const a = Math.acos((C.BOX_DEPTH - C.PENALTY_SPOT) / C.CENTER_R);
    if (s > 0) arc(px, 0, C.CENTER_R, Math.PI - a, Math.PI + a, 24); else arc(px, 0, C.CENTER_R, -a, a, 24);
    // archi d'angolo
    arc(gx, -W, 1, s > 0 ? Math.PI / 2 : 0, s > 0 ? Math.PI : Math.PI / 2, 8);
    arc(gx, W, 1, s > 0 ? Math.PI : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : 0, 8);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: '#f4f6ef', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const lines = this.fieldLines = new THREE.Mesh(geo, mat);
  lines.receiveShadow = true;
  lines.name = 'linee';
  this.scene.add(lines);
};

// telecamera televisiva (camMode 0) con anticipo e avvicinamento vicino alle aree; scrive in want e look
Renderer.prototype.tvCamera = function (dt, bx, bz, match, want, look) {
  const b = match && match.ball, S = this._tv || (this._tv = { lx: 0, lz: 0, near: 0 });
  // anticipo: dove sta andando il pallone (con la palla al piede conta la corsa di chi la porta)
  const v = b && b.owner ? { x: b.owner.vx || 0, z: b.owner.vz || 0 } : { x: (b && b.vx) || 0, z: (b && b.vz) || 0 };
  const k = 1 - Math.exp(-1.6 * dt);   // lento: un passaggio non fa scattare l'inquadratura
  S.lx += (clamp(v.x * 0.32, -7, 7) - S.lx) * k;
  S.lz += (clamp(v.z * 0.2, -4, 4) - S.lz) * k;
  // vicino alle aree la telecamera si abbassa e si avvicina un poco (più dramma davanti alla porta)
  const near = clamp((Math.abs(bx) - 30) / 16, 0, 1);
  S.near += (near * near * (3 - 2 * near) - S.near) * (1 - Math.exp(-1.2 * dt));
  const fx = bx + S.lx, fz = bz + S.lz;
  // più bassa (0.25.4): circa 20 gradi sopra il campo, come la telecamera principale delle partite in TV
  want.set(fx * 0.84, 14.5 - 2.0 * S.near, fz * 0.32 + 41 - 4.5 * S.near);
  look.set(fx * 0.9, 0.4 + 0.3 * S.near, fz * 0.6 + 2);
  // teleobiettivo come le telecamere TV vere (0.25.4): campo visivo più stretto (TV_FOV) e telecamera più lontana in
  // tribuna, stessa inquadratura: la prospettiva si appiattisce e il campo non sembra visto dall'alto
  const k2 = Math.tan(CAM_FOV * Math.PI / 360) / Math.tan(TV_FOV * Math.PI / 360);
  want.sub(look).multiplyScalar(k2).add(look);
};
const CAM_FOV = 38, TV_FOV = 30;   // campo visivo (gradi): normale e della telecamera televisiva
// cambia il campo visivo piano (k = quanto in fretta, 1 = subito)
Renderer.prototype.applyFov = function (fov, dt) {
  const c = this.camera;
  if (Math.abs(c.fov - fov) < 0.01) return;
  c.fov += (fov - c.fov) * (this._cut || dt >= 1 ? 1 : Math.min(1, dt * 3));
  c.updateProjectionMatrix();
};

// effetti discreti
// palo o traversa (0.25.3): sbuffo, la porta vibra un attimo (pochi millimetri o un paio di centimetri secondo la
// forza del colpo, 13 volte al secondo, si spegne in mezzo secondo) e la vibrazione passa alla rete, che trema
// vicino al punto colpito. e: evento (x, z del pallone, y, power = forza del colpo)
Renderer.prototype.onPost = function (shake, bar, e) {
  const p = this.ballMesh.position;
  this.burst('dust', p.x, p.z, { amount: 0.35 });
  if (shake !== false) this.shake = Math.max(this.shake || 0, 0.12);
  const ex = e && Number.isFinite(e.x) ? e.x : p.x, ez = e && Number.isFinite(e.z) ? e.z : p.z, ey = e && Number.isFinite(e.y) ? e.y : p.y;
  const side = Math.sign(ex) || 1, v = clamp(((e && e.power) || 12) / 25, 0.15, 1.2);
  this.woodShake = { side: side, t: 0, amp: 0.02 * v, bar: !!bar };
  // la rete legata al legno trema: spinta ai nodi vicini al punto colpito
  const net = this.nets && this.nets.find(n => n.side === side);
  if (!net) return;
  for (let i = 0; i < net.n; i++) {
    if (net.pin[i]) continue;
    const o = i * 3, dx = net.rest[o] - ex, dy = net.rest[o + 1] - ey, dz = net.rest[o + 2] - ez, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 2.5) continue;
    const k = 1.6 * v * Math.exp(-d2 / 0.6);
    net.v[o] += side * k; net.v[o + 1] += (bar ? 1 : 0.3) * k; net.v[o + 2] -= Math.sign(ez) * 0.4 * k;
  }
  net.awake = true;
};
// vibrazione della porta dopo un colpo sul legno (ogni fotogramma)
Renderer.prototype.updateWoodShake = function (dt) {
  const W = this.woodShake, g = W && this.goalGroups && this.goalGroups[W.side];
  if (!g) return;
  W.t += dt;
  const a = W.amp * Math.exp(-7 * W.t) * Math.sin(W.t * 2 * Math.PI * 13);
  g.position.set(W.bar ? 0 : a * W.side, W.bar ? a : 0, W.bar ? 0 : a * 0.5);
  if (W.t > 0.8) { g.position.set(0, 0, 0); this.woodShake = null; }
  // la rete è appesa al telaio: si sposta con lui
  const net = this.nets && this.nets.find(n => n.side === W.side);
  if (net) { net.lines.position.copy(g.position); if (net.threads) net.threads.position.copy(g.position); }
};
