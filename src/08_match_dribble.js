// ============================================================
// FINTA E DRIBBLING — un tasto per saltare l'uomo (solo per chi gioca: l'IA non la usa)
// Con la palla: scatto laterale di pochi metri (verso la direzione scelta, o lontano dall'avversario più vicino)
// e per mezzo secondo un contrasto riesce meno, di più con un buon dribbling o la caratteristica «Dribblatore».
// Costa un po' di energia e si può rifare dopo poco più di un secondo.
// Una partita senza giocatori umani non passa mai da qui: le partite tra IA (anche quelle del server) non cambiano.
// ============================================================
const DRIBBLE = {
  BURST: 4.2,        // spinta laterale (m/s) aggiunta alla corsa
  ANGLE: 1.05,       // angolo dello scarto senza direzione (circa 60°)
  SHIELD: 0.5,       // secondi in cui il contrasto riesce meno
  COOLDOWN: 1.15,    // secondi prima della prossima finta
  ENERGY: 4,         // energia spesa
};

// probabilità che un contrasto vada a vuoto durante la finta
function dribbleShieldChance(p) {
  const a = p.data.attr.dribble;
  return clamp(0.25 + (a - 50) / 150 + (p.data.ability === 'Dribblatore' ? 0.1 : 0), 0.2, 0.65);
}

Match.prototype.humanDribble = function (p, input) {
  if (p.dribbleCooldown > 0 || this.ball.owner !== p || p.isGK) return false;
  // l'avversario più vicino davanti
  let opp = null, od = 1e9;
  for (const q of p.team.opponent().players) {
    if (q.sentOff) continue;
    const d = dist2(p.x, p.z, q.x, q.z);
    if (d < od) { od = d; opp = q; }
  }
  let dx, dz;
  if (len(input.mx, input.mz) > 0.2) { const l = len(input.mx, input.mz); dx = input.mx / l; dz = input.mz / l; }
  else {
    // senza direzione: scarto di lato, dalla parte opposta all'avversario
    const fx = Math.cos(p.facing), fz = Math.sin(p.facing);
    const side = opp ? (fx * (opp.z - p.z) - fz * (opp.x - p.x) > 0 ? -1 : 1) : 1;
    const a = p.facing + side * DRIBBLE.ANGLE;
    dx = Math.cos(a); dz = Math.sin(a);
  }
  p.vx += dx * DRIBBLE.BURST; p.vz += dz * DRIBBLE.BURST;
  const top = p.maxSpeed(true) * 1.12, v = len(p.vx, p.vz);
  if (v > top) { p.vx *= top / v; p.vz *= top / v; }
  p.dribbleShield = DRIBBLE.SHIELD;
  p.dribbleCooldown = DRIBBLE.COOLDOWN;
  p.energy = Math.max(5, p.energy - DRIBBLE.ENERGY * (1.3 - p.data.attr.stamina / 100));
  p.anim.feint = 0.3;
  this.emit('dribble', { id: p.team.match.allSlots().indexOf(p) });
  return true;
};

// contrasto durante la finta: a volte va a vuoto (chi interviene perde tempo come in un intervento mancato)
const _dribbleResolveTackle = Match.prototype.resolveTackle;
Match.prototype.resolveTackle = function (tackler, carrier, sliding) {
  if (carrier && carrier.dribbleShield > 0 && rand() < dribbleShieldChance(carrier)) {
    tackler.tackleCooldown = sliding ? 1.2 : 0.7;
    tackler.anim.tackle = sliding ? 0.8 : 0.35;
    tackler.stunned = sliding ? 1.0 : 0.5;
    carrier.dribbleShield = 0;
    carrier.stats.dribbles = (carrier.stats.dribbles || 0) + 1;
    return { legal: true, foul: false, advantage: false, yellow_card: false, red_card: false, severity: 0, reason: 'Dribbling riuscito' };
  }
  return _dribbleResolveTackle.apply(this, arguments);
};

// i tempi della finta scendono a ogni passo (solo se una finta c'è stata)
const _dribbleUpdate = Player.prototype.update;
Player.prototype.update = function (dt) {
  if (this.dribbleShield > 0) this.dribbleShield -= dt;
  if (this.dribbleCooldown > 0) this.dribbleCooldown -= dt;
  if (this.anim.feint > 0) this.anim.feint -= dt;
  return _dribbleUpdate.apply(this, arguments);
};
