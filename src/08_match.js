// ============================================================
// PARTITA — stati, regole e ciclo di simulazione
// Stati: KICKOFF, PLAY, DEAD (palla ferma dopo fischio), SETPIECE, GOAL, HALFTIME, FULLTIME
// ============================================================
const SETPIECE_NAMES = {
  KICKOFF: "Calcio d'inizio", THROW_IN: 'Rimessa laterale', CORNER: "Calcio d'angolo",
  GOAL_KICK: 'Rinvio dal fondo', FREE_KICK: 'Punizione', PENALTY: 'Calcio di rigore',
};

class Match {
  constructor(homeData, awayData, opts) {
    opts = opts || {};
    this.ball = new Ball();
    this.halfSeconds = opts.halfSeconds || CONFIG.HALF_REAL_SECONDS;
    this.gameSecondsPerReal = 2700 / this.halfSeconds;
    this.teams = [];
    this.teams.push(new Team(homeData, 0, 'home', this));
    this.teams.push(new Team(awayData, 1, 'away', this));
    this.difficulty = opts.difficulty === undefined ? 1 : opts.difficulty;  // 0 facile, 1 normale, 2 difficile
    // giocatori umani: ognuno controlla un calciatore della sua squadra.
    // opts.humans = [{ id, team }]; per compatibilità opts.humanTeam crea un solo umano 'local' (-1 = solo IA)
    this.humans = [];
    let hs = opts.humans;
    if (!hs) {
      const ht = opts.humanTeam === undefined ? 0 : opts.humanTeam;
      hs = ht >= 0 ? [{ id: 'local', team: ht }] : [];
    }
    this.clock = 0; this.half = 1; this.realTime = 0;
    this.state = 'KICKOFF'; this.stateTime = 0;
    this.setPiece = null;
    this.possessionTeam = this.teams[0];
    this.events = [];
    this.log = [];                 // cronaca (gol, ecc.)
    this.banner = null;
    this.offside = null;
    this.pendingPass = null;
    this.pred = [];
    this.predTimer = 0;
    this.replay = []; this.replayMax = Math.round(CONFIG.REPLAY_SECONDS / CONFIG.DT);
    this.lastGoal = null;
    this.stuckTimer = 0;
    for (const h of hs) this.addHuman(h.id, h.team);
    this.startKickoff(this.teams[0]);
  }

  // ---------- GIOCATORI UMANI ----------
  addHuman(id, team) {
    if (this.humanById(id)) return this.humanById(id);
    const h = { id: id, team: team, player: null, input: null, shootCharge: 0, prevShoot: false };
    this.humans.push(h);
    h.player = this.nearestFree(this.teams[team], this.ball.x, this.ball.z);
    return h;
  }
  removeHuman(id) { this.humans = this.humans.filter(h => h.id !== id); }
  humanById(id) { return this.humans.find(h => h.id === id) || null; }
  controllerOf(p) { return this.humans.find(h => h.player === p) || null; }
  // squadra del primo umano (-1 se nessuno): usato da HUD e test
  get humanTeam() { return this.humans.length ? this.humans[0].team : -1; }
  get controlled() { return this.humans.length ? this.humans[0].player : null; }
  set controlled(p) { if (this.humans.length) this.humans[0].player = p; }
  get shootCharge() { return this.humans.length ? this.humans[0].shootCharge : 0; }

  // calciatore libero più vicino (non già controllato da un altro umano)
  nearestFree(team, x, z, except) {
    let best = null, bd = 1e9;
    for (const p of team.players) {
      if (p.isGK) continue;
      if (this.humans.some(o => o !== except && o.player === p)) continue;
      const d = dist2(p.x, p.z, x, z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  // a ogni piazzato: il battitore va al primo umano della squadra, gli altri al più vicino libero
  assignControl(takerTeam, taker, x, z) {
    for (const h of this.humans) h.player = null;
    for (const h of this.humans) {
      const team = this.teams[h.team];
      if (taker && team === takerTeam && !this.controllerOf(taker)) h.player = taker;
      else h.player = this.nearestFree(team, x, z, h);
    }
  }
  // un calciatore della squadra ha preso la palla: lo controlla l'umano più vicino
  giveControl(p) {
    if (this.controllerOf(p)) return;
    let best = null, bd = 1e9;
    for (const h of this.humans) {
      if (h.team !== p.team.index) continue;
      const d = h.player ? dist2(h.player.x, h.player.z, p.x, p.z) : 0;
      if (d < bd) { bd = d; best = h; }
    }
    if (best) best.player = p;
  }

  allPlayers() { return this.teams[0].players.concat(this.teams[1].players); }
  emit(type, data) { this.events.push({ type: type, data: data }); }
  showBanner(text, secs) { this.banner = { text: text, t: secs || 2 }; }
  minute() { return Math.min((this.half - 1) * 45 + Math.floor(this.clock / 60), this.half * 45 + 5); }
  isHuman(team) { return this.humans.some(h => h.team === team.index); }
  // rumore delle decisioni IA: più alto = scelte meno precise
  aiNoise(team) {
    if (this.isHuman(team)) return 0.35;
    return [0.75, 0.4, 0.15][this.difficulty];
  }
  setState(s) { this.state = s; this.stateTime = 0; }

  // ---------- CALCIO D'INIZIO ----------
  startKickoff(team) {
    this.setState('KICKOFF');
    this.ball.reset(0, 0);
    this.offside = null; this.pendingPass = null;
    for (const p of this.allPlayers()) {
      const pos = kickoffPosition(p, team);
      p.x = pos.x; p.z = pos.z; p.vx = 0; p.vz = 0;
      p.facing = p.team.dir > 0 ? 0 : Math.PI;
      p.stunned = 0; p.kickCooldown = 0;
    }
    const fws = team.players.filter(p => p.slot.role === 'FW');
    const taker = fws[0] || team.players[10];
    const partner = fws[1] || team.players.filter(p => p.slot.role === 'MF')[0];
    taker.x = -team.dir * 0.4; taker.z = 0;
    partner.x = -team.dir * 1.5; partner.z = 4;
    this.possessionTeam = team;
    this.setPiece = { type: 'KICKOFF', team: team, x: 0, z: 0, taker: taker, partner: partner };
    this.assignControl(team, taker, 0, 0);
  }

  nearestTo(team, x, z, allowGK, exclude) {
    let best = null, bd = 1e9;
    for (const p of team.players) {
      if ((p.isGK && !allowGK) || p === exclude) continue;
      const d = dist2(p.x, p.z, x, z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------- CALCI PIAZZATI ----------
  // fischio: la palla resta ferma un attimo, poi si prepara il piazzato
  whistle(type, team, x, z, text) {
    this.setState('DEAD');
    this.pendingSetPiece = { type: type, team: team, x: x, z: z };
    this.ball.owner = null;
    this.offside = null; this.pendingPass = null;
    this.showBanner(text || SETPIECE_NAMES[type], 2);
    this.emit('whistle', { type: type });
  }

  startSetPiece() {
    const sp = this.pendingSetPiece;
    this.setState('SETPIECE');
    this.possessionTeam = sp.team;
    this.ball.reset(sp.x, sp.z);
    if (sp.type === 'THROW_IN') this.ball.y = 2.0;
    let taker;
    const team = sp.team;
    if (sp.type === 'GOAL_KICK') taker = team.gk;
    else if (sp.type === 'PENALTY') taker = team.players.filter(p => !p.isGK).sort((a, b) => b.attr.shot - a.attr.shot)[0];
    else taker = this.nearestTo(team, sp.x, sp.z, false);
    sp.taker = taker;
    this.setPiece = sp;
    // il battitore va dietro la palla
    const back = this.setPieceTakerSpot(sp);
    if (dist2(taker.x, taker.z, back.x, back.z) > 25) { taker.x = back.x + randRange(-3, 3); taker.z = back.z + randRange(-3, 3); }
    this.assignControl(team, taker, sp.x, sp.z);
    if (sp.type === 'PENALTY') {
      // posizioni fisse per il rigore
      const def = team.opponent();
      for (const p of this.allPlayers()) {
        if (p === taker) continue;
        if (p === def.gk) { p.x = def.ownGoalX(); p.z = 0; continue; }
        const side = team.oppGoalX() > 0 ? 1 : -1;
        p.x = side * (CONFIG.HALF_L - CONFIG.BOX_DEPTH - 2 - rand() * 8);
        p.z = randRange(-18, 18);
        p.vx = 0; p.vz = 0;
      }
      taker.x = back.x; taker.z = back.z;
    }
  }

  setPieceTakerSpot(sp) {
    const b = this.ball;
    let dx = -sp.team.dir, dz = 0;
    if (sp.type === 'THROW_IN') { dx = 0; dz = Math.sign(sp.z); }
    if (sp.type === 'CORNER') { dx = Math.sign(sp.x) * 0.7; dz = Math.sign(sp.z) * 0.7; }
    const toGoalX = sp.team.oppGoalX() - sp.x, toGoalZ = -sp.z;
    if (sp.type === 'FREE_KICK' || sp.type === 'PENALTY') {
      const d = len(toGoalX, toGoalZ) || 1;
      dx = -toGoalX / d; dz = -toGoalZ / d;
    }
    const l = len(dx, dz) || 1;
    const off = sp.type === 'THROW_IN' ? 0.3 : 0.7;
    return { x: b.x + dx / l * off, z: b.z + dz / l * off };
  }

  // posizioni degli altri giocatori durante il piazzato
  setPiecePosition(p) {
    const sp = this.setPiece;
    const st = slotTarget(p);
    let x = st.x, z = st.z;
    const atk = sp.team, def = atk.opponent();
    if (sp.type === 'CORNER') {
      const gx = atk.oppGoalX();
      if (p.team === atk && (p.slot.role === 'FW' || (p.slot.role === 'DF' && Math.abs(p.slot.z) < 10) || p.slotIndex === 6)) {
        x = gx - atk.dir * randRange(6, 12) * 0 - atk.dir * (6 + (p.slotIndex % 4) * 2);
        z = ((p.slotIndex % 3) - 1) * 4;
      }
      if (p.team === def && !p.isGK) {
        x = gx - atk.dir * (3 + (p.slotIndex % 4) * 2.5);
        z = ((p.slotIndex % 5) - 2) * 3.5;
      }
    }
    if (p.team !== atk && (sp.type === 'FREE_KICK' || sp.type === 'CORNER')) {
      const d = dist2(x, z, sp.x, sp.z);
      if (d < 9.5) { const k = 9.5 / (d || 1); x = sp.x + (x - sp.x) * k; z = sp.z + (z - sp.z) * k; }
    }
    if (sp.type === 'GOAL_KICK' && p.team !== atk && inBoxOf(atk, x, z)) {
      x = atk.ownGoalX() + atk.dir * (CONFIG.BOX_DEPTH + 2);
    }
    // barriera per le punizioni vicine alla porta
    if (sp.type === 'FREE_KICK' && p.team === def && !p.isGK && p.slot.role === 'DF') {
      const gx = def.ownGoalX();
      const dGoal = dist2(sp.x, sp.z, gx, 0);
      if (dGoal < 30) {
        const vx = (gx - sp.x) / dGoal, vz = -sp.z / dGoal;
        const k = (p.slotIndex - 2.5) * 0.65;
        x = sp.x + vx * 9.15 - vz * k; z = sp.z + vz * 9.15 + vx * k;
      }
    }
    return { x: clamp(x, -CONFIG.HALF_L + 0.5, CONFIG.HALF_L - 0.5), z: clamp(z, -CONFIG.HALF_W + 0.5, CONFIG.HALF_W - 0.5) };
  }

  // esecuzione del piazzato da parte dell'IA
  executeSetPieceAI() {
    const sp = this.setPiece, p = sp.taker, team = sp.team;
    if (sp.type === 'KICKOFF') { doGroundPass(p, sp.partner.x, sp.partner.z, sp.partner); return; }
    if (sp.type === 'PENALTY') { doShot(p, pick([-1, 1]) * randRange(1.5, 3.1), randRange(0.55, 0.8)); return; }
    if (sp.type === 'CORNER') {
      const targets = team.players.filter(t => t !== p && inBoxOf(team.opponent(), t.x, t.z));
      const tgt = targets.length ? pick(targets) : null;
      const gx = team.oppGoalX();
      doLobPass(p, tgt ? tgt.x : gx - team.dir * 9, tgt ? tgt.z : randRange(-4, 4), tgt, 'cross');
      return;
    }
    if (sp.type === 'FREE_KICK') {
      const gx = team.oppGoalX();
      const dGoal = dist2(sp.x, sp.z, gx, 0);
      if (dGoal < 27 && Math.abs(sp.z) < 20 && rand() < 0.7) {
        doShot(p, chooseShotAim(p), 0.75);
        this.ball.spin = -Math.sign(this.ball.vz || 1) * randRange(0.5, 1.0) * (p.attr.shot / 100);
        return;
      }
    }
    const passes = evaluatePasses(p, { long: true });
    if (sp.type === 'THROW_IN') {
      const near = passes.filter(o => dist2(p.x, p.z, o.x, o.z) < 22);
      const o = near[0] || passes[0];
      if (o) this.doThrow(p, o.x, o.z, o.mate); else this.doThrow(p, p.x + team.dir * 10, p.z * 0.7, null);
      return;
    }
    if (passes.length) {
      const o = passes[0];
      if (o.lob || dist2(p.x, p.z, o.x, o.z) > 30) doLobPass(p, o.x, o.z, o.mate, 'lob');
      else doGroundPass(p, o.x, o.z, o.mate);
    } else doLobPass(p, p.x + team.dir * 35, p.z * 0.5, null, 'lob');
  }

  doThrow(p, tx, tz, mate) {
    const d = Math.max(3, dist2(p.x, p.z, tx, tz));
    const T = clamp(d / 12, 0.6, 1.4);
    const vh = Math.min(d / T, 16), vy = CONFIG.GRAVITY * T / 2 - 1.8 / T;
    this.pendingPass = { from: p, to: mate };
    const e = withError((tx - p.x) / d * vh, (tz - p.z) / d * vh, 0.05);
    kickBall(p, e[0], Math.max(1, vy), e[1], 0, 'throw');
  }

  // ---------- EVENTI DI GIOCO ----------
  onKick(p, kind) {
    this.emit('kick', { kind: kind, power: this.ball.speed() });
    const setKinds = this.state === 'SETPIECE' && ['THROW_IN', 'CORNER', 'GOAL_KICK'].includes(this.setPiece.type);
    this.offside = null;
    if (kind !== 'shot' && !setKinds) {
      // registra chi è in fuorigioco al momento del passaggio
      const team = p.team;
      const line = Math.max(offsideLineU(team), team.uOf(this.ball.x));
      const off = new Set();
      for (const t of team.players) {
        if (t === p) continue;
        const u = team.uOf(t.x);
        if (u > CONFIG.HALF_L && u > line + 0.25) off.add(t);
      }
      if (off.size) this.offside = { team: team, players: off };
    }
    if (kind === 'pass' || kind === 'lob' || kind === 'cross' || kind === 'throw') { p.stats.passes++; p.team.stats.passes++; }
    this.lastKick = { player: p, kind: kind, time: this.realTime };
  }

  // chiamata ad ogni tocco di palla: restituisce false se c'è fuorigioco
  onTouch(p) {
    if (this.offside && this.offside.team === p.team && this.offside.players.has(p)) {
      p.team.stats.offsides++;
      this.whistle('FREE_KICK', p.team.opponent(), clamp(p.x, -CONFIG.HALF_L + 1, CONFIG.HALF_L - 1), clamp(p.z, -CONFIG.HALF_W + 1, CONFIG.HALF_W - 1), 'Fuorigioco');
      return false;
    }
    this.offside = null;
    if (this.pendingPass && this.pendingPass.from !== p) {
      if (this.pendingPass.from.team === p.team) { this.pendingPass.from.stats.passesOk++; p.team.stats.passesOk++; }
      this.pendingPass = null;
    }
    return true;
  }

  // contrasto: tackler prova a prendere la palla a carrier
  resolveTackle(tackler, carrier, sliding) {
    tackler.tackleCooldown = sliding ? 1.2 : 0.7;
    tackler.anim.tackle = sliding ? 0.8 : 0.35;
    const d = dist2(tackler.x, tackler.z, carrier.x, carrier.z);
    const reach = sliding ? 2.8 : 1.6;
    if (d > reach) { tackler.stunned = sliding ? 0.9 : 0.3; return; }
    const behind = Math.abs(angleDiff(carrier.facing, Math.atan2(tackler.z - carrier.z, tackler.x - carrier.x))) > Math.PI * 0.7;
    let success = 0.42 + (tackler.attr.defense - carrier.attr.dribble) / 180 + (sliding ? 0.12 : 0);
    if (tackler.data.ability === 'Muro') success += 0.1;
    if (carrier.data.ability === 'Dribblatore') success -= 0.08;
    if (behind) success -= 0.25;
    let foulP = 0.07 + (sliding ? 0.14 : 0) + (behind ? 0.3 : 0) + tackler.data.hidden.aggression / 1000;
    const r = rand();
    if (r < success) {
      tackler.stats.tackles++;
      this.emit('tackle', {});
      if (rand() < 0.5 && !sliding) {
        this.ball.owner = tackler; this.ball.lastTouch = tackler;
        this.possessionTeam = tackler.team;
        this.onTouch(tackler);
        this.giveControl(tackler);
      } else {
        const a = tackler.facing + randRange(-0.6, 0.6);
        const v = randRange(4, 8);
        this.ball.kick(Math.cos(a) * v, 0.5, Math.sin(a) * v, tackler, 0);
        this.onTouch(tackler);
      }
      carrier.stunned = 0.5;
    } else if (r < success + foulP) {
      this.foul(tackler, carrier);
    } else {
      tackler.stunned = sliding ? 1.0 : 0.55; // saltato
    }
  }

  foul(tackler, victim) {
    tackler.team.stats.fouls++;
    victim.stunned = 0.8;
    const def = tackler.team;
    const fx = clamp(victim.x, -CONFIG.HALF_L + 1, CONFIG.HALF_L - 1), fz = clamp(victim.z, -CONFIG.HALF_W + 1, CONFIG.HALF_W - 1);
    if (inBoxOf(def, fx, fz)) {
      const spotX = def.ownGoalX() + def.dir * CONFIG.PENALTY_SPOT;
      this.whistle('PENALTY', victim.team, spotX, 0, 'Rigore!');
    } else {
      this.whistle('FREE_KICK', victim.team, fx, fz, 'Fallo di ' + tackler.data.name.split(' ')[1]);
    }
  }

  // ---------- CONTATTO CON LA PALLA ----------
  checkBallContact() {
    const b = this.ball;
    if (b.owner || b.inNet) return;
    let best = null, bestD = 99, bestType = null;
    for (const p of this.allPlayers()) {
      if (p.kickCooldown > 0 || p.stunned > 0) continue;
      const dh = dist2(p.x, p.z, b.x, b.z);
      const gkHands = p.isGK && inBoxOf(p.team, p.x, p.z);
      const reach = gkHands ? (p.anim.dive > 0 ? 1.9 : CONFIG.GK_CONTROL_DIST) : CONFIG.CONTROL_DIST;
      if (dh > reach) continue;
      let type = null;
      if (gkHands && b.y < 2.55) type = 'gk';
      else if (b.y < 1.6) type = 'foot';
      else if (b.y < 2.6 && dh < 1.0) type = 'head';
      if (type && dh < bestD) { bestD = dh; best = p; bestType = type; }
    }
    if (!best) return;
    const p = best;
    const rel = len(b.vx - p.vx, b.vz - p.vz);
    if (bestType === 'gk') { this.goalkeeperSave(p, rel); return; }
    if (!this.onTouch(p)) return;
    b.lastTouch = p;
    if (bestType === 'head') {
      let tgt;
      const hc = this.controllerOf(p), hi = hc && hc.input;
      if (hi && len(hi.mx, hi.mz) > 0.2) {
        tgt = { x: p.x + hi.mx * 15, z: p.z + hi.mz * 15, strength: 13 };
        if (dist2(p.x, p.z, p.team.oppGoalX(), 0) < 16) tgt = { x: p.team.oppGoalX(), z: clamp(p.z + hi.mz * 4, -3, 3), strength: 15 };
      } else tgt = aiHeaderTarget(p);
      doHeader(p, tgt.x, tgt.z, tgt.strength);
      if (tgt.shot) { p.stats.shots++; p.team.stats.shots++; }
      return;
    }
    const limit = 16 + p.attr.dribble * 0.14;
    if (rel > limit) {
      // controllo sbagliato: la palla rimbalza via
      b.vx = b.vx * -0.25 + randRange(-2, 2); b.vz = b.vz * -0.25 + randRange(-2, 2);
      b.vy = Math.abs(b.vy) * 0.3;
      p.kickCooldown = 0.3;
      this.emit('touch', {});
      return;
    }
    b.owner = p;
    b.vy = 0; b.y = CONFIG.BALL_R;
    this.possessionTeam = p.team;
    p.decisionTimer = 0.3 + rand() * 0.35;
    this.giveControl(p);
    this.emit('touch', {});
  }

  goalkeeperSave(gk, rel) {
    const b = this.ball;
    const fast = rel > 14;
    const lastShot = this.lastKick && this.lastKick.kind === 'shot' && this.lastKick.player.team !== gk.team;
    // probabilità di parata: tiri forti e angolati battono più spesso il portiere (più gol, 0.3.2)
    let chance = 0.44 + gk.attr.gk / 250 - Math.max(0, rel - 16) / 30;
    if (gk.data.ability === 'Para-rigori' && lastShot) chance += 0.08;
    if (!this.isHuman(gk.team)) chance += (this.difficulty - 1) * 0.05;
    if (!lastShot && !fast) chance = 1;  // palla lenta: presa sicura
    if (!this.onTouch(gk)) return;
    b.lastTouch = gk;
    if (rand() < chance) {
      if (lastShot) { gk.team.opponent().stats.onTarget++; this.emit('save', {}); this.showBanner('Parata!', 1.2); }
      if (!fast || rand() < 0.35) {
        b.owner = gk; b.vx = 0; b.vy = 0; b.vz = 0;
        this.possessionTeam = gk.team;
        gk.holdTime = 0;
        this.giveControl(gk);
      } else {
        // respinta
        const out = gk.team.dir;
        b.vx = out * randRange(4, 9); b.vz = (rand() < 0.5 ? -1 : 1) * randRange(3, 9); b.vy = randRange(1, 4);
        gk.kickCooldown = 0.6;
      }
    } else {
      gk.kickCooldown = 0.6; // non ci arriva: la palla prosegue
      b.vx *= 0.85; b.vz *= 0.85;
    }
  }

  // ---------- REGOLE: gol e palla fuori ----------
  checkBoundaries() {
    const b = this.ball, C = CONFIG;
    if (Math.abs(b.x) > C.HALF_L + C.BALL_R) {
      const side = Math.sign(b.x);
      const scorer = this.teams.find(t => t.dir === side);
      if (Math.abs(b.z) < C.GOAL_HALF_W && b.y < C.GOAL_H) {
        this.goal(scorer);
        return;
      }
      if (b.inNet) return;
      const defending = scorer.opponent();
      const last = b.lastTouch ? b.lastTouch.team : scorer;
      if (last === scorer) {
        this.whistle('GOAL_KICK', defending, side * (C.HALF_L - C.SMALL_BOX_DEPTH), Math.sign(b.z || 1) * 5);
      } else {
        scorer.stats.corners++;
        this.whistle('CORNER', scorer, side * (C.HALF_L - 0.5), Math.sign(b.z || 1) * (C.HALF_W - 0.5));
      }
      return;
    }
    if (Math.abs(b.z) > C.HALF_W + C.BALL_R) {
      const last = b.lastTouch ? b.lastTouch.team : this.teams[0];
      this.whistle('THROW_IN', last.opponent(), clamp(b.x, -C.HALF_L + 1, C.HALF_L - 1), Math.sign(b.z) * (C.HALF_W - 0.1));
    }
  }

  goal(team) {
    team.score++;
    // marcatore: chi ha toccato per ultimo, ma una parata non riuscita o una deviazione della squadra
    // che subisce non trasformano il tiro (o il passaggio) dell'attaccante in un autogol
    let scorerP = this.ball.lastTouch;
    const lk = this.lastKick && this.lastKick.player;
    if (scorerP && scorerP.team !== team && lk && lk.team === team) scorerP = lk;
    const own = !!scorerP && scorerP.team !== team;
    if (scorerP && !own) { scorerP.stats.goals++; }
    if (this.lastKick && this.lastKick.kind === 'shot' && !own) team.stats.onTarget++;
    const name = scorerP ? scorerP.data.name : '';
    this.lastGoal = { team: team, scorer: name, own: own, minute: this.minute() };
    this.log.push(this.lastGoal);
    this.ball.owner = null;
    this.offside = null;
    this.setState('GOAL');
    this.showBanner(own ? 'Autogol!' : 'GOL!', 3);
    this.emit('goal', { team: team.index });
  }

  // ---------- CONTROLLO UMANO ----------
  // input: { mx, mz (direzione sul campo, lunghezza 0..1), sprint, shoot (tenuto), press (pressing tenuto),
  //          switchDir ([x, z] colpetto della levetta destra), pressed: { pass, long, through, switch, shootDown } }
  handleHuman(h, dt) {
    const input = h.input;
    const pressed = input.pressed || {};
    const team = this.teams[h.team];
    let p = h.player;
    if (!p || p.team !== team || (this.controllerOf(p) !== h)) p = h.player = this.nearestFree(team, this.ball.x, this.ball.z, h);
    if (p && p.isGK && this.ball.owner !== p && this.state === 'PLAY') p = h.player = this.nearestFree(team, this.ball.x, this.ball.z, h);
    if (!p) return null;
    const b = this.ball;
    const freeMate = t => !t.isGK && t !== p && !this.humans.some(o => o !== h && o.player === t);
    // cambio giocatore (esclusi quelli dei compagni umani)
    if (pressed.switch && b.owner !== p) {
      // se un tuo passaggio è in viaggio, il primo cambio va a chi lo deve ricevere
      const pp = this.pendingPass;
      const recv = pp && pp.to && !b.owner && pp.to.team === team && freeMate(pp.to) ? pp.to : null;
      const cand = recv ? [recv] : team.players.filter(freeMate)
        .sort((a, c) => dist2(a.x, a.z, b.x, b.z) - dist2(c.x, c.z, b.x, b.z));
      if (cand[0]) { p = h.player = cand[0]; this.emit('switch', { id: h.id }); }
    } else if (input.switchDir && b.owner !== p) {
      // levetta destra: il compagno nella direzione indicata
      const sx = input.switchDir[0], sz = input.switchDir[1];
      let best = null, bs = -1e9;
      for (const t of team.players) {
        if (!freeMate(t)) continue;
        const vx = t.x - p.x, vz = t.z - p.z, d = len(vx, vz) || 1;
        const cos = (vx * sx + vz * sz) / d;
        if (cos < 0.5) continue;
        const sc = cos * 2 - d / 35;
        if (sc > bs) { bs = sc; best = t; }
      }
      if (best) { p = h.player = best; this.emit('switch', { id: h.id }); }
    }
    // tiro: un tocco rapidissimo (premuto e rilasciato tra due passi) conta comunque come tiro debole
    const shootHeld = !!input.shoot || !!pressed.shootDown;
    // in un piazzato il battitore umano mira e batte
    if (this.state === 'SETPIECE' || this.state === 'KICKOFF') {
      if (this.setPiece.taker !== p) return null;
      if (!this.setPieceReady) { h.prevShoot = shootHeld; return p; }
      this.humanSetPieceInput(p, h, dt);
      return p;
    }
    if (this.state !== 'PLAY') { h.shootCharge = 0; h.prevShoot = shootHeld; return p; }
    const dirX = input.mx, dirZ = input.mz;
    const hasDir = len(dirX, dirZ) > 0.2;
    if (b.owner === p && p.isGK) {
      // portiere umano: può solo rinviare; dopo qualche secondo rinvia da solo
      p.vx *= 0.8; p.vz *= 0.8;
      h.gkHold = (h.gkHold || 0) + dt;
      if (pressed.pass) this.humanPass(p, input, 'pass');
      else if (pressed.long || pressed.through || h.gkHold > 6) this.humanPass(p, input, 'lob');
      if (b.owner !== p) h.gkHold = 0;
      h.prevShoot = shootHeld;
      return p;
    }
    h.gkHold = 0;
    const opp = b.owner && b.owner.team !== team ? b.owner : null;
    const pp = this.pendingPass;
    if (input.press && !(b.owner && b.owner.team === team)) {
      // pressing assistito: va da solo sul portatore (restando tra lui e la porta) o sulla palla libera
      let tx, tz;
      if (opp) {
        const gx = team.ownGoalX(), gx2 = gx - opp.x, gz2 = -opp.z, gd = len(gx2, gz2) || 1;
        tx = opp.x + gx2 / gd * 0.9 + opp.vx * 0.25; tz = opp.z + gz2 / gd * 0.9 + opp.vz * 0.25;
      } else {
        tx = p.icX !== undefined ? p.icX : b.x; tz = p.icZ !== undefined ? p.icZ : b.z;
      }
      tx = clamp(tx, -CONFIG.HALF_L - 0.5, CONFIG.HALF_L + 0.5); tz = clamp(tz, -CONFIG.HALF_W - 0.5, CONFIG.HALF_W + 0.5);
      p.moveToward(tx, tz, input.sprint, dt, true);
      if (opp) p.faceTo(opp.x, opp.z, dt, 8);
    } else if (!hasDir && h.assist !== false && !b.owner && pp && pp.to === p && pp.from.team === team && p.icTime < 4) {
      // aiuto alla ricezione: senza direzione chi deve ricevere va incontro alla palla
      p.moveToward(p.icX, p.icZ, input.sprint, dt, true);
    } else p.moveDir(dirX, dirZ, input.sprint, dt);
    if (b.owner === p) {
      if (pressed.pass) this.humanPass(p, input, 'pass');
      else if (pressed.long) this.humanPass(p, input, 'lob');
      else if (pressed.through) this.humanPass(p, input, 'through');
      // tiro con carica: tieni premuto e rilascia
      else {
        if (shootHeld) h.shootCharge = Math.min(1, h.shootCharge + dt / 0.9);
        if (!shootHeld && h.prevShoot && h.shootCharge > 0) {
          doShot(p, this.humanShotAim(p, input), Math.max(0.25, h.shootCharge));
          h.shootCharge = 0;
        }
      }
    } else {
      // senza palla la carica del tiro si azzera
      h.shootCharge = 0;
      // difesa: contrasto (passaggio) o scivolata (tiro)
      if (opp && !opp.isGK && p.tackleCooldown <= 0) {
        const d = dist2(p.x, p.z, opp.x, opp.z);
        if (pressed.pass) {
          p.anim.tackle = 0.35;
          // troppo lontano: si vede il gesto ma non si perde tempo (niente penalità)
          if (d > 2.6) p.tackleCooldown = 0.25;
          else this.resolveTackle(p, opp, false);
        } else if (pressed.shootDown) {
          p.vx += Math.cos(p.facing) * 3; p.vz += Math.sin(p.facing) * 3;
          this.resolveTackle(p, opp, true);
        }
      }
    }
    h.prevShoot = shootHeld;
    return p;
  }

  // mira del tiro umano: direzione verso il palo in alto o in basso; senza direzione laterale
  // (o spingendo solo verso la porta) il tiro va nell'angolo più lontano dal portiere
  humanShotAim(p, input) {
    const W = CONFIG.GOAL_HALF_W - 0.4;
    const mz = input.mz || 0;
    if (Math.abs(mz) < 0.3) return chooseShotAim(p);
    return Math.sign(mz) * W * clamp(0.55 + (Math.abs(mz) - 0.3) / 0.4 * 0.45, 0.55, 1);
  }

  // sceglie il compagno nella direzione indicata; senza direzione il migliore disponibile
  humanPass(p, input, kind) {
    const team = p.team;
    let dx = input.mx, dz = input.mz;
    const pU = team.uOf(p.x);
    const lobKind = tz => (pU > 80 && Math.abs(p.z) > 12 && Math.abs(tz) < 18 ? 'cross' : 'lob');
    if (len(dx, dz) < 0.2) {
      // nessuna direzione: stessa valutazione dell'IA (linee di passaggio libere), così la palla non va a nessuno
      const opts = evaluatePasses(p, { long: kind === 'lob' });
      let o = null;
      if (kind === 'through') o = opts.find(x => x.kind === 'through');
      else if (kind === 'lob') o = opts.find(x => dist2(p.x, p.z, x.x, x.z) > 18);
      else o = opts.find(x => !x.lob);
      if (!o) o = opts[0];
      if (!o) {
        // nessuna opzione libera: il compagno più vicino
        let nb = null, nd = 1e9;
        for (const m of team.players) {
          if (m === p || m.isGK) continue;
          const d = dist2(p.x, p.z, m.x, m.z);
          if (d < nd) { nd = d; nb = m; }
        }
        if (nb) o = { mate: nb, x: nb.x, z: nb.z, lob: nd > 30 };
      }
      if (o) {
        if (kind === 'lob' || o.lob) doLobPass(p, o.x, o.z, o.mate, lobKind(o.z));
        else doGroundPass(p, o.x, o.z, o.mate);
        return;
      }
      dx = Math.cos(p.facing); dz = Math.sin(p.facing);
    }
    const dl = len(dx, dz); dx /= dl; dz /= dl;
    let best = null, bs = -1e9;
    for (const m of team.players) {
      if (m === p) continue;
      const vx = m.x - p.x, vz = m.z - p.z;
      const d = len(vx, vz);
      if (d < 3) continue;
      const cos = (vx * dx + vz * dz) / d;
      if (cos < 0.45) continue;
      const wantFar = kind === 'lob' ? d / 40 : -d / 45;
      const s = cos * 2.2 + wantFar;
      if (s > bs) { bs = s; best = m; }
    }
    if (!best) {
      const tx = p.x + dx * (kind === 'lob' ? 30 : 14), tz = p.z + dz * (kind === 'lob' ? 30 : 14);
      if (kind === 'lob') doLobPass(p, tx, tz, null, 'lob'); else doGroundPass(p, tx, tz, null);
      return;
    }
    const d = dist2(p.x, p.z, best.x, best.z);
    const lead = Math.min(d / 16, 1.2);
    let tx = best.x + best.vx * lead, tz = best.z + best.vz * lead;
    if (kind === 'through') { tx += team.dir * 7; }
    if (kind === 'lob') doLobPass(p, tx, tz, best, lobKind(tz));
    else doGroundPass(p, tx, tz, best);
  }

  humanSetPieceInput(p, h, dt) {
    const input = h.input;
    const pressed = input.pressed || {};
    const sp = this.setPiece;
    const shootHeld = !!input.shoot || !!pressed.shootDown;
    const fire = pressed.pass || pressed.long || pressed.through;
    if (sp.type === 'PENALTY' || sp.type === 'FREE_KICK') {
      if (shootHeld) h.shootCharge = Math.min(1, h.shootCharge + dt / 0.9);
      if (!shootHeld && h.prevShoot && h.shootCharge > 0) {
        doShot(p, this.humanShotAim(p, input), Math.max(0.3, h.shootCharge));
        if (sp.type === 'FREE_KICK') this.ball.spin = -Math.sign(this.ball.vz || 1) * 0.6 * p.attr.shot / 100;
        h.shootCharge = 0;
        h.prevShoot = shootHeld;
        this.afterSetPieceKick();
        return true;
      }
      h.prevShoot = shootHeld;
    }
    if (fire && sp.type !== 'PENALTY') {
      const noDir = len(input.mx, input.mz) < 0.2;
      if (sp.type === 'THROW_IN') {
        let dx = input.mx, dz = input.mz;
        if (noDir) { dx = p.team.dir; dz = -Math.sign(sp.z) * 0.6; }
        const best = this.humanPickMate(p, dx, dz);
        if (best) this.doThrow(p, best.x, best.z, best); else this.doThrow(p, p.x + dx * 12, p.z + dz * 12, null);
      } else if (sp.type === 'CORNER' && noDir && !pressed.pass) {
        // cross dalla bandierina senza direzione: verso un compagno in area, come farebbe l'IA
        const team = p.team, targets = team.players.filter(t => t !== p && inBoxOf(team.opponent(), t.x, t.z));
        const tgt = targets.length ? pick(targets) : null;
        doLobPass(p, tgt ? tgt.x : team.oppGoalX() - team.dir * 9, tgt ? tgt.z : randRange(-4, 4), tgt, 'cross');
      } else {
        this.humanPass(p, input, pressed.pass ? 'pass' : pressed.through ? 'through' : 'lob');
      }
      this.afterSetPieceKick();
      return true;
    }
    return false;
  }
  humanPickMate(p, dx, dz) {
    let best = null, bs = -1e9;
    const dl = len(dx, dz) || 1;
    for (const m of p.team.players) {
      if (m === p) continue;
      const vx = m.x - p.x, vz = m.z - p.z, d = len(vx, vz);
      const cos = (vx * dx + vz * dz) / (d * dl);
      if (cos < 0.3 || d > 30) continue;
      if (cos * 2 - d / 30 > bs) { bs = cos * 2 - d / 30; best = m; }
    }
    return best;
  }
  afterSetPieceKick() {
    this.setState('PLAY');
    this.setPieceReady = false;
  }

  // ---------- CICLO PRINCIPALE ----------
  // input: (compatibilità) comandi del primo umano; per più umani si imposta h.input su ognuno
  update(dt, input) {
    if (input && this.humans.length) this.humans[0].input = input;
    // posizioni del passo precedente: la grafica disegna a metà tra i due passi (movimento fluido a ogni fps)
    const b0 = this.ball;
    b0.px = b0.x; b0.py = b0.y; b0.pz = b0.z;
    for (const t of this.teams) for (const p of t.players) { p.px = p.x; p.pz = p.z; p.pf = p.facing; p.pph = p.anim.phase; }
    this.realTime += dt;
    this.stateTime += dt;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    const b = this.ball;

    if (this.state === 'FULLTIME') return;

    if (this.state === 'HALFTIME') {
      if (this.stateTime > 3) {
        this.half = 2; this.clock = 0;
        for (const t of this.teams) t.dir *= -1;
        this.startKickoff(this.teams[1]);
      }
      return;
    }
    if (this.state === 'GOAL') {
      this.stepBallFree(dt);
      for (const p of this.allPlayers()) {
        // festeggiamenti: chi ha segnato corre, gli altri rallentano
        p.moveToward(p.x, p.z, false, dt);
        p.update(dt);
      }
      this.recordReplay();
      if (this.stateTime > (this.goalPause || 3.5)) {
        const conceded = this.lastGoal.team.opponent();
        if (this.checkHalfEnd()) return;
        this.startKickoff(conceded);
      }
      return;
    }

    // previsione della palla e intercetti (10 volte al secondo)
    this.predTimer -= dt;
    if (this.predTimer <= 0) {
      this.predTimer = 0.1;
      this.pred = predictBall(b, 3.5, 0.1);
      computeIntercepts(this);
      aiAssignRoles(this.teams[0]);
      aiAssignRoles(this.teams[1]);
    }

    // calciatori guidati dagli umani in questo passo
    const humanSet = new Map();
    for (const h of this.humans) {
      if (!h.input) continue;
      const hp = this.handleHuman(h, dt);
      if (hp) humanSet.set(hp, h);
    }

    if (this.state === 'DEAD') {
      // palla ferma dopo il fischio: tutti rallentano
      for (const p of this.allPlayers()) { p.moveToward(p.x + p.vx * 0.3, p.z + p.vz * 0.3, false, dt); p.update(dt); }
      if (!b.owner) { this.stepBallFree(dt); b.vx *= 0.9; b.vz *= 0.9; }
      if (this.stateTime > 1.2) this.startSetPiece();
      this.advanceClock(dt);
      return;
    }

    if (this.state === 'SETPIECE' || this.state === 'KICKOFF') {
      const sp = this.setPiece;
      const spot = this.state === 'KICKOFF' ? { x: -sp.team.dir * 0.4, z: 0 } : this.setPieceTakerSpot(sp);
      for (const p of this.allPlayers()) {
        if (p === sp.taker) {
          p.moveToward(spot.x, spot.z, true, dt, true);
          if (dist2(p.x, p.z, spot.x, spot.z) < 0.3 || this.stateTime > 4) {
            p.x = spot.x; p.z = spot.z; p.vx = 0; p.vz = 0;
          }
          p.faceTo(b.x, b.z, dt, 12);
          const hh = humanSet.get(p);
          if (hh && len(hh.input.mx, hh.input.mz) > 0.2) p.facing = Math.atan2(hh.input.mz, hh.input.mx);
        } else if (this.state === 'SETPIECE' && sp.type !== 'PENALTY') {
          if (p.isGK) aiGoalkeeper(p, dt);
          else {
            const t = this.setPiecePosition(p);
            p.moveToward(t.x, t.z, dist2(p.x, p.z, t.x, t.z) > 6, dt);
          }
        } else {
          p.moveToward(p.x, p.z, false, dt);
          if (sp.type === 'PENALTY' && p.isGK) { p.z = 0; }
        }
        p.update(dt);
      }
      this.separate();
      const takerReady = dist2(sp.taker.x, sp.taker.z, spot.x, spot.z) < 0.35;
      const minWait = this.state === 'KICKOFF' ? 1.3 : (sp.type === 'PENALTY' ? 2.0 : 1.8);
      if (takerReady && this.stateTime > minWait) {
        this.setPieceReady = true;
        const humanTaker = humanSet.has(sp.taker);
        if (!humanTaker || this.stateTime > minWait + 10) {
          this.executeSetPieceAI();
          this.setState('PLAY');
          this.setPieceReady = false;
          if (sp.type === 'PENALTY') this.penaltyGKDive(sp);
        } else if (this.state === 'PLAY' && sp.type === 'PENALTY') this.penaltyGKDive(sp);
      }
      if (this.state === 'SETPIECE') this.advanceClock(dt);
      this.recordReplay();
      return;
    }

    // ----- GIOCO IN CORSO -----
    for (const p of this.allPlayers()) {
      if (!humanSet.has(p)) aiUpdatePlayer(p, dt);
      p.update(dt);
      // nessuno esce troppo dal campo
      p.x = clamp(p.x, -CONFIG.HALF_L - 3, CONFIG.HALF_L + 3);
      p.z = clamp(p.z, -CONFIG.HALF_W - 3, CONFIG.HALF_W + 3);
    }
    this.separate();

    if (b.owner) {
      const o = b.owner;
      if (o.isGK && inBoxOf(o.team, o.x, o.z)) {
        b.x = o.x + Math.cos(o.facing) * 0.35; b.z = o.z + Math.sin(o.facing) * 0.35; b.y = 1.0;
      } else {
        const off = 0.55 + 0.18 * Math.abs(Math.sin(o.anim.phase));
        b.x = o.x + Math.cos(o.facing) * off; b.z = o.z + Math.sin(o.facing) * off; b.y = CONFIG.BALL_R;
      }
      b.vx = o.vx; b.vz = o.vz; b.vy = 0;
      this.possessionTeam.stats.possession += dt;
    } else {
      this.stepBallFree(dt);
      this.checkBallContact();
      if (this.possessionTeam) this.possessionTeam.stats.possession += dt;
    }
    if (this.state === 'PLAY') this.checkBoundaries();

    // sicurezza: palla ferma e nessuno la prende per troppo tempo
    if (!b.owner && b.speed() < 0.2) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.stuckTimer > 8 && this.state === 'PLAY') {
      this.stuckTimer = 0;
      const t = this.teams[rand() < 0.5 ? 0 : 1];
      this.whistle('FREE_KICK', t, clamp(b.x, -50, 50), clamp(b.z, -32, 32), 'Ripresa del gioco');
    }
    this.advanceClock(dt);
    if (this.state === 'PLAY') this.checkHalfEnd();
    this.recordReplay();
  }

  stepBallFree(dt) {
    const b = this.ball;
    const sub = 4;
    for (let i = 0; i < sub; i++) {
      stepBallPhysics(b, dt / sub);
      if (collideGoalFrame(b)) this.emit('post', {});
    }
  }

  advanceClock(dt) {
    this.clock += dt * this.gameSecondsPerReal;
  }

  checkHalfEnd() {
    if (this.clock < 2700) return false;
    if (this.half === 1) {
      this.setState('HALFTIME');
      this.showBanner('Fine primo tempo', 3);
      this.emit('whistle', { type: 'HALF' });
    } else {
      this.setState('FULLTIME');
      this.showBanner('Fine partita', 5);
      this.emit('whistle', { type: 'END' });
    }
    return true;
  }

  penaltyGKDive(sp) {
    const gk = sp.team.opponent().gk;
    // il portiere indovina il lato con una certa probabilità
    const ballDir = Math.sign(this.ball.vz || 1);
    let guess = rand() < 0.4 + gk.attr.gk / 500 ? ballDir : -ballDir;
    // se la squadra del portiere ha un umano che tiene una direzione, il tuffo lo sceglie lui
    const hd = this.humans.find(h => h.team === gk.team.index && h.input && Math.abs(h.input.mz) > 0.3);
    if (hd) guess = Math.sign(hd.input.mz);
    gk.anim.dive = 0.9; gk.anim.diveDir = guess * gk.team.dir;
    gk.vz = guess * 4.2;
    gk.commitTimer = 0.9; // resta sulla scelta fatta
  }

  // i giocatori non si compenetrano
  separate() {
    const ps = this.allPlayers();
    const minD = CONFIG.PLAYER_RADIUS * 2;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const dx = c.x - a.x, dz = c.z - a.z;
        const d = len(dx, dz);
        if (d < minD && d > 0.0001) {
          const push = (minD - d) / 2;
          a.x -= dx / d * push; a.z -= dz / d * push;
          c.x += dx / d * push; c.z += dz / d * push;
        }
      }
    }
  }

  // registra un fotogramma per il replay
  recordReplay() {
    const ps = this.allPlayers();
    // il fotogramma più vecchio viene riusato: niente memoria nuova 60 volte al secondo (meno scatti del garbage collector)
    const size = 3 + ps.length * 7;
    const f = this.replay.length >= this.replayMax && this.replay[0].length === size ? this.replay.shift() : new Float32Array(size);
    f[0] = this.ball.x; f[1] = this.ball.y; f[2] = this.ball.z;
    let k = 3;
    for (const p of ps) {
      f[k++] = p.x; f[k++] = p.z; f[k++] = p.facing; f[k++] = p.anim.phase;
      f[k++] = p.speed(); f[k++] = p.anim.kick; f[k++] = p.anim.dive > 0 ? p.anim.diveDir : 0;
    }
    this.replay.push(f);
    while (this.replay.length > this.replayMax) this.replay.shift();
  }
}
