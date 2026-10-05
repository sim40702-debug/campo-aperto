// ============================================================
// PARTITA — stati, regole e ciclo di simulazione
// Stati: KICKOFF, PLAY, DEAD (palla ferma dopo fischio), SETPIECE, GOAL, HALFTIME, FULLTIME
// ============================================================
const SETPIECE_NAMES = {
  KICKOFF: "Calcio d'inizio", THROW_IN: 'Rimessa laterale', CORNER: "Calcio d'angolo",
  GOAL_KICK: 'Rinvio dal fondo', FREE_KICK: 'Punizione', PENALTY: 'Calcio di rigore',
};

class Match {
  // opts.rng: generatore casuale proprio della partita (makeRng(seme)). Con lo stesso seme la partita si ripete
  // identica, anche se intanto altro codice usa rand(): così il server la calcola e i client la rivedono uguale.
  constructor(homeData, awayData, opts) {
    this.rng = (opts && opts.rng) || null;
    this.withRng(() => this.setup(homeData, awayData, opts));
  }
  withRng(fn) {
    if (!this.rng) return fn();
    const prev = rand;
    rand = this.rng;
    try { return fn(); } finally { rand = prev; }
  }

  setup(homeData, awayData, opts) {
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
    this.timeline = [];            // registro degli eventi di partita (gol, falli, cartellini, piazzati...)
    this.advantage = null;         // vantaggio in corso dopo un fallo
    this.pendingCards = [];        // cartellini da mostrare alla prossima interruzione
    this.bannerQueue = [];
    this.deadPause = 1.2;
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

  // calciatori in campo (senza gli espulsi)
  allPlayers() { return this.teams[0].players.concat(this.teams[1].players); }
  // tutti i 22, sempre nello stesso ordine: per rete, replay e grafica
  allSlots() { return this.teams[0].roster.concat(this.teams[1].roster); }
  emit(type, data) { this.events.push({ type: type, data: data }); }
  // kind: goal, foul, yellow, red, advantage, offside, penalty, info (stile della scritta)
  showBanner(text, secs, kind) { this.banner = { text: text, t: secs || 2, kind: kind || 'info' }; this.bannerQueue.length = 0; }
  queueBanner(text, secs, kind) {
    if (this.banner && this.banner.t > 0.3) this.bannerQueue.push({ text: text, t: secs || 2, kind: kind || 'info' });
    else this.banner = { text: text, t: secs || 2, kind: kind || 'info' };
  }
  // registro centrale degli eventi di partita: con tempo, giocatori, squadra, posizione, motivo e conseguenza.
  // Ogni evento va anche agli eventi del passo ('ref'): audio e grafica locali, e ai client in rete.
  matchEvent(type, info) {
    info = info || {};
    const slots = this.allSlots();
    const who = q => q ? { id: slots.indexOf(q), num: q.data.number, name: q.data.name, team: q.team.index } : null;
    const r1 = v => Math.round(v * 10) / 10;
    const ev = {
      type: type, minute: this.minute(), half: this.half, clock: Math.round(this.clock),
      team: info.team ? info.team.index : info.player ? info.player.team.index : -1,
      player: who(info.player), victim: who(info.victim),
      x: r1(info.x !== undefined ? info.x : this.ball.x), z: r1(info.z !== undefined ? info.z : this.ball.z),
      t: Math.round(this.realTime * 1000) / 1000,   // secondi reali dal calcio d'inizio (per rivelare gli eventi al momento giusto)
      reason: info.reason || '', severity: info.severity || 0, consequence: info.consequence || '',
    };
    this.timeline.push(ev);
    if (this.timeline.length > 300) this.timeline.shift();
    this.emit('ref', ev);
    return ev;
  }
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
    this.advantage = null;
    this.matchEvent('KICK_OFF', { team: team, x: 0, z: 0 });
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
  // kind: stile della scritta; reason: motivo registrato nell'evento. I cartellini in sospeso si mostrano adesso.
  whistle(type, team, x, z, text, kind, reason) {
    this.setState('DEAD');
    this.pendingSetPiece = { type: type, team: team, x: x, z: z };
    this.ball.owner = null;
    this.offside = null; this.pendingPass = null;
    this.advantage = null;
    this.showBanner(text || SETPIECE_NAMES[type], 2, kind || 'info');
    this.emit('whistle', { type: type });
    this.matchEvent(type, { team: team, x: x, z: z, reason: reason || text || '' });
    // con un cartellino la ripresa aspetta che l'arbitro lo mostri
    this.deadPause = 1.2 + this.issuePendingCards() * 1.6;
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
        doShot(p, chooseShotAim(p), 0.75, { curl: true });
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
    // la posizione conta nel momento in cui il compagno gioca il pallone (anche al tiro: vale per le ribattute)
    if (!setKinds) {
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
    // la squadra che ha avuto il vantaggio arriva al tiro: il vantaggio si è concretizzato
    if (this.advantage && kind === 'shot' && p.team === this.advantage.team) this.advantage = null;
    this.lastKick = { player: p, kind: kind, time: this.realTime };
    if (kind === 'shot') this.matchEvent('SHOT', { player: p, x: p.x, z: p.z });
  }

  // chiamata ad ogni tocco di palla: restituisce false se il gioco si ferma (fuorigioco, vantaggio non concretizzato).
  // deflect: parata o deviazione di un avversario, che non annulla un fuorigioco già in corso (regola 11)
  onTouch(p, deflect) {
    if (this.offside && this.offside.team === p.team && this.offside.players.has(p)) {
      p.team.stats.offsides++;
      const ox = clamp(p.x, -CONFIG.HALF_L + 1, CONFIG.HALF_L - 1), oz = clamp(p.z, -CONFIG.HALF_W + 1, CONFIG.HALF_W - 1);
      this.matchEvent('OFFSIDE', { player: p, x: ox, z: oz, reason: 'Fuorigioco', consequence: 'FREE_KICK' });
      this.whistle('FREE_KICK', p.team.opponent(), ox, oz, 'Fuorigioco', 'offside', 'Fuorigioco');
      return false;
    }
    if (this.advantage && p.team !== this.advantage.team && this.realTime <= this.advantage.until) {
      this.callBackAdvantage();
      return false;
    }
    if (!(deflect && this.offside && this.offside.team !== p.team)) this.offside = null;
    if (this.pendingPass && this.pendingPass.from !== p) {
      if (this.pendingPass.from.team === p.team) { this.pendingPass.from.stats.passesOk++; p.team.stats.passesOk++; }
      this.pendingPass = null;
    }
    return true;
  }

  // ---------- CONTRASTI E ARBITRO ----------
  // contrasto: tackler interviene sul portatore, in piedi o in scivolata. L'esito fisico (pallone toccato o no,
  // contatto o no) viene da analyzeChallenge, la decisione da evaluateChallenge: il contatto da solo non è fallo.
  resolveTackle(tackler, carrier, sliding) {
    const kind = sliding ? 'slide' : 'stand';
    tackler.tackleCooldown = sliding ? 1.2 : 0.7;
    tackler.anim.tackle = sliding ? 0.8 : 0.35;
    const c = analyzeChallenge(this, tackler, carrier, kind);
    const d = evaluateChallenge(c);
    this.lastChallenge = { challenge: c, decision: d };
    if (d.foul) { this.applyFoul(tackler, carrier, d, c); return d; }
    if (c.ballPlayed) {
      tackler.stats.tackles++;
      this.emit('tackle', { contact: c.contact, sev: d.severity, slide: sliding });
      const b = this.ball;
      if (!sliding && rand() < 0.45 + tackler.attr.defense / 250) {
        // in piedi spesso il difensore resta con il pallone
        b.owner = tackler; b.lastTouch = tackler;
        this.possessionTeam = tackler.team;
        if (this.onTouch(tackler)) this.giveControl(tackler);
      } else {
        // pallone allontanato nella direzione dell'intervento
        const a = Math.atan2(b.z - tackler.z, b.x - tackler.x) + randRange(-0.5, 0.5);
        const v = sliding ? randRange(5, 9) : randRange(3.5, 7);
        b.kick(Math.cos(a) * v, 0.4, Math.sin(a) * v, tackler, 0);
        this.onTouch(tackler);
      }
      carrier.stunned = c.contact ? 0.55 : 0.3;
      if (c.contact && d.severity > 0.45) carrier.anim.fall = 1.0;
    } else {
      // a vuoto: chi interviene perde tempo, in scivolata resta a terra
      tackler.stunned = sliding ? 1.0 : 0.45;
    }
    return d;
  }

  // fallo fischiato direttamente (compatibilità e prove): fallo semplice, senza vantaggio
  foul(tackler, victim) {
    return this.applyFoul(tackler, victim, { legal: false, foul: true, advantage: false, yellow_card: false, red_card: false, severity: 0.35, reason: 'Contrasto irregolare' }, null, true);
  }

  // un fallo è stato commesso: vantaggio oppure fischio (punizione o rigore), con l'eventuale cartellino
  applyFoul(offender, victim, d, c, noAdvantage) {
    c = c || challengeContext(this, offender, victim);
    offender.team.stats.fouls++;
    offender.stunned = Math.max(offender.stunned, 0.6);
    victim.stunned = Math.max(victim.stunned, 0.9);
    victim.anim.fall = 1.1;
    const b = this.ball;
    if (b.owner === victim) { b.owner = null; b.vx = victim.vx * 0.7; b.vz = victim.vz * 0.7; }
    const card = d.red_card ? 'red' : d.yellow_card ? 'yellow' : null;
    const ev = this.matchEvent('FOUL', { player: offender, victim: victim, x: c.x, z: c.z, reason: d.reason, severity: d.severity, consequence: c.inPenaltyArea ? 'PENALTY' : 'FREE_KICK' });
    if (card) this.pendingCards.push({ player: offender, type: card, reason: d.reason });
    // vantaggio: mai per rigori, rossi o occasioni da rete negate (lì conviene il fischio)
    if (!noAdvantage && !c.inPenaltyArea && !d.red_card && !c.dogso && this.advantagePossible(victim.team, c.x)) {
      d.advantage = true;
      ev.consequence = 'ADVANTAGE';
      this.advantage = { team: victim.team, offender: offender, victim: victim, x: c.x, z: c.z, reason: d.reason, until: this.realTime + REF.ADVANTAGE_SECS };
      this.matchEvent('ADVANTAGE', { team: victim.team, player: offender, victim: victim, x: c.x, z: c.z, reason: d.reason });
      this.showBanner('Vantaggio', 1.8, 'advantage');
      return d;
    }
    this.callFoul(offender, victim.team, c.x, c.z, c.inPenaltyArea, d.reason);
    return d;
  }

  callFoul(offender, team, x, z, penalty, reason) {
    if (penalty) {
      const def = offender.team;
      this.whistle('PENALTY', team, def.ownGoalX() + def.dir * CONFIG.PENALTY_SPOT, 0, 'Calcio di rigore', 'penalty', reason);
    } else this.whistle('FREE_KICK', team, x, z, 'Fallo — ' + reason, 'foul', reason);
  }

  // c'è un chiaro vantaggio? nella metà campo d'attacco, con un compagno che arriva prima di tutti sul pallone
  // (chi ha subito il fallo è a terra e non conta, chi l'ha commesso nemmeno)
  advantagePossible(team, x) {
    if (team.uOf(x) < CONFIG.HALF_L) return false;
    const b = this.ball;
    let mate = 1e9, opp = 1e9;
    for (const p of this.allPlayers()) {
      if (p.stunned > 0) continue;
      const d = dist2(p.x, p.z, b.x, b.z);
      if (p.team === team) mate = Math.min(mate, d); else opp = Math.min(opp, d);
    }
    return mate < 5 && mate + 1.5 < opp;
  }

  // il vantaggio non si è concretizzato: si torna al punto del fallo
  callBackAdvantage() {
    const a = this.advantage;
    this.advantage = null;
    this.matchEvent('FOUL', { player: a.offender, victim: a.victim, x: a.x, z: a.z, reason: 'Vantaggio non concretizzato', consequence: 'FREE_KICK' });
    this.callFoul(a.offender, a.team, a.x, a.z, false, a.reason);
  }

  updateAdvantage() {
    const a = this.advantage;
    if (!a || this.realTime <= a.until) return;
    // vantaggio concretizzato: si gioca; l'eventuale cartellino arriverà alla prossima interruzione
    this.advantage = null;
  }

  // mostra i cartellini in sospeso; restituisce quanti ne ha mostrati
  issuePendingCards() {
    const list = this.pendingCards;
    this.pendingCards = [];
    for (const pc of list) this.issueCard(pc.player, pc.type, pc.reason);
    return list.length;
  }

  issueCard(p, type, reason) {
    if (p.sentOff) return;
    const name = p.data.name;
    if (type === 'yellow') {
      p.cards.yellow++;
      p.team.stats.yellow++;
      if (p.cards.yellow >= 2) {
        this.matchEvent('SECOND_YELLOW', { player: p, reason: reason, consequence: 'RED_CARD' });
        this.matchEvent('RED_CARD', { player: p, reason: 'Doppia ammonizione', consequence: 'SENT_OFF' });
        this.queueBanner('Secondo giallo — ' + name + ' espulso', 2.2, 'red');
        this.sendOff(p);
        return;
      }
      this.matchEvent('YELLOW_CARD', { player: p, reason: reason });
      this.queueBanner('Cartellino giallo — ' + name, 1.8, 'yellow');
    } else {
      this.matchEvent('RED_CARD', { player: p, reason: reason, consequence: 'SENT_OFF' });
      this.queueBanner('Cartellino rosso — ' + name, 2.2, 'red');
      this.sendOff(p);
    }
  }

  // espulsione: il calciatore lascia il campo e la squadra gioca in dieci
  sendOff(p) {
    const team = p.team;
    p.sentOff = true; p.cards.red = true;
    team.stats.red++;
    team.players = team.players.filter(q => q !== p);
    if (this.ball.owner === p) this.ball.owner = null;
    if (team.chaser === p) team.chaser = null;
    if (team.presser === p) team.presser = null;
    if (team.cover === p) team.cover = null;
    if (this.offside) this.offside.players.delete(p);
    if (this.pendingPass && (this.pendingPass.from === p || this.pendingPass.to === p)) this.pendingPass = null;
    if (p.isGK && team.players.length) {
      // portiere espulso: in porta va il difensore più arretrato
      const sub = team.players.filter(q => q.slot.role === 'DF').sort((a, c) => team.uOf(a.x) - team.uOf(c.x))[0] || team.players[0];
      sub.isGK = true; sub.slot = p.slot;
      team.players = [sub].concat(team.players.filter(q => q !== sub));
    }
    for (const h of this.humans) if (h.player === p) h.player = this.nearestFree(team, this.ball.x, this.ball.z, h);
  }

  // gli espulsi escono camminando verso la panchina, poi spariscono dal campo
  walkOff(dt) {
    for (const t of this.teams) for (const p of t.roster) {
      if (!p.sentOff || p.gone) continue;
      const tx = clamp(p.x, -12, 12), tz = -(CONFIG.HALF_W + 5);
      p.moveToward(tx, tz, false, dt);
      p.update(dt);
      if (dist2(p.x, p.z, tx, tz) < 1) p.gone = true;
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
    const comfy = 8 + p.attr.dribble * 0.08;
    if (rel > comfy && rel <= limit && b.y < 0.6) {
      // controllo lungo: il pallone non si ferma al piede e scappa avanti di qualche metro
      const s = Math.min(6, (rel - comfy) * 0.45);
      const f = p.speed() > 1 ? Math.atan2(p.vz, p.vx) : p.facing;
      b.vx = p.vx + Math.cos(f) * s; b.vz = p.vz + Math.sin(f) * s; b.vy = 0; b.y = CONFIG.BALL_R;
      b.spin = 0; b.topspin = 0;
      p.kickCooldown = 0.18;
      this.possessionTeam = p.team;
      this.giveControl(p);
      this.emit('touch', {});
      return;
    }
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
    // (velocità d'arrivo: con la resistenza dell'aria un tiro da 30 m/s arriva in porta a circa 24 m/s da 18 metri)
    let chance = 0.44 + gk.attr.gk / 250 - Math.max(0, rel - 14) / 26;
    if (gk.data.ability === 'Para-rigori' && lastShot) chance += 0.08;
    if (!this.isHuman(gk.team)) chance += (this.difficulty - 1) * 0.05;
    if (!lastShot && !fast) chance = 1;  // palla lenta: presa sicura
    if (!this.onTouch(gk, true)) return;
    b.lastTouch = gk;
    if (rand() < chance) {
      if (lastShot) {
        gk.team.opponent().stats.onTarget++;
        this.matchEvent('SHOT_ON_TARGET', { player: this.lastKick.player, reason: 'Parata', consequence: 'SAVE' });
        this.emit('save', {}); this.showBanner('Parata!', 1.2);
      }
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
    if (this.lastKick && this.lastKick.kind === 'shot' && !own) {
      team.stats.onTarget++;
      this.matchEvent('SHOT_ON_TARGET', { player: this.lastKick.player, consequence: 'GOAL' });
    }
    const name = scorerP ? scorerP.data.name : '';
    this.lastGoal = { team: team, scorer: name, own: own, minute: this.minute() };
    this.log.push(this.lastGoal);
    this.ball.owner = null;
    this.offside = null;
    this.advantage = null;
    this.setState('GOAL');
    this.showBanner(own ? 'Autogol!' : 'GOL!', 3, 'goal');
    this.emit('goal', { team: team.index });
    this.matchEvent('GOAL', { team: team, player: scorerP, reason: own ? 'Autogol' : '', consequence: 'KICK_OFF' });
    this.issuePendingCards();
  }

  // ---------- CONTROLLO UMANO ----------
  // input: { mx, mz (direzione sul campo, lunghezza 0..1), sprint, shoot (tenuto), press (pressing tenuto),
  //          switchDir ([x, z] colpetto della levetta destra), pressed: { pass, long, through, switch, shootDown } }
  handleHuman(h, dt) {
    const input = h.input;
    const pressed = input.pressed || {};
    const team = this.teams[h.team];
    let p = h.player;
    if (!p || p.sentOff || p.team !== team || (this.controllerOf(p) !== h)) p = h.player = this.nearestFree(team, this.ball.x, this.ball.z, h);
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
          doShot(p, this.humanShotAim(p, input), Math.max(0.25, h.shootCharge), { curl: !!input.press });
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

  // sceglie il compagno nella direzione indicata; senza direzione il migliore disponibile.
  // Con il tasto del pressing tenuto (inutile quando si ha la palla) il passaggio diventa teso e il filtrante alto.
  humanPass(p, input, kind) {
    const team = p.team;
    const mod = !!input.press;
    const ground = (tx, tz, mate) => kind === 'through' && mod ? doLobPass(p, tx, tz, mate, 'lofted') : doGroundPass(p, tx, tz, mate, mod && kind === 'pass');
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
        else ground(o.x, o.z, o.mate);
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
      if (kind === 'lob') doLobPass(p, tx, tz, null, 'lob'); else ground(tx, tz, null);
      return;
    }
    const d = dist2(p.x, p.z, best.x, best.z);
    const lead = Math.min(d / 16, 1.2);
    let tx = best.x + best.vx * lead, tz = best.z + best.vz * lead;
    if (kind === 'through') {
      // nello spazio davanti alla corsa del compagno (verso la porta se è fermo)
      const rv = len(best.vx, best.vz), fx = rv > 2 ? best.vx / rv : team.dir, fz = rv > 2 ? best.vz / rv : 0;
      tx += fx * 6.5; tz += fz * 6.5;
    }
    if (kind === 'lob') doLobPass(p, tx, tz, best, lobKind(tz));
    else ground(tx, tz, best);
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
        doShot(p, this.humanShotAim(p, input), Math.max(0.3, h.shootCharge), { curl: sp.type === 'FREE_KICK' || !!input.press });
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
  update(dt, input) { return this.withRng(() => this.step(dt, input)); }

  step(dt, input) {
    if (input && this.humans.length) this.humans[0].input = input;
    // posizioni del passo precedente: la grafica disegna a metà tra i due passi (movimento fluido a ogni fps)
    const b0 = this.ball;
    b0.px = b0.x; b0.py = b0.y; b0.pz = b0.z;
    for (const t of this.teams) for (const p of t.roster) { p.px = p.x; p.pz = p.z; p.pf = p.facing; p.pph = p.anim.phase; }
    this.realTime += dt;
    this.stateTime += dt;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = this.bannerQueue.shift() || null; }
    const b = this.ball;

    if (this.state === 'FULLTIME') return;
    this.walkOff(dt);

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
      if (this.stateTime > this.deadPause) this.startSetPiece();
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
        // conduzione: correndo il pallone si allontana dal piede tra un tocco e l'altro, in sprint di più
        // (e chi dribbla peggio lo allunga ancora): più facile da contrastare
        const run = Math.min(1, o.speed() / o.maxSpeed(true)) * (o.sprinting ? 0.45 : 0.15) * (1.3 - o.attr.dribble / 100);
        const off = 0.55 + (0.18 + run) * Math.abs(Math.sin(o.anim.phase));
        b.x = o.x + Math.cos(o.facing) * off; b.z = o.z + Math.sin(o.facing) * off; b.y = CONFIG.BALL_R;
      }
      b.vx = o.vx; b.vz = o.vz; b.vy = 0;
      this.possessionTeam.stats.possession += dt;
    } else {
      this.stepBallFree(dt);
      this.checkBallContact();
      if (this.state === 'PLAY' && !b.owner) this.ballBodyBlock();
      if (this.possessionTeam) this.possessionTeam.stats.possession += dt;
    }
    if (this.state === 'PLAY') this.checkBoundaries();
    if (this.state === 'PLAY') this.updateAdvantage();

    // sicurezza: palla ferma e nessuno la prende per troppo tempo
    if (!b.owner && b.speed() < 0.2) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (this.stuckTimer > 8 && this.state === 'PLAY') {
      this.stuckTimer = 0;
      const t = (b.lastTouch && b.lastTouch.team) || this.possessionTeam || this.teams[0];
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
    this.advantage = null;
    if (this.half === 1) {
      this.setState('HALFTIME');
      this.showBanner('Fine primo tempo', 3);
      this.emit('whistle', { type: 'HALF' });
      this.matchEvent('HALF_TIME', {});
    } else {
      this.setState('FULLTIME');
      this.showBanner('Fine partita', 5);
      this.emit('whistle', { type: 'END' });
      this.matchEvent('FULL_TIME', {});
    }
    this.issuePendingCards();
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

  // urti tra giocatori: nessuna compenetrazione; chi ha più massa sposta di più l'altro e le velocità
  // lungo la linea dell'urto si scambiano (urto quasi anelastico). In gioco l'arbitro valuta l'urto con il portatore.
  separate() {
    const ps = this.allPlayers();
    const minD = CONFIG.PLAYER_RADIUS * 2;
    const live = this.state === 'PLAY';
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], c = ps[j];
        const dx = c.x - a.x, dz = c.z - a.z;
        const d = len(dx, dz);
        if (d >= minD || d < 0.0001) continue;
        const nx = dx / d, nz = dz / d, ma = a.mass(), mc = c.mass(), w = ma + mc;
        const pen = minD - d;
        a.x -= nx * pen * mc / w; a.z -= nz * pen * mc / w;
        c.x += nx * pen * ma / w; c.z += nz * pen * ma / w;
        const rel = (c.vx - a.vx) * nx + (c.vz - a.vz) * nz;
        if (rel >= 0) continue;
        const imp = -rel * 1.05 / (1 / ma + 1 / mc);
        a.vx -= nx * imp / ma; a.vz -= nz * imp / ma;
        c.vx += nx * imp / mc; c.vz += nz * imp / mc;
        if (live && this.state === 'PLAY' && -rel > 2.2 && a.team !== c.team) this.bodyContact(a, c, -rel);
      }
    }
  }

  // urto di corsa con il portatore: spalla a spalla è regolare (e si può perdere il pallone), la carica da dietro è fallo
  bodyContact(a, c, impact) {
    const b = this.ball;
    const carrier = b.owner === a ? a : b.owner === c ? c : null;
    if (!carrier) return;
    const other = carrier === a ? c : a;
    if ((other.chargeT || 0) > this.realTime) return;
    other.chargeT = this.realTime + 0.8;
    const ch = analyzeChallenge(this, other, carrier, 'charge');
    ch.relSpeed = impact;
    const d = evaluateChallenge(ch);
    this.lastChallenge = { challenge: ch, decision: d };
    if (d.foul) { this.applyFoul(other, carrier, d, ch); return; }
    // chi arriva con più slancio (massa per velocità) e più fisico può far perdere il pallone
    const push = other.mass() * other.speed() - carrier.mass() * carrier.speed() * 0.8 + (other.attr.physical - carrier.attr.physical) * 4;
    if (push > 120 && rand() < Math.min(0.55, push / 700)) {
      b.kick(carrier.vx * 0.8 + randRange(-1.5, 1.5), 0.2, carrier.vz * 0.8 + randRange(-1.5, 1.5), carrier, 0);
      carrier.stunned = 0.3;
      this.emit('tackle', { contact: true, sev: d.severity });
    }
  }

  // pallone libero contro il corpo di chi non lo può giocare (appena calciato, a terra, troppo alto per il piede):
  // rimbalza sul corpo invece di attraversarlo
  ballBodyBlock() {
    const b = this.ball;
    if (b.owner || b.y > 1.85) return;
    const R = CONFIG.PLAYER_RADIUS * 0.8 + CONFIG.BALL_R;
    for (const p of this.allPlayers()) {
      if (p === b.lastTouch && p.kickCooldown > 0) continue;
      const dx = b.x - p.x, dz = b.z - p.z, d = len(dx, dz);
      if (d >= R || d < 0.0001) continue;
      const nx = dx / d, nz = dz / d;
      const vn = (b.vx - p.vx) * nx + (b.vz - p.vz) * nz;
      b.x = p.x + nx * R; b.z = p.z + nz * R;
      if (vn >= 0) continue;
      b.vx -= 1.35 * vn * nx; b.vz -= 1.35 * vn * nz;
      b.spin *= 0.3; b.topspin = 0;
      if (-vn > 3) { b.lastTouch = p; this.emit('touch', {}); }
      return;
    }
  }

  // registra un fotogramma per il replay
  recordReplay() {
    const ps = this.allSlots();
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
