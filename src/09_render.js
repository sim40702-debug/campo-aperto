// ============================================================
// RENDER 3D (Three.js) — tutto generato proceduralmente
// ============================================================
// preset grafici: dprCap = massimo rapporto pixel (Ultra = risoluzione nativa, anche 4K)
const QUALITY_PRESETS = {
  bassa: { dprCap: 1, shadows: false, shadowSize: 1024, soft: false, pitch: 2048, aniso: 2, particles: 0.4, detail: 0.8, crowd: false },
  media: { dprCap: 1, shadows: true, shadowSize: 1024, soft: false, pitch: 2048, aniso: 4, particles: 0.7, detail: 1, crowd: true },
  alta: { dprCap: 1.5, shadows: true, shadowSize: 2048, soft: true, pitch: 4096, aniso: 8, particles: 1, detail: 1.3, crowd: true },
  ultra: { dprCap: 3, shadows: true, shadowSize: 4096, soft: true, pitch: 4096, aniso: 16, particles: 1, detail: 1.6, crowd: true },
};

class Renderer {
  constructor(container, quality) {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.qualityId = QUALITY_PRESETS[quality] ? quality : 'alta';
    this.Q = QUALITY_PRESETS[this.qualityId];
    this.resScale = 1;        // scelta dell'utente
    this.dynScale = 1;        // regolata automaticamente in base agli fps
    r.shadowMap.enabled = this.Q.shadows;
    r.shadowMap.type = this.Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.98;
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b1626');
    this.scene.fog = new THREE.Fog('#0b1626', 140, 320);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 700);
    this.camera.position.set(0, 30, 60);
    this.camMode = 0; // 0 televisiva, 1 larga, 2 dietro al giocatore
    this.camTarget = new THREE.Vector3();
    this.crowdPhase = 0; this.crowdExcite = 0;
    this.buildLights();
    this.buildPitch();
    this.buildGoals();
    this.buildStadium();
    this.buildBall();
    this.buildFx();
    this.playerMeshes = [];
    this.humanMarks = [];
    this.shake = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // lo schermo cambia (es. finestra spostata su un monitor 4K): aggiorna il rapporto pixel
    if (window.matchMedia) this.watchDpr();
  }

  watchDpr() {
    const mq = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
    const fn = () => { this.resize(); this.watchDpr(); };
    if (mq.addEventListener) mq.addEventListener('change', fn, { once: true });
  }

  // rapporto tra pixel reali e pixel CSS: nativo (HiDPI/4K) limitato dal preset, per scala utente e dinamica
  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    return Math.max(0.35, Math.min(dpr, this.Q.dprCap) * this.resScale * this.dynScale);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // dimensione effettiva del disegno in pixel (per la UI e i test)
  drawingSize() { const c = this.renderer.domElement; return { w: c.width, h: c.height, ratio: this.renderer.getPixelRatio() }; }

  setResolutionScale(v) { this.resScale = clamp(v, 0.5, 1); this.resize(); }
  setDynamicScale(v) {
    v = clamp(Math.round(v * 20) / 20, 0.5, 1);
    if (v === this.dynScale) return false;
    this.dynScale = v; this.resize();
    return true;
  }

  buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#c9dcff', '#27402a', 0.55));
    const sun = this.sun = new THREE.DirectionalLight('#fff6e6', 0.95);
    sun.position.set(-35, 90, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.Q.shadowSize, this.Q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -70; c.right = 70; c.top = 50; c.bottom = -50; c.near = 10; c.far = 220;
    sun.shadow.bias = -0.0005;
    s.add(sun);
    const fill = new THREE.DirectionalLight('#9fb8ff', 0.25);
    fill.position.set(40, 50, -40);
    s.add(fill);
  }

  // texture del campo disegnata su canvas: strisce, linee, aree
  // texture del campo: la risoluzione dipende dalla qualità (fino a 4096 px, ~39 px per metro)
  pitchTexture() {
    const C = CONFIG;
    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    const W = Math.min(this.Q.pitch, maxTex), H = Math.round(W * 68 / 105), ppm = W / 105;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#2f7a3f' : '#35864a';
      g.fillRect(i * W / 14, 0, W / 14 + 1, H);
    }
    // trama dell'erba: puntini e fili proporzionati alla risoluzione
    const dots = Math.round(9000 * (W / 2100) * (W / 2100));
    const ds = Math.max(2, Math.round(W / 700));
    for (let i = 0; i < dots; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
      g.fillRect(Math.random() * W, Math.random() * H, ds, ds);
    }
    // segni dell'usura davanti alle porte e al centro
    for (const cx of [0.06, 0.5, 0.94]) {
      const gr = g.createRadialGradient(cx * W, H / 2, 0, cx * W, H / 2, H * 0.22);
      gr.addColorStop(0, 'rgba(70,60,30,0.16)'); gr.addColorStop(1, 'rgba(70,60,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    g.strokeStyle = 'rgba(245,248,240,0.95)'; g.lineWidth = 0.12 * ppm;
    const X = x => (x + 52.5) * ppm, Z = z => (z + 34) * ppm;
    g.strokeRect(X(-52.5), Z(-34), 105 * ppm, 68 * ppm);
    g.beginPath(); g.moveTo(X(0), Z(-34)); g.lineTo(X(0), Z(34)); g.stroke();
    g.beginPath(); g.arc(X(0), Z(0), C.CENTER_R * ppm, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(245,248,240,0.95)';
    g.beginPath(); g.arc(X(0), Z(0), 0.25 * ppm, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      const gx = s * 52.5;
      const bx = s > 0 ? X(gx - C.BOX_DEPTH) : X(gx);
      g.strokeRect(bx, Z(-C.BOX_HALF_W), C.BOX_DEPTH * ppm, C.BOX_HALF_W * 2 * ppm);
      const sbx = s > 0 ? X(gx - C.SMALL_BOX_DEPTH) : X(gx);
      g.strokeRect(sbx, Z(-C.SMALL_BOX_HALF_W), C.SMALL_BOX_DEPTH * ppm, C.SMALL_BOX_HALF_W * 2 * ppm);
      const px = gx - s * C.PENALTY_SPOT;
      g.beginPath(); g.arc(X(px), Z(0), 0.22 * ppm, 0, Math.PI * 2); g.fill();
      // lunetta dell'area
      const a = Math.acos((C.BOX_DEPTH - C.PENALTY_SPOT) / C.CENTER_R);
      g.beginPath();
      if (s > 0) g.arc(X(px), Z(0), C.CENTER_R * ppm, Math.PI - a, Math.PI + a);
      else g.arc(X(px), Z(0), C.CENTER_R * ppm, -a, a);
      g.stroke();
      for (const t of [-1, 1]) {
        g.beginPath(); g.arc(X(gx), Z(t * 34), 1 * ppm, 0, Math.PI * 2); g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = Math.min(this.Q.aniso, this.renderer.capabilities.getMaxAnisotropy());
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  buildPitch() {
    const pitch = this.pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshLambertMaterial({ map: this.pitchTexture() }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.scene.add(pitch);
    // erba attorno al campo
    const cv2 = document.createElement('canvas'); cv2.width = 64; cv2.height = 64;
    const g2 = cv2.getContext('2d');
    for (let i = 0; i < 2; i++) { g2.fillStyle = i ? '#2a6d38' : '#2e7640'; g2.fillRect(i * 32, 0, 32, 64); }
    const t2 = new THREE.CanvasTexture(cv2); t2.wrapS = t2.wrapT = THREE.RepeatWrapping; t2.repeat.set(9, 1);
    t2.encoding = THREE.sRGBEncoding;
    const around = new THREE.Mesh(new THREE.PlaneGeometry(135, 96), new THREE.MeshLambertMaterial({ map: t2 }));
    around.rotation.x = -Math.PI / 2; around.position.y = -0.02; around.receiveShadow = true;
    this.scene.add(around);
    // bandierine
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), new THREE.MeshLambertMaterial({ color: '#eeeeee' }));
      pole.position.set(sx * 52.5, 0.75, sz * 34); this.scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), new THREE.MeshLambertMaterial({ color: '#ffd84a', side: THREE.DoubleSide }));
      flag.position.set(sx * 52.5 + 0.22, 1.33, sz * 34); this.scene.add(flag);
    }
  }

  buildGoals() {
    const C = CONFIG;
    const postMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35 });
    const netMat = new THREE.LineBasicMaterial({ color: '#e8eef5', transparent: true, opacity: 0.42 });
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const gx = s * C.HALF_L;
      for (const pz of [-C.GOAL_HALF_W, C.GOAL_HALF_W]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(C.POST_R, C.POST_R, C.GOAL_H, 10), postMat);
        post.position.set(gx, C.GOAL_H / 2, pz); post.castShadow = true; g.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(C.POST_R, C.POST_R, C.GOAL_HALF_W * 2 + 0.12, 10), postMat);
      bar.rotation.x = Math.PI / 2; bar.position.set(gx, C.GOAL_H, 0); bar.castShadow = true; g.add(bar);
      // rete: griglia di linee su retro, lati e tetto
      const pts = [];
      const bx = gx + s * C.GOAL_DEPTH, step = 0.25;
      for (let z = -C.GOAL_HALF_W; z <= C.GOAL_HALF_W + 0.01; z += step) {
        pts.push(bx, 0, z, bx, C.GOAL_H * 0.85, z);
        pts.push(gx, C.GOAL_H, z, bx, C.GOAL_H * 0.85, z);
      }
      for (let y = 0; y <= C.GOAL_H * 0.85 + 0.01; y += step) pts.push(bx, y, -C.GOAL_HALF_W, bx, y, C.GOAL_HALF_W);
      for (let t = 0; t <= 1.001; t += step / C.GOAL_DEPTH) {
        const x = gx + s * C.GOAL_DEPTH * t, y = C.GOAL_H - C.GOAL_H * 0.15 * t;
        pts.push(x, C.GOAL_H - C.GOAL_H * 0.15 * t, -C.GOAL_HALF_W, x, C.GOAL_H - C.GOAL_H * 0.15 * t, C.GOAL_HALF_W);
        for (const pz of [-C.GOAL_HALF_W, C.GOAL_HALF_W]) pts.push(x, 0, pz, x, y, pz);
      }
      for (const pz of [-C.GOAL_HALF_W, C.GOAL_HALF_W]) for (let y = 0; y <= C.GOAL_H; y += step) {
        const k = y / C.GOAL_H;
        pts.push(gx, y, pz, bx, y * (0.85 + 0.15 * (1 - k)) / 1, pz);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(geo, netMat));
      this.scene.add(g);
    }
  }

  // tribune con pubblico procedurale, tetti, cartelloni e torri faro
  buildStadium() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#1b2433'; g.fillRect(0, 0, 512, 256);
    const shirts = ['#d8d8d8', '#c8202f', '#1e56c8', '#f2c230', '#2d8a4f', '#8a8a8a', '#eeeeee', '#5a3a8a', '#ff8a3d', '#3a3a3a'];
    for (let row = 0; row < 16; row++) {
      g.fillStyle = '#141b27'; g.fillRect(0, row * 16 + 13, 512, 3);
      for (let i = 0; i < 64; i++) {
        if (rand() < 0.1) continue;
        const x = i * 8 + rand() * 2, y = row * 16 + 3;
        g.fillStyle = pick(shirts); g.fillRect(x, y + 4, 6, 7);
        g.fillStyle = pick(['#f1d3b8', '#c68c62', '#6e4630', '#e0b48f']); g.fillRect(x + 1, y, 4, 4);
      }
    }
    const crowdTex = new THREE.CanvasTexture(cv);
    crowdTex.wrapS = crowdTex.wrapT = THREE.RepeatWrapping;
    crowdTex.encoding = THREE.sRGBEncoding;
    this.crowdMeshes = [];
    const concrete = new THREE.MeshLambertMaterial({ color: '#39424f' });
    const roofMat = new THREE.MeshLambertMaterial({ color: '#232b36', side: THREE.DoubleSide });
    const quad = (p, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([].concat(p[0], p[1], p[2], p[0], p[2], p[3]), 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      geo.computeVertexNormals();
      return new THREE.Mesh(geo, mat);
    };
    // tribuna: da (distanza d0, altezza h0) a (d1, h1), lunga "length"
    const stand = (axis, sign, d0, d1, h0, h1, length, rep) => {
      const tex = crowdTex.clone(); tex.needsUpdate = true; tex.repeat.set(rep, 3);
      const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
      const L = length / 2;
      let pts;
      if (axis === 'z') pts = [[-L, h0, sign * d0], [L, h0, sign * d0], [L, h1, sign * d1], [-L, h1, sign * d1]];
      else pts = [[sign * d0, h0, L], [sign * d0, h0, -L], [sign * d1, h1, -L], [sign * d1, h1, L]];
      const mesh = quad(pts, mat);
      this.scene.add(mesh);
      this.crowdMeshes.push(mesh);
      // muro di fondo e tetto
      const back = axis === 'z' ? new THREE.Mesh(new THREE.BoxGeometry(length, h1 + 8, 1), concrete) : new THREE.Mesh(new THREE.BoxGeometry(1, h1 + 8, length), concrete);
      if (axis === 'z') back.position.set(0, (h1 + 8) / 2, sign * (d1 + 0.5)); else back.position.set(sign * (d1 + 0.5), (h1 + 8) / 2, 0);
      this.scene.add(back);
      const roofDepth = (d1 - d0) * 0.75;
      const roof = axis === 'z' ? new THREE.Mesh(new THREE.BoxGeometry(length, 0.6, roofDepth), roofMat) : new THREE.Mesh(new THREE.BoxGeometry(roofDepth, 0.6, length), roofMat);
      if (axis === 'z') roof.position.set(0, h1 + 7, sign * (d1 - roofDepth / 2)); else roof.position.set(sign * (d1 - roofDepth / 2), h1 + 7, 0);
      this.scene.add(roof);
      // parapetto
      const wall = axis === 'z' ? new THREE.Mesh(new THREE.BoxGeometry(length, h0, 0.4), concrete) : new THREE.Mesh(new THREE.BoxGeometry(0.4, h0, length), concrete);
      if (axis === 'z') wall.position.set(0, h0 / 2, sign * d0); else wall.position.set(sign * d0, h0 / 2, 0);
      this.scene.add(wall);
    };
    stand('z', 1, 44, 70, 1.6, 24, 132, 6);
    stand('z', -1, 44, 66, 1.6, 20, 132, 6);
    stand('x', 1, 62, 82, 1.6, 17, 92, 4);
    stand('x', -1, 62, 82, 1.6, 17, 92, 4);
    // cartelloni pubblicitari con marchi inventati
    const adCv = document.createElement('canvas'); adCv.width = 1024; adCv.height = 64;
    const ag = adCv.getContext('2d');
    const ads = [['CAMPO APERTO', '#0e1b2c', '#ffd84a'], ['Birrificio Nebbia', '#6b1d1d', '#ffffff'], ['VoltaBike', '#1e56c8', '#ffffff'],
      ['Caffè Tornante', '#2a1a14', '#f2c230'], ['Lago Assicura', '#1d6b3a', '#ffffff'], ['Ferrovie di Fantasia', '#e5652a', '#ffffff']];
    ads.forEach((a, i) => {
      const w = 1024 / ads.length;
      ag.fillStyle = a[1]; ag.fillRect(i * w, 0, w, 64);
      ag.fillStyle = a[2]; ag.font = 'bold 26px Arial'; ag.textAlign = 'center'; ag.textBaseline = 'middle';
      ag.fillText(a[0], i * w + w / 2, 33);
    });
    const adTex = new THREE.CanvasTexture(adCv); adTex.wrapS = THREE.RepeatWrapping; adTex.encoding = THREE.sRGBEncoding;
    this.adTex = adTex;
    const adMat = new THREE.MeshBasicMaterial({ map: adTex });
    const board = (w, x, z, ry) => {
      const t = adTex.clone(); t.needsUpdate = true; t.repeat.set(w / 60, 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.15), [concrete, concrete, concrete, concrete, new THREE.MeshBasicMaterial({ map: t }), new THREE.MeshBasicMaterial({ map: t })]);
      m.position.set(x, 0.45, z); m.rotation.y = ry; this.scene.add(m);
      this.boards = this.boards || []; this.boards.push(t);
    };
    board(110, 0, -38.5, 0); board(110, 0, 38.5, Math.PI);
    board(30, -57, -21, Math.PI / 2); board(30, -57, 21, Math.PI / 2);
    board(30, 57, -21, -Math.PI / 2); board(30, 57, 21, -Math.PI / 2);
    // torri faro
    const lampMat = new THREE.MeshBasicMaterial({ color: '#fffbe6' });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 42, 8), concrete);
      pole.position.set(sx * 66, 21, sz * 52); this.scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 0.6), lampMat);
      head.position.set(sx * 64, 43, sz * 50); head.lookAt(0, 0, 0); this.scene.add(head);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(26, 26, 1); glow.position.copy(head.position); this.scene.add(glow);
    }
  }
  glowTexture() {
    if (this._glow) return this._glow;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,240,200,0.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return this._glow = new THREE.CanvasTexture(cv);
  }

  buildBall() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#1a1a1a';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) {
      g.beginPath(); g.arc(i * 64 + 32, j * 64 + 32, 20, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(CONFIG.BALL_R * 1.6, 28, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
    // indicatore del giocatore controllato
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), new THREE.MeshBasicMaterial({ color: '#ffd84a' }));
    arrow.rotation.x = Math.PI; this.arrow = arrow; this.scene.add(arrow);
    // ombra di contatto della palla quando è in aria
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }));
    this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.02;
    this.scene.add(this.ballShadow);
  }

  numberTexture(num, color, bg) {
    const S = this.Q.detail > 1 ? 128 : 64;   // numeri più nitidi in alta qualità
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    g.fillStyle = color; g.font = 'bold ' + Math.round(S * 0.62) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), S / 2, S * 0.55);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // unisce più pezzi (geometria, colore, posizione) in una sola geometria con i colori nei vertici:
  // un solo disegno al posto di tanti, stesso aspetto (meno lavoro per la scheda grafica)
  mergeColored(parts) {
    let total = 0;
    const flat = parts.map(pt => {
      const g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo;
      const o = new THREE.Object3D();
      if (pt.pos) o.position.set(pt.pos[0], pt.pos[1], pt.pos[2]);
      if (pt.rot) o.rotation.set(pt.rot[0], pt.rot[1], pt.rot[2]);
      if (pt.scale) o.scale.set(pt.scale[0], pt.scale[1], pt.scale[2]);
      o.updateMatrix();
      g.applyMatrix4(o.matrix);
      total += g.attributes.position.count;
      return { g, c: new THREE.Color(pt.color) };
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let k = 0;
    for (const f of flat) {
      const P = f.g.attributes.position.array, N = f.g.attributes.normal.array, n = f.g.attributes.position.count;
      pos.set(P, k * 3); nor.set(N, k * 3);
      for (let i = 0; i < n; i++) { col[(k + i) * 3] = f.c.r; col[(k + i) * 3 + 1] = f.c.g; col[(k + i) * 3 + 2] = f.c.b; }
      k += n;
      f.g.dispose();
    }
    for (const pt of parts) if (pt.geo.dispose) pt.geo.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  // costruisce un giocatore con primitive: il modello guarda verso +x.
  // Corpo, testa e capelli sono un'unica geometria colorata; gambe e braccia restano snodate.
  // Un solo materiale condiviso da tutti i giocatori (i colori stanno nei vertici).
  makePlayerMesh(p) {
    const look = p.data.look;
    const kit = p.isGK ? (p.team.index === 0 ? ['#2bd18c', '#1a1a1a', '#2bd18c'] : ['#ff7ac8', '#1a1a1a', '#ff7ac8']) : p.team.kit;
    if (!this.playerMat) this.playerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mat = this.playerMat;
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const w = look.build;
    const D = this.Q.detail, seg = n => Math.max(5, Math.round(n * D));
    const parts = [
      { geo: new THREE.CylinderGeometry(0.2 * w, 0.16 * w, 0.62, seg(10)), color: kit[0], pos: [0, 1.2, 0], scale: [1, 1, 1.35] },
      { geo: new THREE.CylinderGeometry(0.17 * w, 0.19 * w, 0.24, seg(10)), color: kit[1], pos: [0, 0.84, 0], scale: [1, 1, 1.4] },
      { geo: new THREE.SphereGeometry(0.12, seg(12), seg(10)), color: look.skin, pos: [0, 1.68, 0] },
      { geo: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6), color: look.skin, pos: [0, 1.54, 0] },
    ];
    if (look.hairStyle !== 'rasati') {
      const hs = look.hairStyle === 'ricci' ? [1.15, 1.1, 1.15] : look.hairStyle === 'cresta' ? [1.05, 1.3, 0.55] : null;
      parts.push({ geo: new THREE.SphereGeometry(0.128, 12, 8, 0, Math.PI * 2, 0, look.hairStyle === 'medi' ? 1.9 : 1.4), color: look.hair, pos: [0, 1.7, 0], rot: [0, 0, 0.25], scale: hs });
    }
    if (look.beard) parts.push({ geo: new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 1.8, 1.2), color: look.hair, pos: [0.02, 1.66, 0] });
    const torso = new THREE.Mesh(this.mergeColored(parts), mat);
    torso.castShadow = true; body.add(torso);
    // numero sulla schiena
    const numMat = new THREE.MeshBasicMaterial({ map: this.numberTexture(p.data.number, kit[1] === kit[0] ? '#ffffff' : kit[1], kit[0]) });
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), numMat);
    num.position.set(-0.2 * w - 0.001, 1.22, 0); num.rotation.y = -Math.PI / 2; body.add(num);
    const cyl = (r1, r2, l) => new THREE.CylinderGeometry(r1, r2, l, seg(7));
    const legs = [], arms = [];
    const armColor = p.isGK ? kit[0] : look.skin;
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0, 0.8, side * 0.1); body.add(hip);
      const thigh = new THREE.Mesh(this.mergeColored([{ geo: cyl(0.075, 0.06, 0.4), color: look.skin, pos: [0, -0.2, 0] }]), mat);
      thigh.castShadow = true; hip.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.4; hip.add(knee);
      // stinco e scarpa nello stesso pezzo (si muovono insieme)
      const shin = new THREE.Mesh(this.mergeColored([
        { geo: cyl(0.06, 0.05, 0.38), color: kit[2], pos: [0, -0.19, 0] },
        { geo: new THREE.BoxGeometry(0.24, 0.07, 0.1), color: look.boots, pos: [0.05, -0.4, 0] },
      ]), mat);
      shin.castShadow = true; knee.add(shin);
      legs.push({ hip, knee });
      const sh = new THREE.Group(); sh.position.set(0, 1.46, side * 0.27 * w); body.add(sh);
      // le braccia non proiettano ombra: differenza invisibile, molto lavoro in meno
      const upper = new THREE.Mesh(this.mergeColored([{ geo: cyl(0.055, 0.05, 0.3), color: kit[0], pos: [0, -0.15, 0] }]), mat);
      sh.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.3; sh.add(elbow);
      const fore = new THREE.Mesh(this.mergeColored([{ geo: cyl(0.045, 0.04, 0.28), color: armColor, pos: [0, -0.14, 0] }]), mat);
      elbow.add(fore);
      arms.push({ sh, elbow });
    }
    const scale = look.height / 1.8;
    root.scale.set(scale, scale, scale);
    this.scene.add(root);
    return { root, body, legs, arms, player: p };
  }

  // libera la memoria della scheda grafica di un giocatore (geometrie e numero; il materiale è condiviso)
  disposePlayerMesh(pm) {
    this.scene.remove(pm.root);
    pm.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== this.playerMat) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }

  setupMatch(match) {
    for (const pm of this.playerMeshes) this.disposePlayerMesh(pm);
    this.playerMeshes = match.allPlayers().map(p => this.makePlayerMesh(p));
    this.match = match;
  }

  clearMatch() {
    for (const pm of this.playerMeshes) this.disposePlayerMesh(pm);
    this.playerMeshes = [];
    this.match = null;
  }

  // anima un giocatore partendo dai dati (partita o replay)
  poseMesh(pm, x, z, facing, phase, speed, kick, diveDir, extra) {
    const root = pm.root, body = pm.body;
    root.position.set(x, 0, z);
    root.rotation.y = -facing;
    const amt = Math.min(speed / 7, 1);
    const sw = Math.sin(phase) * 0.9 * amt;
    pm.legs[0].hip.rotation.z = sw; pm.legs[1].hip.rotation.z = -sw;
    pm.legs[0].knee.rotation.z = -Math.max(0, -Math.sin(phase)) * 1.1 * amt - 0.05;
    pm.legs[1].knee.rotation.z = -Math.max(0, Math.sin(phase)) * 1.1 * amt - 0.05;
    pm.arms[0].sh.rotation.z = -sw * 0.8; pm.arms[1].sh.rotation.z = sw * 0.8;
    pm.arms[0].elbow.rotation.z = 0.6 * amt + 0.2; pm.arms[1].elbow.rotation.z = 0.6 * amt + 0.2;
    pm.arms[0].sh.rotation.x = -0.12; pm.arms[1].sh.rotation.x = 0.12;
    body.rotation.set(0, 0, -amt * 0.12);
    body.position.set(0, Math.abs(Math.sin(phase)) * 0.04 * amt, 0);
    if (kick > 0) { // calcio: gamba destra in avanti
      const k = Math.sin((1 - kick / 0.3) * Math.PI);
      pm.legs[1].hip.rotation.z = 1.2 * k - 0.4; pm.legs[1].knee.rotation.z = -0.2;
    }
    if (diveDir) { // tuffo del portiere
      body.rotation.x = -diveDir * 1.25; body.position.y = 0.3;
      pm.arms[0].sh.rotation.x = -2.6; pm.arms[1].sh.rotation.x = 2.6;
    }
    if (extra && extra.tackle > 0) { body.rotation.z = -0.9; body.position.y = -0.35; pm.legs[1].hip.rotation.z = 1.4; }
    if (extra && extra.header > 0) { body.position.y = 0.35; body.rotation.z = 0.25; }
    if (extra && extra.celebrate) { pm.arms[0].sh.rotation.x = -2.8; pm.arms[1].sh.rotation.x = 2.8; body.position.y = Math.abs(Math.sin(phase * 1.5)) * 0.3; }
  }

  // aggiornamento dal vivo.
  // alpha (0..1): frazione del passo di simulazione già trascorsa; la grafica disegna tra il passo precedente
  // e quello attuale, così il movimento è fluido anche se lo schermo non va esattamente a 60 Hz.
  syncFromMatch(match, dt, alpha) {
    const b = match.ball;
    const useA = alpha !== undefined && b.px !== undefined;
    const a = useA ? clamp(alpha, 0, 1) : 1;
    const mix = (prev, cur, maxJump) => (useA && prev !== undefined && Math.abs(cur - prev) < maxJump ? prev + (cur - prev) * a : cur);
    const bx = mix(b.px, b.x, 3), by = mix(b.py, b.y, 3), bz = mix(b.pz, b.z, 3);
    b.rx = bx; b.ry = by; b.rz = bz;
    this.ballMesh.position.set(bx, by + 0.07, bz);
    const sp = len(b.vx, b.vz);
    if (sp > 0.05) {
      this.ballMesh.rotation.z -= b.vx * dt / 0.18;
      this.ballMesh.rotation.x += b.vz * dt / 0.18;
    }
    this.ballShadow.position.set(bx, 0.02, bz);
    this.ballShadow.visible = by > 0.4;
    const scorers = match.state === 'GOAL' && match.lastGoal ? match.lastGoal.team : null;
    for (const pm of this.playerMeshes) {
      const p = pm.player;
      // posizione disegnata (interpolata), usata anche da indicatori e telecamera
      p.rx = mix(p.px, p.x, 2.5); p.rz = mix(p.pz, p.z, 2.5);
      const f = useA && p.pf !== undefined ? p.pf + angleDiff(p.pf, p.facing) * a : p.facing;
      const ph = mix(p.pph, p.anim.phase, 1.5);
      this.poseMesh(pm, p.rx, p.rz, f, ph, p.speed(), p.anim.kick, p.anim.dive > 0 ? p.anim.diveDir : 0,
        { tackle: p.anim.tackle, header: p.anim.header, celebrate: scorers === p.team && match.stateTime > 0.4 });
    }
    this.syncHumanMarks(match, this.localId, this.names);
    // pubblico: si agita di più vicino alle porte e dopo un gol
    const nearGoal = Math.max(0, (Math.abs(bx) - 30) / 22);
    const target = match.state === 'GOAL' ? 1 : nearGoal * 0.5;
    this.crowdExcite = lerp(this.crowdExcite, target, dt * 2);
    this.animateCrowd(dt);
    const mine = match.humanById ? match.humanById(this.localId) : null;
    this.updateFx(dt);
    this.updateCamera(dt, bx, by, bz, mine && mine.player, match);
  }

  animateCrowd(dt) {
    if (this.boards) for (const t of this.boards) t.offset.x += dt * 0.03;
    if (!this.Q.crowd) return;
    this.crowdPhase += dt * (4 + this.crowdExcite * 10);
    const j = Math.sin(this.crowdPhase) * 0.12 * (0.2 + this.crowdExcite);
    for (let i = 0; i < this.crowdMeshes.length; i++) this.crowdMeshes[i].position.y = j * (i % 2 ? 1 : -1);
  }

  // aggiornamento dal replay
  syncFromReplay(frame, match, dt) {
    this.ballMesh.position.set(frame[0], frame[1] + 0.07, frame[2]);
    this.ballShadow.position.set(frame[0], 0.02, frame[2]);
    this.ballShadow.visible = frame[1] > 0.4;
    let k = 3;
    for (const pm of this.playerMeshes) {
      this.poseMesh(pm, frame[k], frame[k + 1], frame[k + 2], frame[k + 3], frame[k + 4], frame[k + 5], frame[k + 6], null);
      k += 7;
    }
    for (const mk of this.humanMarks) { mk.ring.visible = false; if (mk.label) mk.label.visible = false; }
    this.arrow.visible = false;
    this.updateFx(dt);
    this.crowdExcite = lerp(this.crowdExcite, 0.6, dt);
    this.animateCrowd(dt);
    // telecamera del replay: bassa e laterale verso la porta
    const side = Math.sign(frame[0]) || 1;
    const want = new THREE.Vector3(frame[0] - side * 14, 5, frame[2] + 16);
    this.camera.position.lerp(want, Math.min(1, dt * 2.5));
    this.camTarget.lerp(new THREE.Vector3(frame[0], frame[1] * 0.5 + 0.5, frame[2]), Math.min(1, dt * 5));
    this.camera.lookAt(this.camTarget);
  }

  updateCamera(dt, bx, by, bz, controlled, match) {
    // vettori riusati (niente oggetti nuovi a ogni fotogramma)
    const want = this._want || (this._want = new THREE.Vector3()), look = this._look || (this._look = new THREE.Vector3());
    if (this.camMode === 0) {
      want.set(bx * 0.82, 24, bz * 0.3 + 47);
      look.set(bx * 0.9, 0, bz * 0.55 + 2);
    } else if (this.camMode === 1) {
      want.set(bx * 0.5, 55, bz * 0.2 + 75);
      look.set(bx * 0.6, 0, bz * 0.3);
    } else {
      const mh = match && match.humanById ? match.humanById(this.localId) : null;
      const dir = mh ? match.teams[mh.team].dir : 1;
      const f = controlled ? { x: controlled.rx !== undefined ? controlled.rx : controlled.x, z: controlled.rz !== undefined ? controlled.rz : controlled.z } : { x: bx, z: bz };
      want.set(f.x - dir * 16, 9, f.z * 0.9);
      look.set(f.x + dir * 8, 0, f.z * 0.8);
    }
    // inseguimento esponenziale: stessa morbidezza a 30, 60 o 144 fps
    this.camera.position.lerp(want, 1 - Math.exp(-3 * dt));
    this.camTarget.lerp(look, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(this.camTarget);
    // piccolo tremolio della telecamera dopo un gol
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * a; this.camera.position.y += (Math.random() - 0.5) * a;
    }
  }

  // inquadratura lenta dello stadio per il menu
  menuCamera(t) {
    const a = t * 0.05;
    // orbita dentro lo stadio (le tribune iniziano a 44 m sui lati e 62 m sui fondi)
    this.camera.position.set(Math.cos(a) * 54, 24 + Math.sin(t * 0.1) * 3, Math.sin(a) * 40);
    this.camera.lookAt(0, 0, 0);
  }

  setQuality(id) {
    if (!QUALITY_PRESETS[id] || id === this.qualityId) return;
    const old = this.Q;
    this.qualityId = id; this.Q = QUALITY_PRESETS[id];
    const r = this.renderer;
    r.shadowMap.enabled = this.Q.shadows;
    r.shadowMap.type = this.Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (old.shadowSize !== this.Q.shadowSize && this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(this.Q.shadowSize, this.Q.shadowSize);
    if (old.pitch !== this.Q.pitch || old.aniso !== this.Q.aniso) {
      const prev = this.pitch.material.map;
      this.pitch.material.map = this.pitchTexture();
      prev.dispose();
    }
    // i materiali vanno ricompilati quando cambiano le ombre
    this.scene.traverse(o => { if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); } });
    this.resize();
  }

  // ---------- EFFETTI: particelle (erba, polvere, coriandoli) ----------
  buildFx() {
    const N = this.fxMax = 600;
    const geo = new THREE.BufferGeometry();
    this.fxPos = new Float32Array(N * 3); this.fxCol = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.fxPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.fxCol, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const dg = dot.getContext('2d');
    const gr = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = gr; dg.fillRect(0, 0, 32, 32);
    this.fxPoints = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.3, map: new THREE.CanvasTexture(dot), vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.05 }));
    this.fxPoints.frustumCulled = false;
    this.scene.add(this.fxPoints);
    this.fx = [];   // particelle vive: { x,y,z, vx,vy,vz, life, max, r,g,b, drag, grav }
  }

  // getto di particelle: kind = 'grass' | 'dust' | 'confetti'
  burst(kind, x, z, opts) {
    opts = opts || {};
    const mult = this.Q.particles;
    const n = Math.round((kind === 'confetti' ? 220 : kind === 'grass' ? 14 : 10) * mult * (opts.amount || 1));
    const c1 = new THREE.Color(), c2 = new THREE.Color();
    if (kind === 'confetti') { c1.set(opts.colors ? opts.colors[0] : '#ffd84a'); c2.set(opts.colors ? opts.colors[1] : '#ffffff'); }
    for (let i = 0; i < n && this.fx.length < this.fxMax; i++) {
      const a = Math.random() * Math.PI * 2;
      let p;
      if (kind === 'confetti') {
        const c = Math.random() < 0.5 ? c1 : c2;
        p = { x: x + (Math.random() - 0.5) * 8, y: 6 + Math.random() * 8, z: z + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: (Math.random() - 0.5) * 3,
          life: 0, max: 2.5 + Math.random() * 2, r: c.r, g: c.g, b: c.b, drag: 1.6, grav: 2.2 };
      } else {
        const sp = kind === 'grass' ? 2 + Math.random() * 3 : 1 + Math.random() * 1.5;
        const green = kind === 'grass';
        p = { x: x, y: 0.05, z: z, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * (green ? 3 : 1.5), vz: Math.sin(a) * sp,
          life: 0, max: green ? 0.6 + Math.random() * 0.4 : 0.8 + Math.random() * 0.5,
          r: green ? 0.2 : 0.55, g: green ? 0.45 + Math.random() * 0.15 : 0.5, b: green ? 0.16 : 0.38, drag: 2.5, grav: green ? 9 : 2 };
      }
      this.fx.push(p);
    }
  }

  updateFx(dt) {
    const out = this.fx;
    let w = 0;
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      p.life += dt;
      if (p.life >= p.max || p.y < -0.1) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03) { p.y = 0.03; p.vy = 0; }
      out[w++] = p;
    }
    out.length = w;
    const pos = this.fxPos, col = this.fxCol;
    for (let i = 0; i < this.fxMax; i++) {
      if (i < w) {
        const p = out[i], fade = 1 - p.life / p.max;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        col[i * 3] = p.r * fade + 0.0; col[i * 3 + 1] = p.g * fade; col[i * 3 + 2] = p.b * fade;
      } else { pos[i * 3 + 1] = -100; }
    }
    this.fxPoints.geometry.attributes.position.needsUpdate = true;
    this.fxPoints.geometry.attributes.color.needsUpdate = true;
    this.fxPoints.geometry.setDrawRange(0, Math.max(1, w));
  }

  // ---------- INDICATORI DEI GIOCATORI UMANI (anello + nome) ----------
  nameSprite(text, color) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = '700 30px "Saira Condensed", Arial, sans-serif';
    const w = Math.min(240, g.measureText(text).width + 28);
    g.fillStyle = 'rgba(12,26,43,0.82)';
    g.fillRect((256 - w) / 2, 10, w, 44);
    g.fillStyle = color; g.fillRect((256 - w) / 2, 10, 5, 44);
    g.fillStyle = '#f3f5ee'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128 + 2, 33);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    sp.scale.set(4, 1, 1);
    sp.renderOrder = 10;
    return sp;
  }

  // un indicatore per ogni umano: giallo per te, chiaro per i compagni, rosso per gli avversari
  syncHumanMarks(match, localId, names) {
    const humans = match.humans;
    const local = humans.find(h => h.id === localId);
    while (this.humanMarks.length > humans.length) { const m = this.humanMarks.pop(); this.scene.remove(m.ring); if (m.label) this.scene.remove(m.label); }
    humans.forEach((h, i) => {
      let mk = this.humanMarks[i];
      const isMe = h.id === localId;
      const color = isMe ? '#ffd84a' : (local && h.team === local.team ? '#9fd8ff' : '#ff6a55');
      const label = isMe ? '' : (names && names[h.id]) || '';
      if (!mk || mk.color !== color || mk.text !== label) {
        if (mk) { this.scene.remove(mk.ring); if (mk.label) this.scene.remove(mk.label); }
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, isMe ? 0.78 : 0.7, 28), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035;
        this.scene.add(ring);
        const sp = label ? this.nameSprite(label, color) : null;
        if (sp) this.scene.add(sp);
        mk = this.humanMarks[i] = { ring: ring, label: sp, color: color, text: label };
      }
      const p = h.player;
      mk.ring.visible = !!p;
      if (mk.label) mk.label.visible = !!p;
      if (!p) return;
      const px = p.rx !== undefined ? p.rx : p.x, pz = p.rz !== undefined ? p.rz : p.z;
      mk.ring.position.x = px; mk.ring.position.z = pz;
      if (isMe) mk.ring.material.color.set(h.shootCharge > 0 ? (h.shootCharge > 0.9 ? '#ff5a36' : '#ffae3d') : '#ffd84a');
      if (mk.label) mk.label.position.set(px, 2.9 * p.data.look.height / 1.8, pz);
    });
    // freccia sopra il tuo calciatore
    const me = local && local.player;
    this.arrow.visible = !!me;
    if (me) this.arrow.position.set(me.rx !== undefined ? me.rx : me.x, 2.45 * me.data.look.height / 1.8 + Math.sin(match.realTime * 5) * 0.06, me.rz !== undefined ? me.rz : me.z);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
