// ============================================================
// STADIO VIVO — bandiere, sciarpe e flash dei fotografi (solo grafica)
// - bandiere con i colori delle due squadre piantate tra il pubblico: sventolano sempre, di più quando il pubblico si
//   scalda (palla vicino alle porte, gol);
// - sciarpe tese sopra le teste: si alzano e ondeggiano quando il pubblico si scalda;
// - flash dei fotografi: dopo un gol (e un po' sui tiri) lampi bianchi tra il pubblico e dietro le porte.
// Con la qualità "bassa" niente bandiere e sciarpe (solo i flash, pochi).
// ============================================================
// tribune: [asse, lato, distanza davanti, distanza dietro, altezza davanti, altezza dietro, lunghezza] (come buildStadium)
const STANDS = [['z', 1, 44, 70, 1.6, 24, 132], ['z', -1, 44, 66, 1.6, 20, 132], ['x', 1, 62, 82, 1.6, 17, 92], ['x', -1, 62, 82, 1.6, 17, 92]];
const FLAGS_PER_STAND = 9, SCARVES = 240, FLASHES = 90;

// un punto sulla tribuna: f = quanto in alto (0 davanti, 1 in fondo), s = dove lungo la tribuna (-1..1)
function standPoint(st, f, s) {
  const [axis, sign, d0, d1, h0, h1, len] = st;
  const d = d0 + (d1 - d0) * f, y = h0 + (h1 - h0) * f, along = s * len / 2 * 0.92;
  return axis === 'z' ? { x: along, y: y, z: sign * d, face: sign > 0 ? Math.PI : 0 } : { x: sign * d, y: y, z: along, face: sign > 0 ? -Math.PI / 2 : Math.PI / 2 };
}

// stoffa a strisce con i colori della squadra
function flagTexture(c1, c2, stripes) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
  const g = cv.getContext('2d');
  for (let i = 0; i < stripes; i++) { g.fillStyle = i % 2 ? c2 : c1; g.fillRect(i * 64 / stripes, 0, 64 / stripes + 1, 32); }
  const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
  return t;
}

Renderer.prototype.setupStadiumLife = function (match) {
  this.clearStadiumLife();
  const life = this.life = { flags: [], t: 0, flash: 0, group: new THREE.Group() };
  this.scene.add(life.group);
  const kits = match && match.teams ? match.teams.map(t => t.kit) : [['#c8202f', '#ffffff'], ['#1e56c8', '#ffffff']];
  const rnd = makeRng(7);
  if (this.Q.crowd) {
    // ---- bandiere su un'asta, sopra il pubblico
    const mats = kits.map((k, i) => new THREE.MeshLambertMaterial({ map: flagTexture(k[0], k[1] === k[0] ? '#ffffff' : k[1], i ? 2 : 3), side: THREE.DoubleSide }));
    const poleMat = new THREE.MeshLambertMaterial({ color: '#cfd6dc' });
    life.mats = mats.concat([poleMat]);
    STANDS.forEach((st, si) => {
      for (let i = 0; i < FLAGS_PER_STAND; i++) {
        const team = (si + i) % 2;
        const p = standPoint(st, 0.15 + rnd() * 0.6, (i + 0.5) / FLAGS_PER_STAND * 2 - 1 + (rnd() - 0.5) * 0.1);
        const holder = new THREE.Group();
        holder.position.set(p.x, p.y, p.z); holder.rotation.y = p.face + (rnd() - 0.5) * 0.6;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 5), poleMat);
        pole.position.y = 2.3; holder.add(pole);
        const geo = new THREE.PlaneGeometry(3.4, 2.1, 10, 3);
        geo.translate(1.7, 3.5, 0);
        const cloth = new THREE.Mesh(geo, mats[team]);
        holder.add(cloth);
        life.group.add(holder);
        life.flags.push({ geo: geo, base: Float32Array.from(geo.attributes.position.array), seed: rnd() * 10, speed: 2.2 + rnd() * 1.4 });
      }
    });
    // ---- sciarpe tese sopra le teste (tante, con i colori delle squadre)
    const sg = new THREE.BoxGeometry(2.2, 0.42, 0.05);
    const sm = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const sc = new THREE.InstancedMesh(sg, sm, SCARVES);
    sc.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    life.scarves = sc; life.scarfData = [];
    const col = new THREE.Color();
    for (let i = 0; i < SCARVES; i++) {
      const st = STANDS[i % 4];
      const p = standPoint(st, 0.05 + rnd() * 0.85, rnd() * 2 - 1);
      const team = rnd() < 0.5 ? 0 : 1, k = kits[team];
      col.set(rnd() < 0.6 ? k[0] : (k[1] === k[0] ? '#ffffff' : k[1]));
      sc.setColorAt(i, col);
      life.scarfData.push({ x: p.x, y: p.y + 1.3, z: p.z, face: p.face, seed: rnd() * 6.28 });
    }
    if (sc.instanceColor) sc.instanceColor.needsUpdate = true;
    life.group.add(sc);
    life.mats.push(sm);
    life.geos = [sg];
  }
  // ---- flash dei fotografi: punti bianchi che si accendono e si spengono
  const n = this.Q.crowd ? FLASHES : 25;
  const pos = new Float32Array(n * 3);
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // lampo tondo e sfumato (senza texture i punti sarebbero quadrati bianchi)
  const fm = new THREE.PointsMaterial({ color: 0xffffff, size: 3.2, map: this.glowTexture(), sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(fg, fm);
  pts.frustumCulled = false; pts.visible = false;
  life.flashPts = pts; life.flashPos = pos; life.flashN = n;
  life.group.add(pts);
};

Renderer.prototype.clearStadiumLife = function () {
  const life = this.life;
  if (!life) return;
  this.scene.remove(life.group);
  life.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  for (const m of life.mats || []) { if (m.map) m.map.dispose(); m.dispose(); }
  if (life.flashPts) life.flashPts.material.dispose();
  this.life = null;
};

// lampi: secs di flash (gol 2,5 s, tiro 0,5 s)
Renderer.prototype.cameraFlashes = function (secs) { if (this.life) this.life.flash = Math.max(this.life.flash, secs); };

Renderer.prototype.updateStadiumLife = function (dt) {
  const life = this.life;
  if (!life) return;
  life.t += dt;
  const ex = this.crowdExcite || 0, t = life.t;
  // bandiere: onde lungo la stoffa, più forti con il pubblico caldo
  const amp = 0.12 + ex * 0.3;
  for (const f of life.flags) {
    const a = f.geo.attributes.position.array, b = f.base;
    for (let i = 0; i < a.length; i += 3) {
      const u = b[i] / 3.4;            // 0 vicino all'asta, 1 in fondo
      a[i + 2] = Math.sin(t * f.speed * (1 + ex) - u * 4 + f.seed) * amp * u + Math.sin(t * 1.3 + f.seed + b[i + 1]) * 0.04 * u;
      a[i + 1] = b[i + 1] - u * u * 0.12 * (1 - ex);   // con poco vento la punta cade un po'
    }
    f.geo.attributes.position.needsUpdate = true;
  }
  // sciarpe: si alzano e ondeggiano quando il pubblico si scalda
  if (life.scarves) {
    const m = this._scarfM || (this._scarfM = new THREE.Matrix4()), q = this._scarfQ || (this._scarfQ = new THREE.Quaternion()), e = this._scarfE || (this._scarfE = new THREE.Euler());
    const v = this._scarfV || (this._scarfV = new THREE.Vector3()), one = this._scarfS || (this._scarfS = new THREE.Vector3(1, 1, 1));
    const lift = 0.15 + ex * 0.9;
    life.scarfData.forEach((s, i) => {
      v.set(s.x, s.y - 0.6 + lift + Math.sin(t * (3 + ex * 5) + s.seed) * 0.12 * (0.3 + ex), s.z);
      e.set(0, s.face, Math.sin(t * 2.4 + s.seed) * 0.25 * (0.3 + ex));
      q.setFromEuler(e); m.compose(v, q, one);
      life.scarves.setMatrixAt(i, m);
    });
    life.scarves.instanceMatrix.needsUpdate = true;
  }
  // flash: ogni fotogramma si accende qualche lampo in un punto a caso delle tribune o dietro le porte
  const pts = life.flashPts;
  if (life.flash > 0) {
    life.flash -= dt;
    pts.visible = true;
    const p = life.flashPos;
    for (let i = 0; i < life.flashN; i++) {
      if (Math.random() < 0.4) { p[i * 3 + 1] = -100; continue; }   // spento (sotto il campo)
      const behind = Math.random() < 0.3;
      if (behind) {
        // fotografi a bordo campo dietro le porte
        const side = Math.random() < 0.5 ? 1 : -1;
        p[i * 3] = side * (CONFIG.HALF_L + 3 + Math.random() * 2); p[i * 3 + 1] = 0.6 + Math.random() * 0.5; p[i * 3 + 2] = (Math.random() - 0.5) * 30;
      } else {
        const sp = standPoint(STANDS[Math.floor(Math.random() * 4)], Math.random(), Math.random() * 2 - 1);
        p[i * 3] = sp.x; p[i * 3 + 1] = sp.y + 1.4; p[i * 3 + 2] = sp.z;
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
    pts.material.opacity = 0.6 + Math.random() * 0.4;
  } else pts.visible = false;
};
