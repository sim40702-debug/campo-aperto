// ============================================================
// AUDIO — tutto sintetizzato, nessun file esterno
// ============================================================
class GameAudio {
  constructor() { this.ctx = null; this.enabled = true; this.vol = { master: 0.8, sfx: 1, crowd: 0.7, muted: false }; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    // tre canali: generale -> (effetti, pubblico)
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.crowdBus = ctx.createGain(); this.crowdBus.connect(this.master);
    this.applyVolumes();
    // rumore bianco riutilizzabile
    const len = ctx.sampleRate * 2;
    const buf = this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // pubblico: rumore filtrato in loop
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.0;
    src.connect(bp); bp.connect(lp); lp.connect(this.crowdGain); this.crowdGain.connect(this.crowdBus);
    src.start();
    this.crowdFilter = bp;
  }
  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  setMuted(m) { this.setVolumes({ muted: !!m }); }
  applyVolumes() {
    this.enabled = !this.vol.muted;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.muted ? 0 : this.vol.master, t, 0.03);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.03);
    this.crowdBus.gain.setTargetAtTime(this.vol.crowd, t, 0.03);
  }
  // piccolo "clic" per i pulsanti dell'interfaccia
  ui() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(620, t + 0.05);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.08);
  }
  crowd(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.05 + level * 0.25, t, 0.4);
    this.crowdFilter.frequency.setTargetAtTime(500 + level * 500, t, 0.4);
  }
  whistle(times) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < (times || 1); i++) {
      const t = ctx.currentTime + i * 0.45;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 38;
      const lg = ctx.createGain(); lg.gain.value = 110; lfo.connect(lg); lg.connect(o.frequency);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.setValueAtTime(0.18, t + (times > 1 && i === times - 1 ? 0.7 : 0.28)); g.gain.linearRampToValueAtTime(0, t + (times > 1 && i === times - 1 ? 0.8 : 0.35));
      o.connect(g); g.connect(this.sfx);
      o.start(t); lfo.start(t); o.stop(t + 0.9); lfo.stop(t + 0.9);
    }
  }
  // calcio del pallone: il suono cambia con il gesto. kind: 'shot' tiro, 'pass' passaggio rasoterra,
  // 'lob' / 'cross' / 'lofted' palla alta, 'header' colpo di testa, 'throw' rimessa (nessun suono)
  kick(power, kind) {
    if (!this.ctx || kind === 'throw') return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = Math.min(power || 10, 35);
    const shot = kind === 'shot', head = kind === 'header', high = kind === 'lob' || kind === 'cross' || kind === 'lofted';
    // il colpo: rumore breve, più chiaro e forte nel tiro, sordo nel colpo di testa
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = head ? 'lowpass' : 'bandpass';
    f.frequency.value = head ? 500 : shot ? 1400 + p * 60 : high ? 900 + p * 30 : 700 + p * 25;
    f.Q.value = shot ? 1.4 : 0.8;
    const g = ctx.createGain();
    const vol = head ? 0.22 : shot ? 0.35 + p / 70 : high ? 0.28 + p / 110 : 0.18 + p / 120;
    const dur = shot ? 0.09 : head ? 0.1 : 0.07;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
    // il "bum" del cuoio: più basso e lungo nel tiro, quasi niente nel passaggio
    const o = ctx.createOscillator();
    const f0 = head ? 110 : shot ? 170 : high ? 150 : 210;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + (shot ? 0.14 : 0.08));
    const og = ctx.createGain(); og.gain.setValueAtTime(shot ? 0.45 : head ? 0.25 : 0.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + (shot ? 0.16 : 0.1));
    o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.18);
    // tiro forte o lancio lungo: il fruscio del pallone che vola
    if (shot && p > 18 || high && p > 16) {
      const w = ctx.createBufferSource(); w.buffer = this.noise;
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.Q.value = 2;
      wf.frequency.setValueAtTime(2600, t + 0.03); wf.frequency.exponentialRampToValueAtTime(900, t + 0.5);
      const wg = ctx.createGain(); wg.gain.setValueAtTime(0.0001, t); wg.gain.linearRampToValueAtTime(shot ? 0.06 : 0.035, t + 0.06); wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      w.connect(wf); wf.connect(wg); wg.connect(this.sfx); w.start(t, Math.random()); w.stop(t + 0.6);
    }
  }
  // palo o traversa: colpo metallico che vibra (frequenze non armoniche, come un tubo), poi il pubblico fa "ooh"
  post() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [fr, v, d] of [[310, 0.16, 1.3], [829, 0.12, 1.0], [1587, 0.08, 0.7], [2410, 0.05, 0.5], [3720, 0.03, 0.3]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr * (1 + (Math.random() - 0.5) * 0.01);
      const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + d + 0.05);
    }
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start(t); src.stop(t + 0.06);
    this.ooh(0.25);
  }
  // tante voci insieme: oscillatori un po' stonati tra loro, filtrati come una vocale (o, a, e)
  voices(t, notes, opts) {
    const ctx = this.ctx;
    const n = opts.n || 10, vowel = { o: [450, 850], a: [750, 1200], e: [500, 1800] }[opts.vowel || 'o'];
    const out = ctx.createGain(); out.gain.value = 1;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = vowel[0]; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = vowel[1]; f2.Q.value = 4;
    const mixG = ctx.createGain(); mixG.gain.value = opts.vol || 0.1;
    out.connect(f1); out.connect(f2); f1.connect(mixG); f2.connect(mixG); mixG.connect(this.crowdBus);
    const end = t + notes.reduce((s, x) => s + x[1], 0);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const det = 1 + (Math.random() - 0.5) * 0.06, start = (Math.random() - 0.5) * 0.06;
      let tt = t;
      for (const [fr, d] of notes) {
        o.frequency.setTargetAtTime(fr * det, Math.max(t, tt + start), opts.glide || 0.03);
        tt += d;
      }
      const g = ctx.createGain(); g.gain.value = 1 / n;
      o.connect(g); g.connect(out); o.start(t); o.stop(end + 0.4);
    }
    return { gain: mixG.gain, end: end };
  }
  // il pubblico fa "ooh" (occasione sprecata, palo, rigore sbagliato)
  ooh(delay) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const v = this.voices(t, [[240, 0.25], [210, 0.6], [160, 0.5]], { n: 14, vowel: 'o', vol: 0.0, glide: 0.15 });
    v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(0.32, t + 0.25); v.gain.linearRampToValueAtTime(0.22, t + 0.8); v.gain.exponentialRampToValueAtTime(0.0005, t + 1.35);
    // e il fiato del pubblico (rumore) sotto alle voci
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    src.connect(f); f.connect(g); g.connect(this.crowdBus); src.start(t, Math.random()); src.stop(t + 1.5);
  }
  // fischi del pubblico dopo un fallo duro o un cartellino: tanti fischi corti, ognuno con la sua nota
  crowdWhistles(amount) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const n = Math.round(6 + (amount || 0.5) * 12);
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.random() * 0.9, d = 0.25 + Math.random() * 0.8, fr = 1700 + Math.random() * 1900;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(fr, t);
      if (Math.random() < 0.5) o.frequency.linearRampToValueAtTime(fr * (0.85 + Math.random() * 0.3), t + d);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5 + Math.random() * 6;
      const lg = ctx.createGain(); lg.gain.value = fr * 0.012; lfo.connect(lg); lg.connect(o.frequency);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.04); g.gain.setValueAtTime(0.025, t + d - 0.05); g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(g); g.connect(this.crowdBus); o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
    }
    // e un brusio arrabbiato
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.14, t0 + 0.4); g.gain.exponentialRampToValueAtTime(0.001, t0 + 2);
    src.connect(f); f.connect(g); g.connect(this.crowdBus); src.start(t0, Math.random()); src.stop(t0 + 2.1);
  }
  // boato: big = gol (lungo, con le voci che urlano), altrimenti un applauso breve (parata, grande giocata)
  roar(big) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(big ? 0.55 : 0.25, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + (big ? 4.5 : 1.5));
    src.connect(f); f.connect(g); g.connect(this.crowdBus); src.start(t); src.stop(t + 5);
    if (!big) { this.clap(t, 1.2, 0.5); return; }
    // le voci che urlano "eeeh!" e poi gli applausi
    const v = this.voices(t, [[330, 0.4], [370, 1.2], [300, 1.2]], { n: 16, vowel: 'e', vol: 0, glide: 0.2 });
    v.gain.setValueAtTime(0.0001, t); v.gain.linearRampToValueAtTime(0.3, t + 0.3); v.gain.linearRampToValueAtTime(0.2, t + 1.6); v.gain.exponentialRampToValueAtTime(0.0005, t + 2.8);
    this.clap(t + 0.8, 3, 1);
  }
  // applausi: tanti battiti di mani a caso (rumore cortissimo filtrato)
  clap(t, secs, amount) {
    const ctx = this.ctx;
    const n = Math.round(secs * 40 * amount);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * secs;
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100 + Math.random() * 1500; f.Q.value = 1.5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.05 * (1 - (tt - t) / secs * 0.6), tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.03);
      src.connect(f); f.connect(g); g.connect(this.crowdBus); src.start(tt, Math.random() * 1.5); src.stop(tt + 0.04);
    }
  }
  // cori del pubblico: una melodia semplice cantata da tutto lo stadio, con le mani che battono il tempo
  chant(which) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    const N = { C: 196, D: 220, E: 247, G: 294, A: 330 };   // note basse, come un coro di stadio
    const songs = [
      // "o-o-o, o-o-o-o" su due note
      [['E', 0.45], ['E', 0.45], ['E', 0.9], ['D', 0.45], ['E', 0.45], ['G', 0.45], ['E', 0.9]],
      // "o-lè, o-lè o-lè o-lè"
      [['G', 0.5], ['E', 1.0], ['G', 0.5], ['E', 0.5], ['G', 0.5], ['E', 0.5], ['G', 0.5], ['E', 1.0]],
      // tre colpi e un grido
      [['C', 0.35], ['C', 0.35], ['C', 0.7], ['E', 0.35], ['G', 1.2]],
    ];
    const song = songs[(which === undefined ? Math.floor(Math.random() * songs.length) : which) % songs.length];
    const notes = song.map(x => [N[x[0]], x[1]]);
    const v = this.voices(t, notes, { n: 18, vowel: which === 1 ? 'e' : 'o', vol: 0, glide: 0.04 });
    // ogni nota è "cantata": la voce sale all'inizio e cala un po' alla fine
    let tt = t;
    v.gain.setValueAtTime(0.0001, t);
    for (const [, d] of notes) {
      v.gain.linearRampToValueAtTime(0.16, tt + 0.06);
      v.gain.linearRampToValueAtTime(0.09, tt + d * 0.9);
      tt += d;
    }
    v.gain.linearRampToValueAtTime(0.0001, tt + 0.3);
    // mani sul tempo
    const ctx = this.ctx;
    tt = t;
    for (const [, d] of notes) {
      for (let k = 0; k < 6; k++) {
        const ct = tt + Math.random() * 0.04;
        const src = ctx.createBufferSource(); src.buffer = this.noise;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300 + Math.random() * 900; f.Q.value = 1.2;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.045, ct); g.gain.exponentialRampToValueAtTime(0.001, ct + 0.04);
        src.connect(f); f.connect(g); g.connect(this.crowdBus); src.start(ct, Math.random() * 1.5); src.stop(ct + 0.05);
      }
      tt += d;
    }
    return tt - t;
  }
  // il gioco chiama questa funzione a ogni fotogramma della partita: ogni tanto parte un coro
  // (mai durante un'azione pericolosa, mai due cori di fila)
  chantTick(dt, calm) {
    if (!this.ctx) return;
    if (this.chantWait === undefined) this.chantWait = 12 + Math.random() * 20;
    this.chantWait -= dt;
    if (this.chantWait > 0 || !calm) return;
    const len = this.chant();
    this.chantWait = (len || 5) + 25 + Math.random() * 35;
  }
  // battito del cuore (rigori): "tu-tum" ogni 0,8 secondi finché on è vero
  heartbeat(dt, on) {
    if (!this.ctx) return;
    if (!on) { this.hbT = 0; return; }
    this.hbT = (this.hbT || 0) - dt;
    if (this.hbT > 0) return;
    this.hbT = 0.8;
    const ctx = this.ctx;
    for (const [d, v] of [[0, 0.5], [0.16, 0.35]]) {
      const t = ctx.currentTime + d;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.2);
    }
  }
}
