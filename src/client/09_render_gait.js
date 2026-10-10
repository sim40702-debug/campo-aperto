// ============================================================
// CORSA DEI CALCIATORI — passo vero invece di gambe a compasso
// Per ogni gamba c'è un ciclo (0 = il piede tocca terra, poi appoggio, spinta, volo, gamba che torna avanti).
// Gli angoli di anca, ginocchio e caviglia vengono da tre andature misurate a occhio su corridori veri:
// camminata, corsetta e scatto. Il gioco le mescola in base alla velocità. Poi il corpo si abbassa o si alza
// finché il piede più basso tocca l'erba: così i piedi non affondano e non galleggiano.
// Angoli in radianti: anca positiva = coscia in avanti; ginocchio positivo = piegato; caviglia positiva = punta su.
// ============================================================
const GAIT = {
  // [momento del ciclo (0..1), angolo]
  walk: {
    hip: [[0, 0.32], [0.3, 0.0], [0.6, -0.3], [0.8, 0.12], [0.95, 0.34]],
    knee: [[0, 0.05], [0.15, 0.22], [0.4, 0.08], [0.62, 0.55], [0.75, 0.9], [0.9, 0.3]],
    ankle: [[0, 0.12], [0.1, 0.0], [0.45, 0.1], [0.62, -0.35], [0.8, 0.1]],
    bob: 0.018, lean: 0.03, arm: 0.55, elbow: 0.3, twist: 0.1,
  },
  jog: {
    hip: [[0, 0.42], [0.15, 0.15], [0.38, -0.32], [0.55, 0.05], [0.78, 0.7], [0.92, 0.55]],
    knee: [[0, 0.3], [0.12, 0.55], [0.36, 0.22], [0.6, 1.55], [0.78, 1.15], [0.94, 0.4]],
    ankle: [[0, 0.05], [0.12, 0.25], [0.36, -0.45], [0.55, 0.1], [0.85, 0.15]],
    bob: 0.032, lean: 0.12, arm: 0.65, elbow: 1.25, twist: 0.16,
  },
  sprint: {
    hip: [[0, 0.5], [0.12, 0.2], [0.32, -0.42], [0.5, 0.15], [0.72, 1.05], [0.9, 0.75]],
    knee: [[0, 0.35], [0.1, 0.6], [0.3, 0.25], [0.52, 2.1], [0.7, 1.6], [0.9, 0.45]],
    ankle: [[0, 0.0], [0.1, 0.25], [0.3, -0.6], [0.5, 0.2], [0.85, 0.2]],
    bob: 0.04, lean: 0.26, arm: 0.95, elbow: 1.55, twist: 0.22,
  },
};
const THIGH_LEN = 0.45, SHIN_LEN = 0.46;   // dall'anca al ginocchio, dal ginocchio alla suola (misure del modello)

// valore della curva al momento u, con una curva morbida che si ripete (Catmull-Rom chiusa)
function gaitCurve(keys, u) {
  u = ((u % 1) + 1) % 1;
  const n = keys.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] > u) { i = k - 1; break; }
  if (i < 0) i = n - 1;
  const at = j => keys[(j + n) % n];
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  let t0 = p1[0], t1 = p2[0];
  if (t1 <= t0) t1 += 1;
  let uu = u; if (uu < t0) uu += 1;
  const t = (uu - t0) / (t1 - t0);
  const a = p0[1], b = p1[1], c = p2[1], d = p3[1];
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

const smooth01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// angoli di una gamba al momento u per la velocità data (miscela delle tre andature)
function gaitLeg(u, wJog, wSprint) {
  const W = GAIT.walk, J = GAIT.jog, S = GAIT.sprint;
  const mix = key => {
    const walk = gaitCurve(W[key], u), jog = gaitCurve(J[key], u), sprint = gaitCurve(S[key], u);
    const run = jog + (sprint - jog) * wSprint;
    return walk + (run - walk) * wJog;
  };
  return { hip: mix('hip'), knee: mix('knee'), ankle: mix('ankle') };
}
function gaitParam(key, wJog, wSprint) {
  const run = GAIT.jog[key] + (GAIT.sprint[key] - GAIT.jog[key]) * wSprint;
  return GAIT.walk[key] + (run - GAIT.walk[key]) * wJog;
}
// altezza della suola sotto l'anca (per tenere il piede sull'erba)
function footDrop(hip, knee) { return THIGH_LEN * Math.cos(hip) + SHIN_LEN * Math.cos(hip - knee); }

// posa di corsa: gambe, caviglie, braccia, busto, molleggio. amt = quanto si muove (0 fermo, 1 corre)
Renderer.prototype.poseGait = function (pm, phase, speed, amt) {
  const L0 = pm.legs[0], L1 = pm.legs[1], A0 = pm.arms[0], A1 = pm.arms[1];
  const wJog = smooth01(2.0, 3.6, speed), wSprint = smooth01(5.4, 8.0, speed);
  const u0 = phase / (Math.PI * 2), u1 = u0 + 0.5;
  const g0 = gaitLeg(u0, wJog, wSprint), g1 = gaitLeg(u1, wJog, wSprint);
  // da fermo verso il passo: gli angoli crescono con la velocità
  const k = amt;
  L0.hip.rotation.z = g0.hip * k; L0.knee.rotation.z = -g0.knee * k; L0.ankle.rotation.z = g0.ankle * k;
  L1.hip.rotation.z = g1.hip * k; L1.knee.rotation.z = -g1.knee * k; L1.ankle.rotation.z = g1.ankle * k;
  // braccia opposte alle gambe, gomiti più piegati quando si corre forte
  const arm = gaitParam('arm', wJog, wSprint), elbow = gaitParam('elbow', wJog, wSprint);
  A0.sh.rotation.z = -g0.hip * arm * k; A1.sh.rotation.z = -g1.hip * arm * k;
  A0.elbow.rotation.z = 0.2 + (elbow + Math.max(0, g1.hip) * 0.35) * k;
  A1.elbow.rotation.z = 0.2 + (elbow + Math.max(0, g0.hip) * 0.35) * k;
  // bacino e spalle girano al contrario, il busto si piega in avanti con la velocità
  const twist = gaitParam('twist', wJog, wSprint) * k * (g0.hip - g1.hip) * 0.6;
  pm.pelvis.rotation.y = twist * 0.6;
  pm.chest.rotation.y = -twist;
  const lean = gaitParam('lean', wJog, wSprint) * k;
  // il bacino si inclina in avanti con il busto: le gambe (attaccate al bacino) finiscono più indietro, come nei corridori
  const tilt = lean * 0.7;
  // molleggio: due volte per ciclo, in basso a metà appoggio
  const bob = gaitParam('bob', wJog, wSprint) * k * Math.cos((u0 * 2 - 0.3) * Math.PI * 2);
  // piede più basso sull'erba (la suola sta 0,91 m sotto l'anca a gamba dritta)
  const rest = THIGH_LEN + SHIN_LEN;
  const low = Math.max(footDrop(g0.hip * k - tilt, g0.knee * k), footDrop(g1.hip * k - tilt, g1.knee * k));
  return { lean: lean, tilt: tilt, bodyY: (low - rest) + bob * 0.5 };
};
