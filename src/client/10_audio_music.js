// ============================================================
// MUSICA DI NATALE (0.22) — Jingle Bells suonata davvero, tutta sintetizzata (nessun file)
// Jingle Bells (James Lord Pierpont, 1857) è di pubblico dominio: strofa e ritornello in sol maggiore.
// Strumenti: campanelle (FM) sulla melodia, pianoforte con gli accordi a "um-pa", basso, sonagli della slitta in
// ottavi, cassa e spazzola, più un'eco da stadio. Due modi:
// - 'menu': musica di sottofondo nella Home, in loop, pulita (canale Musica);
// - 'stadium': gli altoparlanti dello stadio suonano il ritornello e il pubblico canta (canale Pubblico).
// Le note si programmano poco alla volta (mezzo secondo avanti), così non si creano migliaia di suoni insieme.
// ============================================================
const JB_BPM = 132;
// melodia: [nota MIDI, durata in battiti] — 0 = pausa
const JB_VERSE = [
  [62, 1], [71, 1], [69, 1], [67, 1], [62, 3], [62, 0.5], [62, 0.5],
  [62, 1], [71, 1], [69, 1], [67, 1], [64, 4],
  [64, 1], [72, 1], [71, 1], [69, 1], [66, 4],
  [74, 1], [74, 1], [72, 1], [69, 1], [71, 4],
  [62, 1], [71, 1], [69, 1], [67, 1], [62, 4],
  [62, 1], [71, 1], [69, 1], [67, 1], [64, 3], [64, 1],
  [64, 1], [72, 1], [71, 1], [69, 1], [74, 1], [74, 1], [74, 1], [74, 1],
  [76, 1], [74, 1], [72, 1], [69, 1], [67, 4],
];
const JB_CHORUS = [
  [71, 1], [71, 1], [71, 2], [71, 1], [71, 1], [71, 2], [71, 1], [74, 1], [67, 1.5], [69, 0.5], [71, 4],
  [72, 1], [72, 1], [72, 1.5], [72, 0.5], [72, 1], [71, 1], [71, 1], [71, 0.5], [71, 0.5],
  [71, 1], [69, 1], [69, 1], [71, 1], [69, 2], [74, 2],
  [71, 1], [71, 1], [71, 2], [71, 1], [71, 1], [71, 2], [71, 1], [74, 1], [67, 1.5], [69, 0.5], [71, 4],
  [72, 1], [72, 1], [72, 1.5], [72, 0.5], [72, 1], [71, 1], [71, 1], [71, 0.5], [71, 0.5],
  [74, 1], [74, 1], [72, 1], [69, 1], [67, 4],
];
// accordi, uno per battuta da 4 battiti: nota di base (MIDI) e tipo
const JB_CHORDS_VERSE = ['G', 'G', 'C', 'D', 'G', 'G', 'C', 'G'];   // ogni accordo dura 2 battute nella strofa (16 battute)
const JB_CHORDS_CHORUS = ['G', 'G', 'G', 'G', 'C', 'G', 'A7', 'D7', 'G', 'G', 'G', 'G', 'C', 'G', 'D7', 'G'];
const JB_CHORD = { G: [55, 59, 62], C: [60, 64, 67], D: [57, 62, 66], A7: [57, 61, 64, 67], D7: [57, 60, 62, 66] };
const JB_ROOT = { G: 43, C: 48, D: 50, A7: 45, D7: 50 };

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// tutta la canzone come elenco di eventi { t (battiti), kind, ... }
function jingleBellsScore(chorusOnly) {
  const ev = [];
  let t = 0;
  const melody = (notes) => { for (const [m, d] of notes) { if (m) ev.push({ t: t, kind: 'mel', m: m, d: d }); t += d; } };
  const accomp = (chords, barsEach, start) => {
    let bt = start;
    for (const c of chords) {
      for (let b = 0; b < barsEach; b++) {
        for (let beat = 0; beat < 4; beat++) {
          const at = bt + beat;
          // um-pa: basso sui battiti 1 e 3 (radice e quinta), accordo sui battiti 2 e 4
          if (beat % 2 === 0) ev.push({ t: at, kind: 'bass', m: JB_ROOT[c] + (beat === 2 ? 7 : 0) });
          else ev.push({ t: at, kind: 'chord', ms: JB_CHORD[c] });
          ev.push({ t: at, kind: beat % 2 === 0 ? 'kick' : 'brush' });
        }
        for (let h = 0; h < 8; h++) ev.push({ t: bt + h * 0.5, kind: 'sleigh', acc: h % 2 === 0 });
        bt += 4;
      }
    }
  };
  const t0 = t;
  if (!chorusOnly) { accomp(JB_CHORDS_VERSE, 2, t0); melody(JB_VERSE); }
  const t1 = t;
  accomp(JB_CHORDS_CHORUS, 1, t1); melody(JB_CHORUS);
  ev.sort((a, b) => a.t - b.t);
  return { ev: ev, beats: t, chorusAt: t1 };
}

// eco da stadio: una risposta all'impulso finta (rumore che si spegne), calcolata una volta
GameAudio.prototype.musicReverb = function () {
  if (this._reverb) return this._reverb;
  const ctx = this.ctx, len = Math.round(ctx.sampleRate * 2.2), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const conv = ctx.createConvolver(); conv.buffer = buf;
  return this._reverb = conv;
};

// avvia la canzone. mode 'menu' (loop, canale Musica) o 'stadium' (solo ritornello, altoparlanti e pubblico che canta)
GameAudio.prototype.playJingleBells = function (mode) {
  if (!this.ctx) return;
  if (this.song && this.song.mode === mode) return;
  this.stopJingleBells();
  const ctx = this.ctx, stadium = mode === 'stadium';
  if (!this.musicBus) { this.musicBus = ctx.createGain(); this.musicBus.connect(this.master); this.applyVolumes(); }
  // catena: strumenti -> (altoparlanti dello stadio: un po' di filtro) -> secco + eco -> canale
  const out = ctx.createGain(); out.gain.value = 0;
  const dest = stadium ? this.crowdBus : this.musicBus;
  let pre = out;
  if (stadium) {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
    out.connect(hp); hp.connect(lp); pre = lp;
  }
  const dry = ctx.createGain(); dry.gain.value = stadium ? 0.55 : 0.85;
  const wet = ctx.createGain(); wet.gain.value = stadium ? 0.6 : 0.22;
  pre.connect(dry); dry.connect(dest);
  pre.connect(this.musicReverb()); this.musicReverb().connect(wet); wet.connect(dest);
  const score = jingleBellsScore(stadium);
  const spb = 60 / JB_BPM;
  const song = this.song = { mode: mode, out: out, dry: dry, wet: wet, score: score, spb: spb, start: ctx.currentTime + 0.15, idx: 0, loop: !stadium };
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.linearRampToValueAtTime(stadium ? 0.5 : 0.38, ctx.currentTime + 0.8);
  // il pubblico canta il ritornello insieme agli altoparlanti
  if (stadium) this.crowdSing(song.start, score, spb);
  const tick = () => {
    if (this.song !== song) return;
    const now = ctx.currentTime, horizon = now + 0.6;
    while (true) {
      if (song.idx >= score.ev.length) {
        if (!song.loop) { song.endAt = song.start + score.beats * spb; return; }
        song.start += score.beats * spb + spb * 4;   // una battuta di respiro, poi da capo
        song.idx = 0;
      }
      const e = score.ev[song.idx], at = song.start + e.t * spb;
      if (at > horizon) break;
      if (at >= now - 0.05) this.musicNote(e, at, spb, out);
      song.idx++;
    }
  };
  tick();
  song.timer = setInterval(tick, 150);
  return score.beats * spb;
};

GameAudio.prototype.stopJingleBells = function () {
  const s = this.song;
  if (!s) return;
  this.song = null;
  clearInterval(s.timer);
  const t = this.ctx.currentTime;
  s.out.gain.cancelScheduledValues(t);
  s.out.gain.setValueAtTime(s.out.gain.value, t);
  s.out.gain.linearRampToValueAtTime(0, t + 0.6);
  setTimeout(() => { try { s.dry.disconnect(); s.wet.disconnect(); s.out.disconnect(); } catch (e) { /* già staccato */ } }, 900);
};

// la canzone dello stadio è finita?
GameAudio.prototype.songPlaying = function () { return !!(this.song && (!this.song.endAt || this.ctx.currentTime < this.song.endAt)); };

// un evento della partitura: suona lo strumento giusto
GameAudio.prototype.musicNote = function (e, t, spb, out) {
  const ctx = this.ctx;
  const env = (g, a, peak, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
  if (e.kind === 'mel') {
    // campanella: sinusoide modulata in frequenza (suono metallico che si addolcisce) più un'ottava sopra leggera
    const f = midiHz(e.m), dur = Math.max(0.5, e.d * spb + 0.6);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * 3.5;
    const mg = ctx.createGain(); mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain(); env(g, 0.004, 0.22, dur);
    car.connect(g);
    const oct = ctx.createOscillator(); oct.frequency.value = f * 2;
    const og = ctx.createGain(); env(og, 0.004, 0.05, dur * 0.6);
    oct.connect(og); og.connect(out);
    // un flauto morbido sotto, perché la melodia si capisca bene
    const fl = ctx.createOscillator(); fl.type = 'triangle'; fl.frequency.value = f;
    const fg = ctx.createGain(); fg.gain.setValueAtTime(0.0001, t); fg.gain.linearRampToValueAtTime(0.09, t + 0.03); fg.gain.setValueAtTime(0.09, t + e.d * spb * 0.85); fg.gain.linearRampToValueAtTime(0.0001, t + e.d * spb);
    fl.connect(fg); fg.connect(out);
    g.connect(out);
    for (const o of [car, mod, oct]) { o.start(t); o.stop(t + dur + 0.1); }
    fl.start(t); fl.stop(t + e.d * spb + 0.05);
  } else if (e.kind === 'chord') {
    // pianoforte: due onde leggermente stonate tra loro per ogni nota, attacco secco
    for (const m of e.ms) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = midiHz(m); o.detune.value = det;
        const g = ctx.createGain(); env(g, 0.006, 0.035, spb * 0.9);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + spb + 0.1);
      }
    }
  } else if (e.kind === 'bass') {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midiHz(e.m);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = midiHz(e.m) * 2;
    const g = ctx.createGain(); env(g, 0.01, 0.22, spb * 1.1);
    const g2 = ctx.createGain(); env(g2, 0.01, 0.04, spb * 0.6);
    o.connect(g); o2.connect(g2); g.connect(out); g2.connect(out);
    o.start(t); o2.start(t); o.stop(t + spb * 1.3); o2.stop(t + spb);
  } else if (e.kind === 'kick') {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ctx.createGain(); env(g, 0.003, 0.3, 0.16);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
  } else if (e.kind === 'brush') {
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.6;
    const g = ctx.createGain(); env(g, 0.005, 0.07, 0.12);
    src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random()); src.stop(t + 0.15);
  } else if (e.kind === 'sleigh') {
    // sonagli: tre campanelline acute per colpo, con un fruscio
    const g = ctx.createGain(); env(g, 0.002, e.acc ? 0.05 : 0.03, 0.09);
    g.connect(out);
    for (const f of [5274, 6272, 7459]) {
      const o = ctx.createOscillator(); o.frequency.value = f * (0.99 + Math.random() * 0.02);
      o.connect(g); o.start(t); o.stop(t + 0.12);
    }
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 7000;
    const ng = ctx.createGain(); env(ng, 0.002, 0.025, 0.06);
    src.connect(hf); hf.connect(ng); ng.connect(out); src.start(t, Math.random()); src.stop(t + 0.08);
  }
};

// il pubblico canta la melodia del ritornello (voci del coro di stadio, 10_audio.js), un'ottava sotto
GameAudio.prototype.crowdSing = function (start, score, spb) {
  const notes = [];
  let t = 0;
  for (const [m, d] of JB_CHORUS) { notes.push([midiHz(m - 12), d * spb]); t += d; }
  const v = this.voices(start + score.chorusAt * spb, notes, { n: 20, vowel: 'e', vol: 0, glide: 0.03 });
  let tt = start + score.chorusAt * spb;
  v.gain.setValueAtTime(0.0001, tt);
  for (const [, d] of notes) {
    v.gain.linearRampToValueAtTime(0.13, tt + 0.05);
    v.gain.linearRampToValueAtTime(0.07, tt + d * 0.85);
    tt += d;
  }
  v.gain.linearRampToValueAtTime(0.0001, tt + 0.4);
};
