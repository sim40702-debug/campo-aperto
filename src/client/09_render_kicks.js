// ============================================================
// TIRI E PASSAGGI — un gesto diverso per ogni calcio (solo grafica)
// Il motore dice solo "calcia" (anim.kick per 0,3 s). L'evento 'kick' dice anche che tipo di calcio è (kind) e a
// che altezza era il pallone (y): qui si sceglie il gesto.
// - passaggio rasoterra: di piatto, la gamba ruota in fuori e il movimento è corto;
// - tiro: di collo pieno, caricamento lungo, punta in giù, braccia larghe e accompagnamento alto;
// - lancio e cross: il busto va indietro e la gamba accompagna in alto;
// - al volo (pallone tra 0,7 e 1,5 m): la gamba sale e il corpo si inclina di lato;
// - rovesciata (pallone sopra 1,5 m): ci si butta all'indietro con la gamba sopra la testa e si atterra sulla schiena;
// - tuffo di testa (colpo di testa con il pallone basso): ci si butta in avanti a corpo steso.
// ============================================================
const KICK_SECS = 0.3;

// evento 'kick': chi ha calciato (quello che sta calciando più vicino al pallone) e con che gesto
Renderer.prototype.onKick = function (e) {
  let best = null, bd = 2.2;
  for (const pm of this.playerMeshes) {
    const p = pm.player;
    if (p.gone) continue;
    const d = Math.hypot((p.rx !== undefined ? p.rx : p.x) - e.x, (p.rz !== undefined ? p.rz : p.z) - e.z);
    const kicking = p.anim.kick > 0.15 || (e.kind === 'header' && p.anim.header > 0.1);
    if (d < bd && (kicking || d < 1.2)) { bd = d; best = pm; }
  }
  if (!best) return;
  const y = Number(e.y) || 0, kind = e.kind || '';
  best.kk = { kind: kind, y: y, power: e.power || 0, t: performance.now() };
  if (kind === 'header' && y < 1.0) best.dh = 0.9;                                   // tuffo di testa
  else if (kind !== 'header' && kind !== 'throw' && y >= 1.5) best.bike = 0.85;     // rovesciata
};

// dopo poseMesh: il gesto del calcio (se si sa che calcio è) e le acrobazie che durano più del calcio
Renderer.prototype.poseKick = function (pm, p, dt) {
  const body = pm.body, chest = pm.chest, neck = pm.neck;
  const L0 = pm.legs[0], L1 = pm.legs[1], A0 = pm.arms[0], A1 = pm.arms[1];
  const ss = x => x * x * (3 - 2 * x);
  // ---- rovesciata: all'indietro in aria, gamba sopra la testa, atterraggio sulla schiena
  if (pm.bike > 0) {
    pm.bike -= dt;
    const u = clamp(1 - pm.bike / 0.85, 0, 1);
    const up = u < 0.6 ? ss(u / 0.6) : 1 - ss((u - 0.6) / 0.4) * 0.15;
    body.rotation.z = 1.55 * Math.min(1, u / 0.35) * (u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15 * 0.3);
    body.position.y = 0.95 * Math.sin(Math.min(1, u / 0.6) * Math.PI) + 0.15 * (u > 0.6 ? 1 : 0);
    const sw = u < 0.3 ? -0.3 : u < 0.5 ? 2.9 * ss((u - 0.3) / 0.2) : 2.9 - 1.6 * ss((u - 0.5) / 0.5);
    L1.hip.rotation.z = sw; L1.knee.rotation.z = -0.1;
    L0.hip.rotation.z = 1.1 * up; L0.knee.rotation.z = -1.0 * up;
    A0.sh.rotation.x = -1.6 * up; A1.sh.rotation.x = 1.6 * up; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.3;
    chest.rotation.z = 0.1; neck.rotation.z = -0.4 * up;
    return;
  }
  // ---- tuffo di testa: in avanti a corpo steso, poi giù sulla pancia
  if (pm.dh > 0) {
    pm.dh -= dt;
    const u = clamp(1 - pm.dh / 0.9, 0, 1);
    const fly = Math.min(1, u / 0.25);
    body.rotation.z = -1.4 * ss(fly);
    body.position.y = 0.55 * Math.sin(Math.min(1, u / 0.55) * Math.PI) + 0.12 * Math.min(1, u / 0.3);
    L0.hip.rotation.z = L1.hip.rotation.z = -0.15; L0.knee.rotation.z = L1.knee.rotation.z = -0.25;
    A0.sh.rotation.x = -0.35; A1.sh.rotation.x = 0.35; A0.sh.rotation.z = A1.sh.rotation.z = u < 0.5 ? 0.6 : 2.0;
    neck.rotation.z = 0.7; chest.rotation.z = 0;
    return;
  }
  const kick = p.anim.kick;
  const kk = pm.kk && performance.now() - pm.kk.t < 700 ? pm.kk : null;
  if (!(kick > 0) || !kk) return;
  const u = clamp(1 - kick / KICK_SECS, 0, 1);
  // tre tempi: caricamento (fino a a), impatto (fino a b), accompagnamento
  const phase = (back, hit, follow, a, b) => {
    if (u < a) { const v = ss(u / a); return { hp: back * v, v: v, part: 0 }; }
    if (u < b) { const v = (u - a) / (b - a); return { hp: back + (hit - back) * v, v: v, part: 1 }; }
    const v = ss((u - b) / (1 - b)); return { hp: hit + (follow - hit) * v, v: v, part: 2 };
  };
  const volley = kk.y >= 0.7 && kk.kind !== 'header' && kk.kind !== 'throw';
  if (kk.kind === 'pass' && !volley) {
    // di piatto: movimento corto, gamba ruotata in fuori
    const ph = phase(-0.45, 0.75, 0.45, 0.4, 0.62);
    L1.hip.rotation.z = ph.hp; L1.knee.rotation.z = ph.part === 0 ? -0.9 * ph.v : -0.9 + 0.8 * Math.min(1, ph.part === 1 ? ph.v : 1);
    L1.hip.rotation.y = -0.85 * (ph.part === 0 ? ph.v : 1); L1.ankle.rotation.z = 0.15;
    L0.hip.rotation.z = -0.08; L0.knee.rotation.z = -0.35;
    chest.rotation.y = 0.15 * (ph.part === 0 ? ph.v : 1 - ph.v * 0.5);
    A0.sh.rotation.x = -0.5; A1.sh.rotation.x = 0.35;
  } else if (kk.kind === 'shot' && !volley) {
    // di collo pieno: caricamento lungo, punta in giù, braccia larghe, accompagnamento alto
    const pw = clamp(kk.power / 30, 0.5, 1);
    const ph = phase(-0.95 * pw, 1.45, 1.6 * pw, 0.38, 0.58);
    L1.hip.rotation.z = ph.hp; L1.knee.rotation.z = ph.part === 0 ? -1.7 * ph.v : ph.part === 1 ? -1.7 + 1.6 * ph.v : -0.1 - 0.3 * ph.v;
    L1.ankle.rotation.z = -0.65;
    L0.hip.rotation.z = -0.15; L0.knee.rotation.z = -0.45;
    chest.rotation.y = ph.part === 0 ? 0.45 * ph.v : 0.45 - 0.75 * Math.min(1, ph.part === 1 ? ph.v : 1);
    chest.rotation.z = ph.part === 2 ? 0.15 * Math.sin(ph.v * Math.PI) : -0.12;
    A0.sh.rotation.x = -1.25; A1.sh.rotation.x = 0.95; A0.elbow.rotation.z = A1.elbow.rotation.z = 0.3;
    if (ph.part === 2) body.position.y += 0.07 * Math.sin(ph.v * Math.PI);
  } else if (volley) {
    // al volo: la gamba sale all'altezza del pallone, il corpo si inclina di lato
    const ph = phase(-0.5, 1.9, 1.7, 0.35, 0.55);
    L1.hip.rotation.z = ph.hp; L1.knee.rotation.z = ph.part === 0 ? -1.2 * ph.v : -0.15;
    L1.ankle.rotation.z = -0.4;
    body.rotation.x = 0.38 * (ph.part === 0 ? ph.v : 1);
    L0.knee.rotation.z = -0.3;
    A0.sh.rotation.x = -1.4; A1.sh.rotation.x = 0.8;
  } else if (kk.kind === 'lob' || kk.kind === 'cross' || kk.kind === 'lofted') {
    // lancio: busto indietro, la gamba accompagna in alto
    const ph = phase(-0.75, 1.35, 1.75, 0.4, 0.6);
    L1.hip.rotation.z = ph.hp; L1.knee.rotation.z = ph.part === 0 ? -1.4 * ph.v : -0.2;
    L1.ankle.rotation.z = -0.35;
    chest.rotation.z = 0.22 * (ph.part === 0 ? ph.v : 1);
    L0.knee.rotation.z = -0.4;
    A0.sh.rotation.x = -1.0; A1.sh.rotation.x = 0.7;
  }
};
