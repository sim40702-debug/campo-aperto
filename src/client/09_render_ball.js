// ============================================================
// PALLONE PREMIUM (0.24) — disegno originale, nessun marchio o scritta
// - 6 pannelli a forma di elica (come i palloni moderni termosaldati): i bordi sono curvi perché ogni punto della
//   sfera viene prima "attorcigliato" e poi assegnato alla faccia del cubo più vicina;
// - su ogni pannello due fasce colorate che seguono le cuciture (una scura e una dorata), pannelli alternati;
// - cuciture: un solco sottile e scuro (anche nel rilievo, bumpMap);
// - micro-rilievo: una trama fitta di piccoli esagoni in rilievo, come la pelle sintetica dei palloni veri;
// - materiale sintetico lucido: a qualità alta una vernice trasparente (clearcoat) che fa riflessi morbidi.
// Dimensione disegnata (0.25.8): vera (22 cm) con la telecamera vicina, fino a 1,6 volte da lontano (ballVisSize).
// Rotazione: il pallone gira davvero attorno all'asse giusto (perpendicolare alla direzione in cui rotola), con
// l'angolo uguale alla strada fatta diviso il raggio; in volo mantiene la rotazione e aggiunge l'effetto del tiro.
// ============================================================
const BALL_VIS_R = CONFIG.BALL_R * 1.6;   // il più grande che si disegna (telecamera lontana)

// grandezza del pallone disegnato (0.25.8): prima era sempre 1,6 volte quello vero (35 cm invece di 22) per vederlo
// dalla telecamera televisiva; nelle punizioni e nei rigori, con la telecamera vicina, sembrava enorme vicino alla
// porta (che è grande come quella vera). Ora: grandezza vera fino a 12 m dalla telecamera, poi cresce piano fino a
// 1,6 volte a 45 m. Cambia piano (niente salti quando la telecamera stacca).
Renderer.prototype.ballVisSize = function (dt) {
  const d = this.camera.position.distanceTo(this.ballMesh.position);
  const want = CONFIG.BALL_R * (1 + 0.6 * clamp((d - 12) / 33, 0, 1));
  this.ballVisR = this.ballVisR ? this.ballVisR + (want - this.ballVisR) * Math.min(1, (dt || 0) * 4) : want;
  this.ballMesh.scale.setScalar(this.ballVisR / BALL_VIS_R);
  return this.ballVisR;
};
// modelli di pallone (0.25.4): tutti disegni originali, senza marchi né scritte. pattern = forma dei pannelli
// (eliche: 6 pannelli a elica; classico: 32 pannelli, pentagoni scuri; triangoli: 20 pannelli; retro: cuoio a 18
// strisce cucite), colori: base, dark (fasce o pentagoni), accent (filetti), seam (cuciture). rainbow: ogni pannello
// di un colore diverso. Si sceglie nelle impostazioni (settings.ballDesign); "auto" = Natale con il tema di Natale.
const BALL_DESIGNS = {
  premium: { name: 'Premium', pattern: 'eliche', base: [246, 246, 241], dark: [22, 34, 64], accent: [214, 164, 52], seam: [70, 74, 82] },
  natale: { name: 'Natale', pattern: 'eliche', base: [248, 246, 240], dark: [176, 16, 40], accent: [24, 120, 64], seam: [90, 60, 60] },
  classico: { name: 'Classico', pattern: 'classico', base: [248, 248, 244], dark: [24, 24, 26], accent: [24, 24, 26], seam: [90, 90, 92] },
  notte: { name: 'Notte', pattern: 'eliche', base: [32, 36, 50], dark: [0, 196, 255], accent: [255, 60, 170], seam: [10, 10, 16] },
  fuoco: { name: 'Fuoco', pattern: 'eliche', base: [250, 246, 236], dark: [214, 64, 18], accent: [255, 192, 30], seam: [80, 50, 40] },
  ghiaccio: { name: 'Ghiaccio', pattern: 'triangoli', base: [250, 252, 255], dark: [38, 140, 205], accent: [160, 220, 250], seam: [90, 110, 130] },
  arancione: { name: 'Neve (arancione)', pattern: 'classico', base: [255, 122, 24], dark: [28, 28, 30], accent: [28, 28, 30], seam: [120, 60, 20] },
  retro: { name: 'Retrò (cuoio)', pattern: 'retro', base: [156, 96, 50], dark: [128, 76, 38], accent: [70, 40, 20], seam: [56, 32, 16] },
  arcobaleno: { name: 'Arcobaleno', pattern: 'triangoli', rainbow: true, base: [250, 250, 250], dark: [40, 40, 40], accent: [255, 255, 255], seam: [60, 60, 60] },
};

// centri dei pannelli per i disegni a "pannelli vicini": icosaedro (12) e dodecaedro (20)
const PHI = (1 + Math.sqrt(5)) / 2;
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const ICO = [], DODECA = [];
for (const a of [-1, 1]) for (const b of [-1, 1]) { ICO.push(norm3([0, a, b * PHI]), norm3([a, b * PHI, 0]), norm3([b * PHI, 0, a])); }
for (const a of [-1, 1]) for (const b of [-1, 1]) {
  for (const c of [-1, 1]) DODECA.push(norm3([a, b, c]));
  DODECA.push(norm3([0, a / PHI, b * PHI]), norm3([a / PHI, b * PHI, 0]), norm3([a * PHI, 0, b / PHI]));
}
const CLASSIC_CENTERS = ICO.concat(DODECA);   // 12 pentagoni + 20 esagoni

// colore di un pannello dell'arcobaleno
function rainbowColor(i) { const c = new THREE.Color().setHSL((i * 0.618) % 1, 0.75, 0.55); return [c.r * 255, c.g * 255, c.b * 255]; }

// disegna colore e rilievo del pallone (texture equirettangolare: x = longitudine, y = latitudine)
function makeBallTextures(pal, W) {
  const H = W / 2;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H;
  const g = cv.getContext('2d'), gb = bv.getContext('2d');
  const img = g.createImageData(W, H), bump = gb.createImageData(W, H);
  const C = img.data, B = bump.data, pat = pal.pattern || 'eliche';
  // centri dei 6 pannelli (facce del cubo)
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const centers = pat === 'classico' ? CLASSIC_CENTERS : pat === 'triangoli' ? DODECA : faces;
  for (let py = 0; py < H; py++) {
    const th = (py + 0.5) / H * Math.PI, sy = Math.cos(th), sr = Math.sin(th);
    for (let px = 0; px < W; px++) {
      const ph = (px + 0.5) / W * Math.PI * 2;
      // stesso orientamento della SphereGeometry di three.js
      let x = -Math.cos(ph) * sr, y = sy, z = Math.sin(ph) * sr;
      let x2 = x, y2 = y, z2 = z;
      if (pat === 'eliche') {
        // attorcigliamento: i bordi dei pannelli diventano curvi (forma a elica)
        const a1 = 0.55 * y, c1 = Math.cos(a1), s1 = Math.sin(a1);
        x2 = x * c1 - z * s1; z2 = x * s1 + z * c1;
        const a2 = 0.55 * x2, c2 = Math.cos(a2), s2 = Math.sin(a2);
        y2 = y * c2 - z2 * s2; z2 = y * s2 + z2 * c2;
      }
      // pannello più vicino e secondo più vicino: la differenza dice quanto si è lontani dalla cucitura
      let b1 = -9, b2 = -9, f1 = 0;
      for (let f = 0; f < centers.length; f++) {
        const d = centers[f][0] * x2 + centers[f][1] * y2 + centers[f][2] * z2;
        if (d > b1) { b2 = b1; b1 = d; f1 = f; } else if (d > b2) b2 = d;
      }
      let e = b1 - b2;   // 0 sulla cucitura, cresce verso il centro del pannello
      let col = pal.base, h = 0.62;
      if (pat === 'eliche') {
        // fasce colorate lungo le cuciture, su pannelli alternati
        if (f1 % 2 === 0 && e > 0.05 && e < 0.15) col = pal.dark;
        else if (f1 % 2 === 0 && e > 0.15 && e < 0.18) col = pal.accent;
        else if (f1 % 2 === 1 && e > 0.05 && e < 0.075) col = pal.accent;
      } else if (pat === 'classico') {
        e *= 3.2;   // pannelli più piccoli: cuciture in proporzione
        if (f1 < 12) col = pal.dark;   // i 12 pentagoni
      } else if (pat === 'triangoli') {
        e *= 2.2;
        if (pal.rainbow) col = rainbowColor(f1);
        else if (f1 % 3 === 0) col = e > 0.12 && e < 0.28 ? pal.dark : col;
        else if (e > 0.08 && e < 0.13) col = pal.accent;
      } else if (pat === 'retro') {
        // cuoio: ogni faccia del cubo divisa in tre strisce cucite (verso alternato da una faccia all'altra)
        const ax = f1 >> 1, P = [x2, y2, z2], t = (ax + (f1 % 2 ? 2 : 1)) % 3;
        const u = P[t] / Math.abs(P[ax]), su = Math.abs(u);
        const de = Math.min(Math.abs(su - 1 / 3) * Math.abs(P[ax]) * 0.9, e);
        if (Math.abs(u) < 1 / 3) col = pal.dark;
        e = de;
        // lacci sulla striscia centrale di una faccia
        if (f1 === 2 && Math.abs(u) < 0.06 && Math.abs(P[(ax + (f1 % 2 ? 1 : 2)) % 3] / Math.abs(P[ax])) < 0.45) { col = pal.accent; h = 0.85; }
        // cuoio: grana irregolare
        h += (Math.sin(px * 1.7) * Math.sin(py * 2.3)) * 0.04;
      }
      // micro-rilievo: piccoli esagoni in rilievo (trama a nido d'ape sulla superficie), non sul cuoio
      if (pat !== 'retro') {
        const u = px / W * 150, v = py / H * 75 * 1.15;
        const hx = u - Math.round(u), hy = v + (Math.round(u) % 2) * 0.5;
        const dh = Math.hypot(hx, hy - Math.round(hy));
        h += dh < 0.3 ? 0.05 : 0;
      }
      // cucitura: solco scuro
      let shade = 1;
      if (e < 0.022) { col = pal.seam; h = 0.15; }
      else if (e < 0.04) { shade = 0.9; h = 0.4 + (e - 0.022) * 10; }   // bordo del pannello che scende verso il solco
      const o = (py * W + px) * 4;
      C[o] = col[0] * shade; C[o + 1] = col[1] * shade; C[o + 2] = col[2] * shade; C[o + 3] = 255;
      const hb = Math.round(clamp(h, 0, 1) * 255); B[o] = B[o + 1] = B[o + 2] = hb; B[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); gb.putImageData(bump, 0, 0);
  const map = new THREE.CanvasTexture(cv), bumpMap = new THREE.CanvasTexture(bv);
  map.encoding = THREE.sRGBEncoding;
  map.anisotropy = bumpMap.anisotropy = 4;
  return { map: map, bump: bumpMap };
}

// sceglie il modello di pallone ("auto": quello di Natale con il tema di Natale, altrimenti Premium)
// anteprima di un pallone per le impostazioni (0.25.8): una pallina disegnata pixel per pixel in un'immagine 2D con la
// stessa texture del gioco (avvolta sulla sfera come fa three.js), luce da sinistra in alto e un riflesso.
// Restituisce un'immagine (data URL); si calcola una volta per pallone.
const _ballPreviews = {};
function ballPreview(id, size) {
  const key = id + '@' + size;
  if (_ballPreviews[key]) return _ballPreviews[key];
  const des = BALL_DESIGNS[id] || BALL_DESIGNS.premium;
  const tex = makeBallTextures(des, 512).map.image;
  const tw = tex.width, th = tex.height, src = tex.getContext('2d').getImageData(0, 0, tw, th).data;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'), img = g.createImageData(size, size), out = img.data;
  const L = [-0.45, 0.6, 0.66], tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  // ogni pixel è la media di 4 punti (bordi delle fasce lisci, senza scalini)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cr = 0, cg = 0, cb = 0, ca = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const nx = (px + 0.25 + sx * 0.5) / size * 2 - 1, ny = 1 - (py + 0.25 + sy * 0.5) / size * 2, r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);
        // il pallone è un po' inclinato verso chi guarda (si vede anche la parte di sopra)
        const y2 = ny * ct + nz * st, z2 = -ny * st + nz * ct;
        const u = (Math.atan2(nx, z2) / (2 * Math.PI) + 0.75) % 1, v = Math.acos(clamp(y2, -1, 1)) / Math.PI;
        const o = ((Math.min(th - 1, v * th | 0)) * tw + Math.min(tw - 1, u * tw | 0)) * 4;
        const dif = 0.38 + 0.72 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const spec = Math.pow(Math.max(0, nx * -0.3 + ny * 0.42 + nz * 0.86), 40) * 120;
        cr += Math.min(255, src[o] * dif + spec); cg += Math.min(255, src[o + 1] * dif + spec); cb += Math.min(255, src[o + 2] * dif + spec);
        ca += clamp((1 - r2) * 6, 0, 1);   // bordo morbido
      }
      if (!ca) continue;
      const q = (py * size + px) * 4, n = Math.max(1, ca);
      out[q] = cr / n; out[q + 1] = cg / n; out[q + 2] = cb / n; out[q + 3] = 255 * ca / 4;
    }
  }
  g.putImageData(img, 0, 0);
  return _ballPreviews[key] = cv.toDataURL();
}

Renderer.prototype.setBallDesign = function (id) {
  if (id !== undefined) this.ballDesignId = id;
  const want = this.ballDesignId && this.ballDesignId !== 'auto' && BALL_DESIGNS[this.ballDesignId] ? this.ballDesignId : (this.xmas ? 'natale' : 'premium');
  const cache = this._ballTexs || (this._ballTexs = {});
  if (!cache[want]) cache[want] = makeBallTextures(BALL_DESIGNS[want], this.Q.detail >= 1 ? 1024 : 512);
  const m = this.ballMesh.material;
  m.map = cache[want].map; m.bumpMap = cache[want].bump;
  m.roughness = BALL_DESIGNS[want].pattern === 'retro' ? 0.7 : 0.38;   // il cuoio non luccica
  m.needsUpdate = true;
  this.ballDesignShown = want;
};

Renderer.prototype.buildBall = function () {
  const hi = this.Q.detail >= 1.3, W = this.Q.detail >= 1 ? 1024 : 512;
  this.ballTex = makeBallTextures(BALL_DESIGNS.premium, W);
  (this._ballTexs = {}).premium = this.ballTex;
  const opts = { map: this.ballTex.map, bumpMap: this.ballTex.bump, bumpScale: 0.006, roughness: 0.38, metalness: 0 };
  const mat = hi ? new THREE.MeshPhysicalMaterial(Object.assign(opts, { clearcoat: 0.7, clearcoatRoughness: 0.22 })) : new THREE.MeshStandardMaterial(opts);
  this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_VIS_R, hi ? 44 : 32, hi ? 30 : 22), mat);
  this.ballMesh.castShadow = true;
  this.scene.add(this.ballMesh);
  this.ballW = new THREE.Vector3();   // velocità di rotazione del pallone (rad/s)
  // indicatore del giocatore controllato
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), new THREE.MeshBasicMaterial({ color: '#ffd84a' }));
  arrow.rotation.x = Math.PI; this.arrow = arrow; this.scene.add(arrow);
};

// fa girare il pallone: vx, vz velocità orizzontale, spin e topspin l'effetto del motore (rad/s), ground = rotola
const _ballQ = new THREE.Quaternion(), _ballAxis = new THREE.Vector3();
Renderer.prototype.spinBall = function (dt, vx, vz, ground, spin, topspin) {
  const w = this.ballW;
  if (!(dt > 0)) return;
  if (ground) {
    // rotola senza strisciare: asse = su × velocità, giri = strada / raggio
    const r = this.ballVisR || BALL_VIS_R; w.set(vz / r, 0, -vx / r);
  } else {
    // in volo: mantiene la rotazione del calcio (rallenta pochissimo) e segue l'effetto del motore
    const sh = Math.hypot(vx, vz);
    w.multiplyScalar(Math.exp(-0.3 * dt));
    if (sh > 1) {
      const k = 1 - Math.exp(-4 * dt);
      w.y += ((spin || 0) - w.y) * k;
      if (topspin) { w.x += (vz / sh * topspin - w.x) * k; w.z += (-vx / sh * topspin - w.z) * k; }
    }
  }
  const ang = w.length() * dt;
  if (ang < 1e-5) return;
  _ballAxis.copy(w).normalize();
  _ballQ.setFromAxisAngle(_ballAxis, Math.min(ang, 1.2));   // mai più di un giro scarso per fotogramma (niente effetto ruota che va all'indietro)
  this.ballMesh.quaternion.premultiply(_ballQ);
};
