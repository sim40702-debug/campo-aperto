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
  want.set(fx * 0.84, 19.5 - 2.6 * S.near, fz * 0.32 + 41 - 4.5 * S.near);
  look.set(fx * 0.9, 0.4 + 0.3 * S.near, fz * 0.6 + 2);
};

// effetti discreti
Renderer.prototype.onPost = function () {
  const p = this.ballMesh.position;
  this.burst('dust', p.x, p.z, { amount: 0.35 });
  this.shake = Math.max(this.shake || 0, 0.12);
};
