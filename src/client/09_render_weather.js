// ============================================================
// METEO E ORA DEL GIORNO — luci, cielo, nebbia, campo bagnato o innevato, pioggia e neve che cadono
// Il meteo arriva dalla partita (match.weather, match.timeOfDay): lo stesso per chi gioca, chi guarda e il server.
// Ora del giorno: 'night' (sera con i fari, com'era sempre lo stadio), 'sunset' (tramonto), 'day' (giorno).
// ============================================================
const SKY_PRESETS = {
  night: { bg: '#0b1626', fog: '#0b1626', near: 140, far: 320, hemiSky: '#c9dcff', hemiGround: '#1f3a24', hemi: 0.5,
    sun: '#fff3df', sunI: 1.05, sunPos: [-35, 90, 45], fill: '#9fb8ff', fillI: 0.25, exposure: 1.04, glow: 1, lamp: '#fffbe6' },
  sunset: { bg: '#c9774f', fog: '#b86f52', near: 130, far: 330, hemiSky: '#ffc49a', hemiGround: '#2b2a22', hemi: 0.5,
    sun: '#ffb27a', sunI: 1.15, sunPos: [-95, 34, 40], fill: '#8b8fe0', fillI: 0.3, exposure: 1.0, glow: 0.55, lamp: '#fff1d0' },
  day: { bg: '#8ec2ea', fog: '#a8cde8', near: 170, far: 430, hemiSky: '#e2efff', hemiGround: '#3b5a2b', hemi: 0.72,
    sun: '#fff7e8', sunI: 1.25, sunPos: [-45, 110, 30], fill: '#d2e2ff', fillI: 0.3, exposure: 1.0, glow: 0.12, lamp: '#d9d9cf' },
};
// il meteo cambia il cielo partendo dall'ora del giorno: colore verso cui va, luce che resta, nebbia più vicina
const WEATHER_LOOK = {
  clear: { tint: null, mix: 0, light: 1, fog: 1 },
  rain: { tint: '#56616c', mix: 0.55, light: 0.62, fog: 0.55 },
  snow: { tint: '#c9d0d8', mix: 0.5, light: 0.8, fog: 0.5 },
};

Renderer.prototype.applyEnvironment = function (weather, timeOfDay) {
  const sky = SKY_PRESETS[timeOfDay] || SKY_PRESETS.night;
  const w = WEATHER_LOOK[weather] || WEATHER_LOOK.clear;
  this.weather = WEATHER_LOOK[weather] ? weather : 'clear';
  this.timeOfDay = SKY_PRESETS[timeOfDay] ? timeOfDay : 'night';
  const col = c => new THREE.Color(c);
  // di sera il cielo resta scuro anche con la pioggia o la neve (si schiarisce solo un poco)
  const mixTo = (c, amount) => (w.tint ? col(c).lerp(col(w.tint), amount * (this.timeOfDay === 'night' ? 0.25 : 1)) : col(c));
  this.scene.background = mixTo(sky.bg, w.mix);
  this.scene.fog.color = mixTo(sky.fog, w.mix);
  this.scene.fog.near = sky.near * w.fog; this.scene.fog.far = sky.far * (0.4 + 0.6 * w.fog);
  this.hemi.color = col(sky.hemiSky); this.hemi.groundColor = col(sky.hemiGround); this.hemi.intensity = sky.hemi * (0.75 + 0.25 * w.light);
  this.sun.color = col(sky.sun); this.sun.intensity = sky.sunI * w.light; this.sun.position.set(sky.sunPos[0], sky.sunPos[1], sky.sunPos[2]);
  this.fill.color = col(sky.fill); this.fill.intensity = sky.fillI;
  this.renderer.toneMappingExposure = sky.exposure;
  for (const g of this.floodGlows || []) g.material.opacity = sky.glow;
  if (this.lampMat) this.lampMat.color = col(sky.lamp);
  // campo: bagnato (più scuro e un po' lucido) o con un velo di neve (più chiaro)
  for (const m of [this.pitch && this.pitch.material, this.around && this.around.material]) {
    if (!m) continue;
    m.color = col(this.weather === 'rain' ? '#c9d2cf' : '#ffffff');
    m.emissive = col(this.weather === 'snow' ? '#363c42' : '#000000');
  }
  this.setWeatherParticles(this.weather);
};

// ---------- pioggia (righe che cadono veloci) e neve (fiocchi lenti che ondeggiano) ----------
Renderer.prototype.buildWeather = function () {
  // pioggia: segmenti di linea, due punti per goccia
  const RN = this.rainMax = 2600;
  this.rainPos = new Float32Array(RN * 6);
  this.rainDrop = new Float32Array(RN * 3);    // posizione della goccia (la riga si allunga verso l'alto)
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
  this.rainLines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#aebfcf', transparent: true, opacity: 0.38, depthWrite: false }));
  this.rainLines.frustumCulled = false; this.rainLines.visible = false;
  this.scene.add(this.rainLines);
  // neve: punti morbidi
  const SN = this.snowMax = 2200;
  this.snowPos = new Float32Array(SN * 3);
  this.snowSway = new Float32Array(SN);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
  const dot = document.createElement('canvas'); dot.width = dot.height = 32;
  const g = dot.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  this.snowPoints = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.16, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false, opacity: 0.9 }));
  this.snowPoints.frustumCulled = false; this.snowPoints.visible = false;
  this.scene.add(this.snowPoints);
  this.weatherBox = { x: 0, z: 0 };
};

// la zona in cui cade (attorno a metà strada tra telecamera e azione): 80 × 40 × 80 metri
const WEATHER_W = 80, WEATHER_H = 40;

Renderer.prototype.setWeatherParticles = function (weather) {
  const rain = weather === 'rain', snow = weather === 'snow';
  this.rainLines.visible = rain; this.snowPoints.visible = snow;
  // quante gocce o fiocchi: dipende dalla qualità grafica
  this.rainCount = rain ? Math.round(this.rainMax * Math.max(0.35, this.Q.particles)) : 0;
  this.snowCount = snow ? Math.round(this.snowMax * Math.max(0.35, this.Q.particles)) : 0;
  const R = Math.random;
  for (let i = 0; i < this.rainCount; i++) {
    this.rainDrop[i * 3] = (R() - 0.5) * WEATHER_W; this.rainDrop[i * 3 + 1] = R() * WEATHER_H; this.rainDrop[i * 3 + 2] = (R() - 0.5) * WEATHER_W;
  }
  for (let i = 0; i < this.snowCount; i++) {
    this.snowPos[i * 3] = (R() - 0.5) * WEATHER_W; this.snowPos[i * 3 + 1] = R() * WEATHER_H; this.snowPos[i * 3 + 2] = (R() - 0.5) * WEATHER_W;
    this.snowSway[i] = R() * Math.PI * 2;
  }
  this.rainLines.geometry.setDrawRange(0, this.rainCount * 2);
  this.snowPoints.geometry.setDrawRange(0, this.snowCount);
};

Renderer.prototype.updateWeather = function (dt) {
  if (!this.rainCount && !this.snowCount) return;
  dt = Math.min(dt || 0, 0.05);
  // la zona segue la telecamera: le particelle sono in coordinate relative e si spostano con lei
  const c = this.camera.position, t = this.camTarget;
  const cx = (c.x + t.x) / 2, cz = (c.z + t.z) / 2;
  const wrap = v => ((v % WEATHER_W) + WEATHER_W * 1.5) % WEATHER_W - WEATHER_W / 2;
  if (this.rainCount) {
    const d = this.rainDrop, p = this.rainPos, fall = 24 * dt, wind = 3 * dt;
    for (let i = 0; i < this.rainCount; i++) {
      const k = i * 3;
      d[k + 1] -= fall; d[k] += wind;
      if (d[k + 1] < 0) { d[k + 1] += WEATHER_H; d[k] = (Math.random() - 0.5) * WEATHER_W; d[k + 2] = (Math.random() - 0.5) * WEATHER_W; }
      const x = cx + wrap(d[k] - cx), z = cz + wrap(d[k + 2] - cz), y = d[k + 1];
      const j = i * 6;
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
      p[j + 3] = x - 0.12; p[j + 4] = y + 0.9; p[j + 5] = z;
    }
    this.rainLines.geometry.attributes.position.needsUpdate = true;
  }
  if (this.snowCount) {
    const p = this.snowPos, s = this.snowSway, fall = 1.4 * dt;
    this.snowT = (this.snowT || 0) + dt;
    for (let i = 0; i < this.snowCount; i++) {
      const k = i * 3;
      p[k + 1] -= fall * (0.7 + (i % 5) * 0.12);
      p[k] += Math.sin(this.snowT * 0.9 + s[i]) * 0.6 * dt;
      p[k + 2] += Math.cos(this.snowT * 0.7 + s[i]) * 0.4 * dt;
      if (p[k + 1] < 0) p[k + 1] += WEATHER_H;
      // fiocchi sempre nella zona della telecamera
      p[k] = cx + wrap(p[k] - cx); p[k + 2] = cz + wrap(p[k + 2] - cz);
    }
    this.snowPoints.geometry.attributes.position.needsUpdate = true;
  }
};
