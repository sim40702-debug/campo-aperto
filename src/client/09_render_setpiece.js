// ============================================================
// TELECAMERA DEI CALCI PIAZZATI E DELL'ALLENAMENTO (0.23) — la porta si vede sempre tutta
// - punizioni dirette (entro 36 m dalla porta) e rigori: la telecamera va dietro al pallone, sulla linea tra il
//   pallone e il centro della porta, un po' in alto. Si vedono il tiratore, la barriera, il portiere e tutta la porta.
//   Come in TV si arriva con uno stacco netto;
// - dopo il calcio la telecamera resta ferma e segue il pallone per un paio di secondi, poi torna morbida
//   all'inquadratura scelta;
// - in allenamento (tiri, punizioni, rigori, dribbling) la telecamera sta sempre dietro al tuo calciatore e guarda
//   verso la porta: la porta resta nell'inquadratura anche mentre corri.
// Con la telecamera "Dietro al giocatore" (impostazioni) resta quella.
// Altre cose della telecamera e dei giocatori usate dopo il gol:
// - cutCamera(): al prossimo fotogramma la telecamera salta al suo posto invece di volarci (stacco);
// - resetPoses(): i giocatori ripartono da fermi nella posa (dopo un teletrasporto niente inclinazioni strane).
// ============================================================
const SP_CAM_RANGE = 36;      // punizioni più lontane: inquadratura normale
const SP_CAM_AFTER = 2.2;     // secondi di telecamera ferma dopo il calcio
const TRAIN_GOAL_CAM = { shots: true, freekick: true, penalty: true, dribble: true };

Renderer.prototype.setPieceCamera = function (dt, m, bx, by, bz) {
  const S = this._spc || (this._spc = { mode: null, after: 0, ox: 0, oz: 0, gx: 0, lbx: 0, lbz: 0 });
  const sp = m.setPiece, cam = this.camera, want = this._want, look = this._look;
  let mode = null;
  if (m.state === 'SETPIECE' && sp && (sp.type === 'FREE_KICK' || sp.type === 'PENALTY') && sp.team &&
      Math.hypot(sp.team.oppGoalX() - sp.x, sp.z) < SP_CAM_RANGE) {
    mode = 'set'; S.gx = sp.team.oppGoalX(); S.ox = sp.x; S.oz = sp.z; S.after = 0;
  } else if ((S.mode === 'set' || S.mode === 'after') && m.state === 'PLAY' && S.after < SP_CAM_AFTER) {
    mode = 'after'; S.after += dt;
  } else if (m.training && m.tr && TRAIN_GOAL_CAM[m.tr.drill.id]) {
    mode = 'train'; S.gx = CONFIG.HALF_L;   // in allenamento si attacca sempre verso destra
  }
  const prev = S.mode;
  S.mode = mode;
  if (!mode) return false;
  if (mode === 'set') {
    // dietro al pallone, sulla linea verso il centro della porta, spostata un po' di lato (verso il centro del campo)
    // e in alto: il tiratore, che sta proprio dietro al pallone, non copre il portiere
    const dx = S.gx - S.ox, dz = -S.oz, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    const pen = sp.type === 'PENALTY', back = pen ? 8 : 9, h = pen ? 3.4 : 4.4, side = pen ? 2.2 : 2.8;
    let nx = -uz, nz = ux;
    if (S.oz !== 0 && Math.sign(nz) === Math.sign(S.oz)) { nx = -nx; nz = -nz; }
    want.set(S.ox - ux * back + nx * side, h, S.oz - uz * back + nz * side);
    // si guarda più vicino al pallone: tiratore e pallone stanno sopra i comandi in basso, la porta resta in alto
    const ahead = pen ? 0.5 : 0.36;
    look.set(S.ox + ux * d * ahead, pen ? 0.9 : 0.5, S.oz + uz * d * ahead);
  } else if (mode === 'after') {
    // ferma: si gira verso il pallone (che non esce mai dall'inquadratura della porta)
    want.copy(cam.position);
    look.set(clamp(bx, Math.min(S.ox, S.gx), Math.max(S.ox, S.gx)), Math.max(0.8, by * 0.8), bz * 0.85);
  } else {
    // allenamento: dietro al pallone verso la porta (il punto di partenza non va mai troppo vicino alla porta)
    const ox = Math.min(bx, S.gx - 9), oz = bz;
    const dx = S.gx - ox, dz = -oz * 0.85, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    want.set(ox - ux * 11, 5.2, oz - uz * 11);
    look.set(ox + ux * Math.min(d * 0.5, 16), 0.9, oz + uz * Math.min(d * 0.5, 16));
    // nuovo tentativo (il pallone salta da un'altra parte): stacco
    if (Math.hypot(bx - S.lbx, bz - S.lbz) > 8) this._cut = true;
  }
  S.lbx = bx; S.lbz = bz;
  if (mode === 'set' && prev !== 'set') this._cut = true;   // si arriva alla punizione con uno stacco
  if (this._cut) {
    this._cut = false;
    cam.position.copy(want); this.camTarget.copy(look);
  } else {
    const k = mode === 'train' ? 3 : 2.5;
    cam.position.lerp(want, 1 - Math.exp(-k * dt));
    this.camTarget.lerp(look, 1 - Math.exp(-(k + 1.5) * dt));
  }
  cam.lookAt(this.camTarget);
  return true;
};

// stacco: al prossimo fotogramma la telecamera salta al suo posto
Renderer.prototype.cutCamera = function () { this._cut = true; };

// dopo un teletrasporto (calcio d'inizio, fine del replay): le pose ripartono da zero
Renderer.prototype.resetPoses = function () {
  for (const pm of this.playerMeshes) {
    pm.prevSp = undefined; pm.cel = null; pm.dv = null; pm.punch = 0; pm.catchHigh = 0; pm.smother = 0;
    pm.back = 0; pm.side = 0; pm.ready = 0; pm.release = null; pm.setHop = 0; pm.setK = 0; pm.block = 0; pm.held = false; pm._gkPrev = null;
  }
  this.celeb = null;
};

// prepara subito i disegni che si vedono solo ogni tanto (flash dei fotografi, fuochi d'artificio): senza, la prima
// volta che compaiono (al primo tiro o al primo gol) il gioco si ferma un attimo per prepararli
Renderer.prototype.warmShaders = function () {
  const hidden = [];
  this.scene.traverse(o => { if (o.isPoints && !o.visible) { hidden.push(o); o.visible = true; } });
  try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* non importante */ }
  for (const o of hidden) o.visible = false;
};
