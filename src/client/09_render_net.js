// ============================================================
// PORTE E RETI 3D DINAMICHE (0.24)
// La rete è fatta di tanti nodi (le maglie, ogni 13-22 cm secondo la qualità) collegati ai vicini come fili tesi.
// La rete è appesa come nelle porte vere: fissata a pali, traversa e terra, legata ai sostegni dietro (0.24.3).
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
  SUB: 3,          // sotto-passi per fotogramma (il pallone si sposta anche tra un sotto-passo e l'altro)
  WAKE: 1.2,       // distanza del pallone dalla porta che sveglia la rete (m)
};

// costruisce le due porte come quelle vere (0.24.3): pali e traversa davanti; dietro, FUORI dalla rete, due sostegni
// curvi che partono dai pali e scendono a terra dietro la porta, con una corda tesa tra loro e un tubo a terra.
// La rete è appesa: legata ai sostegni e alla corda in pochi punti (i lacci), fissata a terra con i picchetti; il
// resto è libero e un po' molle (gli spigoli dietro non sono tubi: la rete lì pende e si muove).
Renderer.prototype.buildGoals = function () {
  const C = CONFIG, W = C.GOAL_HALF_W, H = C.GOAL_H, D = C.GOAL_DEPTH, HB = goalRoofY(D);
  // pali e traversa: metallo verniciato bianco, lucido; sostegni dietro: metallo grigio più sottile
  const postMat = new THREE.MeshStandardMaterial({ color: '#f7f8fa', roughness: 0.22, metalness: 0.15 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#aeb6bf', roughness: 0.35, metalness: 0.55 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.8 });
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
    const g = new THREE.Group(), gx = s * C.HALF_L;
    // telaio davanti
    for (const pz of [-W, W]) tube(g, postMat, C.POST_R, [gx, 0, pz], [gx, H + C.POST_R, pz], 16);
    tube(g, postMat, C.POST_R, [gx, H, -W - C.POST_R], [gx, H, W + C.POST_R], 16);
    // sostegni curvi: dal retro del palo, vicino alla traversa, all'indietro e giù fino a terra, fuori dalla rete
    const OUT = 0.14, back = D + 0.55;
    const stanchion = sz => new THREE.CatmullRomCurve3([
      new THREE.Vector3(gx + s * 0.05, H - 0.12, sz * W),
      new THREE.Vector3(gx + s * 0.9, H + 0.02, sz * (W + OUT * 0.6)),
      new THREE.Vector3(gx + s * (D + 0.25), HB + 0.08, sz * (W + OUT)),
      new THREE.Vector3(gx + s * (back - 0.05), HB * 0.5, sz * (W + OUT)),
      new THREE.Vector3(gx + s * back, 0.02, sz * (W + OUT)),
    ]);
    const curves = {};
    for (const sz of [-1, 1]) {
      const cv = curves[sz] = stanchion(sz);
      const m = new THREE.Mesh(new THREE.TubeGeometry(cv, 40, 0.032, 10, false), frameMat);
      m.castShadow = true; m.receiveShadow = true; g.add(m);
    }
    // tubo a terra dietro (tiene i sostegni) e corda tesa in alto tra i due sostegni
    tube(g, frameMat, 0.025, [gx + s * back, 0.025, -(W + OUT)], [gx + s * back, 0.025, W + OUT], 8);
    const ropeY = HB + 0.08, ropeX = gx + s * (D + 0.25);
    tube(g, ropeMat, 0.009, [ropeX, ropeY, -(W + OUT)], [ropeX, ropeY, W + OUT], 5);
    this.scene.add(g);
    (this.goalGroups || (this.goalGroups = {}))[s] = g;   // per la vibrazione del legno (09_render_field.js)
    const net = this.buildNet(s, gx, step);
    this.updateThreads(net);
    // lacci: dai punti della rete legati fino al sostegno o alla corda più vicini
    const tiePts = [], R0 = net.rest;
    for (const i of net.ties) {
      const x = R0[i * 3], y = R0[i * 3 + 1], z = R0[i * 3 + 2];
      let to;
      if (Math.abs(Math.abs(z) - W) < 0.01) {
        // lato: il punto del sostegno più vicino
        const cv = curves[Math.sign(z)];
        let best = null, bd = 1e9;
        for (let k = 0; k <= 40; k++) { const q = cv.getPoint(k / 40), dd = (q.x - x) ** 2 + (q.y - y) ** 2; if (dd < bd) { bd = dd; best = q; } }
        to = [best.x, best.y, best.z];
      } else to = [ropeX, ropeY, z];
      tiePts.push(x, y, z, to[0], to[1], to[2]);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tiePts, 3));
    g.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: '#d9dde2' })));
    this.nets.push(net);
  }
};

// una rete: fondo, due lati e tetto fatti di nodi in griglia. I nodi degli spigoli sono in comune tra i pannelli (la
// rete è un pezzo solo). Fissati: i nodi lungo pali e traversa, quelli a terra (picchetti) e uno ogni tre lungo il
// bordo in alto dietro e lungo i bordi del tetto (i lacci verso i sostegni e la corda); tutti gli altri sono liberi.
Renderer.prototype.buildNet = function (s, gx, step) {
  const C = CONFIG, W = C.GOAL_HALF_W, D = C.GOAL_DEPTH;
  const rest = [], normal = [], pinned = [], nbr = [], edgeSet = new Set(), edges = [], ties = [];
  const byKey = new Map();
  const key = p => Math.round(p[0] * 200) + ',' + Math.round(p[1] * 200) + ',' + Math.round(p[2] * 200);
  // nodo nel punto p (con la "pancia" bag lungo n); se c'è già (spigolo in comune) si riusa
  const node = (p, n, bag, pin, tie) => {
    const k = key(p);
    let id = byKey.get(k);
    if (id === undefined) {
      id = rest.length / 3; byKey.set(k, id);
      rest.push(p[0] + n[0] * bag, p[1] + n[1] * bag, p[2] + n[2] * bag);
      normal.push(0, 0, 0); pinned.push(0); nbr.push([]);
    }
    normal[id * 3] += n[0]; normal[id * 3 + 1] += n[1]; normal[id * 3 + 2] += n[2];
    if (pin) pinned[id] = 1;
    if (tie && ties.indexOf(id) < 0) ties.push(id);
    return id;
  };
  const link = (a, b) => {
    const k = a < b ? a + '-' + b : b + '-' + a;
    if (edgeSet.has(k)) return;
    edgeSet.add(k); edges.push(a, b); nbr[a].push(b); nbr[b].push(a);
  };
  // pannello: P(u, v) punto di riposo, n normale verso fuori, sag pancia, pinAt(i, j) => 0 libero, 1 fissato, 2 laccio
  const panel = (nu, nv, P, n, sag, pinAt) => {
    const ids = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, f = pinAt(i, j);
      ids.push(node(P(u, v), n, sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v), f > 0, f === 2));
    }
    const id = (i, j) => ids[j * (nu + 1) + i];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      if (i < nu) link(id(i, j), id(i + 1, j));
      if (j < nv) link(id(i, j), id(i, j + 1));
    }
  };
  const nz = Math.round(2 * W / step), ny = Math.round(CONFIG.GOAL_H / step), nd = Math.round(D / step);
  const bx = gx + s * D, HB = goalRoofY(D);
  const tieEvery = 3;
  // fondo: z da -W a W (i), da terra al bordo in alto (j). Terra fissata; in alto un laccio ogni 3 (e gli angoli)
  panel(nz, ny, (u, v) => [bx, v * HB, -W + 2 * W * u], [s, 0, 0], 0.07,
    (i, j) => j === 0 ? 1 : j === ny && (i % tieEvery === 0 || i === nz) ? 2 : 0);
  // lati: dalla linea di porta (palo, fissato) al fondo (i), da terra al tetto (j)
  // la rete parte dal retro dei pali e della traversa (non dal loro centro): F = spessore del palo
  const F = CONFIG.POST_R, dep = u => F + (D - F) * u;
  for (const pz of [-W, W]) panel(nd, ny, (u, v) => { const x = gx + s * dep(u); return [x, v * goalRoofY(dep(u)), pz]; }, [0, 0, Math.sign(pz)], 0.05,
    (i, j) => i === 0 || j === 0 ? 1 : j === ny && (i % tieEvery === 0 || i === nd) ? 2 : 0);
  // tetto: dalla traversa (fissata) al fondo (i), da -W a W (j); i bordi di lato e dietro sono quelli già legati
  panel(nd, nz, (u, v) => [gx + s * dep(u), goalRoofY(dep(u)), -W + 2 * W * v], [0, 1, 0], -0.1,
    i => i === 0 ? 1 : 0);
  const n = rest.length / 3;
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]) || 1;
    normal[i * 3] /= l; normal[i * 3 + 1] /= l; normal[i * 3 + 2] /= l;
  }
  // forma di riposo naturale (0.24.4): la rete non è un telo tirato su una scatola. Si lascia "pendere": ogni nodo
  // libero va verso la media dei vicini (i fili la tengono) e un poco in giù (il peso), per qualche giro. Così gli
  // spigoli dietro, che non hanno pali, si arrotondano e scendono, il tetto si incurva e il fondo pende tra i lacci.
  // Restano fermi i nodi fissati (pali, traversa, terra, lacci). Nessun nodo va sotto l'erba o dentro la porta oltre
  // 25 cm (la fisica del pallone usa ancora la forma della porta).
  const G = 0.004 * step / 0.16, ITER = 60;
  for (let it = 0; it < ITER; it++) {
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const nb = nbr[i];
      let ax = 0, ay = 0, az = 0;
      for (const j of nb) { ax += rest[j * 3]; ay += rest[j * 3 + 1]; az += rest[j * 3 + 2]; }
      const k = 0.5;   // metà verso la media dei vicini a ogni giro
      let x = rest[i * 3] + (ax / nb.length - rest[i * 3]) * k;
      let y = rest[i * 3 + 1] + (ay / nb.length - rest[i * 3 + 1]) * k - G;
      let z = rest[i * 3 + 2] + (az / nb.length - rest[i * 3 + 2]) * k;
      y = Math.max(0.03, y);
      const depth = (x - gx) * s;
      if (depth < D - 0.25 && Math.abs(z) < W - 0.25 && y < goalRoofY(depth) - 0.25) {
        // troppo dentro la porta: resta al limite
        const c = Math.min(D - 0.25 - depth, W - 0.25 - Math.abs(z), goalRoofY(depth) - 0.25 - y);
        if (c === D - 0.25 - depth) x = gx + s * (D - 0.25);
        else if (c === W - 0.25 - Math.abs(z)) z = Math.sign(z) * (W - 0.25);
        else y = goalRoofY(depth) - 0.25;
      }
      rest[i * 3] = x; rest[i * 3 + 1] = y; rest[i * 3 + 2] = z;
    }
  }
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
  // fili veri (0.25.0, qualità media e alta): ogni filo è un cilindro sottile (9 mm) che riceve la luce e fa ombra
  // sull'erba. Da lontano un filo così è più sottile di un pixel: lì si vedono le linee e i cilindri fanno solo
  // l'ombra; da vicino (replay, punizioni, allenamento) si vedono i cilindri.
  let threads = null;
  if (this.Q.shadows) {
    const tgeo = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 5, 1, true);
    const near = new THREE.MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.85 });
    const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    threads = new THREE.InstancedMesh(tgeo, shadowOnly, edges.length / 2);
    threads.castShadow = true; threads.frustumCulled = false;
    threads.userData = { near: near, far: shadowOnly };
    this.scene.add(threads);
  }
  // vicini in un array piatto (più veloce da scorrere)
  const nbStart = new Int32Array(n + 1), nbList = [];
  for (let i = 0; i < n; i++) { nbStart[i] = nbList.length; nbList.push(...nbr[i]); }
  nbStart[n] = nbList.length;
  return {
    side: s, gx: gx, geo: geo, lines: lines, threads: threads, edges: Int32Array.from(edges), step: step,
    n: n, tension: NET_VIS.TENSION / (step * step), ties: ties,
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
  if (!this.nets || !(dt > 0)) return;   // pausa (dt = 0): la rete resta com'è
  dt = Math.min(dt, 1 / 30);
  const bp = this.ballMesh.position, C = CONFIG;
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
    if (Math.hypot(bv.x, bv.y, bv.z) > 60) { bv.x = bv.y = bv.z = 0; pb.x = bp.x; pb.y = bp.y; pb.z = bp.z; }   // teletrasporto (calcio d'inizio, replay)
    // il pallone è dentro la porta o fuori? Si decide quando è chiaramente da una parte e si ricorda finché non
    // esce davvero (così anche quando spinge il fondo oltre la sua forma di riposo la rete resta dalla parte giusta)
    const inBox = depth > 0.02 && depth < C.GOAL_DEPTH && Math.abs(bp.z) < C.GOAL_HALF_W && bp.y < goalRoofY(depth);
    if (inBox) net.ballIn = true;
    else if (depth < 0 || depth > C.GOAL_DEPTH + 1 || Math.abs(bp.z) > C.GOAL_HALF_W + 1 || bp.y > C.GOAL_H + 1) net.ballIn = false;
    // raggio del contatto: il pallone disegnato più mezza maglia (un filo tra due nodi non deve tagliare il pallone)
    const vr = this.ballVisR || BALL_VIS_R, r = Math.sqrt(vr * vr + net.step * net.step * 0.25) + 0.005;
    const h = dt / NET_VIS.SUB, bi = this._netBall || (this._netBall = { x: 0, y: 0, z: 0 });
    let energy = 0;
    for (let k = 0; k < NET_VIS.SUB; k++) {
      // il pallone si sposta anche tra un sotto-passo e l'altro (a 30 m/s fa mezzo metro per fotogramma): il punto
      // dove tocca la rete è quello vero, non quello di fine fotogramma
      const f = (k + 1) / NET_VIS.SUB;
      bi.x = pb.x + (bp.x - pb.x) * f; bi.y = pb.y + (bp.y - pb.y) * f; bi.z = pb.z + (bp.z - pb.z) * f;
      energy = this.stepNet(net, h, near ? bi : null, r, bv);
    }
    // la rete torna a dormire quando è ferma e il pallone è lontano
    if (!near && energy < 1e-6) {
      net.awake = false; net.d.fill(0); net.v.fill(0); net.prevBall = null;
    }
    const pos = net.geo.attributes.position.array, R0 = net.rest, d = net.d;
    for (let i = 0; i < pos.length; i++) pos[i] = R0[i] + d[i];
    net.geo.attributes.position.needsUpdate = true;
    this.updateThreads(net);
  }
  // fili veri o solo linee secondo la distanza della telecamera (sotto i 30 m si vedono i fili)
  for (const net of this.nets) {
    if (!net.threads) continue;
    const cp = this.camera.position, close = Math.hypot(cp.x - (net.gx + net.side * 1.1), cp.y - 1.2, cp.z) < 30;
    const U = net.threads.userData, want = close ? U.near : U.far;
    if (net.threads.material !== want) net.threads.material = want;
    net.lines.visible = !close;
  }
};

// fili veri: per ogni filo (coppia di nodi) un cilindro dal primo al secondo nodo
Renderer.prototype.updateThreads = function (net) {
  const T = net.threads;
  if (!T) return;
  const P = net.geo.attributes.position.array, E = net.edges, M = T.instanceMatrix.array;
  for (let e = 0, k = 0; e < E.length; e += 2, k += 16) {
    const a = E[e] * 3, b = E[e + 1] * 3;
    const yx = P[b] - P[a], yy = P[b + 1] - P[a + 1], yz = P[b + 2] - P[a + 2];
    const l = Math.hypot(yx, yy, yz) || 1e-4, ux = yx / l, uy = yy / l, uz = yz / l;
    // due direzioni perpendicolari al filo (lo spessore del cilindro)
    let xx = uy, xy = -ux, xz = 0;
    if (Math.abs(uz) > 0.9) { xx = 0; xy = uz; xz = -uy; }
    const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const zx = uy * xz - uz * xy, zy = uz * xx - ux * xz, zz = ux * xy - uy * xx;
    M[k] = xx; M[k + 1] = xy; M[k + 2] = xz; M[k + 3] = 0;
    M[k + 4] = yx; M[k + 5] = yy; M[k + 6] = yz; M[k + 7] = 0;
    M[k + 8] = zx; M[k + 9] = zy; M[k + 10] = zz; M[k + 11] = 0;
    M[k + 12] = (P[a] + P[b]) / 2; M[k + 13] = (P[a + 1] + P[b + 1]) / 2; M[k + 14] = (P[a + 2] + P[b + 2]) / 2; M[k + 15] = 1;
  }
  T.instanceMatrix.needsUpdate = true;
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
