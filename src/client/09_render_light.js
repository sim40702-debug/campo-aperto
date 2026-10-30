// ============================================================
// LUCE, OMBRE E RIFLESSI (0.25.2)
// - Ombre nitide: l'ombra del sole (o della luce principale dei fari) copre solo la zona inquadrata e la segue: con
//   la stessa mappa d'ombra i dettagli sono 2-3 volte più fini (calciatori, pali, fili della rete). Lo spostamento va
//   a scatti di un pixel della mappa: così le ombre non tremolano quando la telecamera si muove.
// - Riflessi: un "ambiente" calcolato una volta (cielo, tribune scure, quattro fari accesi, erba) che i materiali
//   lucidi riflettono: pali verniciati, pallone, scarpe, telaio della porta.
// - Ombre dei fari: di sera ogni calciatore ha quattro ombre leggere e allungate, una per torre faro, come nelle
//   partite vere in notturna (disegni piatti sull'erba, tutti insieme in un solo oggetto).
// ============================================================
const FLOOD_TOWERS = [[-66, -52], [66, -52], [-66, 52], [66, 52]];

// l'ombra segue l'inquadratura
Renderer.prototype.updateShadowFrustum = function () {
  const sun = this.sun;
  if (!sun || !sun.castShadow || !this.Q.shadows) return;
  if (!sun.target.parent) this.scene.add(sun.target);
  const cam = this.camera, t = this.camTarget;
  // centro: dove guarda la telecamera; grandezza: secondo la distanza (vista larga = zona più grande)
  const dist = cam.position.distanceTo(t);
  const half = clamp(dist * 0.62, 24, 70);
  const texel = (2 * half) / sun.shadow.mapSize.x;
  const fx = Math.round(clamp(t.x, -60, 60) / texel) * texel, fz = Math.round(clamp(t.z, -42, 42) / texel) * texel;
  const dir = this._sunDir || (this._sunDir = new THREE.Vector3());
  dir.copy(this.sunBase || sun.position).normalize();
  sun.target.position.set(fx, 0, fz);
  sun.position.set(fx + dir.x * 110, dir.y * 110, fz + dir.z * 110);
  const c = sun.shadow.camera;
  if (c.right !== half) {
    c.left = -half; c.right = half; c.top = half * 0.8; c.bottom = -half * 0.8; c.near = 20; c.far = 240;
    c.updateProjectionMatrix();
  }
};

// ambiente per i riflessi, secondo l'ora del giorno
Renderer.prototype.buildEnvironmentMap = function (timeOfDay) {
  if (!this.Q.shadows) { this.scene.environment = null; return; }   // qualità bassa: niente riflessi (più leggero)
  const key = timeOfDay || 'night';
  this._envMaps = this._envMaps || {};
  if (!this._envMaps[key]) {
    const s = new THREE.Scene();
    const night = key === 'night', day = key === 'day';
    // cielo: una sfera colorata dall'alto in basso
    const sky = new THREE.SphereGeometry(50, 24, 12), col = [];
    const top = new THREE.Color(day ? '#8ec2ea' : night ? '#0a1424' : '#e08a5c'), mid = new THREE.Color(day ? '#c9def0' : night ? '#1d2a3c' : '#c87a58');
    const ground = new THREE.Color(day ? '#3f6b35' : '#1c3a22');
    const p = sky.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 50, c = y > 0.15 ? mid.clone().lerp(top, (y - 0.15) / 0.85) : y > -0.05 ? new THREE.Color(night ? '#2a3240' : '#6b7480') : ground;
      col.push(c.r, c.g, c.b);
    }
    sky.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    s.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    // i fari: quattro rettangoli molto luminosi in alto (si vedono riflessi nei pali e nel pallone)
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(night ? '#ffffff' : '#fff6e0').multiplyScalar(night ? 6 : day ? 1.2 : 2.5) });
    for (const [x, z] of FLOOD_TOWERS) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), lamp);
      m.position.set(x * 0.45, 22, z * 0.45); m.lookAt(0, 0, 0); s.add(m);
    }
    const pm = new THREE.PMREMGenerator(this.renderer);
    this._envMaps[key] = pm.fromScene(s, 0.02).texture;
    pm.dispose();
    s.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  this.scene.environment = this._envMaps[key];
};

// ombre dei fari (sera e tramonto): quattro ombre allungate per calciatore
Renderer.prototype.buildFloodShadows = function () {
  const mat = new THREE.MeshBasicMaterial({ map: this.softShadowTexture(), color: '#000000', transparent: true, opacity: 0.16, depthWrite: false });
  const m = this.floodShadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, 22 * 4);
  m.frustumCulled = false; m.count = 0;
  this.scene.add(m);
};
Renderer.prototype.setFloodShadows = function (i, x, z) {
  const m = this.floodShadows, M = this._fsM || (this._fsM = new THREE.Matrix4()), Q = this._fsQ || (this._fsQ = new THREE.Quaternion());
  const flat = this._fsFlat || (this._fsFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  const P = this._fsP || (this._fsP = new THREE.Vector3()), S = this._fsS || (this._fsS = new THREE.Vector3()), up = this._fsU || (this._fsU = new THREE.Vector3(0, 1, 0));
  for (let k = 0; k < 4; k++) {
    const [tx, tz] = FLOOD_TOWERS[k], dx = x - tx, dz = z - tz, d = Math.hypot(dx, dz) || 1;
    // l'ombra parte dai piedi e si allunga dalla parte opposta alla torre (più lunga se la torre è lontana)
    const len = 1.6 + d * 0.012;
    Q.setFromAxisAngle(up, -Math.atan2(dz, dx)).multiply(flat);
    M.compose(P.set(x + dx / d * len * 0.45, 0.016, z + dz / d * len * 0.45), Q, S.set(len, 0.55, 1));
    m.setMatrixAt(i * 4 + k, M);
  }
};

// fasci di luce dei fari (0.25.4): di sera, nell'aria umida dello stadio, si vedono i coni di luce che scendono dalle
// torri verso il campo (più forti con la pioggia e la neve). Coni aperti, colore che si somma, quasi trasparenti.
Renderer.prototype.buildLightBeams = function () {
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 128;
  const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const alpha = new THREE.CanvasTexture(cv);
  const mat = this.beamMat = new THREE.MeshBasicMaterial({ color: '#fff4d6', alphaMap: alpha, transparent: true, opacity: 0.06,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const group = this.beams = new THREE.Group();
  for (const [x, z] of FLOOD_TOWERS) {
    const head = new THREE.Vector3(x * 0.97, 43, z * 0.96), target = new THREE.Vector3(x * 0.35, 0, z * 0.32);
    const dir = target.clone().sub(head), L = dir.length();
    // il cono: stretto in alto (il faro), largo in basso; l'alfa va da pieno in alto a niente in basso
    const geo = new THREE.CylinderGeometry(3.5, 24, L, 28, 1, true);
    geo.translate(0, -L / 2, 0);
    // capovolge le coordinate della texture: in alto (vicino al faro) pieno
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(head);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    m.renderOrder = 5;
    group.add(m);
  }
  this.scene.add(group);
};
// quanto si vedono i fasci: secondo l'ora e il meteo
Renderer.prototype.setLightBeams = function (timeOfDay, weather) {
  if (!this.beams) return;
  const k = timeOfDay === 'night' ? 1 : timeOfDay === 'sunset' ? 0.35 : 0;
  this.beams.visible = k > 0 && this.Q.post > 0;   // solo con la rifinitura dell'immagine (qualità media e alta)
  this.beamMat.opacity = 0.05 * k * (weather === 'rain' ? 2.2 : weather === 'snow' ? 1.8 : 1);
};
