// ============================================================
// REPLAY SALVATI — le azioni più belle da rivedere quando vuoi (Home → Replay)
// A fine partita, mentre rivedi le azioni migliori, «Salva» mette l'azione da parte su questo computer.
// Nella schermata Replay le rivedi con la telecamera che scegli (TV, tribuna, dietro la porta, dall'alto, segui la
// palla), più lente o più veloci, avanti e indietro con la barra.
// Come si salva: 30 fotogrammi al secondo, ogni numero in 2 byte (Int16, centimetri e millesimi), in base64 nel
// localStorage; con il replay anche squadre, colori, aspetto dei giocatori, meteo e ora, per ridisegnarli uguali.
// Tra un fotogramma e l'altro il movimento si interpola, quindi rivisto al rallentatore resta fluido.
// ============================================================
const REPLAY_KEY = 'campoAperto.replays.v1';
const REPLAY_MAX = 25;
const REPLAY_FPS = 30;          // fotogrammi salvati al secondo (la partita ne registra 60)
const REPLAY_STRIDE = 7;        // numeri per giocatore nel fotogramma: x, z, direzione, passo, velocità, calcio, tuffo
// moltiplicatori per salvare in interi: posizioni in cm, angoli e animazioni in millesimi
const REPLAY_SCALE = [100, 100, 100];
const REPLAY_PSCALE = [100, 100, 1000, 1000, 100, 1000, 1000];
const REPLAY_CAMS = [['tv', 'TV'], ['stand', 'Tribuna'], ['goal', 'Dietro la porta'], ['top', 'Dall\'alto'], ['ball', 'Segui la palla']];
const REPLAY_SPEEDS = [0.25, 0.5, 1];

// ---- codifica dei fotogrammi ----
function encodeReplayFrames(frames) {
  const keep = frames.filter((f, i) => i % 2 === 0);   // 60 -> 30 al secondo
  const len = keep.length ? keep[0].length : 0;
  const arr = new Int16Array(keep.length * len);
  let k = 0;
  for (const f of keep) {
    for (let i = 0; i < len; i++) {
      let v = f[i];
      const s = i < 3 ? REPLAY_SCALE[i] : REPLAY_PSCALE[(i - 3) % REPLAY_STRIDE];
      if (i >= 3 && (i - 3) % REPLAY_STRIDE === 3) v = ((v % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);   // passo: solo il giro
      arr[k++] = Math.max(-32767, Math.min(32767, Math.round(v * s)));
    }
  }
  const bytes = new Uint8Array(arr.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { data: btoa(bin), count: keep.length, len: len };
}
function decodeReplayFrames(r) {
  const bin = atob(r.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const arr = new Int16Array(bytes.buffer);
  const out = [];
  for (let n = 0; n < r.count; n++) {
    const f = new Array(r.len);
    for (let i = 0; i < r.len; i++) {
      const s = i < 3 ? REPLAY_SCALE[i] : REPLAY_PSCALE[(i - 3) % REPLAY_STRIDE];
      f[i] = arr[n * r.len + i] / s;
    }
    out.push(f);
  }
  return out;
}
// fotogramma tra due salvati (t = 0..1): posizioni in linea retta, angoli per la via più corta, passo sul giro
function lerpReplayFrame(a, b, t) {
  const f = a.slice();
  for (let i = 0; i < a.length; i++) {
    const kind = i < 3 ? -1 : (i - 3) % REPLAY_STRIDE;
    if (kind === 2) f[i] = a[i] + angleDiff(a[i], b[i]) * t;
    else if (kind === 3) { let d = b[i] - a[i]; if (d < -Math.PI) d += Math.PI * 2; f[i] = a[i] + d * t; }
    else if (kind === 6) f[i] = t < 0.5 ? a[i] : b[i];
    else f[i] = a[i] + (b[i] - a[i]) * t;
  }
  return f;
}

// ---- archivio ----
function loadReplays() {
  try { const l = JSON.parse(localStorage.getItem(REPLAY_KEY) || '[]'); return Array.isArray(l) ? l.filter(r => r && r.data && r.count > 1 && Array.isArray(r.slots)) : []; }
  catch (e) { return []; }
}
function saveReplays(list) {
  try { localStorage.setItem(REPLAY_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}

// azione della partita -> replay da salvare (con chi c'era in campo, per ridisegnarlo uguale)
Game.prototype.replayFromClip = function (clip, m) {
  const enc = encodeReplayFrames(clip.frames);
  const slots = m.allSlots().map(p => ({ n: p.data.number, gk: !!p.isGK, t: p.team.index, gone: !!p.gone,
    look: { skin: p.data.look.skin, hair: p.data.look.hair, hairStyle: p.data.look.hairStyle, height: p.data.look.height, build: p.data.look.build, boots: p.data.look.boots, beard: !!p.data.look.beard } }));
  return {
    id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), at: Date.now(),
    label: clip.label, kind: clip.kind, minute: clip.minute,
    teams: m.teams.map(t => ({ name: t.data.name, short: t.data.short, kit: t.kit.slice(0, 3) })),
    score: [m.teams[0].score, m.teams[1].score], weather: m.weather || 'clear', timeOfDay: m.timeOfDay || 'night',
    slots: slots, data: enc.data, count: enc.count, len: enc.len,
  };
};
Game.prototype.saveReplayClip = function (clip) {
  if (!clip || !this.match) return;
  const list = loadReplays();
  if (list.some(r => r.label === clip.label && Math.abs(r.at - Date.now()) < 6 * 3600e3 && r.minute === clip.minute)) { this.toast(tr('Questa azione è già salvata')); return; }
  if (list.length >= REPLAY_MAX) { this.toast(trf('Hai già {0} replay salvati: eliminane uno dalla schermata Replay', REPLAY_MAX), true); return; }
  list.unshift(this.replayFromClip(clip, this.match));
  if (!saveReplays(list)) { this.toast(tr('Spazio pieno: elimina qualche replay dalla schermata Replay'), true); return; }
  this.toast(tr('Replay salvato: lo trovi in Home → Replay'));
};

// ---- partita finta per ridisegnare i giocatori del replay ----
function replayStage(r) {
  const teams = r.teams.map((t, i) => ({ index: i, kit: t.kit, data: { name: t.name, short: t.short }, players: [], roster: [] }));
  const slots = r.slots.map((s, i) => {
    const p = { data: { number: s.n, look: Object.assign({}, s.look), name: '' }, isGK: s.gk, team: teams[s.t] || teams[0], slotIndex: i, gone: s.gone, anim: { phase: 0 } };
    p.team.players.push(p); p.team.roster.push(p);
    return p;
  });
  return { teams: teams, allSlots: () => slots, weather: r.weather, timeOfDay: r.timeOfDay, replayStage: true };
}

// ---- schermata Replay ----
Game.prototype.openReplays = function () { this.showScreen('replays'); this.renderReplays(); };
Game.prototype.renderReplays = function () {
  const list = loadReplays(), box = $('rp-list');
  $('rp-count').textContent = trf('{0} di {1}', list.length, REPLAY_MAX);
  if (!list.length) { box.innerHTML = '<p class="empty">' + esc(tr('Nessun replay salvato. A fine partita, in «Rivedi le azioni migliori», premi «Salva» sull\'azione che ti piace.')) + '</p>'; return; }
  box.innerHTML = list.map(r => '<div class="rp-card"><span class="rp-ico" aria-hidden="true">' + (r.kind === 'goal' ? '⚽' : r.kind === 'save' ? '🧤' : r.kind === 'post' ? '🥅' : '🎯') + '</span>' +
    '<div><b translate="no">' + esc(r.label) + '</b><small translate="no">' + esc(r.teams[0].short + ' ' + r.score[0] + '–' + r.score[1] + ' ' + r.teams[1].short) + '</small>' +
    '<small>' + esc(new Date(r.at).toLocaleString(uiLocale(), { dateStyle: 'short', timeStyle: 'short' })) + '</small></div>' +
    '<div class="acts"><button class="primary sm" data-rp-watch="' + r.id + '">' + esc(tr('Guarda')) + '</button><button class="ghost" data-rp-del="' + r.id + '">' + esc(tr('Elimina')) + '</button></div></div>').join('');
  box.querySelectorAll('[data-rp-watch]').forEach(b => b.onclick = () => this.watchReplay(b.dataset.rpWatch));
  box.querySelectorAll('[data-rp-del]').forEach(b => b.onclick = () => this.confirmClick(b, tr('Sicuro?'), () => {
    saveReplays(loadReplays().filter(r => r.id !== b.dataset.rpDel)); this.renderReplays();
  }));
};

// ---- riproduzione ----
Game.prototype.watchReplay = function (id) {
  const r = loadReplays().find(x => x.id === id);
  if (!r) return;
  let frames;
  try { frames = decodeReplayFrames(r); } catch (e) { this.toast(tr('Replay rovinato: non si può guardare'), true); return; }
  const stage = replayStage(r);
  this.demo = null;
  this.renderer._rvMode = null;
  this.renderer.setupMatch(stage);
  this.rv = { r: r, frames: frames, i: 0, speed: 0.5, cam: 'tv', playing: true };
  this.showScreen('rview');
  $('rv-label').textContent = r.label + '  ·  ' + r.teams[0].short + ' ' + r.score[0] + '–' + r.score[1] + ' ' + r.teams[1].short;
  const slider = $('rv-pos');
  slider.max = frames.length - 1; slider.value = 0;
  slider.oninput = () => { this.rv.i = Number(slider.value); };
  $('rv-play').onclick = () => { const v = this.rv; if (v.i >= v.frames.length - 1) v.i = 0; v.playing = !v.playing; this.renderReplayBar(); };
  $('rv-exit').onclick = () => this.closeReplay();
  this.renderReplayBar();
};
Game.prototype.renderReplayBar = function () {
  const v = this.rv;
  if (!v) return;
  $('rv-play').textContent = v.playing ? tr('Pausa') : tr('Avanti');
  this.segmented('rv-speed', REPLAY_SPEEDS.map(s => ({ label: (s === 1 ? '1×' : String(s).replace('.', uiLocale().startsWith('en') ? '.' : ',') + '×'), value: s, noTranslate: true })), v.speed, s => { v.speed = s; this.renderReplayBar(); });
  this.segmented('rv-cam', REPLAY_CAMS.map(c => ({ label: c[1], value: c[0] })), v.cam, c => { v.cam = c; this.renderReplayBar(); });
};
Game.prototype.closeReplay = function () {
  this.rv = null;
  this.startDemo();
  this.openReplays();
};
// un passo (dal ciclo principale)
Game.prototype.stepReplayViewer = function (dt) {
  const v = this.rv, R = this.renderer;
  if (v.playing) {
    v.i += dt * REPLAY_FPS * v.speed;
    if (v.i >= v.frames.length - 1) { v.i = v.frames.length - 1; v.playing = false; this.renderReplayBar(); }
    $('rv-pos').value = Math.floor(v.i);
  }
  const a = Math.floor(v.i), t = v.i - a;
  const f = a + 1 < v.frames.length ? lerpReplayFrame(v.frames[a], v.frames[a + 1], t) : v.frames[a];
  // al rallentatore anche le animazioni del renderer vanno più piano
  R.syncFromReplay(f, null, dt * (v.playing ? v.speed : 0.0001));
  R.replayCamera(v.cam, f, dt);
};

// telecamere del replay (dopo syncFromReplay, che mette la sua: "tv")
Renderer.prototype.replayCamera = function (mode, f, dt) {
  if (mode === 'tv') return;
  const cam = this.camera, bx = f[0], by = f[1], bz = f[2];
  const want = this._rvWant || (this._rvWant = new THREE.Vector3()), look = this._rvLook || (this._rvLook = new THREE.Vector3());
  if (mode === 'stand') { want.set(bx * 0.82, 24, bz * 0.3 + 47); look.set(bx * 0.9, 0, bz * 0.55 + 2); }
  else if (mode === 'top') { want.set(bx, 48, bz + 8); look.set(bx, 0, bz); }
  else if (mode === 'goal') { const side = Math.sign(bx) || 1; want.set(side * (CONFIG.HALF_L + 9), 4.5, bz * 0.25); look.set(bx, Math.max(0.8, by), bz); }
  else if (mode === 'ball') {
    const pv = this._rvPrev || [bx, bz];
    let dx = bx - pv[0], dz = bz - pv[1]; const l = Math.hypot(dx, dz);
    if (l > 0.01) { this._rvDir = [dx / l, dz / l]; }
    this._rvPrev = [bx, bz];
    const d = this._rvDir || [1, 0];
    want.set(bx - d[0] * 7, 2.6 + by * 0.5, bz - d[1] * 7); look.set(bx + d[0] * 4, Math.max(0.6, by), bz + d[1] * 4);
  }
  if (this._rvMode !== mode) { this._rvMode = mode; cam.position.copy(want); this.camTarget.copy(look); }
  cam.position.lerp(want, 1 - Math.exp(-4 * dt)); this.camTarget.lerp(look, 1 - Math.exp(-6 * dt));
  cam.lookAt(this.camTarget);
};
