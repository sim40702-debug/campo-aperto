// ============================================================
// TIRO DISEGNATO COL MOUSE (0.25.6) — solo punizioni, partite offline e allenamento
// Durante una punizione tua tieni premuto il clic sinistro e traccia col mouse la strada del pallone, dal pallone fino
// alla porta; quando lasci il pulsante il calciatore tira.
// - dove finisce il disegno = il punto della porta dove arriva il pallone (altezza e lato)
// - quanto è curva la linea = quanto effetto (curva verso destra = il pallone gira verso destra e torna indietro)
// - quanto in fretta disegni = forza del tiro (piano = tiro morbido, veloce = bordata)
// Si può sempre tirare anche come prima (mirino e tasto del tiro).
// ============================================================

// la punizione si può disegnare adesso?
Game.prototype.drawShotActive = function () {
  const m = this.match;
  if (!m || this.mode !== 'offline' || this.screen !== 'match' || this.paused || this.replay) return false;
  const sp = m.setPiece;
  if (m.state !== 'SETPIECE' || !sp || sp.type !== 'FREE_KICK' || !m.aimMarker) return false;
  const h = m.humanById('local');
  return !!h && h.player === sp.taker;
};

// prepara il foglio trasparente sopra il gioco e i movimenti del mouse
Game.prototype.setupDrawShot = function () {
  const cv = document.createElement('canvas');
  cv.id = 'draw-shot';
  cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5';
  document.body.appendChild(cv);
  this.drawCanvas = cv;
  this.stroke = null;
  // il clic sinistro durante la punizione serve a disegnare (non fa partire il passaggio)
  this.input.mouseCapture = (e, isDown) => {
    if (e.button !== 0) return false;
    if (isDown) {
      if (!this.drawShotActive()) return false;
      if (e.target && e.target.closest && e.target.closest('button, input, select, a, .panel')) return false;
      this.stroke = { pts: [[e.clientX, e.clientY]], t0: performance.now() };
      this.paintStroke();
      return true;
    }
    if (!this.stroke) return false;
    this.finishStroke(e.clientX, e.clientY);
    return true;
  };
  window.addEventListener('mousemove', e => {
    const s = this.stroke;
    if (!s || s.done) return;
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 3) return;
    s.pts.push([e.clientX, e.clientY]);
    this.paintStroke();
  });
};

// disegna la linea tracciata (bianca, arancione se veloce) con un cerchio dove finisce
Game.prototype.paintStroke = function () {
  const cv = this.drawCanvas, s = this.stroke;
  const W = window.innerWidth, H = window.innerHeight, r = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * r) || cv.height !== Math.round(H * r)) { cv.width = Math.round(W * r); cv.height = Math.round(H * r); }
  const g = cv.getContext('2d');
  g.setTransform(r, 0, 0, r, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!s || s.pts.length < 2) return;
  const power = this.strokePower(s);
  g.globalAlpha = s.done ? 0.5 : 0.95;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 9;
  g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
  g.strokeStyle = 'hsl(' + Math.round(55 - power * 45) + ', 100%, ' + Math.round(95 - power * 35) + '%)'; g.lineWidth = 5;
  g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
  const e = s.pts[s.pts.length - 1];
  g.lineWidth = 3; g.beginPath(); g.arc(e[0], e[1], 11, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 1;
};

// forza del tiro dalla velocità del disegno (in altezze dello schermo al secondo)
Game.prototype.strokePower = function (s) {
  let len = 0;
  for (let i = 1; i < s.pts.length; i++) len += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
  const sec = Math.max(0.05, ((s.t1 || performance.now()) - s.t0) / 1000);
  const speed = len / sec / window.innerHeight;
  return clamp(0.35 + (speed - 0.6) * 0.25, 0.35, 0.95);
};

// fine del disegno: calcola il tiro e lo passa al motore con il prossimo comando (gameInput)
Game.prototype.finishStroke = function (x, y) {
  const s = this.stroke;
  s.pts.push([x, y]); s.t1 = performance.now(); s.done = true;
  const shot = this.drawShotActive() ? this.strokeToShot(s) : null;
  if (shot) this.pendingDrawShot = shot;
  this.paintStroke();
  // la linea resta un attimo e poi sparisce
  setTimeout(() => { if (this.stroke === s) { this.stroke = null; this.paintStroke(); } }, shot ? 700 : 150);
};

// dal disegno sullo schermo al tiro: punto in porta (z, y), effetto (spin da -1 a 1), forza
Game.prototype.strokeToShot = function (s) {
  const P = s.pts, a = P[0], e = P[P.length - 1];
  const L = Math.hypot(e[0] - a[0], e[1] - a[1]);
  if (L < 40) return null;   // un clic o una linea cortissima: niente tiro
  const m = this.match, sp = m.setPiece, R = this.renderer, cam = R.camera;
  const rect = R.renderer.domElement.getBoundingClientRect();
  const gx = sp.team.oppGoalX();
  // punto in porta: il raggio dalla telecamera attraverso la fine del disegno incontra la linea di porta (x = gx)
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((e[0] - rect.left) / rect.width * 2 - 1, -(e[1] - rect.top) / rect.height * 2 + 1), cam);
  const o = ray.ray.origin, d = ray.ray.direction;
  if (Math.abs(d.x) < 1e-4) return null;
  const t = (gx - o.x) / d.x;
  if (t < 0) return null;
  const goalY = clamp(o.y + d.y * t, 0.1, 4), goalZ = clamp(o.z + d.z * t, -12, 12);
  // curva: il punto del disegno più lontano dalla linea dritta tra inizio e fine
  let dev = 0, devX = 0;
  for (const p of P) {
    const k = ((p[0] - a[0]) * (e[0] - a[0]) + (p[1] - a[1]) * (e[1] - a[1])) / (L * L);
    const cx = a[0] + (e[0] - a[0]) * k, cy = a[1] + (e[1] - a[1]) * k;
    const dd = Math.hypot(p[0] - cx, p[1] - cy);
    if (dd > dev) { dev = dd; devX = p[0] - cx; }
  }
  // da che parte dello schermo sta il lato +z del campo (dipende da dove guarda la telecamera)
  const s0 = new THREE.Vector3(gx, 1, 0).project(cam), s1 = new THREE.Vector3(gx, 1, 1).project(cam);
  const zOnRight = Math.sign(s1.x - s0.x) || 1;
  const bulgeZ = Math.sign(devX) * zOnRight;          // la linea si allarga verso +z o verso -z
  const amount = clamp((dev / L - 0.03) * 5, 0, 1);    // quasi dritta = niente effetto, molto curva = effetto pieno
  // il pallone gira verso la parte opposta alla pancia della curva (torna verso il punto finale)
  const spin = -bulgeZ * sp.team.dir * amount;
  return { z: goalZ, y: goalY, spin: spin, power: this.strokePower(s) };
};
