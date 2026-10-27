// ============================================================
// MUSICA DI NATALE (0.22) — Jingle Bells suonata davvero, tutta sintetizzata (nessun file)
// Jingle Bells (James Lord Pierpont, 1857) è di pubblico dominio: strofa e ritornello in sol maggiore.
// Strumenti: campanelle (FM) sulla melodia, pianoforte con gli accordi a "um-pa", basso, sonagli della slitta in
// ottavi, cassa e spazzola, più un'eco da stadio. Due modi:
// - 'menu': musica di sottofondo nella Home, in loop, con un coro che canta le parole (canale Musica);
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

// parole cantate: una sillaba per nota della melodia, scritta come [consonante, vocale] (la consonante è un soffio
// o un colpo breve prima della vocale). Le vocali si fanno con i formanti della voce (le "risonanze" della bocca).
const JB_WORDS_VERSE = ('d-a s-i th-u th-e s-o -i n-a | w-a h-o -o p-e s-e | -o th-e f-i w-i g-o | l-a -i -o th-e w-e | ' +
  'b-e -o b-o t-e r-i | m-e k-i s-i r-i b-a w-o | f-a -i -i t-u r-a -a s-i g-a | s-e -i s-o t-u n-a').split(/[\s|]+/).filter(Boolean);
const JB_WORDS_CHORUS = ('j-i g-e b-e j-i g-e b-e j-i g-e -o th-e w-e | -o w-o f-a -i -i t-u r-a -i n-a | w-a h-o -o p-e s-e h-e | ' +
  'j-i g-e b-e j-i g-e b-e j-i g-e -o th-e w-e | -o w-o f-a -i -i t-u r-a -i n-a | w-a h-o -o p-e s-e').split(/[\s|]+/).filter(Boolean);
const JB_FORMANTS = { a: [800, 1200, 2500], e: [480, 1800, 2500], i: [300, 2250, 2950], o: [450, 820, 2830], u: [330, 720, 2530] };

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
  // nei menu canta un coro (poche voci, pulite) tutta la canzone, a ogni giro
  const sing = () => {
    if (stadium) return;
    this.choir('verse', song.start, spb, { n: 6, vol: 0.16, dest: out });
    this.choir('chorus', song.start + score.chorusAt * spb, spb, { n: 6, vol: 0.16, dest: out });
  };
  sing();
  const tick = () => {
    if (this.song !== song) return;
    const now = ctx.currentTime, horizon = now + 0.6;
    while (true) {
      if (song.idx >= score.ev.length) {
        if (!song.loop) { song.endAt = song.start + score.beats * spb; return; }
        song.start += score.beats * spb + spb * 4;   // una battuta di respiro, poi da capo
        song.idx = 0;
        sing();
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

// coro che canta le parole: part = 'verse' o 'chorus', t0 = quando inizia; opts: { n voci, vol, octave, dest }
// Ogni voce è un'onda a dente di sega appena stonata dalle altre; tre filtri fanno le vocali e cambiano a ogni
// sillaba; prima della vocale un piccolo soffio fa la consonante.
GameAudio.prototype.choir = function (part, t0, spb, opts) {
  const ctx = this.ctx, melody = part === 'verse' ? JB_VERSE : JB_CHORUS, words = part === 'verse' ? JB_WORDS_VERSE : JB_WORDS_CHORUS;
  const n = opts.n || 8, dest = opts.dest || this.crowdBus, oct = opts.octave || 0;
  const mix = ctx.createGain(); mix.gain.value = 0;
  const formants = [0, 1, 2].map(k => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = [6, 9, 11][k]; return f; });
  const fg = [1, 0.55, 0.25].map(v => { const g = ctx.createGain(); g.gain.value = v; return g; });
  const src = ctx.createGain(); src.gain.value = 4.5 / n;   // i filtri delle vocali tolgono molto: si compensa qui
  formants.forEach((f, k) => { src.connect(f); f.connect(fg[k]); fg[k].connect(mix); });
  mix.connect(dest);
  // le note e le sillabe
  let t = t0, end = t0;
  const notes = [];
  melody.forEach(([m, d], k) => {
    const w = (words[k] || '-a').split('-'), dur = d * spb;
    notes.push({ t: t, d: dur, f: midiHz(m + oct), c: w[0], v: JB_FORMANTS[w[1]] ? w[1] : 'a' });
    t += dur; end = t;
  });
  const oscs = [];
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const det = (Math.random() - 0.5) * 22;   // centesimi di semitono: ognuno canta un po' a modo suo
    o.detune.value = det;
    // vibrato lento, diverso per ogni voce
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.6 + Math.random() * 1.2;
    const lg = ctx.createGain(); lg.gain.value = 14; lfo.connect(lg); lg.connect(o.detune);
    for (const nt of notes) {
      const late = Math.random() * 0.025;   // le voci non attaccano tutte nello stesso istante
      o.frequency.setTargetAtTime(nt.f, nt.t + late, 0.018);
    }
    o.connect(src); o.start(t0); lfo.start(t0); o.stop(end + 0.5); lfo.stop(end + 0.5);
    oscs.push(o);
  }
  const vol = opts.vol || 0.12;
  mix.gain.setValueAtTime(0.0001, t0);
  for (const nt of notes) {
    // vocale: i filtri vanno alle risonanze della vocale di questa sillaba
    formants.forEach((f, k) => f.frequency.setTargetAtTime(JB_FORMANTS[nt.v][k], nt.t, 0.02));
    // volume della sillaba: entra dopo la consonante, resta, cala un po' prima della nota dopo
    const cons = nt.c ? 0.045 : 0.01;
    mix.gain.setTargetAtTime(vol * 0.35, nt.t, 0.01);
    mix.gain.setTargetAtTime(vol, nt.t + cons, 0.02);
    mix.gain.setTargetAtTime(vol * 0.55, nt.t + Math.max(cons + 0.05, nt.d * 0.82), 0.03);
    if (nt.c) this.consonant(nt.c, nt.t, vol, dest);
  }
  mix.gain.setTargetAtTime(0.0001, end, 0.12);
  return end;
};

// consonante: un soffio di rumore filtrato (s, f, th, h) o un colpo breve (d, b, p, t, g, j, k), le altre morbide
GameAudio.prototype.consonant = function (c, t, vol, dest) {
  const ctx = this.ctx;
  const hiss = { s: [6500, 0.07], f: [4500, 0.06], th: [5000, 0.05], h: [1800, 0.06], j: [3200, 0.05] }[c];
  const pop = { d: 2400, b: 900, p: 1400, t: 3800, g: 1600, k: 2600 }[c];
  if (!hiss && !pop) return;   // l, m, n, r, w: la vocale basta
  const src = ctx.createBufferSource(); src.buffer = this.noise;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = hiss ? hiss[0] : pop; f.Q.value = hiss ? 1.2 : 0.9;
  const g = ctx.createGain(); const len = hiss ? hiss[1] : 0.022;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol * (hiss ? 0.5 : 0.8), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random()); src.stop(t + len + 0.02);
};

// lo stadio canta il ritornello insieme agli altoparlanti: tante voci, un'ottava sotto (voci da stadio)
GameAudio.prototype.crowdSing = function (start, score, spb) {
  const t0 = start + score.chorusAt * spb;
  this.choir('chorus', t0, spb, { n: 16, vol: 0.2, octave: -12, dest: this.crowdBus });
  this.choir('chorus', t0, spb, { n: 8, vol: 0.09, octave: 0, dest: this.crowdBus });   // e chi canta più acuto
};
