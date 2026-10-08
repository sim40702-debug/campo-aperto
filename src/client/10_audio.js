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
  kick(power) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + power * 40;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25 + Math.min(power, 30) / 60, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + 0.15);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og); og.connect(this.sfx); o.start(t); o.stop(t + 0.13);
  }
  post() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const fr of [520, 1310, 2150]) {
      const o = ctx.createOscillator(); o.frequency.value = fr;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + 0.6);
    }
  }
  roar(big) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(big ? 0.55 : 0.25, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + (big ? 4.5 : 1.5));
    src.connect(f); f.connect(g); g.connect(this.crowdBus); src.start(t); src.stop(t + 5);
  }
}
