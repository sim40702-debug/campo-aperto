// ============================================================
// SOSTITUZIONI — cambi dalla panchina durante la partita
// Valgono solo se la partita è creata con opts.subs (partita rapida e competizioni). Le partite del server non le
// chiedono: lì non cambia niente, la stessa partita esce identica (stesso seme = stesso risultato).
// Un cambio si chiede in qualsiasi momento ma avviene alla prossima palla ferma (punizione, rimessa, calcio d'inizio).
// Il nuovo calciatore prende il posto dell'uscente nella stessa casella della formazione: l'ordine dei calciatori
// (roster) non cambia, così rete, replay e grafica restano allineati.
// ============================================================
const SUBS = {
  MAX: 5,               // cambi per squadra
  AI_FROM_MINUTE: 58,   // l'IA comincia a pensare ai cambi da qui
  AI_MAX: 3,            // l'IA ne fa al massimo tre
  AI_TIRED: 88,         // sotto questa riserva di energia un calciatore è "stanco" (a fine partita i più stanchi sono verso 75)
};

// cambio chiesto: si fa alla prossima palla ferma. out = calciatore in campo, benchIndex = posto in panchina
Match.prototype.requestSub = function (team, out, benchIndex) {
  const t = typeof team === 'number' ? this.teams[team] : team;
  if (!this.subsOn || !t || !out || out.team !== t || out.sentOff) return false;
  if (!t.bench[benchIndex]) return false;
  // un portiere si cambia solo con un portiere
  if (out.isGK !== (t.bench[benchIndex].role === 'GK')) return false;
  // un calciatore esce una volta sola e un panchinaro entra una volta sola
  const others = (t.pendingSubs || []).filter(s => s.out !== out && s.bench !== t.bench[benchIndex]);
  if ((t.subsMade || 0) + others.length >= SUBS.MAX) return false;
  t.pendingSubs = others;
  t.pendingSubs.push({ out: out, bench: t.bench[benchIndex] });
  return true;
};
Match.prototype.cancelSub = function (team, out) {
  const t = typeof team === 'number' ? this.teams[team] : team;
  if (t && t.pendingSubs) t.pendingSubs = t.pendingSubs.filter(s => s.out !== out);
};
Match.prototype.subsLeft = function (team) {
  const t = typeof team === 'number' ? this.teams[team] : team;
  return SUBS.MAX - (t.subsMade || 0) - (t.pendingSubs ? t.pendingSubs.length : 0);
};

// il cambio vero: il calciatore resta lo stesso oggetto (stessa casella), cambiano anagrafica, energia e cartellini
Match.prototype.doSub = function (t, out, benchData) {
  const bi = t.bench.indexOf(benchData);
  if (bi < 0 || out.sentOff || !t.players.includes(out)) return false;
  const outData = out.data;
  t.bench.splice(bi, 1);
  t.subbedOff = t.subbedOff || [];
  t.subbedOff.push(outData);
  // i numeri di chi esce restano (statistiche di fine partita e migliore in campo)
  t.subbedStats = t.subbedStats || [];
  t.subbedStats.push({ data: outData, stats: out.stats, cards: out.cards });
  out.data = benchData;
  out.isGK = benchData.role === 'GK';
  out.energy = 100; out.energyCap = 100;
  out.cards = { yellow: 0, red: false };
  out.stats = { passes: 0, passesOk: 0, shots: 0, goals: 0, tackles: 0, saves: 0 };
  out.stunned = 0;
  t.subsMade = (t.subsMade || 0) + 1;
  this.queueBanner('Cambio — ' + benchData.name + ' ↔ ' + outData.name, 2, 'info');
  this.matchEvent('SUB', { player: out, team: t, reason: outData.name });
  return true;
};

// l'IA cambia i più stanchi, preferendo un panchinaro dello stesso ruolo
Match.prototype.aiSubs = function (t) {
  if (this.minute() < SUBS.AI_FROM_MINUTE || (t.subsMade || 0) >= SUBS.AI_MAX || !t.bench.length) return;
  const tired = t.players.filter(p => !p.isGK && !p.sentOff && (p.energyCap === undefined ? 100 : p.energyCap) < SUBS.AI_TIRED)
    .sort((a, b) => a.energyCap - b.energyCap);
  for (const p of tired) {
    if ((t.subsMade || 0) >= SUBS.AI_MAX) break;
    const role = p.slot.role;
    const cand = t.bench.filter(d => d.role !== 'GK');
    const best = cand.find(d => d.role === role) || cand[0];
    if (!best) break;
    this.doSub(t, p, best);
    break;   // uno per volta: il prossimo alla prossima palla ferma
  }
};

// a ogni palla ferma: prima i cambi chiesti, poi quelli dell'IA (solo per le squadre senza giocatori umani)
Match.prototype.applySubs = function () {
  if (!this.subsOn || this.so) return;   // ai rigori niente cambi
  for (const t of this.teams) {
    const list = t.pendingSubs || [];
    t.pendingSubs = [];
    for (const s of list) this.doSub(t, s.out, s.bench);
    if (!this.humans.some(h => h.team === t.index)) this.aiSubs(t);
  }
};

const _subsStartSetPiece = Match.prototype.startSetPiece;
Match.prototype.startSetPiece = function () { this.applySubs(); return _subsStartSetPiece.apply(this, arguments); };
const _subsStartKickoff = Match.prototype.startKickoff;
Match.prototype.startKickoff = function () { if (this.teams) this.applySubs(); return _subsStartKickoff.apply(this, arguments); };
