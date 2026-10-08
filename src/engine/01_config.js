// ============================================================
// CONFIGURAZIONE — tutte le misure sono in metri e secondi
// Coordinate: x = lunghezza del campo, z = larghezza, y = altezza
// ============================================================
// versione del gioco: il valore vero lo inserisce build.js leggendo package.json
if (typeof GAME_VERSION === 'undefined') var GAME_VERSION = 'sviluppo';
// destinazione della build: 'web' (pagina pubblicata), 'desktop' (Electron) o 'test'
if (typeof BUILD_TARGET === 'undefined') var BUILD_TARGET = 'test';
// true quando il gioco gira dentro l'app desktop (Electron)
var IS_DESKTOP = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

const CONFIG = {
  HALF_L: 52.5,          // metà lunghezza campo (105 m)
  HALF_W: 34,            // metà larghezza campo (68 m)
  GOAL_HALF_W: 3.66,     // metà larghezza porta
  GOAL_H: 2.44,
  GOAL_DEPTH: 2.2,
  BOX_DEPTH: 16.5,
  BOX_HALF_W: 20.16,
  SMALL_BOX_DEPTH: 5.5,
  SMALL_BOX_HALF_W: 9.16,
  PENALTY_SPOT: 11,
  CENTER_R: 9.15,
  POST_R: 0.06,

  GRAVITY: 9.81,
  BALL_R: 0.11,
  ROLL_DECEL: 2.6,       // attrito di rotolamento (m/s²)
  ROLL_DRAG: 0.12,       // attrito proporzionale alla velocità
  AIR_DRAG: 0.0125,      // resistenza dell'aria: decelerazione = AIR_DRAG·v² (pallone da 0.43 kg, raggio 0.11 m)
  MAGNUS: 0.004,         // effetto: accelerazione = MAGNUS·ω·v (ω in rad/s, 50 rad/s a 25 m/s ≈ 5 m/s²)
  BOUNCE: 0.62,          // restituzione massima del rimbalzo (cala con la forza dell'impatto)

  PLAYER_RADIUS: 0.42,
  CONTROL_DIST: 0.85,
  GK_CONTROL_DIST: 1.35,
  KICK_COOLDOWN: 0.35,

  HALF_REAL_SECONDS: 180, // durata reale di un tempo (modificabile dal menu)
  DT: 1 / 60,
  REPLAY_SECONDS: 6,
};

// ---------- Numeri casuali con seme (utile per i test ripetibili) ----------
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = makeRng(Date.now() % 100000);
function setSeed(s) { rand = makeRng(s); }
function randRange(a, b) { return a + (b - a) * rand(); }
function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

// ---------- Matematica ----------
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function len(x, z) { return Math.sqrt(x * x + z * z); }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
// distanza di un punto da un segmento, con la posizione t (0..1) lungo il segmento
function distPointSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0;
  t = clamp(t, 0, 1);
  return { d: dist2(px, pz, ax + vx * t, az + vz * t), t: t };
}
