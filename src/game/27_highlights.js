// ============================================================
// AZIONI MIGLIORI — gol, pali, parate e grandi occasioni da rivedere a fine partita
// Durante la partita, un secondo e mezzo dopo ogni momento importante si copia l'ultimo pezzo del buffer del replay
// (match.replay, 6 secondi): così ogni azione si vede da prima del tiro fino a dopo. Funziona uguale offline,
// per chi ospita, per chi entra online (il client registra il suo buffer) e guardando le partite del server.
// ============================================================
const HL = {
  AFTER: 90,          // fotogrammi dopo il momento (1,5 s a 60 al secondo)
  CLIP: 300,          // lunghezza di un'azione (5 s)
  KEEP: 12,           // azioni tenute in memoria durante la partita
  SHOW: 6,            // azioni proposte a fine partita
  SPEED: 0.75,        // un po' al rallentatore
  CHANCE_DIST: 18,    // un tiro da meno di 18 m dalla porta è una grande occasione
};
const HL_KIND = { goal: 3, post: 2, save: 2, chance: 1 };

// la lista è della partita: con una partita nuova si riparte da zero
Game.prototype.hlFor = function (m) {
  if (!this.hl || this.hl.match !== m) this.hl = { match: m, list: [], pending: null };
  return this.hl;
};

// evento della partita (stesso formato per partita locale e online): segna un momento da registrare
Game.prototype.hlEvent = function (e) {
  const m = this.match;
  if (!m || m.so || m.training || this.mode === 'menu' || !m.replay) return;
  let kind = null;
  if (e.type === 'goal') kind = 'goal';
  else if (e.type === 'post') kind = 'post';
  else if (e.type === 'save') kind = 'save';
  else if (e.type === 'ref' && e.r && e.r.type === 'SHOT' && Number.isFinite(e.r.x)) {
    // tiro da vicino a una porta (da lì si tira sempre verso quella porta)
    if (Math.hypot(52.5 - Math.abs(e.r.x), e.r.z || 0) < HL.CHANCE_DIST) kind = 'chance';
  }
  if (!kind) return;
  const hl = this.hlFor(m), now = m.replayCount || 0;
  const p = hl.pending;
  // stessa azione (un tiro e poi la parata o il gol): si tiene il momento più importante e si allunga un poco
  if (p && now <= p.due) {
    if (HL_KIND[kind] >= HL_KIND[p.kind]) p.kind = kind;
    p.due = Math.min(p.start + HL.CLIP - 30, now + HL.AFTER);
    return;
  }
  hl.pending = { kind: kind, start: now, due: now + HL.AFTER, minute: m.minute ? m.minute() : 0 };
};

// a ogni fotogramma: quando è il momento si copia l'azione dal buffer del replay
Game.prototype.hlTick = function (m) {
  const hl = this.hl;
  if (!hl || hl.match !== m || !hl.pending) return;
  const p = hl.pending, now = m.replayCount || 0;
  if (now < p.due && m.state !== 'FULLTIME') return;
  hl.pending = null;
  const n = Math.min(m.replay.length, HL.CLIP, Math.max(60, now - p.start + 210));
  if (n < 30) return;
  // copia: i fotogrammi del buffer vengono riusati mentre la partita va avanti
  const frames = m.replay.slice(m.replay.length - n).map(f => f.slice());
  let label = '';
  if (p.kind === 'goal') {
    const g = m.lastGoal;
    label = g ? trf(g.own ? '{0}\' Autogol di {1}' : '{0}\' Gol di {1}', g.minute, g.scorer) : trf('{0}\' Gol', p.minute);
  } else label = trf({ post: '{0}\' Palo', save: '{0}\' Parata', chance: '{0}\' Occasione' }[p.kind], p.minute);
  hl.list.push({ kind: p.kind, minute: p.minute, label: label, frames: frames, order: hl.list.length });
  // troppe azioni: via la meno importante (a pari importanza la più vecchia)
  if (hl.list.length > HL.KEEP) {
    let worst = 0;
    hl.list.forEach((c, i) => { if (HL_KIND[c.kind] < HL_KIND[hl.list[worst].kind]) worst = i; });
    hl.list.splice(worst, 1);
  }
};

// le azioni da proporre: prima i gol, poi le altre per importanza, poi in ordine di minuto
Game.prototype.hlChosen = function () {
  const hl = this.hl;
  if (!hl || hl.match !== this.match) return [];
  return hl.list.slice().sort((a, b) => HL_KIND[b.kind] - HL_KIND[a.kind] || a.order - b.order).slice(0, HL.SHOW)
    .sort((a, b) => a.order - b.order);
};

Game.prototype.renderHighlightsButton = function () {
  const list = this.hlChosen(), b = $('ft-highlights');
  b.hidden = !list.length;
  b.textContent = trf('Rivedi le azioni migliori ({0})', list.length);
  b.onclick = () => this.playHighlights();
};

// ---------- riproduzione ----------
Game.prototype.playHighlights = function () {
  const clips = this.hlChosen();
  if (!clips.length || !this.match) return;
  this.hlPlay = { clips: clips, idx: 0, i: 0 };
  $('fulltime').hidden = true;
  $('hl-bar').hidden = false;
  $('hl-next').onclick = () => this.nextHighlight();
  $('hl-exit').onclick = () => this.stopHighlights();
  this.showHighlightLabel();
};
Game.prototype.showHighlightLabel = function () {
  const h = this.hlPlay, c = h.clips[h.idx];
  $('hl-label').textContent = c.label + '  ·  ' + (h.idx + 1) + '/' + h.clips.length;
  $('hl-next').textContent = h.idx + 1 < h.clips.length ? tr('Prossima') : tr('Fine');
};
Game.prototype.nextHighlight = function () {
  const h = this.hlPlay;
  if (!h) return;
  if (h.idx + 1 >= h.clips.length) { this.stopHighlights(); return; }
  h.idx++; h.i = 0;
  this.showHighlightLabel();
};
Game.prototype.stopHighlights = function () {
  if (!this.hlPlay) return;
  this.hlPlay = null;
  $('hl-bar').hidden = true;
  if (this.screen === 'fulltime') $('fulltime').hidden = false;
};
// un passo della riproduzione (dal ciclo principale, nella schermata di fine partita)
Game.prototype.stepHighlights = function (dt) {
  const h = this.hlPlay;
  if (!h || !this.match) return;
  if (this.input.consumeAction('pass')) { this.nextHighlight(); if (!this.hlPlay) return; }
  const c = h.clips[h.idx];
  h.i += dt * 60 * HL.SPEED;
  if (h.i >= c.frames.length - 1) { this.nextHighlight(); if (!this.hlPlay) return; }
  const cc = this.hlPlay.clips[this.hlPlay.idx];
  this.renderer.syncFromReplay(cc.frames[Math.min(cc.frames.length - 1, Math.floor(this.hlPlay.i))], this.match, dt);
};
