// ============================================================
// PORTE E RETI 3D DINAMICHE (0.24)
// La rete è fatta di tanti nodi (le maglie, ogni 13-22 cm secondo la qualità) collegati ai vicini come fili tesi.
// I bordi sono fissati al telaio: pali, traversa, tubi dietro e a terra (come le porte vere).
// Ogni fotogramma:
// - il pallone (una sfera) spinge i nodi che tocca: la rete lo avvolge nel punto preciso dove arriva, sul fondo,
//   sui lati o sul tetto, da dentro e anche da fuori;
// - ogni nodo è tirato dai vicini (tensione dei fili): la deformazione si propaga come un'onda;
// - una molla lo riporta alla forma di riposo e uno smorzamento ferma l'oscillazione.
// Velocità, direzione e punto d'impatto vengono dal pallone vero (03_ball.js frena il pallone nella rete con la stessa
// forma: fondo a GOAL_DEPTH, lati a GOAL_HALF_W, tetto goalRoofY), quindi grafica e fisica coincidono.
// Quando nessuno la tocca la rete "dorme": niente calcoli finché il pallone non torna vicino.
// ============================================================
const NET_VIS = {
  TENSION: 60,     // forza dei fili (più alta = onda più veloce e rigonfiamento più largo); si divide per la
                   // distanza tra le maglie al quadrato, così la rete si comporta uguale a ogni qualità grafica
  ANCHOR: 15,      // forza che riporta la rete alla forma di riposo
  DAMP: 3.2,       // smorzamento (quanto in fretta smette di oscillare)
  SUB: 2,          // sotto-passi per fotogramma
  WAKE: 1.2,       // distanza del pallone dalla porta che sveglia la rete (m)
};

// costruisce le due porte: telaio metallico e reti
Renderer.prototype.buildGoals = function () {
  const C = CONFIG, W = C.GOAL_HALF_W, H = C.GOAL_H, D = C.GOAL_DEPTH, HB = goalRoofY(D);
  // pali e traversa: metallo verniciato bianco, lucido; tubi del telaio dietro: metallo grigio più sottile
  const postMat = new THREE.MeshStandardMaterial({ color: '#f7f8fa', roughness: 0.22, metalness: 0.15 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#b9c0c8', roughness: 0.35, metalness: 0.55 });
  const tube = (g, mat, r, a, b, seg) => {
    const ax = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), l = ax.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), mat);
    m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax.normalize());
    m.castShadow = true; m.receiveShadow = true; g.add(m);
  };
  const step = this.Q.detail >= 1.3 ? 0.13 : this.Q.detail >= 1 ? 0.16 : 0.22;
  this.nets = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group(), gx = s * C.HALF_L, bx = gx + s * D;
    // telaio davanti
    for (const pz of [-W, W]) tube(g, postMat, C.POST_R, [gx, 0, pz], [gx, H + C.POST_R, pz], 16);
    tube(g, postMat, C.POST_R, [gx, H, -W - C.POST_R], [gx, H, W + C.POST_R], 16);
    // telaio dietro: pali, tubo in alto, tubi a terra e tubi del tetto (dove si aggancia la rete)
    for (const pz of [-W, W]) {
      tube(g, frameMat, 0.025, [bx, 0, pz], [bx, HB, pz], 8);
      tube(g, frameMat, 0.022, [gx, H, pz], [bx, HB, pz], 8);
      tube(g, frameMat, 0.02, [gx, 0.02, pz], [bx, 0.02, pz], 6);
    }
    tube(g, frameMat, 0.025, [bx, HB, -W], [bx, HB, W], 8);
    tube(g, frameMat, 0.02, [bx, 0.02, -W], [bx, 0.02, W], 6);
    this.scene.add(g);
    this.nets.push(this.buildNet(s, gx, step));
  }
};

// una rete: quattro pannelli (fondo, due lati, tetto) di nodi in griglia, bordi fissati al telaio
Renderer.prototype.buildNet = function (s, gx, step) {
  const C = CONFIG, W = C.GOAL_HALF_W, H = C.GOAL_H, D = C.GOAL_DEPTH;
  const rest = [], normal = [], pinned = [], edges = [], nbr = [];
  // aggiunge un pannello: P(u, v) dà il punto di riposo (u, v da 0 a 1), n la normale verso fuori dalla porta
  const panel = (nu, nv, P, n, sag) => {
    const id0 = rest.length / 3, id = (i, j) => id0 + j * (nu + 1) + i;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, p = P(u, v);
      // la rete a riposo non è tesa come un telo: si incurva un poco verso fuori (o in giù sul tetto)
      const bag = sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      rest.push(p[0] + n[0] * bag, p[1] + n[1] * bag, p[2] + n[2] * bag);
      normal.push(n[0], n[1], n[2]);
      pinned.push(i === 0 || j === 0 || i === nu || j === nv ? 1 : 0);
      nbr.push([]);
    }
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = id(i, j);
      if (i < nu) { edges.push(a, id(i + 1, j)); nbr[a].push(id(i + 1, j)); nbr[id(i + 1, j)].push(a); }
      if (j < nv) { edges.push(a, id(i, j + 1)); nbr[a].push(id(i, j + 1)); nbr[id(i, j + 1)].push(a); }
    }
  };
  const nz = Math.round(2 * W / step), ny = Math.round(H / step), nd = Math.round(D / step);
  const bx = gx + s * D, HB = goalRoofY(D);
  // fondo: x = fondo, z da -W a W, y da 0 al tubo in alto
  panel(nz, ny, (u, v) => [bx, v * HB, -W + 2 * W * u], [s, 0, 0], 0.06);
  // lati: da linea di porta al fondo, da terra al tetto (che scende)
  for (const pz of [-W, W]) panel(nd, ny, (u, v) => { const x = gx + s * D * u; return [x, v * goalRoofY(D * u), pz]; }, [0, 0, Math.sign(pz)], 0.04);
  // tetto: dalla traversa al fondo, da -W a W
  panel(nd, nz, (u, v) => [gx + s * D * u, goalRoofY(D * u), -W + 2 * W * v], [0, 1, 0], -0.07);
  const n = rest.length / 3;
  const pos = new Float32Array(rest);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(edges);
  geo.computeBoundingSphere();
  const mat = new THREE.LineBasicMaterial({ color: '#f2f5f8', transparent: true, opacity: 0.6 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;   // i nodi si muovono: la sfera di contorno calcolata a riposo non basta
  this.scene.add(lines);
  // vicini in un array piatto (più veloce da scorrere)
  const nbStart = new Int32Array(n + 1), nbList = [];
  for (let i = 0; i < n; i++) { nbStart[i] = nbList.length; nbList.push(...nbr[i]); }
  nbStart[n] = nbList.length;
  return {
    side: s, gx: gx, geo: geo, lines: lines, n: n, tension: NET_VIS.TENSION / (step * step),
    rest: Float32Array.from(rest), nrm: Float32Array.from(normal), pin: Uint8Array.from(pinned),
    nbStart: nbStart, nb: Int32Array.from(nbList),
    d: new Float32Array(n * 3), v: new Float32Array(n * 3), acc: new Float32Array(n * 3),
    awake: false, energy: 0, touchT: 9,
  };
};

// impulso extra (evento "gol" arrivato in una partita online quando il pallone disegnato non è vicino alla porta,
// per esempio per un ritardo della connessione): la rete si gonfia lo stesso
Renderer.prototype.netBulge = function (side, y, z, power) {
  const net = this.nets && this.nets.find(n => n.side === side);
  if (!net || net.touchT < 0.4) return;   // il pallone l'ha appena toccata: la reazione c'è già
  const bp = this.ballMesh.position;
  if (Math.abs(bp.x - net.gx) < 4 && Math.abs(bp.z) < CONFIG.GOAL_HALF_W + 2) return;   // il pallone è lì: ci pensa il contatto
  const kick = clamp(power / 22, 0.25, 1.2) * 3;
  for (let i = 0; i < net.n; i++) {
    if (net.nrm[i * 3] === 0) continue;   // solo il fondo
    const dy = net.rest[i * 3 + 1] - y, dz = net.rest[i * 3 + 2] - z;
    net.v[i * 3] += side * kick * Math.exp(-(dy * dy + dz * dz) / 0.5);
  }
  net.awake = true;
};

// un passo di simulazione per le due reti
Renderer.prototype.updateNets = function (dt) {
  if (!this.nets) return;
  dt = Math.min(dt, 1 / 30);
  const bp = this.ballMesh.position, r = CONFIG.BALL_R * 1.6 + 0.01, C = CONFIG;
  for (const net of this.nets) {
    net.touchT += dt;
    // sveglia: pallone vicino alla porta
    const depth = (bp.x - net.gx) * net.side;
    const near = depth > -NET_VIS.WAKE && depth < C.GOAL_DEPTH + NET_VIS.WAKE && Math.abs(bp.z) < C.GOAL_HALF_W + NET_VIS.WAKE && bp.y < C.GOAL_H + NET_VIS.WAKE;
    if (!net.awake && !near) continue;
    net.awake = true;
    // velocità del pallone disegnato (per dare ai nodi la spinta giusta)
    const pb = net.prevBall || { x: bp.x, y: bp.y, z: bp.z };
    const bv = { x: (bp.x - pb.x) / dt, y: (bp.y - pb.y) / dt, z: (bp.z - pb.z) / dt };
    net.prevBall = { x: bp.x, y: bp.y, z: bp.z };
    if (Math.hypot(bv.x, bv.y, bv.z) > 60) bv.x = bv.y = bv.z = 0;   // teletrasporto (calcio d'inizio, replay)
    // il pallone è dentro la porta o fuori? Si decide quando è chiaramente da una parte e si ricorda finché non
    // esce davvero (così anche quando spinge il fondo oltre la sua forma di riposo la rete resta dalla parte giusta)
    const inBox = depth > 0.02 && depth < C.GOAL_DEPTH && Math.abs(bp.z) < C.GOAL_HALF_W && bp.y < goalRoofY(depth);
    if (inBox) net.ballIn = true;
    else if (depth < 0 || depth > C.GOAL_DEPTH + 1 || Math.abs(bp.z) > C.GOAL_HALF_W + 1 || bp.y > C.GOAL_H + 1) net.ballIn = false;
    const h = dt / NET_VIS.SUB;
    let energy = 0;
    for (let k = 0; k < NET_VIS.SUB; k++) energy = this.stepNet(net, h, near ? bp : null, r, bv);
    // la rete torna a dormire quando è ferma e il pallone è lontano
    if (!near && energy < 1e-6) {
      net.awake = false; net.d.fill(0); net.v.fill(0); net.prevBall = null;
    }
    const pos = net.geo.attributes.position.array, R0 = net.rest, d = net.d;
    for (let i = 0; i < pos.length; i++) pos[i] = R0[i] + d[i];
    net.geo.attributes.position.needsUpdate = true;
  }
};

Renderer.prototype.stepNet = function (net, h, ball, r, bv) {
  const n = net.n, d = net.d, v = net.v, a = net.acc, R0 = net.rest, N = net.nrm, pin = net.pin, S = net.nbStart, NB = net.nb;
  const T = net.tension, K = NET_VIS.ANCHOR, damp = Math.exp(-NET_VIS.DAMP * h);
  // forze: tensione verso la media dei vicini + molla verso la forma di riposo
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (pin[i]) { a[o] = a[o + 1] = a[o + 2] = 0; continue; }
    let sx = 0, sy = 0, sz = 0;
    const c = S[i + 1] - S[i];
    for (let q = S[i]; q < S[i + 1]; q++) { const j = NB[q] * 3; sx += d[j]; sy += d[j + 1]; sz += d[j + 2]; }
    a[o] = T * (sx / c - d[o]) - K * d[o];
    a[o + 1] = T * (sy / c - d[o + 1]) - K * d[o + 1];
    a[o + 2] = T * (sz / c - d[o + 2]) - K * d[o + 2];
  }
  let energy = 0;
  for (let i = 0; i < n; i++) {
    if (pin[i]) continue;
    const o = i * 3;
    v[o] = (v[o] + a[o] * h) * damp; v[o + 1] = (v[o + 1] + a[o + 1] * h) * damp; v[o + 2] = (v[o + 2] + a[o + 2] * h) * damp;
    d[o] += v[o] * h; d[o + 1] += v[o + 1] * h; d[o + 2] += v[o + 2] * h;
    energy += v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2] + d[o] * d[o] + d[o + 1] * d[o + 1] + d[o + 2] * d[o + 2];
  }
  // il pallone spinge i nodi: ogni nodo resta fuori dalla sfera, dalla parte opposta a quella da cui arriva il pallone
  if (ball) {
    const bx = ball.x, by = ball.y, bz = ball.z, bvx = bv.x, bvy = bv.y, bvz = bv.z, inside = net.ballIn;
    for (let i = 0; i < n; i++) {
      if (pin[i]) continue;
      const o = i * 3, px = R0[o] + d[o], py = R0[o + 1] + d[o + 1], pz = R0[o + 2] + d[o + 2];
      const ex = px - bx, ey = py - by, ez = pz - bz;
      if (ex * ex + ey * ey + ez * ez > r * r * 4) continue;   // lontano dal pallone
      const nx = N[o], ny = N[o + 1], nzz = N[o + 2];
      // posizione del pallone e del nodo lungo la normale del pannello (rispetto al punto di riposo del nodo)
      const cn = (bx - R0[o]) * nx + (by - R0[o + 1]) * ny + (bz - R0[o + 2]) * nzz;
      const pn = d[o] * nx + d[o + 1] * ny + d[o + 2] * nzz;
      const tx = ex - (ex * nx + ey * ny + ez * nzz) * nx, ty = ey - (ex * nx + ey * ny + ez * nzz) * ny, tz = ez - (ex * nx + ey * ny + ez * nzz) * nzz;
      const t2 = tx * tx + ty * ty + tz * tz;
      // i nodi attorno al pallone non scappano più veloci di lui: è la rete che lo ferma, non lo lancia via
      const bvn0 = bvx * nx + bvy * ny + bvz * nzz, vn0 = v[o] * nx + v[o + 1] * ny + v[o + 2] * nzz;
      const over = inside ? vn0 - Math.max(bvn0, 0) - 0.5 : Math.min(bvn0, 0) - 0.5 - vn0;
      if (over > 0) { const k = inside ? -over : over; v[o] += k * nx; v[o + 1] += k * ny; v[o + 2] += k * nzz; }
      if (t2 >= r * r) continue;
      const reach = Math.sqrt(r * r - t2);
      const want = inside ? cn + reach : cn - reach;
      if ((inside && pn < want) || (!inside && pn > want)) {
        const dn = want - pn;
        d[o] += dn * nx; d[o + 1] += dn * ny; d[o + 2] += dn * nzz;
        // il nodo a contatto si muove insieme al pallone lungo la normale (né più veloce né più lento)
        const bvn = bvx * nx + bvy * ny + bvz * nzz, vn = v[o] * nx + v[o + 1] * ny + v[o + 2] * nzz, dv = bvn - vn;
        v[o] += dv * nx; v[o + 1] += dv * ny; v[o + 2] += dv * nzz;
        net.touchT = 0;
      }
    }
  }
  return energy / n;
};
