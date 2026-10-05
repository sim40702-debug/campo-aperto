// ============================================================
// SQUADRA IN PARTITA + TATTICHE
// ============================================================
class Team {
  constructor(data, index, kitName, match) {
    this.data = data;
    this.index = index;
    this.match = match;
    this.kit = data.kits[kitName];
    this.dir = index === 0 ? 1 : -1;     // +1 = attacca verso x positivo
    this.tactics = Object.assign({}, data.tactics);
    this.formation = data.formation;
    this.players = [];
    this.bench = [];
    this.score = 0;
    this.chaser = null; this.presser = null; this.cover = null;
    this.stats = { possession: 0, shots: 0, onTarget: 0, passes: 0, passesOk: 0, fouls: 0, corners: 0, offsides: 0, yellow: 0, red: 0 };
    const slots = FORMATIONS[this.formation];
    data.players.forEach((pd, i) => {
      if (i < 11) {
        const p = new Player(pd, this, i);
        p.slot = slots[i];
        this.players.push(p);
      } else this.bench.push(pd);
    });
    this.roster = this.players.slice();   // tutti gli undici, anche gli espulsi: ordine fisso per rete, replay e grafica
  }
  get gk() { return this.players[0]; }
  opponent() { return this.match.teams[1 - this.index]; }
  // conversione coordinate: u = distanza dalla propria porta, za = laterale nel verso d'attacco
  toWorldX(u) { return this.dir * (u - CONFIG.HALF_L); }
  toWorldZ(za) { return this.dir * za; }
  uOf(x) { return this.dir * x + CONFIG.HALF_L; }
  zaOf(z) { return this.dir * z; }
  ownGoalX() { return -this.dir * CONFIG.HALF_L; }
  oppGoalX() { return this.dir * CONFIG.HALF_L; }
}

// Linea del fuorigioco per la squadra che attacca (in coordinate u della squadra):
// penultimo avversario, ma mai prima di metà campo
function offsideLineU(team) {
  const us = team.opponent().players.map(p => team.uOf(p.x)).sort((a, b) => b - a);
  return Math.max(us[1], CONFIG.HALF_L);
}

// Posizione tattica ideale di un giocatore in questo momento
function slotTarget(p) {
  const team = p.team, match = team.match, ball = match.ball, t = team.tactics;
  const s = p.slot;
  const ballU = team.uOf(ball.x), ballZa = team.zaOf(ball.z);
  const attacking = match.possessionTeam === team;
  const shift = ballU - CONFIG.HALF_L;
  const ment = (t.mentality - 1); // -1 difensiva, 0 equilibrata, +1 offensiva
  let u, za;
  if (attacking) {
    const push = s.role === 'DF' ? 8 : s.role === 'MF' ? 12 : 13;
    u = s.u + push + ment * 5 + shift * 0.55;
    za = s.z * 1.15 * t.width + ballZa * 0.18;
  } else {
    u = s.u - 3 + ment * 4 + shift * 0.62;
    za = s.z * 0.78 + ballZa * 0.32;
  }
  if (s.role === 'DF') u = Math.min(u, attacking ? 72 : 58);
  if (attacking) {
    // gli attaccanti restano in linea con il penultimo difensore
    const line = Math.max(offsideLineU(team), ballU);
    if (u > line - 0.8) u = line - 0.8;
  } else {
    // in difesa si resta tra la palla e la propria porta
    const lim = s.role === 'FW' ? ballU + 4 : s.role === 'MF' ? ballU - 1 : ballU - 4;
    u = Math.min(u, Math.max(lim, 6));
  }
  u = clamp(u, 5, 101);
  za = clamp(za, -32, 32);
  return { x: team.toWorldX(u), z: team.toWorldZ(za) };
}

// Posizioni per il calcio d'inizio: tutti nella propria metà campo
function kickoffPosition(p, kickingTeam) {
  const team = p.team, s = p.slot;
  let u = Math.min(s.u * 0.95, 49);
  let za = s.z;
  if (p.isGK) { u = 2; za = 0; }
  // chi non batte sta fuori dal cerchio di centrocampo
  const x = team.toWorldX(u), z = team.toWorldZ(za);
  if (team !== kickingTeam && len(x, z) < CONFIG.CENTER_R + 0.5) {
    const d = len(x, z) || 1;
    return { x: x / d * (CONFIG.CENTER_R + 0.7), z: z / d * (CONFIG.CENTER_R + 0.7) };
  }
  return { x: x, z: z };
}
