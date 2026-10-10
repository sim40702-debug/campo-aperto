// ============================================================
// ARBITRO — contrasti, falli, vantaggio, cartellini
// Il contatto da solo non è mai fallo. La decisione nasce dalla dinamica del contrasto
// (chi tocca prima il pallone, se e dove il difensore colpisce l'avversario, velocità di impatto,
// direzione, tipo di intervento) e dal contesto (possesso, zona, occasione da rete).
// Solo questo modulo decide; in rete lo usa soltanto l'host, i client ricevono le decisioni.
// ============================================================
const REF = {
  STAND_REACH: 1.5,     // portata del contrasto in piedi (gamba tesa compresa)
  SLIDE_REACH: 2.6,     // portata della scivolata
  BODY_R: 0.28,         // ingombro di corpo e gambe dell'avversario visto dall'alto (il pallone al piede sta a 0.55-0.75 m)
  LEG_R: 0.12,          // ingombro della gamba che contrasta
  RECKLESS: 0.55,       // gravità da intervento imprudente (giallo)
  EXCESSIVE: 0.85,      // gravità da forza eccessiva (rosso)
  AFTER_BALL: 0.72,     // dopo aver preso il pallone serve più violenza per essere fallo
  BORDERLINE: 0.08,     // ampiezza della fascia incerta attorno alle soglie
  ADVANTAGE_SECS: 2.5,  // tempo per capire se il vantaggio si concretizza
};

// Infortuni (solo con opts.injuries): dopo un fallo duro chi lo subisce resta a terra qualche secondo e poi zoppica
// (corre un po' meno) per un po'. Con un fallo molto duro arriva la barella (solo grafica) e l'attesa è più lunga.
const INJURY = {
  HURT: 0.55,          // gravità da cui si resta a terra (come un giallo)
  STRETCHER: 0.82,     // gravità da barella
  PAUSE: 2.5,          // secondi in più prima della ripresa
  PAUSE_STRETCHER: 7,
  LIMP: 25,            // secondi in cui zoppica
  LIMP_STRETCHER: 45,
  LIMP_SPEED: 0.86,    // velocità massima mentre zoppica
};
Match.prototype.injure = function (victim, severity) {
  if (!(severity >= INJURY.HURT)) return;
  const big = severity >= INJURY.STRETCHER;
  victim.limp = Math.max(victim.limp || 0, big ? INJURY.LIMP_STRETCHER : INJURY.LIMP);
  this.injuryPause = Math.max(this.injuryPause, big ? INJURY.PAUSE_STRETCHER : INJURY.PAUSE);
};

// Geometria e dinamica di un contrasto (tackler su victim). kind: 'stand' | 'slide' | 'charge'.
// Restituisce i dati fisici che l'arbitro valuta; l'unica parte casuale è se il piede arriva davvero
// sul pallone quando è raggiungibile (abilità contro abilità), mai la decisione sul fallo.
function challengeGeometry(m, tackler, victim, kind) {
  const b = m.ball;
  const reach = kind === 'slide' ? REF.SLIDE_REACH : REF.STAND_REACH;
  // direzione dell'intervento: in piedi verso il pallone, in scivolata lungo la corsa, a spinta verso l'avversario
  let dx, dz;
  if (kind === 'slide') { const s = tackler.speed(); dx = s > 0.5 ? tackler.vx / s : Math.cos(tackler.facing); dz = s > 0.5 ? tackler.vz / s : Math.sin(tackler.facing); }
  else if (kind === 'charge') { const d = dist2(tackler.x, tackler.z, victim.x, victim.z) || 1; dx = (victim.x - tackler.x) / d; dz = (victim.z - tackler.z) / d; }
  else { const d = dist2(tackler.x, tackler.z, b.x, b.z) || 1; dx = (b.x - tackler.x) / d; dz = (b.z - tackler.z) / d; }
  const along = (x, z) => (x - tackler.x) * dx + (z - tackler.z) * dz;
  const side = (x, z) => Math.abs(-(x - tackler.x) * dz + (z - tackler.z) * dx);
  const bAlong = along(b.x, b.z), bSide = side(b.x, b.z);
  const vAlong = along(victim.x, victim.z), vSide = side(victim.x, victim.z);
  const ballReachable = kind !== 'charge' && b.y < 0.9 && bAlong > -0.2 && bAlong <= reach && bSide < (kind === 'slide' ? 0.75 : 0.55);
  // punto della linea dell'intervento in cui la gamba incontra il corpo dell'avversario (Infinity se non lo incontra)
  const hitR = REF.BODY_R + REF.LEG_R;
  const victimFirstHit = vAlong > 0 && vSide < hitR ? vAlong - Math.sqrt(hitR * hitR - vSide * vSide) : Infinity;
  // il pallone viene toccato: dipende da quanto è comodo (distanza laterale, schermato dal corpo) e dalle abilità
  const facingTo = Math.atan2(tackler.z - victim.z, tackler.x - victim.x);
  const approach = Math.abs(angleDiff(victim.facing, facingTo));   // 0 = di fronte, PI = alle spalle
  const fromBehind = approach > Math.PI * 0.68, fromSide = !fromBehind && approach > Math.PI * 0.35;
  const shielded = victimFirstHit < bAlong - 0.05;                   // il corpo dell'avversario sta prima del pallone
  return { kind, reach, dx, dz, bAlong, bSide, vAlong, vSide, ballReachable, victimFirstHit, fromBehind, fromSide, shielded };
}

function analyzeChallenge(m, tackler, victim, kind) {
  const g = challengeGeometry(m, tackler, victim, kind);
  const { reach, dx, dz, bAlong, bSide, ballReachable, victimFirstHit, fromBehind, fromSide, shielded } = g;
  const b = m.ball;
  let ballPlayed = false;
  if (ballReachable && !shielded) {
    let q = 0.66 + (tackler.attr.defense - victim.attr.dribble) / 160 + (kind === 'slide' ? 0.08 : 0) - bSide * 0.35;
    if (tackler.data.ability === 'Muro') q += 0.08;
    if (victim.data.ability === 'Dribblatore') q -= 0.06;
    q -= Math.min(0.15, victim.speed() * 0.015);                     // più è veloce il portatore, più è difficile
    ballPlayed = rand() < clamp(q, 0.12, 0.92);
  }
  // fin dove arriva la gamba: dopo il pallone solo con lo slancio. A vuoto, in piedi il piede si ferma dove era
  // il pallone (l'avversario lo ha spostato e salta il difensore); la scivolata invece non si ferma e va fino in fondo
  const follow = kind === 'slide' ? 0.6 + tackler.speed() * 0.12 : 0.25;
  const sweep = kind === 'charge' ? dist2(tackler.x, tackler.z, victim.x, victim.z)
    : ballPlayed ? bAlong + follow
    : kind === 'slide' ? reach : Math.min(reach, Math.max(0, bAlong) + 0.15);
  const contact = victimFirstHit <= sweep;
  const ballFirst = ballPlayed && bAlong <= victimFirstHit + 0.1;
  // velocità di impatto: avvicinamento lungo la linea dell'intervento, più lo slancio del gesto
  const lunge = kind === 'slide' ? 2.5 : kind === 'stand' ? 1.2 : 0;
  const relSpeed = Math.max(0, (tackler.vx - victim.vx) * dx + (tackler.vz - victim.vz) * dz) + (contact ? lunge : 0);
  const contactPoint = !contact ? 'none' : kind === 'charge' ? 'body' : ballPlayed ? 'feet' : 'legs';
  return Object.assign({
    kind, ballReachable, ballPlayed, ballFirst, contact, contactPoint, fromBehind, fromSide, relSpeed,
    distance: dist2(tackler.x, tackler.z, victim.x, victim.z),
    victimHasBall: b.owner === victim,
    aggression: tackler.data.hidden ? tackler.data.hidden.aggression / 100 : 0.5,
  }, challengeContext(m, tackler, victim));
}

// contesto dell'azione: area di rigore, attacco promettente, chiara occasione da rete
function challengeContext(m, tackler, victim) {
  const atk = victim.team, def = tackler.team;
  const x = clamp(victim.x, -CONFIG.HALF_L + 0.5, CONFIG.HALF_L - 0.5), z = clamp(victim.z, -CONFIG.HALF_W + 0.5, CONFIG.HALF_W - 0.5);
  const hasBall = m.ball.owner === victim || (!m.ball.owner && dist2(victim.x, victim.z, m.ball.x, m.ball.z) < 1.6);
  const gx = atk.oppGoalX(), toGoal = dist2(x, z, gx, 0);
  const u = atk.uOf(x);
  // difensori di movimento (non il portiere, non chi commette il fallo) tra l'attaccante e la porta
  const covering = def.players.filter(p => p !== tackler && !p.isGK && atk.uOf(p.x) > u - 0.5 && Math.abs(p.z - z) < 4 + (atk.uOf(p.x) - u) * 0.6).length;
  const headingGoal = (Math.cos(victim.facing) * (gx - x) - Math.sin(victim.facing) * z) / (toGoal || 1) > 0.2;
  const dogso = hasBall && toGoal < 28 && headingGoal && covering === 0;
  const promising = hasBall && u > CONFIG.HALF_L + 8 && headingGoal && covering <= 1;
  return { inPenaltyArea: inBoxOf(def, x, z), dogso, promising, x, z };
}

// Decisione dell'arbitro su un contrasto analizzato. Funzione pura: con lo stesso input dà lo stesso output,
// tranne la piccola fascia di incertezza attorno alle soglie (r: numero 0..1, predefinito rand()).
function evaluateChallenge(c, r) {
  const out = { legal: true, foul: false, advantage: false, yellow_card: false, red_card: false, severity: 0, reason: '' };
  if (!c.contact) {
    out.reason = c.ballPlayed ? 'Contrasto pulito' : 'Intervento a vuoto, nessun contatto';
    return out;
  }
  // gravità: velocità di impatto, tipo di intervento, direzione, parte colpita
  let sev = clamp(c.relSpeed / 9, 0, 1) * 0.5 + (c.kind === 'slide' ? 0.18 : 0) + (c.fromBehind ? 0.24 : c.fromSide ? 0.06 : 0)
    + (c.contactPoint === 'legs' ? 0.08 : 0) - (c.kind === 'charge' ? 0.12 : 0);
  sev = clamp(sev, 0, 1);
  out.severity = Math.round(sev * 100) / 100;
  // nelle situazioni al limite l'arbitro può vederla in un modo o nell'altro (solo attorno alle soglie)
  const seen = sev + ((r === undefined ? rand() : r) - 0.5) * REF.BORDERLINE;
  const foul = (reason) => { out.legal = false; out.foul = true; out.reason = reason; };
  if (c.kind === 'charge') {
    // spalla a spalla, di fianco o di fronte: gioco regolare; carica da dietro a velocità: fallo
    if (!c.fromBehind || c.relSpeed < 4.5) { out.reason = 'Contatto di gioco regolare'; return out; }
    foul('Carica da dietro');
  } else if (c.ballFirst) {
    // ha preso prima il pallone: il contatto che segue è regolare, a meno che l'intervento sia imprudente
    if (seen < REF.AFTER_BALL) { out.reason = 'Prende il pallone, contatto regolare'; return out; }
    foul(seen >= REF.EXCESSIVE + 0.05 ? 'Intervento con forza eccessiva' : 'Prende il pallone ma travolge l\'avversario');
  } else {
    foul(c.fromBehind ? 'Intervento da dietro' : c.contactPoint === 'legs' ? 'Colpisce le gambe senza prendere il pallone' : 'Contrasto irregolare');
  }
  // provvedimenti disciplinari
  if (seen >= REF.EXCESSIVE + (c.ballFirst ? 0.05 : 0)) { out.red_card = true; out.reason = c.ballFirst ? 'Intervento con forza eccessiva' : 'Grave fallo di gioco'; }
  else if (seen >= REF.RECKLESS) { out.yellow_card = true; if (!c.ballFirst) out.reason = 'Intervento imprudente'; }
  // chiara occasione da rete negata: in area, se si è provato a giocare il pallone, basta il giallo (regola 12)
  if (c.dogso && !out.red_card) {
    if (c.inPenaltyArea && c.kind !== 'charge') { out.yellow_card = true; out.reason = 'Chiara occasione da rete negata'; }
    else { out.red_card = true; out.yellow_card = false; out.reason = 'Chiara occasione da rete negata'; }
  } else if (c.promising && !out.yellow_card && !out.red_card) {
    out.yellow_card = true; out.reason = 'Fallo tattico: interrompe un\'azione promettente';
  }
  if (out.red_card) out.yellow_card = false;
  return out;
}
