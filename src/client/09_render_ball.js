// ============================================================
// PALLONE PREMIUM (0.24) — disegno originale, nessun marchio o scritta
// - 6 pannelli a forma di elica (come i palloni moderni termosaldati): i bordi sono curvi perché ogni punto della
//   sfera viene prima "attorcigliato" e poi assegnato alla faccia del cubo più vicina;
// - su ogni pannello due fasce colorate che seguono le cuciture (una scura e una dorata), pannelli alternati;
// - cuciture: un solco sottile e scuro (anche nel rilievo, bumpMap);
// - micro-rilievo: una trama fitta di piccoli esagoni in rilievo, come la pelle sintetica dei palloni veri;
// - materiale sintetico lucido: a qualità alta una vernice trasparente (clearcoat) che fa riflessi morbidi.
// La dimensione (CONFIG.BALL_R * 1,6 disegnata) e le collisioni non cambiano.
// Rotazione: il pallone gira davvero attorno all'asse giusto (perpendicolare alla direzione in cui rotola), con
// l'angolo uguale alla strada fatta diviso il raggio; in volo mantiene la rotazione e aggiunge l'effetto del tiro.
// ============================================================
const BALL_VIS_R = CONFIG.BALL_R * 1.6;
const BALL_PALETTES = {
  normale: { base: [246, 246, 241], dark: [22, 34, 64], accent: [214, 164, 52], seam: [70, 74, 82] },
  natale: { base: [248, 246, 240], dark: [176, 16, 40], accent: [24, 120, 64], seam: [90, 60, 60] },
};

// disegna colore e rilievo del pallone (texture equirettangolare: x = longitudine, y = latitudine)
function makeBallTextures(pal, W) {
  const H = W / 2;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H;
  const g = cv.getContext('2d'), gb = bv.getContext('2d');
  const img = g.createImageData(W, H), bump = gb.createImageData(W, H);
  const C = img.data, B = bump.data;
  // centri dei 6 pannelli (facce del cubo)
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let py = 0; py < H; py++) {
    const th = (py + 0.5) / H * Math.PI, sy = Math.cos(th), sr = Math.sin(th);
    for (let px = 0; px < W; px++) {
      const ph = (px + 0.5) / W * Math.PI * 2;
      // stesso orientamento della SphereGeometry di three.js
      let x = -Math.cos(ph) * sr, y = sy, z = Math.sin(ph) * sr;
      // attorcigliamento: i bordi dei pannelli diventano curvi (forma a elica)
      const a1 = 0.55 * y, c1 = Math.cos(a1), s1 = Math.sin(a1);
      let x2 = x * c1 - z * s1, z2 = x * s1 + z * c1;
      const a2 = 0.55 * x2, c2 = Math.cos(a2), s2 = Math.sin(a2);
      const y2 = y * c2 - z2 * s2; z2 = y * s2 + z2 * c2; 
      // faccia più vicina e seconda più vicina: la differenza dice quanto si è lontani dalla cucitura
      let b1 = -9, b2 = -9, f1 = 0;
      for (let f = 0; f < 6; f++) {
        const d = faces[f][0] * x2 + faces[f][1] * y2 + faces[f][2] * z2;
        if (d > b1) { b2 = b1; b1 = d; f1 = f; } else if (d > b2) b2 = d;
      }
      const e = b1 - b2;   // 0 sulla cucitura, cresce verso il centro del pannello
      let col = pal.base, h = 0.62;
      // fasce colorate lungo le cuciture, su pannelli alternati
      if (f1 % 2 === 0 && e > 0.05 && e < 0.15) col = pal.dark;
      else if (f1 % 2 === 0 && e > 0.15 && e < 0.18) col = pal.accent;
      else if (f1 % 2 === 1 && e > 0.05 && e < 0.075) col = pal.accent;
      // micro-rilievo: piccoli esagoni in rilievo (trama a nido d'ape sulla superficie)
      const u = px / W * 150, v = py / H * 75 * 1.15;
      const hx = u - Math.round(u), hy = v + (Math.round(u) % 2) * 0.5;
      const dh = Math.hypot(hx, hy - Math.round(hy));
      h += dh < 0.3 ? 0.05 : 0;
      // cucitura: solco scuro
      let shade = 1;
      if (e < 0.022) { col = pal.seam; h = 0.15; }
      else if (e < 0.04) { shade = 0.9; h = 0.4 + (e - 0.022) * 10; }   // bordo del pannello che scende verso il solco
      const o = (py * W + px) * 4;
      C[o] = col[0] * shade; C[o + 1] = col[1] * shade; C[o + 2] = col[2] * shade; C[o + 3] = 255;
      const hb = Math.round(h * 255); B[o] = B[o + 1] = B[o + 2] = hb; B[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); gb.putImageData(bump, 0, 0);
  const map = new THREE.CanvasTexture(cv), bumpMap = new THREE.CanvasTexture(bv);
  map.encoding = THREE.sRGBEncoding;
  map.anisotropy = bumpMap.anisotropy = 4;
  return { map: map, bump: bumpMap };
}

Renderer.prototype.buildBall = function () {
  const hi = this.Q.detail >= 1.3, W = this.Q.detail >= 1 ? 1024 : 512;
  this.ballTex = makeBallTextures(BALL_PALETTES.normale, W);
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

// pallone di Natale: stesso disegno, colori rosso, verde e oro (09_render_natale.js)
Renderer.prototype.xmasBallTexture = function () {
  if (!this._xmasBall) this._xmasBall = makeBallTextures(BALL_PALETTES.natale, this.Q.detail >= 1 ? 1024 : 512).map;
  return this._xmasBall;
};

// fa girare il pallone: vx, vz velocità orizzontale, spin e topspin l'effetto del motore (rad/s), ground = rotola
const _ballQ = new THREE.Quaternion(), _ballAxis = new THREE.Vector3();
Renderer.prototype.spinBall = function (dt, vx, vz, ground, spin, topspin) {
  const w = this.ballW;
  if (!(dt > 0)) return;
  if (ground) {
    // rotola senza strisciare: asse = su × velocità, giri = strada / raggio
    w.set(vz / BALL_VIS_R, 0, -vx / BALL_VIS_R);
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
