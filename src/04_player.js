// ============================================================
// GIOCATORE IN PARTITA
// ============================================================
class Player {
  constructor(data, team, slotIndex) {
    this.data = data;            // anagrafica e attributi dal database
    this.team = team;
    this.slotIndex = slotIndex;
    this.slot = null;            // posizione nella formazione (impostata dalla squadra)
    this.isGK = data.role === 'GK';
    this.x = 0; this.z = 0; this.vx = 0; this.vz = 0;
    this.facing = 0;             // angolo in radianti sul piano x-z
    this.energy = 100;           // energia durante la partita
    this.kickCooldown = 0;
    this.tackleCooldown = 0;
    this.stunned = 0;            // tempo in cui non può agire (dopo un contrasto)
    this.decisionTimer = rand() * 0.3;
    this.runTimer = rand() * 1.5;
    this.runOffX = 0; this.runOffZ = 0;
    this.sprinting = false;
    this.anim = { phase: rand() * 6, kick: 0, tackle: 0, dive: 0, diveDir: 0, header: 0, celebrate: 0, fall: 0 };
    this.cards = { yellow: 0, red: false };
    this.sentOff = false;        // espulso: esce dal campo e non gioca più
    this.stats = { passes: 0, passesOk: 0, shots: 0, goals: 0, tackles: 0 };
  }
  get attr() { return this.data.attr; }
  // massa in kg (fisico e altezza): decide chi sposta chi negli scontri
  mass() { return 68 + this.data.attr.physical * 0.16 + (this.data.look.height - 1.8) * 45; }
  speed() { return len(this.vx, this.vz); }

  // velocità massima in base ad attributi, energia e possesso palla
  maxSpeed(sprint) {
    const a = this.data.attr;
    let top = 6.4 + a.speed * 0.03;
    if (this.data.ability === 'Velocista') top += 0.4;
    let s = sprint ? top : top * 0.64;
    if (this.energy < 45) s *= 0.82 + 0.18 * (this.energy / 45);
    if (this.team.match && this.team.match.ball.owner === this) s *= 0.9;
    return s;
  }
  accel() { return 5 + this.data.attr.accel * 0.045; }

  // si muove verso un punto, rallentando in arrivo
  moveToward(tx, tz, sprint, dt, precise) {
    const dx = tx - this.x, dz = tz - this.z;
    const d = len(dx, dz);
    let desiredX = 0, desiredZ = 0;
    if (d > (precise ? 0.05 : 0.35)) {
      const sp = Math.min(this.maxSpeed(sprint), d * 1.8 + 0.3);
      desiredX = dx / d * sp; desiredZ = dz / d * sp;
    }
    this.steer(desiredX, desiredZ, dt);
    this.sprinting = sprint && d > 2;
  }
  // si muove in una direzione (input umano).
  // Con la levetta analogica la lunghezza del vettore (0..1) decide la velocità: poco inclinata = camminata.
  // I calciatori guidati da un umano rispondono un po' più in fretta (comandi più reattivi).
  moveDir(dirX, dirZ, sprint, dt) {
    const l = len(dirX, dirZ);
    let desiredX = 0, desiredZ = 0;
    if (l > 0.1) {
      const amount = Math.min(1, 0.25 + 0.75 * Math.min(1, l) / 0.9);
      const sp = this.maxSpeed(sprint && l > 0.5) * amount;
      desiredX = dirX / l * sp; desiredZ = dirZ / l * sp;
    }
    this.steer(desiredX, desiredZ, dt, 1.3);
    this.sprinting = sprint && l > 0.5;
  }
  // dinamica del movimento: la variazione di velocità è limitata dall'accelerazione del giocatore.
  // La spinta cala avvicinandosi alla velocità massima (accelerazione progressiva, e in piena corsa si curva più
  // largo), in sprint il controllo è un po' minore, e frenare è più rapido che accelerare (inerzia credibile
  // senza perdere velocità a ogni correzione). response > 1: risposta più pronta (calciatori guidati da un umano).
  steer(desiredX, desiredZ, dt, response) {
    if (this.stunned > 0) { desiredX *= 0.2; desiredZ *= 0.2; }
    const sp = this.speed(), want = len(desiredX, desiredZ);
    const ratio = Math.min(1, sp / this.maxSpeed(true));
    const braking = want < sp - 0.1;
    const k = braking ? 2 : (1 - 0.45 * ratio * ratio) * (this.sprinting ? 0.9 : 1);
    const maxDv = this.accel() * k * (response || 1) * dt;
    let dvx = desiredX - this.vx, dvz = desiredZ - this.vz;
    const dl = len(dvx, dvz);
    if (dl > maxDv) { dvx *= maxDv / dl; dvz *= maxDv / dl; }
    // la parte che aumenta la velocità cala forte verso il massimo: si arriva al 90% in poco più di un secondo,
    // l'ultimo tratto è il più lento (le curve non ne risentono)
    if (sp > 0.3) {
      const ux = this.vx / sp, uz = this.vz / sp, up = dvx * ux + dvz * uz;
      const cap = this.accel() * (response || 1) * (1 - 0.8 * Math.pow(ratio, 1.5)) * dt;
      if (up > cap) { dvx -= ux * (up - cap); dvz -= uz * (up - cap); }
    }
    this.vx += dvx; this.vz += dvz;
  }
  // gira lo sguardo verso un punto
  faceTo(x, z, dt, rate) {
    const target = Math.atan2(z - this.z, x - this.x);
    const d = angleDiff(this.facing, target);
    const maxTurn = (rate || 10) * dt;
    this.facing += clamp(d, -maxTurn, maxTurn);
  }

  update(dt) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const sp = this.speed();
    if (sp > 0.4 && this.anim.dive <= 0) {
      const target = Math.atan2(this.vz, this.vx);
      const d = angleDiff(this.facing, target);
      const turn = 9 * dt;
      this.facing += clamp(d, -turn, turn);
    }
    // energia: lo sprint consuma, la corsa leggera recupera un po'
    // fatica di fondo: abbassa il massimo recuperabile (circa -30 in 90 minuti)
    const staminaAttr = this.data.attr.stamina / 100;
    const tired = this.data.ability === 'Instancabile' ? 0.75 : 1;
    const gsr = this.team.match ? this.team.match.gameSecondsPerReal : 15;
    this.energyCap = (this.energyCap === undefined ? 100 : this.energyCap) - gsr / 60 * 0.4 * (1.3 - staminaAttr) * tired * dt;
    this.energyCap = Math.max(this.energyCap, 35);
    if (this.sprinting && sp > 5) this.energy -= 2.2 * (1.35 - staminaAttr) * tired * dt;
    else this.energy += 1.2 * dt;
    this.energy = clamp(this.energy, 5, this.energyCap);
    if (this.kickCooldown > 0) this.kickCooldown -= dt;
    if (this.tackleCooldown > 0) this.tackleCooldown -= dt;
    if (this.stunned > 0) this.stunned -= dt;
    for (const k of ['kick', 'tackle', 'dive', 'header', 'fall']) if (this.anim[k] > 0) this.anim[k] -= dt;
    this.anim.phase += sp * dt * 1.9;
  }
}
