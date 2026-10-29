// ============================================================
// INTELLIGENZA ARTIFICIALE
// Livelli: 1) percezione (intercetti)  2) ruoli di squadra
//          3) comportamento individuale  4) decisioni con la palla
// ============================================================

function inBoxOf(team, x, z) {
  // area di rigore della porta difesa da "team"
  const gx = team.ownGoalX();
  return Math.abs(x - gx) < CONFIG.BOX_DEPTH && Math.abs(z) < CONFIG.BOX_HALF_W && Math.sign(x) === Math.sign(gx);
}

// un difensore entra solo se può arrivare al pallone senza passare dal corpo dell'avversario;
// da dietro rinuncia, salvo i più aggressivi quando l'azione è pericolosa (fallo tattico consapevole)
function aiWantsTackle(p, carrier) {
  const m = p.team.match;
  const g = challengeGeometry(m, p, carrier, 'stand');
  if (g.ballReachable && !g.shielded && !g.fromBehind) return true;
  // errore di valutazione: chi difende peggio ed è più irruento a volte entra lo stesso da posizione sbagliata
  // (spesso è fallo: lo decide poi la dinamica del contrasto, non questo numero)
  const misjudge = 0.04 + p.data.hidden.aggression / 100 * 0.12 + (1 - p.attr.defense / 100) * 0.08;
  if ((g.bAlong < g.reach + 0.5 || dist2(p.x, p.z, carrier.x, carrier.z) < 1.6) && rand() < misjudge) return true;
  const ctx = challengeContext(m, p, carrier);
  return (ctx.promising || ctx.dogso) && !ctx.inPenaltyArea && rand() < p.data.hidden.aggression / 100 * 0.25;
}

// scivolata di recupero: solo per fermare un'azione pericolosa, più spesso per i difensori aggressivi.
// Se manca il pallone travolge l'avversario: da qui nascono gran parte dei falli (e dei cartellini) dell'IA
function aiWantsSlide(p, carrier) {
  const m = p.team.match;
  const ctx = challengeContext(m, p, carrier);
  if (!ctx.promising && !ctx.dogso) return false;
  if (p.speed() < 3) return false;
  const g = challengeGeometry(m, p, carrier, 'slide');
  if (!g.ballReachable && g.victimFirstHit > g.reach) return false;
  return rand() < 0.12 + p.data.hidden.aggression / 100 * 0.3;
}

// ---------- 1) PERCEZIONE: chi arriva prima sulla palla ----------
function computeIntercepts(match) {
  const pred = match.pred;
  for (const p of match.allPlayers()) {
    p.icTime = Infinity;
    const sp = p.maxSpeed(true) * 0.92;
    const reach = p.isGK ? 1.1 : 0.6;
    for (let i = 0; i < pred.length; i++) {
      const s = pred[i];
      if (Math.abs(s.x) > CONFIG.HALF_L + 1 || Math.abs(s.z) > CONFIG.HALF_W + 1) break;
      if (s.y > (p.isGK ? 2.5 : 2.3)) continue;
      const d = Math.max(0, dist2(p.x, p.z, s.x, s.z) - reach);
      const need = d / sp + 0.15 + (p.stunned > 0 ? p.stunned : 0);
      if (need <= s.t) { p.icTime = s.t; p.icX = s.x; p.icZ = s.z; break; }
    }
    if (p.icTime === Infinity) {
      const last = pred[pred.length - 1];
      p.icX = clamp(last.x, -CONFIG.HALF_L, CONFIG.HALF_L);
      p.icZ = clamp(last.z, -CONFIG.HALF_W, CONFIG.HALF_W);
      p.icTime = last.t + dist2(p.x, p.z, p.icX, p.icZ) / sp;
    }
  }
}

// ---------- 2) RUOLI DI SQUADRA ----------
function aiAssignRoles(team) {
  const m = team.match, ball = m.ball;
  team.chaser = null; team.presser = null; team.cover = null; team.chaser2 = null;
  if (!ball.owner) {
    let best = null, second = null;
    for (const p of team.players) {
      if (p.isGK && !inBoxOf(team, p.icX, p.icZ)) continue;
      if (!best || p.icTime < best.icTime) { second = best; best = p; }
      else if (!second || p.icTime < second.icTime) second = p;
    }
    team.chaser = best;
    // secondo uomo sulla palla solo se è una palla contesa vicina
    if (second && second.icTime < 1.2 && !second.isGK) team.chaser2 = second;
  } else if (ball.owner.team !== team) {
    const c = ball.owner;
    const field = team.players.filter(p => !p.isGK).sort((a, b) =>
      dist2(a.x, a.z, c.x, c.z) - dist2(b.x, b.z, c.x, c.z));
    // in pressione va chi sta tra il portatore e la porta (può contrastare di fronte); chi insegue da dietro copre
    const goalSide = p => team.uOf(p.x) < team.uOf(c.x) - 0.5;
    const score = p => dist2(p.x, p.z, c.x, c.z) + (goalSide(p) ? 0 : 6);
    team.presser = field.slice().sort((a, b) => score(a) - score(b))[0];
    team.cover = field.find(p => p !== team.presser);
  }
  // marcature: ogni difensore/centrocampista prende l'avversario più vicino alla sua zona
  team.marks = new Map();
  if (ball.owner && ball.owner.team !== team) {
    const taken = new Set([ball.owner]);
    const markers = team.players.filter(p => !p.isGK && p !== team.presser && p !== team.cover && p.slot.role !== 'FW');
    for (const p of markers) {
      const st = slotTarget(p);
      let best = null, bd = 11;
      for (const o of team.opponent().players) {
        if (o.isGK || taken.has(o)) continue;
        const d = dist2(st.x, st.z, o.x, o.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) { taken.add(best); team.marks.set(p, best); }
    }
  }
}

// ---------- 3) COMPORTAMENTO INDIVIDUALE ----------
function aiUpdatePlayer(p, dt) {
  const team = p.team, m = team.match, ball = m.ball;
  if (p.isGK) { aiGoalkeeper(p, dt); return; }
  if (ball.owner === p) { aiCarrier(p, dt); return; }

  // palla libera: il più vicino (in tempo) va a prenderla
  if (!ball.owner && (team.chaser === p || team.chaser2 === p)) {
    const tx = clamp(p.icX, -CONFIG.HALF_L - 0.5, CONFIG.HALF_L + 0.5);
    const tz = clamp(p.icZ, -CONFIG.HALF_W - 0.5, CONFIG.HALF_W + 0.5);
    p.moveToward(tx, tz, true, dt, true);
    return;
  }
  // difesa sul portatore
  if (ball.owner && ball.owner.team !== team) {
    const c = ball.owner;
    const gx = team.ownGoalX();
    const toGoalX = gx - c.x, toGoalZ = -c.z;
    const dg = len(toGoalX, toGoalZ) || 1;
    if (team.presser === p) {
      const carrierU = team.uOf(c.x); // distanza del portatore dalla NOSTRA porta
      const passive = carrierU > 68 && team.tactics.pressing < 0.5;
      const keep = passive ? 7 : 0.9;
      let tx = c.x + toGoalX / dg * keep + c.vx * 0.25;
      let tz = c.z + toGoalZ / dg * keep + c.vz * 0.25;
      // alle spalle del portatore il pallone è coperto dal corpo: ci si affianca dal lato del pallone
      const behind = Math.abs(angleDiff(c.facing, Math.atan2(p.z - c.z, p.x - c.x))) > Math.PI * 0.6;
      if (!passive && behind && dist2(p.x, p.z, c.x, c.z) < 4) {
        const fx = Math.cos(c.facing), fz = Math.sin(c.facing);
        const sd = Math.sign(-(p.x - c.x) * fz + (p.z - c.z) * fx) || 1;
        tx = c.x + fx * 0.5 - fz * sd * 0.75 + c.vx * 0.2; tz = c.z + fz * 0.5 + fx * sd * 0.75 + c.vz * 0.2;
      }
      p.moveToward(tx, tz, dist2(p.x, p.z, tx, tz) > 1.2, dt, true);
      p.faceTo(c.x, c.z, dt, 8);
      p.decisionTimer -= dt;
      if (!passive && p.decisionTimer <= 0) {
        p.decisionTimer = 0.25;
        const d = dist2(p.x, p.z, c.x, c.z);
        const chance = 0.3 + p.attr.defense / 350 + team.tactics.pressing * 0.12 - m.aiNoise(team) * 0.1;
        if (d < 2.3 && p.tackleCooldown <= 0 && !c.isGK && aiWantsTackle(p, c) && rand() < chance) m.resolveTackle(p, c, false);
        else if (d < 2.6 && p.tackleCooldown <= 0 && !c.isGK && aiWantsSlide(p, c)) m.resolveTackle(p, c, true);
      }
      return;
    }
    if (team.cover === p) {
      const tx = c.x + toGoalX / dg * 7, tz = c.z + toGoalZ / dg * 7;
      p.moveToward(tx, tz, dist2(p.x, p.z, tx, tz) > 5, dt);
      return;
    }
    const mark = team.marks && team.marks.get(p);
    const st = slotTarget(p);
    if (mark) {
      // marcatura: tra l'avversario e la porta, mischiata alla posizione di zona
      const ox = mark.x - gx, oz = mark.z;
      const od = len(ox, oz) || 1;
      const mx = mark.x - ox / od * 1.8, mz = mark.z - oz / od * 1.8;
      const w = team.uOf(mark.x) < 45 ? 0.75 : 0.45; // più stretta vicino alla porta
      const tx = lerp(st.x, mx, w), tz = lerp(st.z, mz, w);
      p.moveToward(tx, tz, dist2(p.x, p.z, tx, tz) > 6, dt);
      return;
    }
    p.moveToward(st.x, st.z, dist2(p.x, p.z, st.x, st.z) > 8, dt);
    return;
  }
  // senza palla, squadra in possesso: smarcamenti
  aiSupportRun(p, dt);
}

// smarcamento: sceglie ogni tanto un punto libero vicino alla sua posizione tattica
function aiSupportRun(p, dt) {
  const team = p.team, m = team.match, ball = m.ball;
  const st = slotTarget(p);
  const attacking = m.possessionTeam === team && ball.owner && ball.owner.team === team;
  p.runTimer -= dt;
  if (p.runTimer <= 0) {
    p.runTimer = randRange(1.0, 2.2);
    p.runOffX = 0; p.runOffZ = 0;
    if (attacking) {
      const c = ball.owner;
      const cands = [[0, 0], [7, 0], [5, 6], [5, -6], [-4, 6], [-4, -6], [2, 10], [2, -10]];
      let best = -1e9;
      const line = Math.max(offsideLineU(team), team.uOf(ball.x));
      for (const cd of cands) {
        let u = team.uOf(st.x) + cd[0], za = team.zaOf(st.z) + cd[1];
        if (u > line - 0.8) u = line - 0.8;
        const x = team.toWorldX(u), z = team.toWorldZ(clamp(za, -32, 32));
        let open = 99;
        for (const o of team.opponent().players) open = Math.min(open, dist2(x, z, o.x, o.z));
        let lane = 99;
        for (const o of team.opponent().players) {
          const r = distPointSegment(o.x, o.z, c.x, c.z, x, z);
          lane = Math.min(lane, r.d);
        }
        const dc = dist2(x, z, c.x, c.z);
        let score = Math.min(open, 8) * 0.5 + Math.min(lane, 5) * 0.6 + cd[0] * (p.slot.role === 'FW' ? 0.25 : 0.1);
        if (dc < 6) score -= 3; if (dc > 35) score -= 2;
        score += rand() * 0.8;
        if (score > best) { best = score; p.runOffX = x - st.x; p.runOffZ = z - st.z; }
      }
    }
  }
  const tx = clamp(st.x + p.runOffX, -CONFIG.HALF_L + 1, CONFIG.HALF_L - 1);
  const tz = clamp(st.z + p.runOffZ, -CONFIG.HALF_W + 1, CONFIG.HALF_W - 1);
  const forwardRun = team.uOf(tx) > team.uOf(p.x) + 4;
  p.moveToward(tx, tz, (attacking && forwardRun) || dist2(p.x, p.z, tx, tz) > 10, dt);
}

// ---------- 4) DECISIONI DEL PORTATORE ----------
// valuta i compagni a cui passare: restituisce la lista ordinata per punteggio
function evaluatePasses(p, opts) {
  const team = p.team, opp = team.opponent().players;
  const pU = team.uOf(p.x);
  const line = offsideLineU(team);
  const res = [];
  for (const mte of team.players) {
    if (mte === p) continue;
    const mU = team.uOf(mte.x);
    const offside = mU > line + 0.3 && mU > pU && mU > CONFIG.HALF_L;
    if (offside) continue;
    const d = dist2(p.x, p.z, mte.x, mte.z);
    if (d < 4 || d > (opts && opts.long ? 60 : 45)) continue;
    // anticipo: punto dove arriverà il compagno
    const lead = Math.min(d / 16, 1.2);
    const tx = mte.x + mte.vx * lead, tz = mte.z + mte.vz * lead;
    let lane = 99, space = 99;
    for (const o of opp) {
      lane = Math.min(lane, distPointSegment(o.x, o.z, p.x, p.z, tx, tz).d);
      space = Math.min(space, dist2(o.x, o.z, tx, tz));
    }
    const lob = d > 26 && lane < 3;
    if (!lob && lane < 1.3) continue;
    let score = (mU - pU) / 25 + Math.min(space, 9) / 9 * 0.7 + Math.min(lane, 6) / 6 * 0.7;
    if (d > 30) score -= (d - 30) / 20;
    if (mte.isGK) score -= 1.2;
    if (lob) score -= 0.35;
    res.push({ mate: mte, x: tx, z: tz, score: score, lob: lob, kind: 'pass' });
    // filtrante: in avanti nello spazio per chi corre verso la porta
    if (!mte.isGK && mte.slot.role !== 'DF' && mU > pU + 3) {
      const fx = tx + team.dir * 7, fz = tz * 0.9;
      if (Math.abs(fx) < CONFIG.HALF_L - 3) {
        let fl = 99, fs = 99;
        for (const o of opp) {
          fl = Math.min(fl, distPointSegment(o.x, o.z, p.x, p.z, fx, fz).d);
          fs = Math.min(fs, dist2(o.x, o.z, fx, fz));
        }
        if (fl > 1.6) res.push({ mate: mte, x: fx, z: fz, score: (team.uOf(fx) - pU) / 22 + Math.min(fs, 8) / 8 * 0.8 + 0.1, lob: false, kind: 'through' });
      }
    }
  }
  res.sort((a, b) => b.score - a.score);
  return res;
}

function aiCarrier(p, dt) {
  const team = p.team, m = team.match;
  const gx = team.oppGoalX();
  const dGoal = dist2(p.x, p.z, gx, 0);
  const pressure = nearestOpponentDist(p);
  const pU = team.uOf(p.x), pZa = team.zaOf(p.z);

  // guida la palla verso la porta evitando l'avversario più vicino davanti
  let dirX = team.dir, dirZ = -p.z / 60;
  if (dGoal < 30) { dirX = (gx - p.x) / dGoal; dirZ = -p.z / dGoal; }
  let near = null, nd = 7;
  for (const o of team.opponent().players) {
    const d = dist2(p.x, p.z, o.x, o.z);
    const ahead = (o.x - p.x) * team.dir > -1;
    if (d < nd && ahead) { nd = d; near = o; }
  }
  if (near) {
    const side = (near.z - p.z) > 0 ? -1 : 1;
    dirZ += side * (7 - nd) / 7 * 1.3;
  }
  if (Math.abs(p.z) > 30) dirZ -= Math.sign(p.z) * 0.8;
  const tx = clamp(p.x + dirX * 5, -CONFIG.HALF_L + 1, CONFIG.HALF_L - 1);
  const tz = clamp(p.z + dirZ * 5, -CONFIG.HALF_W + 1.5, CONFIG.HALF_W - 1.5);
  const space = nd;
  p.moveToward(tx, tz, space > 4 && p.energy > 30, dt);

  p.decisionTimer -= dt;
  if (p.decisionTimer > 0 && pressure > 1.6) return;
  // senza pressione si ragiona con più calma
  p.decisionTimer = (pressure > 4 ? 0.45 : 0.2) + m.aiNoise(team) * 0.25;
  if (p.kickCooldown > 0) return;

  const noise = m.aiNoise(team);
  // opzione tiro
  let shotScore = -9;
  if (dGoal < 30) {
    const angle = Math.abs(Math.atan2(Math.abs(p.z), Math.abs(gx - p.x)));
    // tiri un po' più frequenti dalla media distanza (più occasioni e più gol, 0.3.2)
    shotScore = dGoal < 16 ? 2.1 : dGoal < 24 ? 1.45 : 0.6;
    shotScore -= angle * 0.85;
    let blockers = 0;
    for (const o of team.opponent().players) {
      if (o.isGK) continue;
      if (distPointSegment(o.x, o.z, p.x, p.z, gx, 0).d < 1.2) blockers++;
    }
    shotScore -= blockers * 0.35;
    if (dGoal < 11) shotScore += 0.8;
    shotScore += p.attr.shot / 250;
  }
  // opzione cross dal fondo
  let crossScore = -9;
  if (pU > 84 && Math.abs(pZa) > 13) {
    const inBox = team.players.filter(t => t !== p && inBoxOf(team.opponent(), t.x, t.z)).length;
    crossScore = 0.6 + inBox * 0.35;
  }
  // opzione dribbling
  const dribbleScore = 0.35 + Math.min(space, 10) / 10 * 1.2 + p.attr.dribble / 250 - (pressure < 1.5 ? 0.9 : 0) + (pU > 60 ? 0.3 : 0);
  // opzioni passaggio
  const passes = evaluatePasses(p, { long: pU < 45 });
  const bestPass = passes[0];
  // passare ha un "costo": conviene solo se migliora la situazione
  const passScore = bestPass ? bestPass.score - 0.25 + (pressure < 2 ? 0.6 : 0) + team.tactics.tempo * 0.2 : -9;

  const opts = [
    { k: 'shot', s: shotScore + (rand() - 0.5) * noise },
    { k: 'cross', s: crossScore + (rand() - 0.5) * noise },
    { k: 'pass', s: passScore + (rand() - 0.5) * noise },
    { k: 'dribble', s: dribbleScore + (rand() - 0.5) * noise },
  ].sort((a, b) => b.s - a.s);
  const choice = opts[0].k;

  if (choice === 'shot') {
    // potenza sotto la soglia del "tiro alle stelle" (sopra 0.92 la palla rischia di volare alta)
    doShot(p, chooseShotAim(p), clamp(0.5 + dGoal / 70 + rand() * 0.15, 0.4, 0.9));
  } else if (choice === 'cross') {
    const targets = team.players.filter(t => t !== p && inBoxOf(team.opponent(), t.x, t.z));
    const tgt = targets.length ? pick(targets) : null;
    const cx = tgt ? tgt.x : team.toWorldX(95), cz = tgt ? tgt.z : randRange(-5, 5);
    doLobPass(p, cx, cz, tgt, 'cross');
  } else if (choice === 'pass') {
    if (bestPass.lob) doLobPass(p, bestPass.x, bestPass.z, bestPass.mate, 'lob');
    else doGroundPass(p, bestPass.x, bestPass.z, bestPass.mate);
  }
}

// ---------- PORTIERE ----------
function shotThreat(team) {
  // cerca nella previsione quando la palla attraversa la linea della nostra porta
  const m = team.match, gx = team.ownGoalX();
  if (m.ball.owner) return null;
  const movingIn = m.ball.vx * Math.sign(gx) > 3;
  if (!movingIn) return null;
  for (const s of m.pred) {
    if (Math.abs(s.x) >= CONFIG.HALF_L - 0.3 && Math.sign(s.x) === Math.sign(gx)) {
      if (Math.abs(s.z) < CONFIG.GOAL_HALF_W + 0.8 && s.y < CONFIG.GOAL_H + 0.4) return s;
      return null;
    }
  }
  return null;
}

// Portiere (0.24): reagisce dopo un tempo di reazione, legge la traiettoria (dove, quando e a che altezza il pallone
// passa sulla sua linea), si sposta di lato con accelerazione e frenata graduali, e se non ci arriva in piedi si tuffa.
// Il tuffo è un movimento vero: spinta, volo con il corpo che si sposta di lato, atterraggio, qualche istante a terra e
// poi si rialza e torna in posizione camminando (mai teletrasportato). Se para o no lo decide la geometria (gkReach in
// 08_match.js): dove arrivano davvero le sue mani in quell'istante, non un tiro di dadi.
const GK = {
  REACT_BASE: 0.25,      // tempo di reazione di un portiere da 100 (s): un portiere da 75 ci mette circa 0,3 s
  REACT_PER_POINT: 0.003, // in più per ogni punto sotto 100
  REACT_RANDOM: 0.06,    // variazione da tiro a tiro
  SHUFFLE_SPEED: 4.0,    // passi laterali, al massimo (m/s)
  SET_SPEED: 1.8,        // con il tiro in arrivo: piccoli passi di aggiustamento, il resto lo fa il tuffo (m/s)
  SHUFFLE_ACCEL: 13,     // quanto in fretta accelera e frena di lato (m/s²)
  ARM_REACH: 0.85,       // in piedi: dove arrivano le braccia dal centro del corpo (m)
  DIVE_TIME: 0.9,        // durata del tuffo (come anim.dive): spinta, volo, atterraggio
  DIVE_PUSH: 0.13,       // spinta sulle gambe prima di staccarsi da terra
  DIVE_FLIGHT: 0.5,      // fine del volo (da qui atterra e scivola)
  DOWN_TIME: 0.5,        // a terra dopo il tuffo, prima di rialzarsi
  DIVE_MIN_T: 0.1,       // sotto questo tempo non c'è il tempo per tuffarsi: solo un riflesso
  DIVE_BASE: 5.0,        // velocità di volo di un portiere da 0 (m/s) ...
  DIVE_PER_POINT: 0.03,  // ... più questo per ogni punto di bravura (un portiere da 80 vola a 7,4 m/s)
  DIVE_REACH: 1.35,      // nel tuffo le mani arrivano fino a qui dal centro del corpo, a braccia tese (m)
  READ_ERROR: 0.9,       // errore di lettura del tiro (m di lato, per un tiro da 20 m a mezza strada): cala avvicinandosi
};
function gkDiveSpeed(p) { return GK.DIVE_BASE + p.attr.gk * GK.DIVE_PER_POINT; }
function gkState(p) { return p.gkAi || (p.gkAi = { react: 0, seen: null, dive: null, down: 0 }); }

// dove il pallone attraversa la linea del portiere (il piano x = lineX), secondo la previsione: { t, y, z } o null
function gkInterceptOnLine(m, lineX, dir) {
  const pred = m.pred;
  for (let i = 1; i < pred.length; i++) {
    const a = pred[i - 1], b = pred[i];
    // il pallone viaggia verso la porta (dir = verso il campo): attraversa la linea quando la differenza cambia segno
    const da = (a.x - lineX) * dir, db = (b.x - lineX) * dir;
    if (da >= 0 && db < 0) {
      const k = da / (da - db);
      return { t: a.t + (b.t - a.t) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
    }
  }
  return null;
}

// inizia un tuffo verso z (altezza y, il pallone arriva tra T secondi)
function gkStartDive(p, side, targetZ, targetY, T) {
  const S = gkState(p);
  // velocità del volo: quanto serve perché le mani arrivino sul pallone (il corpo non deve arrivare fino in fondo)
  const need = Math.max(0, Math.abs(targetZ - p.z) - 0.9);
  const speed = clamp(need / Math.max(T - GK.DIVE_PUSH * 0.5, 0.12) * 1.15, 2.6, gkDiveSpeed(p));
  // il corpo si ferma dove le mani arrivano al pallone (non vola oltre il punto in cui serve)
  const bodyZ = targetZ - side * Math.min(0.9, Math.abs(targetZ - p.z));
  S.dive = { t: 0, side: side, speed: speed, h: clamp(targetY, 0.15, 2.5), z: targetZ, bodyZ: bodyZ };
  p.anim.dive = GK.DIVE_TIME; p.anim.diveDir = side * p.team.dir;
  p.vz += side * 1.2;   // primo appoggio della spinta: il peso va subito dal lato del tuffo
}

// un passo del tuffo: spinta (accelera di lato), volo (velocità quasi costante, un po' in avanti verso il pallone),
// atterraggio (scivola sull'erba e si ferma)
function gkStepDive(p, S, dt) {
  const D = S.dive;
  D.t += dt;
  const inward = p.team.dir;
  if (D.t < GK.DIVE_PUSH) {
    const k = D.t / GK.DIVE_PUSH;
    p.vz += (D.side * D.speed * k - p.vz) * Math.min(1, dt * 18);
    p.vx += (inward * 0.4 - p.vx) * Math.min(1, dt * 10);
  } else if (D.t < GK.DIVE_FLIGHT) {
    // in volo: velocità quasi costante; arrivato dove serve il corpo rallenta e scende
    const left = (D.bodyZ - p.z) * D.side;
    const v = D.speed * (1 - 0.25 * (D.t - GK.DIVE_PUSH) / (GK.DIVE_FLIGHT - GK.DIVE_PUSH));
    p.vz = D.side * (left > 0 ? Math.min(v, left / dt * 0.5 + 0.8) : Math.max(0, p.vz * D.side * Math.exp(-10 * dt)));
    p.vx = inward * 0.6;
  } else {
    const f = Math.exp(-7 * dt);
    p.vx *= f; p.vz *= f;
  }
  if (D.t >= GK.DIVE_TIME) { S.dive = null; S.down = GK.DOWN_TIME; }
}

function aiGoalkeeper(p, dt) {
  const team = p.team, m = team.match, ball = m.ball;
  const gx = team.ownGoalX(), inward = team.dir;
  const S = gkState(p);
  if (ball.owner === p) {
    // tiene la palla un attimo, poi rilancia
    S.dive = null; S.down = 0; S.react = 0;
    p.vx *= 0.8; p.vz *= 0.8;
    p.holdTime = (p.holdTime || 0) + dt;
    if (p.holdTime > 1.3) {
      p.holdTime = 0;
      const passes = evaluatePasses(p, { long: true });
      const safeShort = passes.find(o => !o.lob && o.score > 0.6 && dist2(p.x, p.z, o.x, o.z) < 30);
      if (safeShort) doGroundPass(p, safeShort.x, safeShort.z, safeShort.mate);
      else {
        const fw = team.players.filter(t => t.slot.role !== 'DF' && !t.isGK);
        const tgt = pick(fw);
        doLobPass(p, tgt.x, tgt.z, tgt, 'lob');
      }
    }
    return;
  }
  p.holdTime = 0;
  // tuffo in corso e poi qualche istante a terra: il corpo segue la sua fisica, niente decisioni nuove
  if (S.dive) { gkStepDive(p, S, dt); p.faceTo(ball.x, ball.z, dt, 3); return; }
  if (S.down > 0) {
    S.down -= dt;
    const f = Math.exp(-9 * dt);
    p.vx *= f; p.vz *= f;
    return;
  }
  // un tiro nuovo verso la nostra porta: prima di muoversi passa il tempo di reazione
  const k = m.lastKick;
  if (k && k.kind === 'shot' && k.player && k.player.team !== team && k.time !== S.seen) {
    S.seen = k.time;
    S.react = GK.REACT_BASE + (100 - p.attr.gk) * GK.REACT_PER_POINT + rand() * GK.REACT_RANDOM;
    // lettura del tiro: all'inizio il portiere sbaglia un po' a capire dove andrà il pallone (di più se il tiro è
    // forte e se lui è meno bravo); l'errore si riduce man mano che il pallone si avvicina
    const pace = len(ball.vx, ball.vz);
    S.readErr = (rand() * 2 - 1) * GK.READ_ERROR * (0.6 + pace / 50) * (1.3 - p.attr.gk / 200);
    S.readT0 = null;
  }
  if (S.react > 0) {
    // ancora fermo sulle gambe: la velocità di prima si spegne, lo sguardo segue il pallone
    S.react -= dt;
    const f = Math.exp(-6 * dt);
    p.vx *= f; p.vz *= f;
    p.faceTo(ball.x, ball.z, dt, 10);
    return;
  }
  const threat = shotThreat(team);
  if (threat && threat.t < 1.7) {
    // legge la traiettoria: dove e quando il pallone passa sulla sua linea
    const ip = gkInterceptOnLine(m, p.x, inward) || { t: threat.t, y: threat.y, z: threat.z };
    if (S.readT0 == null) S.readT0 = Math.max(ip.t, 0.2);
    const err = (S.readErr || 0) * clamp(ip.t / S.readT0, 0, 1);   // l'errore sparisce quando il pallone arriva
    const tz = clamp(ip.z + err, -CONFIG.GOAL_HALF_W - 0.6, CONFIG.GOAL_HALF_W + 0.6);
    const dz = tz - p.z;
    // il tuffo parte all'ultimo momento utile: prima si avvicina con i passi laterali (come i portieri veri),
    // poi si tuffa quando il pallone sta per arrivare. Se il pallone è troppo vicino non c'è più tempo
    const need = GK.DIVE_PUSH + Math.max(0, Math.abs(dz) - 1.2) / gkDiveSpeed(p);
    if (Math.abs(dz) > GK.ARM_REACH && ip.t > GK.DIVE_MIN_T && ip.t <= need + 0.14) {
      gkStartDive(p, Math.sign(dz), tz, ip.y, ip.t);
      gkStepDive(p, S, dt);
    } else {
      // ci arriva in piedi, o aspetta il momento del tuffo: piccoli passi verso il pallone, il corpo dietro alla palla
      gkShuffle(p, gx + inward * 0.7, tz, dt, GK.SET_SPEED);
    }
    p.faceTo(ball.x, ball.z, dt, 12);
    return;
  }
  // uno contro uno (0.24.7): l'attaccante arriva da solo verso la porta. Il portiere esce per chiudere lo specchio
  // e, quando è vicino, si butta sui piedi per prendere il pallone (non sempre ci riesce)
  const opp = ball.owner && ball.owner.team !== team ? ball.owner : null;
  if (opp && gkOneOnOne(p, opp)) {
    const odx = opp.x - gx, odz = opp.z, od = len(odx, odz) || 1;
    const dOpp = len(opp.x - p.x, opp.z - p.z);
    if (dOpp < 1.6 && p.tackleCooldown <= 0) gkSmother(p, opp);
    else {
      // sulla linea porta-attaccante, abbastanza avanti da coprire lo specchio ma senza farsi saltare da lontano
      const out = clamp(od * 0.3, 1.2, Math.max(1.2, Math.min(5, od - 2.5)));
      gkShuffle(p, gx + odx / od * out, odz / od * out, dt);
    }
    p.faceTo(ball.x, ball.z, dt, 10);
    return;
  }
  // esce sulla palla libera in area
  if (!ball.owner && team.chaser === p) {
    p.moveToward(p.icX, p.icZ, true, dt, true);
    return;
  }
  // posizionamento sulla bisettrice tra palla e porta, con passi laterali morbidi
  const bdx = ball.x - gx, bdz = ball.z;
  const bd = len(bdx, bdz) || 1;
  const out = clamp(bd * 0.1, 0.6, 5.5);
  const tx = gx + bdx / bd * out;
  let tz = bdz / bd * out;
  tz = clamp(tz, -CONFIG.GOAL_HALF_W + 0.4, CONFIG.GOAL_HALF_W - 0.4);
  gkShuffle(p, tx, tz, dt);
  p.faceTo(ball.x, ball.z, dt, 8);
}

// uno contro uno? L'avversario con la palla è vicino alla porta (entro 17 m, non troppo defilato), sta venendo
// verso la porta e nessun difensore è tra lui e la porta
function gkOneOnOne(p, opp) {
  const team = p.team, gx = team.ownGoalX();
  const dx = gx - opp.x, dz = -opp.z, d = len(dx, dz) || 1;
  if (d > 17 || Math.abs(opp.z) > 12) return false;
  const toward = (opp.vx * dx + opp.vz * dz) / d;
  if (toward < 1 && d > 11) return false;
  for (const t of team.players) {
    if (t.isGK || t.sentOff || t.gone) continue;
    const rx = t.x - opp.x, rz = t.z - opp.z, along = (rx * dx + rz * dz) / d;
    if (along > 0.5 && along < d - 1 && Math.abs(rx * dz - rz * dx) / d < 2.5) return false;   // un difensore copre
  }
  return true;
}

// il portiere si butta sui piedi dell'attaccante: prende il pallone con una probabilità che dipende dalla sua
// bravura contro il dribbling dell'attaccante; se sbaglia resta a terra un attimo e l'attaccante passa
function gkSmother(p, opp) {
  const m = p.team.match, S = gkState(p);
  p.tackleCooldown = 1.0;
  const q = clamp(0.3 + (p.attr.gk - 70) / 90 - (opp.attr.dribble - 70) / 140, 0.12, 0.7);
  if (rand() < q) {
    const b = m.ball;
    b.owner = p; b.lastTouch = p; b.vx = b.vy = b.vz = 0;
    m.possessionTeam = p.team;
    opp.stunned = 0.4;
    m.emit('save', {});
    if (m.onTouch(p)) m.giveControl(p);
  } else {
    S.down = 0.6;   // a vuoto: a terra, l'attaccante lo salta
  }
  p.vx = p.vz = 0;
}

// dove arrivano le mani del portiere in questo istante: 0 = il pallone è fuori portata, altrimenti la qualità della
// presa (1 = comodo, davanti al petto; vicino a 0 = con la punta delle dita). Conta tutto il corpo:
// - in piedi: braccia fino a 0,85 m di lato, da terra fino a 2,35 m (2,6 saltando se il pallone arriva alto e piano);
// - nel tuffo: le braccia si allungano mentre vola, fino a 1,35 m dal centro del corpo nella direzione del tuffo,
//   all'altezza del tuffo (più o meno 0,65 m); prima della spinta e dopo l'atterraggio arriva molto meno;
// - a terra dopo un tuffo: solo un pallone basso che gli arriva addosso.
function gkReach(p, b) {
  const S = p.gkAi, dx = b.x - p.x, dz = b.z - p.z, y = b.y;
  if (S && S.dive) {
    const D = S.dive, t = D.t;
    const ext = clamp((t - 0.04) / 0.22, 0, 1) * (t > GK.DIVE_FLIGHT + 0.15 ? 0.5 : 1);
    const along = dz * D.side;
    const reach = 0.45 + (GK.DIVE_REACH - 0.45) * ext;
    if (along < -0.45 || along > reach || Math.abs(dx) > 0.6) return 0;
    const flyH = t < GK.DIVE_FLIGHT ? D.h : Math.min(D.h, 0.5);
    const dh = Math.abs(y - flyH);
    if (dh > 0.7) return 0;
    const edge = clamp((along - 0.35) / (reach - 0.35 || 1), 0, 1);
    return clamp(1 - edge * 0.85 - dh * 0.5, 0.05, 1);
  }
  if (S && S.down > 0) return Math.abs(dx) < 0.5 && Math.abs(dz) < 0.9 && y < 0.6 ? 0.35 : 0;
  // in piedi: il pallone deve arrivare all'altezza delle mani (davanti al corpo, entro mezzo metro), poi conta quanto
  // è lontano di lato e a che altezza
  const lat = Math.abs(dz);
  const slowHigh = y > 2.35 && len(b.vx, b.vz) < 16;
  if (Math.abs(dx) > 0.5 || lat > 0.95 || y > (slowHigh ? 2.62 : 2.38)) return 0;
  let q = 1 - clamp((lat - 0.3) / 0.65, 0, 1) * 0.7;
  if (y > 2.0) q -= (y - 2.0) * 0.7;          // in alto: braccia tese, più difficile trattenere
  if (y < 0.35 && lat > 0.5) q -= 0.3;        // basso e di lato: piegarsi in fretta è difficile
  return clamp(q, 0.1, 1);
}

// spostamento del portiere: accelerazione e frenata graduali (niente scatti), velocità laterale limitata ai passi
// laterali; più veloce se deve correre in avanti o indietro per tanta strada
function gkShuffle(p, tx, tz, dt, maxSp) {
  const dx = tx - p.x, dz = tz - p.z, d = len(dx, dz);
  let wx = 0, wz = 0;
  if (d > 0.04) {
    const far = d > 4 && !maxSp;
    const top = far ? p.maxSpeed(true) : maxSp || GK.SHUFFLE_SPEED;
    // rallenta arrivando (frenata dolce: v = sqrt(2·a·d))
    const sp = Math.min(top, Math.sqrt(2 * GK.SHUFFLE_ACCEL * 0.55 * d));
    wx = dx / d * sp; wz = dz / d * sp;
  }
  const ax = wx - p.vx, az = wz - p.vz, al = len(ax, az), maxDv = GK.SHUFFLE_ACCEL * dt;
  if (al > maxDv) { p.vx += ax / al * maxDv; p.vz += az / al * maxDv; } else { p.vx = wx; p.vz = wz; }
  p.sprinting = false;
}

// ---------- COLPO DI TESTA automatico ----------
function aiHeaderTarget(p) {
  const team = p.team;
  const gx = team.oppGoalX();
  const dGoal = dist2(p.x, p.z, gx, 0);
  if (dGoal < 16) return { x: gx, z: chooseShotAim(p), strength: 15, shot: true };
  if (inBoxOf(team, p.x, p.z) || team.uOf(p.x) < 40) {
    // spazza lontano dalla propria porta
    return { x: p.x + team.dir * 20, z: p.z + randRange(-10, 10), strength: 14, shot: false };
  }
  const passes = evaluatePasses(p);
  if (passes.length) return { x: passes[0].x, z: passes[0].z, strength: 10, shot: false };
  return { x: p.x + team.dir * 10, z: p.z, strength: 10, shot: false };
}
