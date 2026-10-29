// ============================================================
// NATALE — stadio addobbato (solo grafica, 0.21)
// Quando il tema di Natale è acceso (Impostazioni → Generale → Tema di Natale, vedi src/game/36_natale.js):
// - alberi di Natale agli angoli del campo e tre davanti alla tribuna di fronte alle telecamere (si vedono
//   durante tutta la partita), con palline, lucine che brillano e la stella in cima;
// - luci colorate a festoni davanti alle tribune e sotto i tetti, neve sopra i tetti;
// - cartelloni di Natale (Buon Natale in quattro lingue e marchi inventati);
// - pallone natalizio, cappello di Babbo Natale in testa a tutti (calciatori, portieri, arbitro, barellieri);
// - fuochi d'artificio sopra lo stadio dopo ogni gol (e ogni tanto nel menu).
// La partita non cambia: motore, rete e server sono gli stessi, ognuno vede il tema sul suo computer.
// ============================================================
// colori delle lucine e delle palline
const XMAS_LIGHTS = ['#ff3b3b', '#ffd84a', '#3ba0ff', '#fff6e0', '#36e07a', '#ff7ad9'];
const XMAS_BAUBLES = ['#d81e2b', '#e8b923', '#2a6fdb', '#c9ccd4', '#7a2ad8'];
// alberi: [x, z, altezza, larghezza]. Agli angoli e tra i cartelloni e la tribuna lontana (quella che si vede
// con la telecamera televisiva): lì c'è poco spazio, quindi alberi più stretti
const XMAS_TREES = [[59, 41, 9, 0.38], [-59, 41, 9, 0.38], [59, -41, 9.5, 0.38], [-59, -41, 9.5, 0.38],
  [-30, -41.4, 8, 0.29], [0, -41.4, 9, 0.27], [30, -41.4, 8, 0.29]];
const XMAS_FIREWORKS = 1600;

Renderer.prototype.setChristmas = function (on) {
  on = !!on;
  if (on === !!this.xmas) return false;
  this.xmas = on;
  if (on) this.buildChristmas(); else this.clearChristmas();
  // cartelloni e pallone di Natale (o di nuovo quelli di sempre)
  const img = on ? this.xmasBoardCanvas() : this.adTex.image;
  for (const t of this.boards || []) { t.image = img; t.needsUpdate = true; }
  const bm = this.ballMesh.material;
  if (!this.ballTexNormal) this.ballTexNormal = bm.map;
  bm.map = on ? this.xmasBallTexture() : this.ballTexNormal;
  bm.needsUpdate = true;
  // tifosi con il cappello di Babbo Natale (un tifoso su tre), o di nuovo senza
  if (this.crowdCanvas) {
    const g = this.crowdCanvas.getContext('2d');
    g.putImageData(this.crowdPlain, 0, 0);
    if (on) this.crowdHeads.forEach(([x, y], i) => {
      if ((i * 7919) % 3) return;
      g.fillStyle = '#c40c24'; g.beginPath(); g.moveTo(x - 0.5, y + 1); g.lineTo(x + 4.5, y + 1); g.lineTo(x + 3, y - 3); g.fill();
      g.fillStyle = '#f4f2ec'; g.fillRect(x - 0.5, y + 0.5, 5, 1.2); g.fillRect(x + 2.5, y - 3.5, 1.4, 1.4);
    });
    for (const m of this.crowdMeshes) m.material.map.needsUpdate = true;
  }
  // i calciatori con (o senza) il cappello: si ricostruiscono i modelli della partita in corso
  if (this.match) this.setupMatch(this.match);
  return true;
};

// cappello di Babbo Natale: pezzi da aggiungere alla testa (H = altezza del centro della testa sul collo).
// La faccia guarda verso +x: il cappello si piega all'indietro e la punta con il pon pon cade dietro.
Renderer.prototype.xmasHatParts = function (H, seg) {
  const red = '#8c0618', white = '#f4f2ec';
  const base = [-0.012, H + 0.088];
  const a1 = 0.38, a2 = 1.15, l1 = 0.17, l2 = 0.15;
  const d1 = [-Math.sin(a1), Math.cos(a1)], d2 = [-Math.sin(a2), Math.cos(a2)];
  const top1 = [base[0] + d1[0] * l1, base[1] + d1[1] * l1];
  const tip = [top1[0] + d2[0] * l2, top1[1] + d2[1] * l2];
  return [
    // risvolto bianco
    { geo: new THREE.CylinderGeometry(0.128, 0.124, 0.05, seg(14)), color: white, pos: [base[0], base[1], 0], rot: [0, 0, a1 * 0.45], scale: [1.03, 1, 0.97] },
    // corpo rosso: tronco di cono, poi la punta piegata
    { geo: new THREE.CylinderGeometry(0.06, 0.116, l1, seg(12)), color: red, pos: [base[0] + d1[0] * l1 / 2, base[1] + d1[1] * l1 / 2, 0], rot: [0, 0, a1] },
    { geo: new THREE.ConeGeometry(0.06, l2, seg(10)), color: red, pos: [top1[0] + d2[0] * l2 / 2, top1[1] + d2[1] * l2 / 2, 0], rot: [0, 0, a2] },
    // pon pon
    { geo: new THREE.SphereGeometry(0.036, seg(7), seg(5)), color: white, pos: [tip[0], tip[1], 0] },
  ];
};

// ---------- addobbi ----------
Renderer.prototype.buildChristmas = function () {
  this.clearChristmas();
  const X = this.xmasDeco = { group: new THREE.Group(), lights: [], geos: [], mats: [], t: 0, twinkleT: 0, nextFw: 4 };
  this.scene.add(X.group);
  const D = this.Q.detail;
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  X.mats.push(treeMat);
  // lucine: tutte in un solo insieme di punti (posizione, colore di base e colore acceso)
  const lightPos = [], lightCol = [], lightPhase = [];
  const addLight = (x, y, z, c) => {
    lightPos.push(x, y, z);
    const col = new THREE.Color(c); lightCol.push(col.r, col.g, col.b);
    lightPhase.push(Math.random() * Math.PI * 2, 1.2 + Math.random() * 2.2);
  };
  const tree = (x, y, z, h, wide, lights) => {
    const parts = [];
    const r0 = h * wide;
    // tronco
    parts.push({ geo: new THREE.CylinderGeometry(h * 0.045, h * 0.06, h * 0.16, 7), color: '#5a3a22', pos: [x, y + h * 0.08, z] });
    // rami: coni uno sopra l'altro, sempre più piccoli
    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const f = i / layers, r = r0 * (1 - f * 0.78), lh = h * 0.3;
      const cy = y + h * 0.14 + f * h * 0.7 + lh / 2;
      const shade = ['#0d3a1c', '#104423', '#0b331a', '#134a27', '#0f3f20'][i];
      parts.push({ geo: new THREE.ConeGeometry(r, lh, Math.max(9, Math.round(14 * D))), color: shade, pos: [x, cy, z], rot: [0, i * 0.4, 0] });
      // neve sulla punta dei rami
      parts.push({ geo: new THREE.ConeGeometry(r * 0.42, lh * 0.22, 9), color: '#eef3f6', pos: [x, cy + lh * 0.39, z], rot: [0, i * 0.7, 0] });
    }
    // palline sui rami (sul bordo di ogni cono)
    const nb = 26;
    for (let i = 0; i < nb; i++) {
      const f = Math.random() * 0.92, a = Math.random() * Math.PI * 2;
      const hh = h * 0.16 + f * h * 0.78;
      const layerF = ((hh - h * 0.14) / (h * 0.7)) % (1 / layers);
      const rr = r0 * (1 - Math.min(1, (hh - h * 0.14) / (h * 0.86)) * 0.85) * (0.72 + layerF * 1.2);
      parts.push({ geo: new THREE.SphereGeometry(h * 0.022, 7, 5), color: pick(XMAS_BAUBLES), pos: [x + Math.cos(a) * rr, y + hh, z + Math.sin(a) * rr] });
    }
    const m = new THREE.Mesh(this.mergeColored(parts), treeMat);
    m.castShadow = true;
    X.group.add(m);
    // lucine a spirale attorno all'albero
    const turns = 5;
    for (let i = 0; i < lights; i++) {
      const u = i / lights, a = u * turns * Math.PI * 2;
      const hh = h * 0.18 + u * h * 0.74;
      const rr = r0 * (1 - u * 0.86) * 1.02 + 0.05;
      addLight(x + Math.cos(a) * rr, y + hh, z + Math.sin(a) * rr, XMAS_LIGHTS[i % XMAS_LIGHTS.length]);
    }
    // stella in cima, con il suo alone
    const star = new THREE.Mesh(this.xmasStarGeometry(h * 0.075), this.xmasStarMat || (this.xmasStarMat = new THREE.MeshBasicMaterial({ color: '#ffd84a', side: THREE.DoubleSide })));
    star.position.set(x, y + h * 0.99, z);
    X.group.add(star);
    X.stars = X.stars || []; X.stars.push(star);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: '#ffe48a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(h * 0.6, h * 0.6, 1); glow.position.copy(star.position);
    X.group.add(glow); X.mats.push(glow.material);
    X.glows = X.glows || []; X.glows.push(glow);
  };
  const nl = this.Q.crowd ? 1 : 0.6;
  for (const [x, z, h, wide] of XMAS_TREES) tree(x, 0, z, h, wide, Math.round(80 * nl));
  // ---- luci a festoni sotto il bordo dei tetti, e neve sopra i tetti
  const snowMat = new THREE.MeshLambertMaterial({ color: '#f2f6f8' });
  X.mats.push(snowMat);
  for (const st of STANDS) {
    const [axis, sign, d0, d1, , h1, len] = st;
    const roofDepth = (d1 - d0) * 0.75, front = d1 - roofDepth, y = h1 + 7 - 0.35;
    const L = len / 2;
    // neve: uno strato bianco sopra il tetto, un po' più stretto
    const sg = axis === 'z' ? new THREE.BoxGeometry(len - 0.6, 0.22, roofDepth - 0.4) : new THREE.BoxGeometry(roofDepth - 0.4, 0.22, len - 0.6);
    const snow = new THREE.Mesh(sg, snowMat);
    if (axis === 'z') snow.position.set(0, h1 + 7.4, sign * (d1 - roofDepth / 2)); else snow.position.set(sign * (d1 - roofDepth / 2), h1 + 7.4, 0);
    X.group.add(snow);
    // festoni: archi che scendono un po', una lucina ogni tanto. Sotto il tetto (archi di 8 m) e sul
    // parapetto davanti alla tribuna (archi di 4 m, sopra la testa dei fotografi): questi si vedono in partita
    const festoon = (dist, yTop, span, sag, step) => {
      let k = 0;
      for (let s = -L + 0.5; s < L - 0.5; s += step) {
        const u = ((s + L) % span) / span;
        const yy = yTop - Math.sin(u * Math.PI) * sag;
        const c = XMAS_LIGHTS[k++ % XMAS_LIGHTS.length];
        if (axis === 'z') addLight(s, yy, sign * dist, c); else addLight(sign * dist, yy, s, c);
      }
    };
    festoon(front - 0.15, y, 8, 1.2, this.Q.crowd ? 0.8 : 1.3);
    festoon(d0 - 0.3, st[4] + 0.15, 4, 0.55, this.Q.crowd ? 0.55 : 0.9);
  }
  // ---- le lucine: punti morbidi che si sommano alla luce (brillano anche di giorno, di più la sera)
  const n = lightPos.length / 3;
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
  X.lightBase = Float32Array.from(lightCol);
  X.lightPhase = Float32Array.from(lightPhase);
  lg.setAttribute('color', new THREE.Float32BufferAttribute(lightCol, 3));
  const lm = new THREE.PointsMaterial({ size: 1.15, map: this.glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(lg, lm);
  pts.frustumCulled = false;
  X.group.add(pts);
  X.lights = pts; X.lightN = n; X.mats.push(lm);
  // ---- fuochi d'artificio: un altro insieme di punti, acceso solo quando servono
  const fp = new Float32Array(XMAS_FIREWORKS * 3), fc = new Float32Array(XMAS_FIREWORKS * 3);
  for (let i = 0; i < XMAS_FIREWORKS; i++) fp[i * 3 + 1] = -100;
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  fg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
  const fm = new THREE.PointsMaterial({ size: 2.3, map: this.glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const fw = new THREE.Points(fg, fm);
  fw.frustumCulled = false;
  X.group.add(fw);
  X.fw = fw; X.fwPos = fp; X.fwCol = fc; X.sparks = []; X.rockets = []; X.mats.push(fm);
  this.applyChristmasLight();
};

Renderer.prototype.clearChristmas = function () {
  const X = this.xmasDeco;
  if (!X) return;
  this.scene.remove(X.group);
  X.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  for (const m of X.mats) m.dispose();
  this.xmasDeco = null;
};

// le lucine si vedono di più la sera e meno di giorno (chiamata anche quando cambia l'ora della partita)
Renderer.prototype.applyChristmasLight = function () {
  const X = this.xmasDeco;
  if (!X) return;
  const k = this.timeOfDay === 'day' ? 0.55 : this.timeOfDay === 'sunset' ? 0.8 : 1;
  X.lights.material.opacity = k;
  for (const g of X.glows) g.material.opacity = 0.35 + k * 0.6;
};

// stella a cinque punte, piatta (si gira piano su sé stessa)
Renderer.prototype.xmasStarGeometry = function (r) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: r * 0.25, bevelEnabled: false }).translate(0, 0, -r * 0.125);
};

// ---------- fuochi d'artificio ----------
// un razzo che parte da (x, z) fuori dal campo, sale e scoppia in tante scintille colorate
Renderer.prototype.launchFirework = function (x, z, delay) {
  const X = this.xmasDeco;
  if (!X) return;
  const c = pick(XMAS_LIGHTS), c2 = Math.random() < 0.5 ? c : pick(XMAS_LIGHTS);
  // partono da terra (dietro i cartelloni) e scoppiano tra 13 e 22 metri: abbastanza bassi da vedersi anche con
  // la telecamera televisiva, che guarda in giù
  X.rockets.push({ x: x, y: 0.5, z: z, vy: 21 + Math.random() * 5, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2,
    fuse: 0.75 + Math.random() * 0.3, wait: delay || 0, c1: new THREE.Color(c), c2: new THREE.Color(c2) });
};

// gol: una raffica di fuochi dietro la porta di chi ha segnato (side = +1 o -1) e lungo la linea laterale lontana
Renderer.prototype.christmasGoal = function (side) {
  if (!this.xmasDeco) return [];
  const n = this.Q.crowd ? 8 : 5, times = [];
  for (let i = 0; i < n; i++) {
    const behind = i % 3 !== 2;
    const x = behind ? side * (58.5 + Math.random() * 2) : side * (20 + Math.random() * 30);
    const z = behind ? (Math.random() - 0.5) * 50 : -40 - Math.random() * 1.5;
    const d = 0.15 + i * 0.3 + Math.random() * 0.15;
    this.launchFirework(x, z, d);
    times.push(d + 0.9);
  }
  return times;   // quando scoppiano (per i botti)
};

Renderer.prototype.updateChristmas = function (dt, menu) {
  const X = this.xmasDeco;
  if (!X) return;
  dt = Math.min(dt || 0, 0.1);
  X.t += dt;
  // lucine che brillano: ognuna con il suo ritmo (i colori si aggiornano 20 volte al secondo)
  X.twinkleT -= dt;
  if (X.twinkleT <= 0) {
    X.twinkleT = 0.05;
    const col = X.lights.geometry.attributes.color.array, base = X.lightBase, ph = X.lightPhase, t = X.t;
    for (let i = 0; i < X.lightN; i++) {
      const v = 0.45 + 0.55 * Math.max(0, Math.sin(t * ph[i * 2 + 1] + ph[i * 2]));
      col[i * 3] = base[i * 3] * v; col[i * 3 + 1] = base[i * 3 + 1] * v; col[i * 3 + 2] = base[i * 3 + 2] * v;
    }
    X.lights.geometry.attributes.color.needsUpdate = true;
  }
  for (const s of X.stars) s.rotation.y += dt * 0.6;
  for (const g of X.glows) { const k = 1 + Math.sin(X.t * 2.1) * 0.06; g.scale.x = g.scale.y = g.userData.s0 || (g.userData.s0 = g.scale.x); g.scale.multiplyScalar(k); }
  // nel menu ogni tanto parte un fuoco d'artificio
  if (menu) {
    X.nextFw -= dt;
    if (X.nextFw <= 0) {
      X.nextFw = 3 + Math.random() * 5;
      const a = Math.random() * Math.PI * 2;
      this.launchFirework(Math.cos(a) * 59, Math.sin(a) * 41, 0);
    }
  }
  // razzi: salgono lasciando una scia, poi scoppiano
  const sparks = X.sparks;
  for (let i = X.rockets.length - 1; i >= 0; i--) {
    const r = X.rockets[i];
    if (r.wait > 0) { r.wait -= dt; continue; }
    r.fuse -= dt;
    r.vy -= 9 * dt; r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
    if (sparks.length < XMAS_FIREWORKS - 2) sparks.push({ x: r.x, y: r.y, z: r.z, vx: 0, vy: -1, vz: 0, life: 0, max: 0.35, r: 1, g: 0.85, b: 0.6, drag: 3, grav: 2 });
    if (r.fuse <= 0) {
      const n = Math.round(110 * Math.max(0.5, this.Q.particles));
      for (let k = 0; k < n && sparks.length < XMAS_FIREWORKS; k++) {
        // direzione a caso su una sfera, velocità quasi uguale: una palla di scintille
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, q = Math.sqrt(1 - u * u), sp = 8 + Math.random() * 2;
        const c = k % 2 ? r.c1 : r.c2;
        sparks.push({ x: r.x, y: r.y, z: r.z, vx: q * Math.cos(a) * sp, vy: u * sp, vz: q * Math.sin(a) * sp, life: 0, max: 1.4 + Math.random() * 0.8, r: c.r, g: c.g, b: c.b, drag: 1.4, grav: 3.2 });
      }
      X.rockets.splice(i, 1);
    }
  }
  // scintille: rallentano, cadono e si spengono (con un piccolo tremolio alla fine)
  let w = 0;
  for (let i = 0; i < sparks.length; i++) {
    const p = sparks[i];
    p.life += dt;
    if (p.life >= p.max) continue;
    const k = Math.exp(-p.drag * dt);
    p.vx *= k; p.vy *= k; p.vz *= k; p.vy -= p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    sparks[w++] = p;
  }
  sparks.length = w;
  const pos = X.fwPos, col = X.fwCol;
  for (let i = 0; i < XMAS_FIREWORKS; i++) {
    if (i < w) {
      // colori più forti di 1: con la luce che si somma brillano anche sopra il pubblico e la neve
      const p = sparks[i], f = 1 - p.life / p.max, fl = (f < 0.3 ? (Math.random() < 0.5 ? 0.3 : 1) : 1) * 1.15 * Math.sqrt(f);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r * fl; col[i * 3 + 1] = p.g * fl; col[i * 3 + 2] = p.b * fl;
    } else if (pos[i * 3 + 1] !== -100) pos[i * 3 + 1] = -100;
    else if (i >= w + 4) break;   // il resto è già spento
  }
  X.fw.geometry.attributes.position.needsUpdate = true;
  X.fw.geometry.attributes.color.needsUpdate = true;
  X.fw.geometry.setDrawRange(0, Math.max(1, w));
};

// ---------- cartelloni e pallone ----------
Renderer.prototype.xmasBoardCanvas = function () {
  if (this._xmasBoards) return this._xmasBoards;
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 64;
  const g = cv.getContext('2d');
  // Buon Natale nelle quattro lingue del gioco e marchi inventati
  const ads = [['BUON NATALE', '#b3121f', '#ffffff'], ['Panettoni del Lago', '#14492b', '#ffd84a'], ['FROHE WEIHNACHTEN', '#0e2a52', '#ffffff'],
    ['JOYEUX NOËL', '#b3121f', '#ffd84a'], ['Slitte Valmaggia', '#f4f2ec', '#b3121f'], ['MERRY CHRISTMAS', '#14492b', '#ffffff']];
  const w = 1024 / ads.length;
  ads.forEach((a, i) => {
    g.fillStyle = a[1]; g.fillRect(i * w, 0, w, 64);
    // fiocchi di neve e stelline sul fondo
    g.fillStyle = a[1] === '#f4f2ec' ? 'rgba(179,18,31,0.25)' : 'rgba(255,255,255,0.22)';
    for (let k = 0; k < 14; k++) { g.beginPath(); g.arc(i * w + ((k * 37) % w), 6 + ((k * 23) % 52), 1.6 + (k % 3), 0, Math.PI * 2); g.fill(); }
    g.fillStyle = a[2]; g.font = 'bold 24px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(a[0], i * w + w / 2, 33, w - 14);
  });
  return this._xmasBoards = cv;
};

Renderer.prototype.xmasBallTexture = function () {
  if (this._xmasBall) return this._xmasBall;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, 512, 256);
  // spicchi rossi e verdi al posto di quelli neri, con una stellina dorata in mezzo
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) {
    const x = i * 64 + 32, y = j * 64 + 32;
    g.fillStyle = (i + j) % 4 === 0 ? '#c8102e' : '#1d7a3e';
    g.beginPath(); g.arc(x, y, 21, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd84a'; g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 3.5 : 8; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
  return this._xmasBall = t;
};
