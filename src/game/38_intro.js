// ============================================================
// PRESENTAZIONE DELLA PARTITA (0.24.8) — come in TV prima del calcio d'inizio
// Solo nelle partite che fai partire dal menu (Partita, Partita di Natale), mai in allenamento, nel tutorial o
// online. Per 5 secondi la telecamera vola sopra lo stadio e scende fino all'inquadratura televisiva, mentre al
// centro compare la scheda con le due squadre, i loro colori e lo stadio. La partita aspetta (il tempo non passa).
// Un tasto qualsiasi (passaggio, tiro, Esc, clic) la salta. Si spegne nelle impostazioni ("Presentazione").
// ============================================================
const INTRO_SECS = 5;

Game.prototype.startIntro = function () {
  const m = this.match;
  if (!m || m.training || this.mode !== 'offline' || this.settings.intro === false) return;
  this.intro = { t: 0 };
  const card = $('intro-card');
  const team = i => m.teams[i];
  const bar = c => '<i style="background:' + c[0] + '"></i><i style="background:' + c[1] + '"></i>';
  card.innerHTML = '<div class="ic-teams"><div class="ic-team">' + bar(team(0).kit) + '<b>' + esc(team(0).data.name) + '</b></div>' +
    '<span class="ic-vs">' + esc(tr('contro')) + '</span><div class="ic-team">' + bar(team(1).kit) + '<b>' + esc(team(1).data.name) + '</b></div></div>' +
    '<div class="ic-place">' + esc(tr('Stadio Campo Aperto')) + '</div><small>' + esc(tr('Premi un tasto per saltare')) + '</small>';
  card.hidden = false;
  // un tasto qualsiasi salta la presentazione
  this._introSkip = () => { if (this.intro) this.intro.skip = true; };
  window.addEventListener('keydown', this._introSkip);
  window.addEventListener('pointerdown', this._introSkip);
};

Game.prototype.endIntro = function () {
  this.intro = null;
  this.renderer.introU = null;
  $('intro-card').hidden = true;
  if (this._introSkip) { window.removeEventListener('keydown', this._introSkip); window.removeEventListener('pointerdown', this._introSkip); this._introSkip = null; }
};

// un fotogramma della presentazione: niente simulazione, solo disegno e telecamera
Game.prototype.stepIntro = function (dt) {
  const I = this.intro, m = this.match, R = this.renderer;
  I.t += dt;
  const inp = this.input.read();
  if (inp.pressed && Object.keys(inp.pressed).some(k => inp.pressed[k])) I.skip = true;
  if (I.skip || I.t >= INTRO_SECS) { this.endIntro(); R.cutCamera(); return; }
  R.introU = I.t / INTRO_SECS;   // la telecamera la decide la presentazione (updateCamera, 09_render.js)
  R.syncFromMatch(m, dt);
};

// telecamera della presentazione: giro largo e alto sopra lo stadio, poi scende verso l'inquadratura televisiva
Renderer.prototype.introCamera = function (u) {
  const cam = this.camera, ease = u * u * (3 - 2 * u);
  const a = -2.2 + ease * 2.2 - Math.PI / 2;           // da un angolo dello stadio fino al lato della telecamera TV
  const r = 95 - 54 * ease, h = 48 - 28.5 * ease;
  const fly = new THREE.Vector3(Math.cos(a) * r * 0.9, h, -Math.sin(a) * r);
  const tv = new THREE.Vector3(0, 19.5, 41);
  const k = clamp((u - 0.75) / 0.25, 0, 1);               // nell'ultimo quarto si unisce alla telecamera TV
  cam.position.copy(fly.lerp(tv, k * k * (3 - 2 * k)));
  cam.lookAt(0, 0, 2 * k);
  this.camTarget.set(0, 0.4, 2);
};
