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
    team.presser = field[0];
    team.cover = field[1];
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
      const tx = c.x + toGoalX / dg * keep + c.vx * 0.25;
      const tz = c.z + toGoalZ / dg * keep + c.vz * 0.25;
      p.moveToward(tx, tz, dist2(p.x, p.z, tx, tz) > 1.2, dt, true);
      p.faceTo(c.x, c.z, dt, 8);
      p.decisionTimer -= dt;
      if (!passive && p.decisionTimer <= 0) {
        p.decisionTimer = 0.25;
        const d = dist2(p.x, p.z, c.x, c.z);
        const chance = 0.18 + p.attr.defense / 400 + team.tactics.pressing * 0.12 - m.aiNoise(team) * 0.1;
        if (d < 1.9 && p.tackleCooldown <= 0 && !c.isGK && rand() < chance) m.resolveTackle(p, c, false);
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

function aiGoalkeeper(p, dt) {
  const team = p.team, m = team.match, ball = m.ball;
  const gx = team.ownGoalX(), inward = team.dir;
  if (ball.owner === p) {
    // tiene la palla un attimo, poi rilancia
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
  if (p.commitTimer > 0) { p.commitTimer -= dt; return; }
  const threat = shotThreat(team);
  if (threat && threat.t < 1.7) {
    // tuffo verso il punto di arrivo
    const tz = clamp(threat.z, -CONFIG.GOAL_HALF_W - 0.3, CONFIG.GOAL_HALF_W + 0.3);
    const tx = gx + inward * 0.6;
    const dz = tz - p.z;
    const diveSpeed = 5.5 + p.attr.gk * 0.035;
    const d = dist2(p.x, p.z, tx, tz);
    if (d > 0.1) {
      const sp = Math.min(diveSpeed, d / Math.max(threat.t, 0.12));
      p.vx = (tx - p.x) / d * sp; p.vz = (tz - p.z) / d * sp;
    }
    if (Math.abs(dz) > 1.2 && p.anim.dive <= 0) { p.anim.dive = 0.9; p.anim.diveDir = Math.sign(dz) * inward; }
    p.faceTo(ball.x, ball.z, dt, 12);
    return;
  }
  // esce sulla palla libera in area
  if (!ball.owner && team.chaser === p) {
    p.moveToward(p.icX, p.icZ, true, dt, true);
    return;
  }
  // posizionamento sulla bisettrice tra palla e porta
  const bdx = ball.x - gx, bdz = ball.z;
  const bd = len(bdx, bdz) || 1;
  const out = clamp(bd * 0.1, 0.6, 5.5);
  let tx = gx + bdx / bd * out, tz = bdz / bd * out;
  tz = clamp(tz, -CONFIG.GOAL_HALF_W + 0.4, CONFIG.GOAL_HALF_W - 0.4);
  p.moveToward(tx, tz, false, dt, true);
  p.faceTo(ball.x, ball.z, dt, 8);
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
