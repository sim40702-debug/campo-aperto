// ============================================================
// RENDER 3D (Three.js) — tutto generato proceduralmente
// ============================================================
// preset grafici: dprCap = massimo rapporto pixel (Ultra = risoluzione nativa, anche 4K)
const QUALITY_PRESETS = {
  bassa: { dprCap: 1, shadows: false, shadowSize: 1024, soft: false, pitch: 2048, aniso: 2, particles: 0.4, detail: 0.8, crowd: false, post: 0 },
  media: { dprCap: 1, shadows: true, shadowSize: 1024, soft: false, pitch: 2048, aniso: 4, particles: 0.7, detail: 1, crowd: true, post: 0.8 },
  alta: { dprCap: 1.5, shadows: true, shadowSize: 2048, soft: true, pitch: 4096, aniso: 8, particles: 1, detail: 1.3, crowd: true, post: 1 },
  ultra: { dprCap: 3, shadows: true, shadowSize: 4096, soft: true, pitch: 4096, aniso: 16, particles: 1, detail: 1.6, crowd: true, post: 1 },
};

// profili del corpo [raggio, altezza] in metri per un calciatore di 1,80 m (prima della scala per la corporatura)
const TORSO_PROFILE = [[0.0, 0.93], [0.15, 0.935], [0.158, 0.98], [0.155, 1.06], [0.163, 1.16], [0.182, 1.27], [0.198, 1.36],
  [0.205, 1.42], [0.19, 1.47], [0.15, 1.505], [0.085, 1.525], [0.055, 1.53], [0.0, 1.53]];
// i punti vanno dal basso verso l'alto: con l'ordine inverso le facce guardano dentro e si vede l'interno
const SHORTS_PROFILE = [[0.0, 0.765], [0.172, 0.765], [0.176, 0.8], [0.172, 0.88], [0.163, 0.95], [0.156, 0.995], [0.0, 0.995]];

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
    r.toneMappingExposure = 1.04;
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
    this.buildPitch(); this.buildFieldLines();
    this.buildGoals();
    this.buildStadium();
    this.buildBenches();   // panchine, allenatori e tunnel (09_render_bench.js)
    this.buildBall(); this.buildBallExtras();
    this.buildFx();
    this.buildWeather();    // pioggia e neve (src/client/09_render_weather.js)
    this.playerMeshes = [];
    this.cosmetics = new Map();   // aspetto comprato nel negozio (dal server) per i calciatori degli umani
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
  // con una risoluzione scelta (renderHeight) si disegna esattamente a quell'altezza, qualunque sia la finestra
  pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this.renderHeight) {
      const h = this.container.clientHeight || window.innerHeight || 1;
      return Math.max(0.35, Math.min(4, this.renderHeight / h) * this.resScale * this.dynScale);
    }
    return Math.max(0.35, Math.min(dpr, this.Q.dprCap) * this.resScale * this.dynScale);
  }
  setRenderResolution(height) { this.renderHeight = height || 0; this.resize(); }

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
    s.add(this.hemi = new THREE.HemisphereLight('#c9dcff', '#1f3a24', 0.5));
    const sun = this.sun = new THREE.DirectionalLight('#fff3df', 1.05);
    sun.position.set(-35, 90, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.Q.shadowSize, this.Q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -70; c.right = 70; c.top = 50; c.bottom = -50; c.near = 10; c.far = 220;
    sun.shadow.bias = -0.0005;
    s.add(sun);
    const fill = this.fill = new THREE.DirectionalLight('#9fb8ff', 0.25);
    fill.position.set(40, 50, -40);
    s.add(fill);
  }

  // texture del campo disegnata su canvas: strisce, linee, aree
  // texture del campo: la risoluzione dipende dalla qualità (fino a 4096 px, ~39 px per metro)
  pitchTexture() {
    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    const W = Math.min(this.Q.pitch, maxTex), H = Math.round(W * 68 / 105);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#236b30' : '#2f8a3e';   // strisce del tosaerba ben visibili, verde pieno
      g.fillRect(i * W / 14, 0, W / 14 + 1, H);
    }
    // trama dell'erba: puntini e fili proporzionati alla risoluzione
    const dots = Math.round(9000 * (W / 2100) * (W / 2100));
    const ds = Math.max(2, Math.round(W / 700));
    for (let i = 0; i < dots; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
      g.fillRect(Math.random() * W, Math.random() * H, ds, ds);
    }
    // luce dei quattro fari: il prato è un po' più chiaro sotto le torri e verso il centro
    for (const [fx, fz] of [[0.18, 0.12], [0.82, 0.12], [0.18, 0.88], [0.82, 0.88], [0.5, 0.5]]) {
      const gr = g.createRadialGradient(fx * W, fz * H, 0, fx * W, fz * H, H * 0.55);
      gr.addColorStop(0, 'rgba(255,255,220,0.07)'); gr.addColorStop(1, 'rgba(255,255,220,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    // segni dell'usura davanti alle porte e al centro
    for (const cx of [0.06, 0.5, 0.94]) {
      const gr = g.createRadialGradient(cx * W, H / 2, 0, cx * W, H / 2, H * 0.22);
      gr.addColorStop(0, 'rgba(70,60,30,0.16)'); gr.addColorStop(1, 'rgba(70,60,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    // le linee del campo non sono più nella texture: sono geometria vera (09_render_field.js)
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = Math.min(this.Q.aniso, this.renderer.capabilities.getMaxAnisotropy());
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // trama fine dell'erba (fili e zolle) ripetuta molte volte sul campo: da vicino il prato non sembra più piatto.
  // Un solo campionamento in più nello shader, nessun oggetto in più.
  grassDetailTexture() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const v = 70 + Math.random() * 120 | 0, x = Math.random() * S, y = Math.random() * S, h = 2 + Math.random() * 5;
      g.strokeStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 2, y - h); g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1), x = Math.random() * S, y = Math.random() * S, r = 10 + Math.random() * 30;
      gr.addColorStop(0, 'rgba(' + (Math.random() < 0.5 ? '0,0,0,0.10' : '255,255,255,0.08') + ')'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.save(); g.translate(x, y); g.scale(r, r); g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(this.Q.aniso, this.renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  buildPitch() {
    // il campo si disegna sempre sopra l'erba (o la neve) attorno: niente righe che tremolano da lontano
    const pitchMat = new THREE.MeshLambertMaterial({ map: this.pitchTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    if (this.Q.detail >= 1) {
      const detail = this.grassDetailTexture();
      pitchMat.onBeforeCompile = sh => {
        sh.uniforms.grassDetail = { value: detail };
        sh.fragmentShader = 'uniform sampler2D grassDetail;\n' + sh.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\n  float gd = texture2D(grassDetail, vUv * vec2(84.0, 54.4)).r;\n  diffuseColor.rgb *= 0.84 + gd * 0.32;' +
          // macchie larghe di erba più chiara e più scura (prato vero, non un colore uniforme), stessa trama vista da lontano
          '\n  float gm = texture2D(grassDetail, vUv * vec2(3.1, 2.0) + vec2(0.37, 0.11)).r;\n  diffuseColor.rgb *= 0.9 + gm * 0.2;');
      };
    }
    const pitch = this.pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), pitchMat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.scene.add(pitch);
    // erba attorno al campo
    const cv2 = document.createElement('canvas'); cv2.width = 64; cv2.height = 64;
    const g2 = cv2.getContext('2d');
    for (let i = 0; i < 2; i++) { g2.fillStyle = i ? '#2a6d38' : '#2e7640'; g2.fillRect(i * 32, 0, 32, 64); }
    const t2 = new THREE.CanvasTexture(cv2); t2.wrapS = t2.wrapT = THREE.RepeatWrapping; t2.repeat.set(9, 1);
    t2.encoding = THREE.sRGBEncoding;
    const around = this.around = new THREE.Mesh(new THREE.PlaneGeometry(135, 96), new THREE.MeshLambertMaterial({ map: t2 }));
    around.rotation.x = -Math.PI / 2; around.position.y = -0.05; around.receiveShadow = true;
    this.scene.add(around);
    // bandierine
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 6), new THREE.MeshLambertMaterial({ color: '#eeeeee' }));
      pole.position.set(sx * 52.5, 0.75, sz * 34); this.scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), new THREE.MeshLambertMaterial({ color: '#ffd84a', side: THREE.DoubleSide }));
      flag.position.set(sx * 52.5 + 0.22, 1.33, sz * 34); this.scene.add(flag);
    }
  }

  // porte e reti: 09_render_net.js

  // tribune con pubblico procedurale, tetti, cartelloni e torri faro
  buildStadium() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#1b2433'; g.fillRect(0, 0, 512, 256);
    this.crowdHeads = [];
    const shirts = ['#d8d8d8', '#c8202f', '#1e56c8', '#f2c230', '#2d8a4f', '#8a8a8a', '#eeeeee', '#5a3a8a', '#ff8a3d', '#3a3a3a'];
    for (let row = 0; row < 16; row++) {
      g.fillStyle = '#141b27'; g.fillRect(0, row * 16 + 13, 512, 3);
      for (let i = 0; i < 64; i++) {
        if (rand() < 0.1) continue;
        const x = i * 8 + rand() * 2, y = row * 16 + 3;
        g.fillStyle = pick(shirts); g.fillRect(x, y + 4, 6, 7);
        g.fillStyle = pick(['#f1d3b8', '#c68c62', '#6e4630', '#e0b48f']); g.fillRect(x + 1, y, 4, 4);
        this.crowdHeads.push([x + 1, y]);
      }
    }
    // tifosi: a Natale molti hanno il cappello rosso (09_render_natale.js ridisegna sopra le teste)
    this.crowdCanvas = cv; this.crowdPlain = g.getImageData(0, 0, 512, 256);
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
    const lampMat = this.lampMat = new THREE.MeshBasicMaterial({ color: '#fffbe6' });
    this.floodGlows = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 42, 8), concrete);
      pole.position.set(sx * 66, 21, sz * 52); this.scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 0.6), lampMat);
      head.position.set(sx * 64, 43, sz * 50); head.lookAt(0, 0, 0); this.scene.add(head);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTexture(), color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(26, 26, 1); glow.position.copy(head.position); this.scene.add(glow);
      this.floodGlows.push(glow);
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

  // pallone: 09_render_ball.js
  buildBallExtras() {
    // ombra morbida del pallone: piccola e scura a terra, più larga e chiara quando sale
    this.ballShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: this.softShadowTexture(), color: '#000000', transparent: true, opacity: 0.55, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.02;
    this.scene.add(this.ballShadow);
    // ombre di contatto dei giocatori (occlusione ai piedi): tutte in un solo disegno
    this.footShadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.softShadowTexture(), color: '#000000', transparent: true, opacity: 0.42, depthWrite: false }), 22);
    this.footShadows.frustumCulled = false;
    this.footShadows.count = 0;
    this.scene.add(this.footShadows);
    this._shadowM = new THREE.Matrix4(); this._shadowQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); this._shadowS = new THREE.Vector3(); this._shadowP = new THREE.Vector3();
  }
  softShadowTexture() {
    if (this._softShadow) return this._softShadow;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return this._softShadow = new THREE.CanvasTexture(cv);
  }
  setFootShadow(i, x, z, sx, sz, rot) {
    const q = this._shadowQ.clone();
    if (rot) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot));
    this._shadowM.compose(this._shadowP.set(x, 0.018, z), q, this._shadowS.set(sx, sz, 1));
    this.footShadows.setMatrixAt(i, this._shadowM);
  }
  // pallone e ombra: l'ombra si allarga e si schiarisce con l'altezza
  placeBallShadow(x, y, z) {
    const h = Math.max(0, y - CONFIG.BALL_R);
    const k = 1 + h * 0.35;
    this.ballShadow.position.set(x, 0.02, z);
    this.ballShadow.scale.set(k, k, 1);
    this.ballShadow.material.opacity = 0.55 / (1 + h * 0.6);
  }

  numberTexture(num, color, bg, name) {
    const S = this.Q.detail > 1 ? 128 : 64;   // numeri più nitidi in alta qualità
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (name) {
      // nome sopra il numero (personaggio dell'account)
      g.font = 'bold ' + Math.round(S * 0.17) + 'px Arial';
      g.fillText(String(name).slice(0, 12), S / 2, S * 0.13, S * 0.96);
      g.font = 'bold ' + Math.round(S * 0.56) + 'px Arial';
      g.fillText(String(num), S / 2, S * 0.62);
    } else {
      g.font = 'bold ' + Math.round(S * 0.62) + 'px Arial';
      g.fillText(String(num), S / 2, S * 0.55);
    }
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
      return { g, c: new THREE.Color(pt.color), rough: pt.rough === undefined ? 0.62 : pt.rough, fabric: pt.fabric ? 1 : 0 };
    });
    // oltre al colore ogni vertice porta quanto è opaco (aRough) e se è stoffa (aFabric): 09_render_players.js
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const rough = new Float32Array(total), fab = new Float32Array(total);
    let k = 0;
    for (const f of flat) {
      const P = f.g.attributes.position.array, N = f.g.attributes.normal.array, n = f.g.attributes.position.count;
      pos.set(P, k * 3); nor.set(N, k * 3);
      for (let i = 0; i < n; i++) { col[(k + i) * 3] = f.c.r; col[(k + i) * 3 + 1] = f.c.g; col[(k + i) * 3 + 2] = f.c.b; rough[k + i] = f.rough; fab[k + i] = f.fabric; }
      k += n;
      f.g.dispose();
    }
    for (const pt of parts) if (pt.geo.dispose) pt.geo.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aRough', new THREE.BufferAttribute(rough, 1));
    geo.setAttribute('aFabric', new THREE.BufferAttribute(fab, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  // superficie di rotazione da un profilo [raggio, altezza] (raggi scalati con la corporatura)
  lathe(profile, w, segments) {
    return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r * w), y)), segments);
  }

  // costruisce un giocatore con primitive: il modello guarda verso +x (altezza di riferimento 1,80 m).
  // Scheletro: bacino (anca a 0,92 m, gambe lunghe come in un atleta) con cosce, ginocchia e tibie; busto con
  // perno in vita (si piega e ruota contro il bacino nella corsa), spalle, gomiti; collo con la testa, che resta
  // dritta mentre il corpo si inclina. Ogni pezzo è una geometria unica colorata nei vertici, un solo materiale.
  makePlayerMesh(p) {
    // aspetto: comprato dal giocatore umano (dal server) oppure scelto per una tua squadra (look.items, 22_team_editor.js)
    const cos = this.cosmetics.get(p) || (p.data.look && p.data.look.items ? { items: p.data.look.items, number: p.data.number } : null), it = (cos && cos.items) || {};
    const look0 = p.data.look;
    // capelli e scarpe dell'aspetto comprato; il resto della maglia resta quello della squadra
    const look = !cos ? look0 : Object.assign({}, look0, {
      hairStyle: it.capelli ? it.capelli.style : look0.hairStyle, hair: it.capelli ? it.capelli.color : look0.hair,
      boots: it.scarpe ? it.scarpe.color : look0.boots, beard: it.capelli ? false : look0.beard,
    });
    const kit0 = p.isGK ? (p.team.index === 0 ? ['#2bd18c', '#1a1a1a', '#2bd18c'] : ['#ff7ac8', '#1a1a1a', '#ff7ac8']) : p.team.kit;
    const kit = [kit0[0], it.pantaloncini ? it.pantaloncini.color : kit0[1], it.calzettoni ? it.calzettoni.color : kit0[2]];
    const trim = kit0[1] === kit0[0] ? '#ffffff' : kit0[1];   // colletto e bordi delle maniche
    const pat = it.maglia || null, acc = it.accessori || null, gloves = it.guanti ? it.guanti.color : (p.isGK ? '#f2f2f2' : null);
    const collar = pat && (pat.pattern === 'colletto' || pat.pattern === 'bordi') ? pat.color : trim;
    // materiale unico con opacità diversa per pelle, stoffa, capelli e scarpe, e pieghe nella stoffa (09_render_players.js)
    const mat = this.playerMaterial(), RO = PART_ROUGH;
    const mesh = (parts, shadow) => { const m = new THREE.Mesh(this.mergeColored(parts), mat); m.castShadow = shadow !== false; return m; };
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const w = look.build;
    const D = this.Q.detail, seg = n => Math.max(5, Math.round(n * D));
    const cyl = (r1, r2, l, n) => new THREE.CylinderGeometry(r1, r2, l, seg(n || 9));
    const skinDark = '#' + new THREE.Color(look.skin).multiplyScalar(0.8).getHexString();
    const HIP = 0.92, WAIST = 0.98, NECK = 1.5, HY = 1.665;
    // ---- bacino: pantaloncini (profilo spostato al perno dell'anca)
    const pelvis = new THREE.Group(); pelvis.position.y = HIP; body.add(pelvis);
    pelvis.add(mesh([{ geo: this.lathe(SHORTS_PROFILE, w, seg(14)), color: kit[1], fabric: true, pos: [0, -HIP, 0], scale: [0.8, 1, 1.2] },
      ...this.profileSeams(SHORTS_PROFILE, w, 1.2, -HIP, shadeColor(kit[1], 0.72), 0.15)]));
    // ---- busto con perno in vita
    const chest = new THREE.Group(); chest.position.y = WAIST; body.add(chest);
    const torsoParts = [
      // spalle larghe circa 46 cm, busto meno profondo che largo (proporzioni da atleta, non da manichino)
      { geo: this.lathe(TORSO_PROFILE, w, seg(16)), color: kit[0], fabric: true, pos: [0, -WAIST, 0], scale: [0.7, 1, 1.18] },
      { geo: new THREE.SphereGeometry(0.07, seg(9), seg(7)), color: kit[0], fabric: true, pos: [0, 1.435 - WAIST, 0.222 * w], scale: [1, 0.86, 1] },
      { geo: new THREE.SphereGeometry(0.07, seg(9), seg(7)), color: kit[0], fabric: true, pos: [0, 1.435 - WAIST, -0.222 * w], scale: [1, 0.86, 1] },
      // colletto a polo: fascia attorno al collo e due punte sul davanti, con la piccola apertura scura
      { geo: cyl(0.068, 0.086, 0.04, 12), color: collar, pos: [0, 1.515 - WAIST, 0] },
      { geo: new THREE.BoxGeometry(0.05, 0.004, 0.034), color: collar, pos: [0.085, 1.5 - WAIST, 0.022], rot: [0.25, 0.5, -0.55] },
      { geo: new THREE.BoxGeometry(0.05, 0.004, 0.034), color: collar, pos: [0.085, 1.5 - WAIST, -0.022], rot: [-0.25, -0.5, -0.55] },
      { geo: new THREE.BoxGeometry(0.006, 0.07, 0.012), color: shadeColor(kit[0], 0.55), pos: [0.142 * w * 0.7 + 0.03, 1.47 - WAIST, 0], rot: [0, 0, -0.35] },
      // orlo in fondo alla maglia: una fascia appena più scura
      { geo: cyl(0.159 * w, 0.157 * w, 0.025, 14), color: shadeColor(kit[0], 0.82), fabric: true, pos: [0, 0.95 - WAIST, 0], scale: [0.7, 1, 1.18] },
      // cuciture sui fianchi
      ...this.profileSeams(TORSO_PROFILE, w, 1.18, -WAIST, shadeColor(kit[0], 0.7), 0.15),
    ];
    if (pat) {
      const fx = 0.148 * w;   // superficie davanti (+x) e dietro (-x) del busto
      if (pat.pattern === 'bordi') torsoParts.push({ geo: cyl(0.16 * w, 0.16 * w, 0.04, 10), color: pat.color, pos: [0, 0.955 - WAIST, 0], scale: [0.75, 1, 1.2] });
      if (pat.pattern === 'righe') for (const z of [-0.14, -0.048, 0.048, 0.14]) for (const sx of [1, -1]) torsoParts.push({ geo: new THREE.BoxGeometry(0.02, 0.54, 0.045), color: pat.color, pos: [sx * (fx - Math.abs(z) * 0.16), 1.22 - WAIST, z * w] });
      if (pat.pattern === 'fascia') for (const sx of [1, -1]) torsoParts.push({ geo: new THREE.BoxGeometry(0.02, 0.09, 0.5 * w), color: pat.color, pos: [sx * (fx + 0.006), 1.24 - WAIST, 0], rot: [sx * 0.75, 0, 0] });
    }
    chest.add(mesh(torsoParts));
    // numero sulla schiena: a 1,26 m il profilo del busto ha raggio 0,18 (profondità × 0,7)
    const numColor = kit0[1] === kit0[0] ? '#ffffff' : kit0[1];
    const numMat = new THREE.MeshBasicMaterial({ map: cos ? this.numberTexture(cos.number || p.data.number, numColor, kit0[0], cos.name) : this.numberTexture(p.data.number, numColor, kit0[0]) });
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), numMat);
    num.position.set(-0.18 * 0.7 * w - 0.006, 1.27 - WAIST, 0); num.rotation.y = -Math.PI / 2; chest.add(num);
    // ---- collo e testa (perno alla base del collo)
    const neck = new THREE.Group(); neck.position.y = NECK - WAIST; chest.add(neck);
    const H = HY - NECK;
    const headParts = [
      { geo: cyl(0.054, 0.062, 0.12, 9), color: look.skin, rough: RO.skin, pos: [0, 0.045, 0] },
      { geo: new THREE.SphereGeometry(0.112, seg(14), seg(12)), color: look.skin, rough: RO.skin, pos: [0, H, 0], scale: [1.02, 1.16, 0.94] },
      { geo: new THREE.SphereGeometry(0.07, seg(8), seg(6)), color: look.skin, rough: RO.skin, pos: [0.045, H - 0.075, 0], scale: [1, 0.75, 1.1] },
      // zigomi appena accennati
      { geo: new THREE.SphereGeometry(0.022, 6, 5), color: look.skin, rough: RO.skin, pos: [0.085, H - 0.015, 0.05], scale: [0.7, 0.8, 1] },
      { geo: new THREE.SphereGeometry(0.022, 6, 5), color: look.skin, rough: RO.skin, pos: [0.085, H - 0.015, -0.05], scale: [0.7, 0.8, 1] },
      { geo: new THREE.SphereGeometry(0.025, 6, 5), color: skinDark, rough: RO.skin, pos: [-0.005, H, 0.103], scale: [0.7, 1.2, 0.6] },
      { geo: new THREE.SphereGeometry(0.025, 6, 5), color: skinDark, rough: RO.skin, pos: [-0.005, H, -0.103], scale: [0.7, 1.2, 0.6] },
      { geo: new THREE.ConeGeometry(0.018, 0.045, 5), color: skinDark, rough: RO.skin, pos: [0.115, H - 0.012, 0], rot: [0, 0, -Math.PI / 2] },
      // occhi: bianco dell'occhio, iride colorata e pupilla
      { geo: new THREE.SphereGeometry(0.017, 8, 6), color: '#f1ece4', rough: RO.eye, pos: [0.101, H + 0.018, 0.036], scale: [0.6, 0.7, 1] },
      { geo: new THREE.SphereGeometry(0.017, 8, 6), color: '#f1ece4', rough: RO.eye, pos: [0.101, H + 0.018, -0.036], scale: [0.6, 0.7, 1] },
      { geo: new THREE.SphereGeometry(0.0085, 6, 4), color: look.eyes || '#4a3424', rough: RO.eye, pos: [0.1095, H + 0.018, 0.036], scale: [0.5, 1, 1] },
      { geo: new THREE.SphereGeometry(0.0085, 6, 4), color: look.eyes || '#4a3424', rough: RO.eye, pos: [0.1095, H + 0.018, -0.036], scale: [0.5, 1, 1] },
      { geo: new THREE.SphereGeometry(0.004, 4, 3), color: '#0c0a08', rough: RO.eye, pos: [0.1135, H + 0.018, 0.036] },
      { geo: new THREE.SphereGeometry(0.004, 4, 3), color: '#0c0a08', rough: RO.eye, pos: [0.1135, H + 0.018, -0.036] },
      // sopracciglia
      { geo: new THREE.BoxGeometry(0.012, 0.01, 0.036), color: look.hair, rough: RO.hair, pos: [0.108, H + 0.043, 0.036], rot: [0.15, 0, 0] },
      { geo: new THREE.BoxGeometry(0.012, 0.01, 0.036), color: look.hair, rough: RO.hair, pos: [0.108, H + 0.043, -0.036], rot: [-0.15, 0, 0] },
      // bocca: labbra un po' più scure della pelle
      { geo: new THREE.BoxGeometry(0.01, 0.009, 0.042), color: shadeColor(look.skin, 0.66), rough: RO.skin, pos: [0.111, H - 0.058, 0] },
      { geo: new THREE.BoxGeometry(0.008, 0.006, 0.034), color: shadeColor(look.skin, 0.75), rough: RO.skin, pos: [0.11, H - 0.066, 0] },
    ];
    const hair = (scale, thetaLen, dy) => headParts.push({ geo: new THREE.SphereGeometry(0.118, seg(12), seg(8), 0, Math.PI * 2, 0, thetaLen), color: look.hair, rough: RO.hair, pos: [-0.008, H + (dy || 0.012), 0], rot: [0, 0, 0.32], scale: scale });
    if (look.hairStyle === 'ricci') hair([1.12, 1.2, 1.06], 1.55, 0.024);
    else if (look.hairStyle === 'cresta') { hair([1.0, 1.05, 0.96], 1.1, 0.0); headParts.push({ geo: new THREE.BoxGeometry(0.17, 0.06, 0.05), color: look.hair, pos: [0.0, H + 0.13, 0], rot: [0, 0, 0.15] }); }
    else if (look.hairStyle === 'medi') hair([1.06, 1.16, 1.0], 1.95, 0.0);
    else if (look.hairStyle === 'rasati') hair([1.0, 1.15, 0.95], 1.25, 0.004);
    else hair([1.03, 1.15, 0.97], 1.4, 0.01);
    if (look.beard) headParts.push({ geo: new THREE.SphereGeometry(0.098, 10, 6, 0, Math.PI * 2, 1.75, 1.25), color: look.hair, pos: [0.018, H - 0.012, 0], scale: [1.02, 1.12, 0.95] });
    if (acc && acc.kind === 'fascia') headParts.push({ geo: cyl(0.118, 0.118, 0.032, 12), color: acc.color, pos: [-0.005, H + 0.06, 0], scale: [1.02, 1, 0.95] });
    // tema di Natale: cappello di Babbo Natale (09_render_natale.js)
    if (this.xmas) for (const hp of this.xmasHatParts(H, seg)) headParts.push(hp);
    const head = mesh(headParts); neck.add(head);
    const legs = [], arms = [];
    for (const side of [-1, 1]) {
      // ---- gamba: coscia muscolosa con il bordo dei pantaloncini, ginocchio, polpaccio nel calzettone, scarpa
      const hip = new THREE.Group(); hip.position.set(0, -0.03, side * 0.09 * w); pelvis.add(hip);
      hip.add(mesh([
        { geo: cyl(0.1, 0.074, 0.45), color: look.skin, rough: RO.skin, pos: [0, -0.225, 0], scale: [1.1, 1, 0.97] },   // coscia da atleta
        { geo: cyl(0.104, 0.096, 0.15), color: kit[1], fabric: true, pos: [0, -0.05, 0] },
        { geo: cyl(0.0975, 0.0975, 0.014), color: shadeColor(kit[1], 0.75), pos: [0, -0.118, 0] },   // orlo dei pantaloncini
      ]));
      const knee = new THREE.Group(); knee.position.y = -0.45; hip.add(knee);
      const shinParts = [
        { geo: new THREE.SphereGeometry(0.064, seg(7), seg(5)), color: look.skin, rough: RO.skin, pos: [0.008, 0, 0] },
        { geo: cyl(0.075, 0.054, 0.2), color: kit[2], pos: [-0.01, -0.12, 0] },          // polpaccio
        { geo: new THREE.SphereGeometry(0.05, seg(7), seg(5)), color: kit[2], pos: [0.03, -0.17, 0], scale: [0.55, 1.6, 0.9] },   // parastinchi sotto il calzettone
        { geo: cyl(0.052, 0.042, 0.2), color: kit[2], pos: [0, -0.3, 0] },
        { geo: cyl(0.07, 0.066, 0.05), color: kit[2], pos: [0, -0.035, 0] },               // risvolto del calzettone
      ];
      if (it.calzettoni && it.calzettoni.stripe) shinParts.push({ geo: cyl(0.068, 0.064, 0.05, 9), color: it.calzettoni.stripe, pos: [-0.004, -0.09, 0] });
      knee.add(mesh(shinParts));
      // ---- caviglia (perno 40 cm sotto il ginocchio): la scarpa si piega da sola nella corsa
      const ankle = new THREE.Group(); ankle.position.y = -0.4; knee.add(ankle);
      ankle.add(mesh([
        // scarpa: tomaia, punta arrotondata, tallone e suola
        { geo: new THREE.BoxGeometry(0.19, 0.07, 0.088), color: look.boots, rough: RO.boot, pos: [0.045, -0.01, 0] },
        { geo: new THREE.SphereGeometry(0.047, seg(7), seg(5)), color: look.boots, rough: RO.boot, pos: [0.14, -0.018, 0], scale: [1.2, 0.68, 0.94] },
        { geo: new THREE.SphereGeometry(0.044, seg(6), seg(4)), color: look.boots, rough: RO.boot, pos: [-0.045, -0.005, 0], scale: [0.8, 0.85, 0.95] },
        // zona dei lacci (più chiara) e suola con i tacchetti
        { geo: new THREE.BoxGeometry(0.1, 0.006, 0.042), color: shadeColor(look.boots, 1.35), rough: RO.sole, pos: [0.06, 0.027, 0] },
        { geo: new THREE.BoxGeometry(0.24, 0.016, 0.09), color: '#1c1c1c', rough: RO.sole, pos: [0.055, -0.052, 0] },
        ...(D >= 1 ? [[0.15, 0.025], [0.15, -0.025], [0.09, 0.03], [0.09, -0.03], [-0.03, 0.025], [-0.03, -0.025]].map(([sx, sz]) =>
          ({ geo: cyl(0.009, 0.006, 0.014, 6), color: '#d8d8d8', rough: 0.35, pos: [sx, -0.066, sz] })) : []),
      ]));
      legs.push({ hip, knee, ankle });
      // ---- braccio: manica (con bordo), pelle fino al gomito; avambraccio e mano (o guanto)
      const sh = new THREE.Group(); sh.position.set(0, 1.43 - WAIST, side * 0.228 * w); chest.add(sh);
      const sleeve = pat && pat.pattern === 'maniche' ? pat.color : kit[0];
      const longSleeve = p.isGK;
      const upperParts = [
        { geo: cyl(0.07, 0.063, 0.16), color: sleeve, fabric: true, pos: [0, -0.07, 0] },
        { geo: cyl(0.066, 0.066, 0.025), color: pat && pat.pattern === 'bordi' ? pat.color : trim, pos: [0, -0.145, 0] },
        { geo: cyl(0.056, 0.047, longSleeve ? 0.0001 : 0.15), color: look.skin, rough: RO.skin, pos: [0, -0.215, 0] },
      ];
      if (longSleeve) upperParts.push({ geo: cyl(0.054, 0.048, 0.16), color: sleeve, pos: [0, -0.21, 0] });
      if (acc && acc.kind === 'capitano' && side === 1) upperParts.push({ geo: cyl(0.066, 0.063, 0.06), color: acc.color, pos: [0, -0.09, 0] });
      sh.add(mesh(upperParts));
      const elbow = new THREE.Group(); elbow.position.y = -0.29; sh.add(elbow);
      const foreParts = [
        { geo: cyl(0.049, 0.035, 0.25), color: longSleeve ? sleeve : look.skin, rough: longSleeve ? RO.kit : RO.skin, fabric: longSleeve, pos: [0, -0.125, 0] },
        { geo: new THREE.SphereGeometry(gloves ? 0.05 : 0.042, seg(7), seg(5)), color: gloves || look.skin, rough: gloves ? RO.glove : RO.skin, pos: [0.005, -0.285, 0], scale: [0.75, 1.25, 0.6] },
      ];
      if (acc && acc.kind === 'polsini') foreParts.push({ geo: cyl(0.044, 0.044, 0.05), color: acc.color, pos: [0, -0.215, 0] });
      elbow.add(mesh(foreParts));
      arms.push({ sh, elbow });
    }
    const scale = look.height / 1.8;
    root.scale.set(scale, scale, scale);
    this.scene.add(root);
    return { root, body, pelvis, chest, neck, legs, arms, player: p, celebration: (p.slotIndex || 0) % 4 };
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
    if (match !== this.match) this.cosmetics = new Map();
    for (const pm of this.playerMeshes) this.disposePlayerMesh(pm);
    this.playerMeshes = (match.allSlots ? match.allSlots() : match.allPlayers()).map(p => this.makePlayerMesh(p));
    this.match = match;
    this.applyEnvironment(match.weather, match.timeOfDay);   // meteo e ora del giorno della partita
    this.setupOfficials(match);   // arbitro e barellieri (09_render_referee.js)
    this.setupBenches(match);     // riserve e allenatori (09_render_bench.js)
    this.setupStadiumLife(match);   // bandiere, sciarpe e flash (09_render_stadium.js)
    this.resetPoses(); this.cutCamera();
    this.warmShaders();   // niente pause al primo tiro o al primo gol (09_render_setpiece.js)
  }

  // aspetto comprato (letto dal server) per un calciatore: si ricostruisce solo il suo modello
  setCosmetic(p, loadout) {
    if (!loadout) return;
    this.cosmetics.set(p, loadout);
    const i = this.playerMeshes.findIndex(pm => pm.player === p);
    if (i < 0) return;
    this.disposePlayerMesh(this.playerMeshes[i]);
    this.playerMeshes[i] = this.makePlayerMesh(p);
  }

  // mirino di punizioni e rigori: un anello sulla porta, solo per chi sta mirando su questo computer
  syncAimMarker(match) {
    const a = match.aimMarker, mine = a && (this.localId === null || this.localId === undefined || a.id === this.localId) && match.state !== 'PLAY';
    if (!mine) { if (this.aimMesh) this.aimMesh.visible = false; return; }
    if (!this.aimMesh) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 32), new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshBasicMaterial({ color: 0xffd84a, side: THREE.DoubleSide, depthTest: false }));
      ring.renderOrder = dot.renderOrder = 11;
      g.add(ring); g.add(dot);
      this.aimMesh = g; this.scene.add(g);
    }
    // l'anello sta sul piano della porta
    this.aimMesh.visible = true;
    this.aimMesh.position.set(a.x - Math.sign(a.x) * 0.05, a.y, a.z);
    // sempre girato verso la telecamera, così si vede bene da ogni inquadratura
    if (this.camera) this.aimMesh.quaternion.copy(this.camera.quaternion);
    const s = 1 + 0.08 * Math.sin(performance.now() / 160);
    this.aimMesh.scale.set(s, s, s);
  }

  // cambio: stesso posto in campo, calciatore nuovo (senza l'aspetto comprato di chi è uscito)
  refreshPlayer(p) {
    this.cosmetics.delete(p);
    const i = this.playerMeshes.findIndex(pm => pm.player === p);
    if (i < 0) return;
    this.disposePlayerMesh(this.playerMeshes[i]);
    this.playerMeshes[i] = this.makePlayerMesh(p);
  }

  clearMatch() {
    for (const pm of this.playerMeshes) this.disposePlayerMesh(pm);
    this.playerMeshes = [];
    this.footShadows.count = 0;
    this.clearOfficials();
    this.match = null;
  }

  // anima un giocatore partendo dai dati (partita o replay). Gli stati dipendono solo da posizione, direzione,
  // velocità e animazioni del motore. Corsa: passo più ampio e ginocchio alto in scatto, spalle che ruotano contro le
  // anche, rimbalzo del passo; il busto si inclina con l'accelerazione e in curva, in frenata ci si abbassa sulle
  // ginocchia; la testa resta dritta. Da fermo respiro, peso che si sposta, sguardo che si muove.
  poseMesh(pm, x, z, facing, phase, speed, kick, diveDir, extra) {
    const root = pm.root, body = pm.body, pelvis = pm.pelvis, chest = pm.chest, neck = pm.neck;
    const L0 = pm.legs[0], L1 = pm.legs[1], A0 = pm.arms[0], A1 = pm.arms[1];
    const dt = clamp(this.frameDt || 1 / 60, 1 / 240, 0.1);
    root.position.set(x, 0, z);
    root.rotation.y = -facing;
    if (pm.prevSp === undefined) { pm.prevSp = speed; pm.prevF = facing; pm.lean = 0; pm.bank = 0; pm.crouch = 0; pm.t = (pm.player.slotIndex || 0) * 0.7; pm.tk0 = 0; pm.prevTk = 0; }
    const acc = (speed - pm.prevSp) / dt, turn = angleDiff(pm.prevF, facing) / dt;
    pm.prevSp = speed; pm.prevF = facing; pm.t += dt;
    const k1 = Math.min(1, dt * 7);
    pm.lean += (clamp(acc * 0.022, -0.16, 0.2) - pm.lean) * k1;
    pm.bank += (clamp(turn * speed * 0.01, -0.22, 0.22) - pm.bank) * k1;
    pm.crouch += (clamp(-acc * 0.012, 0, 0.12) - pm.crouch) * Math.min(1, dt * 10);
    // frenata forte (0.24): quanto sta frenando, per la posa con la gamba avanti che "pianta" il piede
    pm.brake = (pm.brake || 0) + (clamp((-acc - 6) / 14, 0, 1) * clamp(pm.prevSpeedMax / 4, 0, 1) - (pm.brake || 0)) * Math.min(1, dt * 9);
    pm.prevSpeedMax = Math.max(speed, (pm.prevSpeedMax || 0) - dt * 6);
    const amt = Math.min(speed / 7, 1), sprint = clamp((speed - 5.5) / 2.5, 0, 1);
    const s = Math.sin(phase), c = Math.cos(phase);
    body.position.set(0, 0, 0); body.rotation.set(0, 0, 0);
    pelvis.position.set(0, 0.92, 0); pelvis.rotation.set(0, 0, 0);
    chest.position.set(0, 0.98, 0); chest.rotation.set(0, 0, 0);
    neck.rotation.set(0, 0, 0);
    for (const A of pm.arms) { A.sh.rotation.set(0, 0, 0); A.elbow.rotation.set(0, 0, 0); }
    for (const L of pm.legs) { L.hip.rotation.set(0, 0, 0); L.knee.rotation.set(0, 0, 0); if (L.ankle) L.ankle.rotation.set(0, 0, 0); }
    // ---- corsa: passo vero (camminata, corsetta, scatto) da src/client/09_render_gait.js
    const cr = pm.crouch;
    // all'indietro (es. un difensore che rincula): il passo va al contrario, più corto e senza piegarsi in avanti
    let back = 0;
    if (extra && extra.vx !== undefined && speed > 0.6) back = clamp(-(extra.vx * Math.cos(facing) + extra.vz * Math.sin(facing)) / speed, 0, 1);
    pm.back = (pm.back || 0) + (back - (pm.back || 0)) * Math.min(1, dt * 6);
    const gait = this.poseGait(pm, pm.back > 0.5 ? -phase : phase, speed * (1 - 0.45 * pm.back), Math.min(1, speed / 1.2) * (1 - 0.3 * pm.back));
    if (pm.back > 0.05) { gait.lean *= 1 - 1.4 * pm.back; gait.tilt *= 1 - pm.back; }
    // frenata o partenza: ginocchia un po' piegate
    L0.hip.rotation.z += cr * 0.9; L1.hip.rotation.z += cr * 0.9;
    L0.knee.rotation.z -= cr * 1.8; L1.knee.rotation.z -= cr * 1.8;
    A0.sh.rotation.x = -0.1 - 0.06 * amt; A1.sh.rotation.x = 0.1 + 0.06 * amt;
    body.rotation.x = pm.bank;
    chest.rotation.z = -(gait.lean + pm.lean + cr * 0.4);
    pelvis.rotation.z = -(gait.tilt + pm.lean * 0.3);
    body.position.y = gait.bodyY - cr * 0.35;
    // frenata: la gamba che è davanti si allunga e pianta il piede, l'altra si piega, braccia larghe per l'equilibrio
    if (pm.brake > 0.03) {
      const b = pm.brake, front = L0.hip.rotation.z > L1.hip.rotation.z ? L0 : L1, rear = front === L0 ? L1 : L0;
      front.hip.rotation.z = front.hip.rotation.z * (1 - b) + 0.55 * b; front.knee.rotation.z = front.knee.rotation.z * (1 - b) - 0.12 * b;
      if (front.ankle) front.ankle.rotation.z = front.ankle.rotation.z * (1 - b) + 0.35 * b;
      rear.hip.rotation.z = rear.hip.rotation.z * (1 - b) - 0.05 * b; rear.knee.rotation.z = rear.knee.rotation.z * (1 - b) - 0.9 * b;
      A0.sh.rotation.x -= 0.35 * b; A1.sh.rotation.x += 0.35 * b;
      body.position.y -= 0.06 * b;
    }
    // in curva il braccio esterno si apre un poco per l'equilibrio
    if (Math.abs(pm.bank) > 0.04) { const o = pm.bank > 0 ? A1 : A0; o.sh.rotation.x += (pm.bank > 0 ? 1 : -1) * Math.abs(pm.bank) * 1.2; }
    // passi laterali (0.23): chi si sposta di lato guardando da un'altra parte (il portiere sulla linea che segue la
    // palla, il difensore che temporeggia) non corre di traverso: apre e chiude le gambe, busto basso e braccia larghe
    let side = 0;
    if (extra && extra.vx !== undefined && speed > 0.4 && speed < 4.8) {
      const lat = (-extra.vx * Math.sin(facing) + extra.vz * Math.cos(facing)) / speed;
      side = clamp((Math.abs(lat) - 0.55) / 0.3, 0, 1) * clamp((4.8 - speed) / 1.5, 0, 1);
    }
    pm.side = (pm.side || 0) + (side - (pm.side || 0)) * Math.min(1, dt * 8);
    if (pm.side > 0.02) {
      const k = pm.side, st = Math.abs(Math.sin(phase));
      for (const L of pm.legs) {
        L.hip.rotation.z = L.hip.rotation.z * (1 - k) + 0.22 * k;
        L.knee.rotation.z = L.knee.rotation.z * (1 - k) - 0.45 * k;
        if (L.ankle) L.ankle.rotation.z = L.ankle.rotation.z * (1 - k) + 0.2 * k;
      }
      const spread = (0.07 + 0.22 * st) * k;
      L0.hip.rotation.x -= spread; L1.hip.rotation.x += spread;
      chest.rotation.z = chest.rotation.z * (1 - k) - 0.14 * k;
      pelvis.rotation.z *= 1 - k;
      body.position.y = body.position.y * (1 - k) + (-0.07 - 0.03 * st) * k;
      A0.sh.rotation.z += 0.2 * k; A1.sh.rotation.z += 0.2 * k;
      A0.sh.rotation.x -= 0.25 * k; A1.sh.rotation.x += 0.25 * k;
    }
    if (amt < 0.08) {
      // fermo: respiro, peso che passa da una gamba all'altra, braccia sciolte, sguardo che si muove
      chest.rotation.z += Math.sin(pm.t * 2.1) * 0.014;
      body.position.y += Math.sin(pm.t * 2.1) * 0.004;
      pelvis.position.z = Math.sin(pm.t * 0.6) * 0.014;
      L0.knee.rotation.z -= Math.max(0, Math.sin(pm.t * 0.6)) * 0.08; L1.knee.rotation.z -= Math.max(0, -Math.sin(pm.t * 0.6)) * 0.08;
      A0.sh.rotation.x = -0.14; A1.sh.rotation.x = 0.14; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.22;
      neck.rotation.y = Math.sin(pm.t * 0.37 + (pm.player.slotIndex || 0)) * 0.3;
    }
    // portiere pronto: ginocchia piegate, busto in avanti, braccia aperte quando la palla è vicina e lui è quasi fermo
    if (extra && extra.isGK && speed < 2.2 && extra.bx !== undefined) {
      const near = clamp(1 - (Math.hypot(extra.bx - x, extra.bz - z) - 12) / 22, 0, 1) * clamp(1 - speed / 2.2, 0, 1);
      pm.ready = (pm.ready || 0) + (near - (pm.ready || 0)) * Math.min(1, dt * 4);
      const r = pm.ready;
      if (r > 0.01) {
        for (const L of pm.legs) { L.hip.rotation.z += 0.35 * r; L.knee.rotation.z -= 0.75 * r; if (L.ankle) L.ankle.rotation.z += 0.35 * r; }
        L0.hip.rotation.x = -0.12 * r; L1.hip.rotation.x = 0.12 * r;   // gambe un po' larghe
        chest.rotation.z -= 0.28 * r;
        A0.sh.rotation.x -= 0.45 * r; A1.sh.rotation.x += 0.45 * r; A0.elbow.rotation.z += 0.5 * r; A1.elbow.rotation.z += 0.5 * r;
        A0.sh.rotation.z += 0.35 * r; A1.sh.rotation.z += 0.35 * r;
        body.position.y = body.position.y * (1 - r) - 0.07 * r;
      }
    }
    // tutti guardano la palla (la testa gira, non tutto il corpo)
    if (extra && extra.bx !== undefined) {
      const dx = extra.bx - x, dz = extra.bz - z;
      const lx = dx * Math.cos(facing) + dz * Math.sin(facing), lz = -dx * Math.sin(facing) + dz * Math.cos(facing);
      const want = Math.hypot(dx, dz) > 0.8 ? clamp(Math.atan2(-lz, lx), -0.85, 0.85) : 0;
      pm.look = (pm.look || 0) + (want - (pm.look || 0)) * Math.min(1, dt * 5);
      neck.rotation.y = pm.look;
    }
    // la testa resta dritta: compensa in parte inclinazione e rotazione del busto
    neck.rotation.z -= chest.rotation.z * 0.6;
    neck.rotation.y -= chest.rotation.y * 0.7;
    if (kick > 0) {
      // calcio in tre tempi: caricamento (gamba indietro, busto che ruota), impatto, accompagnamento
      const u = clamp(1 - kick / 0.3, 0, 1);
      let hp, kn, tw;
      if (u < 0.35) { const v = u / 0.35; hp = -0.7 * v; kn = -1.3 * v; tw = 0.35 * v; }
      else if (u < 0.6) { const v = (u - 0.35) / 0.25; hp = -0.7 + 2.05 * v; kn = -1.3 + 1.2 * v; tw = 0.35 - 0.6 * v; }
      else { const v = (u - 0.6) / 0.4; hp = 1.35 - 0.95 * v; kn = -0.1 - 0.25 * v; tw = -0.25 + 0.25 * v; }
      L1.hip.rotation.z = hp; L1.knee.rotation.z = kn;
      L0.hip.rotation.z = -0.12; L0.knee.rotation.z = -0.3;
      chest.rotation.y = tw; neck.rotation.y = -tw * 0.8;
      A0.sh.rotation.x = -0.85; A1.sh.rotation.x = 0.5; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.35;
      chest.rotation.z = u > 0.4 ? 0.12 * Math.sin((u - 0.4) / 0.6 * Math.PI) : -0.08;
    }
    if (extra && extra.charge > 0 && !(kick > 0)) {
      // carica del tiro: gamba indietro, busto che ruota e braccia aperte in proporzione alla potenza
      const k = Math.min(1, 0.35 + extra.charge * 0.65);
      L1.hip.rotation.z = -0.7 * k; L1.knee.rotation.z = -1.2 * k;
      L0.hip.rotation.z = 0.12 * k; L0.knee.rotation.z = -0.25 * k;
      A0.sh.rotation.x = -0.35 - 0.5 * k; A1.sh.rotation.x = 0.35 + 0.4 * k;
      chest.rotation.y = 0.3 * k; chest.rotation.z = -0.1 * k;
    }
    if (diveDir) { // tuffo del portiere
      body.rotation.x = diveDir * 1.25; body.position.y = 0.3;   // stesso verso del tuffo vero (09_render_keeper.js)
      A0.sh.rotation.x = -2.6; A1.sh.rotation.x = 2.6; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.15;
      L0.knee.rotation.z = -0.4;
    }
    // contrasto: in piedi (affondo con la gamba tesa) o in scivolata; il tipo si riconosce dalla durata iniziale
    const tk = extra ? extra.tackle || 0 : 0;
    if (tk > pm.prevTk + 0.05) pm.tk0 = tk;
    pm.prevTk = tk;
    if (tk > 0 && pm.tk0 > 0) {
      const u = clamp(1 - tk / pm.tk0, 0, 1);
      if (pm.tk0 > 0.5) {
        // scivolata: giù in fretta, scivola con la gamba di attacco tesa, poi si rialza
        const k = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.2);
        const e = k * k * (3 - 2 * k);
        chest.rotation.z = 0.95 * e; body.position.y = -0.4 * e;
        L1.hip.rotation.z = 1.45 * e; L1.knee.rotation.z = -0.05;
        L0.hip.rotation.z = 0.5 * e; L0.knee.rotation.z = -1.3 * e;
        A0.sh.rotation.x = -0.9 * e; A1.sh.rotation.x = 0.9 * e;
        A0.sh.rotation.z = A1.sh.rotation.z = -0.6 * e;
      } else {
        // contrasto in piedi: affondo verso la palla e ritorno
        const r = Math.sin(u * Math.PI);
        L1.hip.rotation.z = 1.05 * r; L1.knee.rotation.z = -0.12;
        L0.hip.rotation.z = -0.2 * r; L0.knee.rotation.z = -0.65 * r;
        body.position.y = -0.12 * r; chest.rotation.z = -0.35 * r;
        A0.sh.rotation.x = -0.6 * r; A1.sh.rotation.x = 0.6 * r;
      }
    }
    if (extra && extra.fall > 0) {
      // a terra dopo un fallo: cade in avanti con le braccia avanti, resta giù, si rialza
      const f = extra.fall, down = f > 0.85 ? (1.1 - f) / 0.25 : f > 0.3 ? 1 : f / 0.3;
      const k = down * down * (3 - 2 * down);
      body.rotation.z = -1.45 * k; body.position.y = 0.05 * k;
      A0.sh.rotation.z = A1.sh.rotation.z = 2.2 * k; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.3 * k;
      L0.hip.rotation.z = 0.3 * k; L1.hip.rotation.z = -0.2 * k; L0.knee.rotation.z = -0.4 * k;
      neck.rotation.z = 0.5 * k;
    }
    if (extra && extra.header > 0) {
      // colpo di testa: stacco, busto che si inarca e poi colpisce, testa che spinge
      const u = clamp(1 - extra.header / 0.35, 0, 1);
      body.position.y = 0.35 * Math.sin(Math.min(1, u * 1.4) * Math.PI * 0.5 + 0.5);
      chest.rotation.z = 0.3 * Math.cos(u * Math.PI) - 0.05;
      neck.rotation.z = -0.45 * Math.sin(u * Math.PI);
      A0.sh.rotation.x = -0.7; A1.sh.rotation.x = 0.7; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.6;
      L0.knee.rotation.z = -0.7; L1.knee.rotation.z = -0.35;
    }
    if (extra && extra.celebrate) {
      // esultanza: quattro modi diversi (dipendono dal calciatore)
      const v = pm.celebration;
      if (v === 0) {
        A0.sh.rotation.x = -2.8; A1.sh.rotation.x = 2.8; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.2;
        body.position.y = Math.abs(Math.sin(phase * 1.5)) * 0.3;
      } else if (v === 1) {
        // aeroplano: braccia larghe, si piega nelle curve
        A0.sh.rotation.x = -1.5; A1.sh.rotation.x = 1.5; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.05;
        body.rotation.x = pm.bank * 2 + Math.sin(pm.t * 2) * 0.12;
      } else if (v === 2 && amt < 0.5) {
        // in ginocchio a braccia alzate
        body.position.y = -0.42; L0.hip.rotation.z = L1.hip.rotation.z = 0.15; L0.knee.rotation.z = L1.knee.rotation.z = -1.9;
        chest.rotation.z = 0.25; A0.sh.rotation.x = -2.6; A1.sh.rotation.x = 2.6; neck.rotation.z = 0.35;
      } else {
        // pugno al cielo
        A1.sh.rotation.x = 2.9; A1.elbow.rotation.z = 0.3 + 0.6 * Math.abs(Math.sin(pm.t * 8));
        A0.sh.rotation.x = -0.3; A0.elbow.rotation.z = 0.5;
        body.position.y += Math.abs(Math.sin(phase * 1.5)) * 0.12;
      }
    }
  }

  // aggiornamento dal vivo.
  // alpha (0..1): frazione del passo di simulazione già trascorsa; la grafica disegna tra il passo precedente
  // e quello attuale, così il movimento è fluido anche se lo schermo non va esattamente a 60 Hz.
  syncFromMatch(match, dt, alpha) {
    this.frameDt = dt;
    this.syncAimMarker(match);
    const b = match.ball;
    const useA = alpha !== undefined && b.px !== undefined;
    const a = useA ? clamp(alpha, 0, 1) : 1;
    const mix = (prev, cur, maxJump) => (useA && prev !== undefined && Math.abs(cur - prev) < maxJump ? prev + (cur - prev) * a : cur);
    const bx = mix(b.px, b.x, 3), by = mix(b.py, b.y, 3), bz = mix(b.pz, b.z, 3);
    b.rx = bx; b.ry = by; b.rz = bz;
    this.ballMesh.position.set(bx, by + 0.07, bz);
    // rotazione vera del pallone (09_render_ball.js); al piede o in mano gira con il giocatore che lo porta
    this.spinBall(dt, b.vx, b.vz, by <= CONFIG.BALL_R + 0.03 && Math.abs(b.vy || 0) < 0.6, b.spin, b.topspin);
    this.placeBallShadow(bx, by, bz);
    // scia sui tiri potenti: qualche particella dietro al pallone
    const sp3 = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    if (!b.owner && sp3 > 21 && by > 0.25) this.burst('trail', bx, bz, { y: by, amount: Math.min(1.5, (sp3 - 18) / 10) });
    const scorers = match.state === 'GOAL' && match.lastGoal ? match.lastGoal.team : null;
    // tiro in carica dei calciatori guidati da persone: la preparazione si vede dal primo istante
    let charges = null;
    for (const h of (match.humans || [])) if (h.player && h.shootCharge > 0) (charges || (charges = new Map())).set(h.player, h.shootCharge);
    let ns = 0;
    this.watchFirstTouch(match, by);   // stop del pallone (09_render_kicks.js)
    for (const pm of this.playerMeshes) {
      const p = pm.player;
      pm.root.visible = !p.gone;
      if (p.gone) continue;
      // posizione disegnata (interpolata), usata anche da indicatori e telecamera
      p.rx = mix(p.px, p.x, 2.5); p.rz = mix(p.pz, p.z, 2.5);
      const f = useA && p.pf !== undefined ? p.pf + angleDiff(p.pf, p.facing) * a : p.facing;
      const ph = mix(p.pph, p.anim.phase, 1.5);
      const hc = charges && charges.get(p);
      // esultanza dopo il gol: posizione e corsa disegnate a parte (09_render_celebrate.js)
      const cel = scorers ? this.celebrationFor(pm, p, match, dt) : (pm.cel = null);
      const dx = cel ? cel.x : p.rx, dz = cel ? cel.z : p.rz;
      this.poseMesh(pm, dx, dz, cel ? cel.f : f, cel ? cel.phase : ph, cel ? cel.speed : p.speed(), p.anim.kick, p.anim.dive > 0 ? p.anim.diveDir : 0,
        { tackle: p.anim.tackle, header: p.anim.header, fall: p.anim.fall, celebrate: false, charge: hc || 0,
          vx: cel ? Math.cos(cel.f) * cel.speed : p.vx, vz: cel ? Math.sin(cel.f) * cel.speed : p.vz, bx: bx, bz: bz, isGK: p.isGK });
      // portiere: tuffi, prese, pugni, uscite (09_render_keeper.js)
      if (p.isGK && !cel) this.poseKeeper(pm, p, match, dt, bx, by, bz);
      // gesto del calcio, rovesciata, tuffo di testa (09_render_kicks.js)
      if (!cel) this.poseKick(pm, p, dt);
      if (!cel && !p.anim.kick) this.poseFirstTouch(pm, dt);
      if (cel) this.poseCelebration(pm, cel);
      // a terra dopo un fallo duro, poi zoppica (09_render_referee.js)
      if (pm.hurtT > 0 || pm.limpT > 0 || pm.hurtAmt > 0.01) this.poseHurt(pm, dt, p.speed(), ph);
      // ombra di contatto: allungata quando è a terra (caduta, scivolata, tuffo)
      const lying = p.anim.fall > 0 || p.anim.tackle > 0.3 || p.anim.dive > 0 || pm.hurtAmt > 0.5;
      if (ns < 22) this.setFootShadow(ns++, dx + (lying ? Math.cos(f) * 0.7 : 0), dz + (lying ? Math.sin(f) * 0.7 : 0), lying ? 2.1 : 1.0, lying ? 0.8 : 0.85, lying ? -f : 0);
    }
    this.keepBallOffFeet();   // i piedi non attraversano il pallone (09_render_players.js)
    this.footShadows.count = ns;
    this.footShadows.instanceMatrix.needsUpdate = true;
    this.syncHumanMarks(match, this.localId, this.names);
    // pubblico: si agita di più vicino alle porte e dopo un gol
    const nearGoal = Math.max(0, (Math.abs(bx) - 30) / 22);
    const target = match.state === 'GOAL' ? 1 : nearGoal * 0.5;
    this.crowdExcite = lerp(this.crowdExcite, target, dt * 2);
    this.animateCrowd(dt);
    this.updateStadiumLife(dt);
    const mine = match.humanById ? match.humanById(this.localId) : null;
    this.updateFx(dt);
    this.updateNets(dt);
    this.updateOfficials(match, dt, bx, bz);
    this.updateBenches(dt, bx, bz);
    this.updateCamera(dt, bx, by, bz, mine && mine.player, match);
    this.updateWeather(dt);
    this.updateChristmas(dt, this.menuDemo);   // lucine e fuochi d'artificio (09_render_natale.js)
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
    this.frameDt = dt;
    // nel replay la velocità del pallone si ricava da quanto si è spostato
    const rb = this._replayBall || (this._replayBall = { x: frame[0], y: frame[1], z: frame[2] });
    const jump = Math.hypot(frame[0] - rb.x, frame[2] - rb.z) > 3 || !(dt > 0);
    this.spinBall(dt, jump ? 0 : (frame[0] - rb.x) / dt, jump ? 0 : (frame[2] - rb.z) / dt, frame[1] <= CONFIG.BALL_R + 0.03, 0, 0);
    rb.x = frame[0]; rb.y = frame[1]; rb.z = frame[2];
    this.ballMesh.position.set(frame[0], frame[1] + 0.07, frame[2]);
    this.placeBallShadow(frame[0], frame[1], frame[2]);
    let k = 3, ns = 0;
    for (const pm of this.playerMeshes) {
      pm.root.visible = !pm.player.gone;
      this.poseMesh(pm, frame[k], frame[k + 1], frame[k + 2], frame[k + 3], frame[k + 4], frame[k + 5], frame[k + 6], null);
      if (pm.root.visible && ns < 22) this.setFootShadow(ns++, frame[k], frame[k + 1], 1, 0.85, 0);
      k += 7;
    }
    this.footShadows.count = ns;
    this.footShadows.instanceMatrix.needsUpdate = true;
    if (this.officials) this.officials.ref.root.visible = false;   // nel replay niente arbitro (non è registrato)
    this.updateNets(dt);
    for (const mk of this.humanMarks) { mk.ring.visible = false; if (mk.label) mk.label.visible = false; }
    this.arrow.visible = false;
    this.updateFx(dt);
    this.crowdExcite = lerp(this.crowdExcite, 0.6, dt);
    this.animateCrowd(dt);
    this.updateStadiumLife(dt);
    // telecamera del replay: bassa e laterale verso la porta
    const side = Math.sign(frame[0]) || 1;
    const want = new THREE.Vector3(frame[0] - side * 14, 5, frame[2] + 16), look = new THREE.Vector3(frame[0], frame[1] * 0.5 + 0.5, frame[2]);
    // il replay comincia con uno stacco (la telecamera non vola dal posto di prima)
    if (this._cut) { this._cut = false; this.camera.position.copy(want); this.camTarget.copy(look); }
    this.camera.position.lerp(want, Math.min(1, dt * 2.5));
    this.camTarget.lerp(look, Math.min(1, dt * 5));
    this.camera.lookAt(this.camTarget);
    this.updateWeather(dt);
    this.updateChristmas(dt, false);
  }

  updateCamera(dt, bx, by, bz, controlled, match) {
    // vettori riusati (niente oggetti nuovi a ogni fotogramma)
    const want = this._want || (this._want = new THREE.Vector3()), look = this._look || (this._look = new THREE.Vector3());
    // presentazione della partita (38_intro.js)
    if (this.introU != null) { this.introCamera(this.introU); return; }
    // serie dei rigori: inquadrature come in televisione (09_render_shootout.js)
    if (match && match.so && match.so.phase !== 'done') { this.shootoutCamera(dt, match, bx, by, bz); return; }
    this._soShot = null;
    // punizioni, rigori e allenamento: telecamera dietro al pallone, la porta sempre tutta in vista (09_render_setpiece.js)
    if (match && this.camMode !== 2 && this.setPieceCamera(dt, match, bx, by, bz)) return;
    if (this.camMode === 0) {
      // televisiva (0.22): più bassa e più vicina, come nelle partite in TV di oggi; dalla 0.24 anticipa l'azione e si
      // avvicina davanti alle porte (09_render_field.js)
      this.tvCamera(dt, bx, bz, match, want, look);
    } else if (this.camMode === 1) {
      want.set(bx * 0.5, 55, bz * 0.2 + 75);
      look.set(bx * 0.6, 0, bz * 0.3);
    } else {
      // dietro al giocatore (0.24.2): segue il pallone (non il calciatore comandato, che cambia da solo), sempre
      // alle spalle nella direzione in cui attacchi; il centro dell'inquadratura si muove morbido
      const mh = match && match.humanById ? match.humanById(this.localId) : null;
      const dir = mh ? match.teams[mh.team].dir : 1;
      const f = this._bf || (this._bf = { x: bx, z: bz });
      const kf = 1 - Math.exp(-4 * dt);
      if (this._cut) { f.x = bx; f.z = bz; } else { f.x += (bx - f.x) * kf; f.z += (bz - f.z) * kf; }
      want.set(f.x - dir * 15, 8.5, f.z * 0.9);
      look.set(f.x + dir * 9, 0, f.z * 0.85);
    }
    // inseguimento esponenziale: stessa morbidezza a 30, 60 o 144 fps; dopo uno stacco (calcio d'inizio) salta subito
    if (this._cut) { this._cut = false; this.camera.position.copy(want); this.camTarget.copy(look); }
    else {
      this.camera.position.lerp(want, 1 - Math.exp(-3.6 * dt));
      this.camTarget.lerp(look, 1 - Math.exp(-5 * dt));
    }
    this.camera.lookAt(this.camTarget);
    // piccolo tremolio della telecamera dopo un gol
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      const a = Math.min(this.shake, 0.6) * 0.35;
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
    // bandiere e sciarpe solo con il pubblico animato (qualità media in su)
    if (this.match && old.crowd !== this.Q.crowd) this.setupStadiumLife(this.match);
    if (!this.Q.post) this.disposePost();
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
    const n = Math.round((kind === 'confetti' ? 220 : kind === 'grass' ? 14 : kind === 'trail' ? 2 : 10) * mult * (opts.amount || 1));
    const c1 = new THREE.Color(), c2 = new THREE.Color();
    if (kind === 'confetti') { c1.set(opts.colors ? opts.colors[0] : '#ffd84a'); c2.set(opts.colors ? opts.colors[1] : '#ffffff'); }
    for (let i = 0; i < n && this.fx.length < this.fxMax; i++) {
      const a = Math.random() * Math.PI * 2;
      let p;
      if (kind === 'trail') {
        p = { x: x + (Math.random() - 0.5) * 0.1, y: opts.y + (Math.random() - 0.5) * 0.1, z: z + (Math.random() - 0.5) * 0.1, vx: 0, vy: 0, vz: 0,
          life: 0, max: 0.18 + Math.random() * 0.1, r: 0.85, g: 0.9, b: 1, drag: 0, grav: 0 };
      } else if (kind === 'confetti') {
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
      // cambio di giocatore: l'anello si allarga e torna subito (si vede chi controlli adesso)
      if (mk.lastP !== p) { mk.lastP = p; mk.pop = 0.22; }
      mk.pop = Math.max(0, (mk.pop || 0) - (this.frameDt || 1 / 60));
      const sc = 1 + mk.pop / 0.22 * 0.7;
      mk.ring.scale.set(sc, sc, sc);
      if (isMe) mk.ring.material.color.set(h.shootCharge > 0 ? (h.shootCharge > 0.9 ? '#ff5a36' : '#ffae3d') : '#ffd84a');
      if (mk.label) mk.label.position.set(px, 2.9 * p.data.look.height / 1.8, pz);
    });
    // freccia sopra il tuo calciatore
    const me = local && local.player;
    this.arrow.visible = !!me;
    if (me) this.arrow.position.set(me.rx !== undefined ? me.rx : me.x, 2.45 * me.data.look.height / 1.8 + Math.sin(match.realTime * 5) * 0.06, me.rz !== undefined ? me.rz : me.z);
  }

  // con la rifinitura dell'immagine (bagliore, colore) la scena passa da 09_render_post.js
  render() {
    if (this.postEnabled()) this.renderPost();
    else this.renderer.render(this.scene, this.camera);
  }
}
