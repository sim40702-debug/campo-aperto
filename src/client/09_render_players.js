// ============================================================
// CALCIATORI: MATERIALI E DETTAGLI DELLA DIVISA (0.24)
// Tutti i calciatori usano un solo materiale (un solo programma per la scheda grafica), ma ogni pezzo porta due
// valori nei vertici (mergeColored in 09_render.js):
// - aRough: quanto è opaco (pelle 0,5, tessuto 0,62, capelli 0,85, scarpe lucide 0,28, suola 0,7, occhi 0,2);
// - aFabric: 1 sui pezzi di stoffa (maglia e pantaloncini). Lì il programma aggiunge pieghe morbide nella stoffa
//   (sui fianchi, in vita e sotto le braccia) piegando la luce sulla superficie (come una bumpMap calcolata), senza
//   aggiungere triangoli.
// Cuciture: strisce sottili lungo i fianchi della maglia e dei pantaloncini (profileSeams).
// ============================================================
const PART_ROUGH = { kit: 0.62, skin: 0.5, hair: 0.85, boot: 0.28, sole: 0.7, eye: 0.2, glove: 0.55 };

Renderer.prototype.playerMaterial = function () {
  if (this.playerMat) return this.playerMat;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 });
  mat.extensions = { derivatives: true };
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRough;\nattribute float aFabric;\nvarying float vRough;\nvarying float vFabric;\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = aRough; vFabric = aFabric; vObjPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vRough;
varying float vFabric;
varying vec3 vObjPos;
// altezza delle pieghe della stoffa in un punto del pezzo (metri): onde morbide e storte, più forti in vita,
// sotto le braccia e in fondo ai pantaloncini
float fabricH(vec3 p) {
  float w = sin(p.y * 38.0 + p.z * 14.0 + sin(p.z * 9.0 + p.x * 6.0) * 1.6) * 0.5 + sin(p.y * 23.0 - p.z * 11.0) * 0.5;
  float zone = 0.35 + 0.65 * max(smoothstep(0.12, 0.0, abs(p.y - 0.06)), smoothstep(0.1, 0.0, abs(p.y - 0.38)) * smoothstep(0.1, 0.2, abs(p.z)));
  return w * zone * 0.006;
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;')
      // luce di taglio (0.25.4): i bordi del calciatore si illuminano un poco contro lo sfondo, come con i fari dello
      // stadio alle spalle in TV: le sagome si staccano dall'erba
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ vec3 vd = normalize(vViewPosition); float rim = pow(1.0 - clamp(dot(normalize(vNormal), vd), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * rim * 0.35 + vec3(0.06, 0.07, 0.09) * rim; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (vFabric > 0.5) {
  // la superficie si piega come se avesse le pieghe (stesso calcolo della bumpMap di three.js)
  float h = fabricH(vObjPos);
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float hx = dFdx(h), hy = dFdy(h);
  // (nomi lunghi: con i riflessi three.js definisce delle costanti r1, r2... e i nomi corti si scontrerebbero)
  vec3 fabR1 = cross(dpy, normal), fabR2 = cross(normal, dpx);
  float det = dot(dpx, fabR1);
  vec3 grad = sign(det) * (hx * fabR1 + hy * fabR2);
  normal = normalize(abs(det) * normal - grad);
}`);
  };
  return this.playerMat = mat;
};

// cuciture lungo i fianchi di un pezzo fatto con lathe (profilo [raggio, altezza]): una striscia sottile per ogni
// tratto del profilo, appoggiata alla superficie. sz = schiacciamento in profondità, y0 = spostamento in altezza.
Renderer.prototype.profileSeams = function (profile, w, sz, y0, color, minR) {
  const parts = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < profile.length - 1; i++) {
      const [r1, y1] = profile[i], [r2, y2] = profile[i + 1];
      if (r1 < minR || r2 < minR || y2 <= y1) continue;
      const z1 = r1 * w * sz + 0.003, z2 = r2 * w * sz + 0.003, dy = y2 - y1, dz = z2 - z1, l = Math.hypot(dy, dz);
      parts.push({ geo: new THREE.BoxGeometry(0.011, l, 0.004), color: color, rough: PART_ROUGH.kit,
        pos: [0, (y1 + y2) / 2 + y0, side * (z1 + z2) / 2], rot: [Math.atan2(side * dz, dy), 0, 0] });
    }
  }
  return parts;
};

// colore un po' più scuro (cuciture, ombra delle pieghe, bordo)
function shadeColor(hex, k) { return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString(); }

// i piedi non attraversano il pallone: dopo le pose, se la punta o il collo di una scarpa entra nel pallone
// disegnato, il pallone disegnato si sposta appena fuori dalla scarpa (al massimo 12 cm, solo il disegno: il
// pallone del motore resta dov'è). Si controllano solo i calciatori vicini al pallone.
const _toe = new THREE.Vector3(), _heel = new THREE.Vector3();
Renderer.prototype.keepBallOffFeet = function () {
  const B = this.ballMesh.position, r = (this.ballVisR || BALL_VIS_R) + 0.035;
  if (B.y > 0.6) return;   // pallone in aria o in mano al portiere
  for (const pm of this.playerMeshes) {
    if (!pm.root.visible || Math.hypot(pm.root.position.x - B.x, pm.root.position.z - B.z) > 1.3) continue;
    pm.root.updateMatrixWorld(true);
    for (const L of pm.legs) {
      // la scarpa come un segmento dal tallone alla punta
      L.ankle.localToWorld(_heel.set(-0.05, -0.02, 0));
      L.ankle.localToWorld(_toe.set(0.17, -0.025, 0));
      const sx = _toe.x - _heel.x, sy = _toe.y - _heel.y, sz = _toe.z - _heel.z, l2 = sx * sx + sy * sy + sz * sz || 1;
      const t = clamp(((B.x - _heel.x) * sx + (B.y - _heel.y) * sy + (B.z - _heel.z) * sz) / l2, 0, 1);
      const cx = _heel.x + sx * t, cy = _heel.y + sy * t, cz = _heel.z + sz * t;
      const dx = B.x - cx, dz = B.z - cz, dy = B.y - cy, d = Math.hypot(dx, dy, dz);
      if (d >= r) continue;
      // spinge in orizzontale (il pallone resta sull'erba)
      const hd = Math.hypot(dx, dz) || 1e-3, push = Math.min(0.12, r - d);
      B.x += dx / hd * push; B.z += dz / hd * push;
    }
  }
};
