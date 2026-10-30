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
        // niente bandiere davanti alla telecamera televisiva (tribuna principale, al centro): coprirebbero il campo
        if (p.z > 46 && Math.abs(p.x) < 34) continue;
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
    this.buildFans(life, kits, rnd);   // tifosi in 3D nelle prime file (0.22)
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

// ---------- tifosi in 3D nelle prime file (0.22) ----------
// Le file davanti (quelle che si vedono di più con la telecamera televisiva) hanno tifosi veri e propri: busto con
// giacca o maglia della squadra, braccia, testa e, a Natale, uno su tre con il cappello di Babbo Natale. Dietro resta
// il pubblico disegnato. Sono tre disegni in tutto (corpi, teste, cappelli): ogni tifoso salta e alza le braccia
// nella scheda grafica, con un ritmo suo, di più quando il pubblico si scalda (palla vicina alla porta, gol).
const FAN_SPACING = 0.62;
const FAN_WINTER = ['#2b2f38', '#3a3f4a', '#5a2a2a', '#2a3a55', '#1f1f22', '#4a4038', '#6b6f76', '#7a1f2b', '#22423a'];
Renderer.prototype.buildFans = function (life, kits, rnd) {
  // file di tifosi in 3D: più file con la grafica più alta (Media 4, Alta 6, Ultra 8)
  const rows = this.Q.detail >= 1.6 ? 8 : this.Q.detail >= 1.3 ? 6 : 4;
  // geometria di un tifoso (in piedi sul gradino, guarda verso +z prima della rotazione)
  const box = (w, h, d, y) => new THREE.BoxGeometry(w, h, d).translate(0, y, 0);
  const merge = (geos, armFlags) => {
    const parts = geos.map(g => g.toNonIndexed());
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), arm = new Float32Array(n);
    let k = 0;
    parts.forEach((g, i) => {
      pos.set(g.attributes.position.array, k * 3); nor.set(g.attributes.normal.array, k * 3);
      if (armFlags && armFlags[i]) arm.fill(1, k, k + g.attributes.position.count);
      k += g.attributes.position.count; g.dispose();
    });
    for (const g of geos) g.dispose();
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('aArm', new THREE.BufferAttribute(arm, 1));
    return out;
  };
  // busto un po' a botte (giacca), spalle, due braccia (alzate: si piegano giù nello shader quando il pubblico è calmo)
  const bodyGeo = merge([box(0.42, 0.55, 0.26, 0.6), box(0.48, 0.14, 0.28, 0.85), box(0.11, 0.48, 0.11, 1.12).translate(-0.2, 0, 0), box(0.11, 0.48, 0.11, 1.12).translate(0.2, 0, 0)], [0, 0, 1, 1]);
  const headGeo = merge([new THREE.SphereGeometry(0.115, 7, 5).scale(1, 1.12, 1).translate(0, 1.06, 0)]);
  const hatGeo = merge([new THREE.CylinderGeometry(0.122, 0.122, 0.06, 8).translate(0, 1.16, 0), new THREE.ConeGeometry(0.1, 0.24, 8).translate(0, 1.3, -0.02)]);
  // posti: le prime file di ogni tribuna
  const seats = [];
  STANDS.forEach(st => {
    const [, , , , , , len] = st;
    const per = Math.floor(len * 0.92 / FAN_SPACING);
    for (let r = 0; r < rows; r++) {
      const f = 0.018 + r * 0.028;
      for (let i = 0; i < per; i++) {
        if (rnd() < 0.1) continue;   // qualche posto vuoto
        const p = standPoint(st, f, ((i + 0.5) / per) * 2 - 1 + (rnd() - 0.5) * 0.004);
        seats.push({ x: p.x, y: p.y - 0.05, z: p.z, face: p.face + (rnd() - 0.5) * 0.5, s: 0.92 + rnd() * 0.16 });
      }
    }
  });
  const n = seats.length;
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) phase[i] = rnd() * 100;
  bodyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  headGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  const uni = life.fanUniforms = { uTime: { value: 0 }, uExcite: { value: 0 } };
  const mat = (opts) => {
    const m = new THREE.MeshLambertMaterial(opts);
    m.onBeforeCompile = sh => {
      sh.uniforms.uTime = uni.uTime; sh.uniforms.uExcite = uni.uExcite;
      sh.vertexShader = 'uniform float uTime; uniform float uExcite; attribute float aPhase; attribute float aArm;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float fanUp = clamp(uExcite * 1.7 - fract(aPhase * 0.37) * 0.9, 0.0, 1.0);
        transformed.y = mix(transformed.y, 0.86 + (transformed.y - 0.86) * mix(-0.85, 1.0, fanUp), aArm);
        transformed.z += aArm * (1.0 - fanUp) * 0.08;
        transformed.y += max(0.0, sin(uTime * (4.5 + fract(aPhase) * 3.0) + aPhase * 6.283)) * (0.02 + uExcite * uExcite * 0.34);`);
    };
    life.mats.push(m);
    return m;
  };
  const bodies = new THREE.InstancedMesh(bodyGeo, mat({ color: '#ffffff' }), n);
  const heads = new THREE.InstancedMesh(headGeo, mat({ color: '#ffffff' }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const skins = ['#f1d3b8', '#e0b48f', '#c68c62', '#8d5a3c', '#6e4630'];
  const hatIdx = [];
  seats.forEach((st, i) => {
    e.set(0, st.face, 0); q.setFromEuler(e); m4.compose(v.set(st.x, st.y, st.z), q, sc.set(st.s, st.s, st.s));
    bodies.setMatrixAt(i, m4); heads.setMatrixAt(i, m4);
    // metà dei tifosi con i colori di una delle due squadre, gli altri con la giacca d'inverno
    const r = rnd();
    col.set(r < 0.28 ? kits[0][0] : r < 0.52 ? kits[1][0] : pick(FAN_WINTER));
    bodies.setColorAt(i, col);
    heads.setColorAt(i, col.set(skins[Math.floor(rnd() * skins.length)]));
    if (this.xmas && rnd() < 0.34) hatIdx.push(i);
  });
  for (const im of [bodies, heads]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; life.group.add(im); }
  life.geos.push(bodyGeo, headGeo);
  // cappelli di Babbo Natale: rosso con il risvolto bianco (colori nei vertici)
  if (hatIdx.length) {
    const cnt = hatGeo.attributes.position.count, c = new Float32Array(cnt * 3), red = new THREE.Color('#b80a22'), white = new THREE.Color('#f4f2ec');
    const brim = new THREE.CylinderGeometry(0.122, 0.122, 0.06, 8).toNonIndexed().attributes.position.count;
    for (let i = 0; i < cnt; i++) { const k = i < brim ? white : red; c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
    hatGeo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const hp = new Float32Array(hatIdx.length);
    hatIdx.forEach((i, k) => { hp[k] = phase[i]; });
    hatGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(hp, 1));
    const hats = new THREE.InstancedMesh(hatGeo, mat({ vertexColors: true }), hatIdx.length);
    hatIdx.forEach((i, k) => { const st = seats[i]; e.set(0, st.face, 0); q.setFromEuler(e); m4.compose(v.set(st.x, st.y, st.z), q, sc.set(st.s, st.s, st.s)); hats.setMatrixAt(k, m4); });
    hats.instanceMatrix.needsUpdate = true; hats.frustumCulled = false;
    life.group.add(hats);
  }
  life.geos.push(hatGeo);
  life.fans = n;
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
  if (life.fanUniforms) { life.fanUniforms.uTime.value = t; life.fanUniforms.uExcite.value = ex; }
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
