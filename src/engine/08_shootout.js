// ============================================================
// ELIMINAZIONE DIRETTA — supplementari e rigori sulla partita vera
// KnockoutMatch è una partita normale (stesso motore, stessa fisica, stessi comandi) che alla fine dei 90 minuti,
// se serve un vincitore, gioca i supplementari (2 tempi da 15 minuti) e poi la serie dei rigori.
// opts.knockout = { extraTime: true, penalties: true, aggregate: [gol casa, gol trasferta] dell'andata (ritorno) }.
// Senza rigori una parità resta parità (la competizione decide la ripetizione).
// I rigori usano il rigore del motore: rincorsa, tiro caricato del giocatore, tuffo del portiere (anche umano).
// ============================================================
class KnockoutMatch extends Match {
  setup(homeData, awayData, opts) {
    const ko = (opts && opts.knockout) || {};
    this.ko = { extraTime: ko.extraTime !== false, penalties: ko.penalties !== false, aggregate: Array.isArray(ko.aggregate) ? [ko.aggregate[0] | 0, ko.aggregate[1] | 0] : [0, 0] };
    this.regScore = null;    // punteggio alla fine dei 90 minuti (se si va ai supplementari)
    this.so = null;          // serie dei rigori in corso
    this.decided = null;     // 0 o 1: chi passa il turno; null finché non è deciso (o se serve la ripetizione)
    super.setup(homeData, awayData, opts);
  }

  // parità considerando l'andata: [gol della squadra di casa di questa partita, gol di quella in trasferta]
  aggLevel() { return this.teams[0].score + this.ko.aggregate[0] === this.teams[1].score + this.ko.aggregate[1]; }
  aggLeader() { const a = this.teams[0].score + this.ko.aggregate[0], b = this.teams[1].score + this.ko.aggregate[1]; return a > b ? 0 : a < b ? 1 : null; }

  minute() {
    if (this.half <= 2) return super.minute();
    const base = this.half === 3 ? 90 : 105;
    return Math.min(base + Math.floor(this.clock / 60), base + 18);
  }

  checkHalfEnd() {
    if (this.so) return false;
    const limit = this.half <= 2 ? 2700 : 900;
    if (this.clock < limit) return false;
    this.advantage = null;
    if (this.half === 1 || this.half === 3) {
      this.setState('HALFTIME');
      this.showBanner(this.half === 1 ? 'Fine primo tempo' : 'Fine primo tempo supplementare', 3);
      this.emit('whistle', { type: 'HALF' });
      this.matchEvent('HALF_TIME', {});
    } else if (this.half === 2 && this.aggLevel() && this.ko.extraTime) {
      this.regScore = [this.teams[0].score, this.teams[1].score];
      this.setState('HALFTIME');
      this.showBanner('Parità: si va ai supplementari', 3.5);
      this.emit('whistle', { type: 'HALF' });
      this.matchEvent('HALF_TIME', { reason: 'Supplementari' });
    } else if (this.aggLevel() && this.ko.penalties) {
      if (!this.regScore) this.regScore = [this.teams[0].score, this.teams[1].score];
      this.emit('whistle', { type: 'END' });
      this.startShootout();
    } else {
      if (this.half === 2 && !this.regScore) this.regScore = [this.teams[0].score, this.teams[1].score];
      this.decided = this.aggLeader();
      this.setState('FULLTIME');
      this.showBanner(this.decided === null ? 'Fine partita: parità, si ripeterà' : 'Fine partita', 5);
      this.emit('whistle', { type: 'END' });
      this.matchEvent('FULL_TIME', {});
    }
    this.issuePendingCards();
    return true;
  }

  // contabilità di ogni passo (posizioni precedenti per la grafica, tempi, scritte), come nella partita normale
  tick(dt) {
    const b0 = this.ball; b0.px = b0.x; b0.py = b0.y; b0.pz = b0.z;
    for (const t of this.teams) for (const p of t.roster) { p.px = p.x; p.pz = p.z; p.pf = p.facing; p.pph = p.anim.phase; }
    this.realTime += dt; this.stateTime += dt;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = this.bannerQueue.shift() || null; }
  }
  step(dt, input) {
    // intervallo dei supplementari (dopo il secondo tempo o dopo il primo supplementare): la partita normale
    // conosce solo l'intervallo tra primo e secondo tempo
    if (this.state === 'HALFTIME' && this.half >= 2) {
      this.tick(dt);
      this.walkOff(dt);
      if (this.stateTime > 3) {
        this.half++;
        this.clock = 0;
        for (const t of this.teams) t.dir *= -1;
        this.startKickoff(this.half === 3 ? this.teams[0] : this.teams[1]);
      }
      return;
    }
    if (this.so) return this.stepShootout(dt, input);
    return super.step(dt, input);
  }

  // ---------- RIGORI ----------
  startShootout() {
    const kickers = t => t.players.slice().sort((a, b) => (a.isGK - b.isGK) || (b.attr.shot - a.attr.shot));
    this.so = {
      score: [0, 0], taken: [0, 0], order: [kickers(this.teams[0]), kickers(this.teams[1])], log: [],
      phase: 'intro', t: 0, kicking: 0, kicker: null, kickT: 0,
      saved: this.teams.map(t => t.players.slice()),
    };
    this.ball.owner = null;
    this.setState('SHOOTOUT');
    this.showBanner('Calci di rigore', 3);
    this.matchEvent('FULL_TIME', { reason: 'Rigori' });
    // tutti a centrocampo, in fila per squadra
    for (const t of this.teams) t.players.forEach((p, i) => this.toCenter(p, t.index, i));
  }
  toCenter(p, side, i) {
    p.x = (side === 0 ? -1.3 : 1.3); p.z = -9 + i * 1.6; p.vx = 0; p.vz = 0;
    p.facing = 0; p.anim.kick = 0; p.anim.dive = 0; p.anim.tackle = 0; p.stunned = 0;
  }
  // prepara il prossimo rigore: in campo restano solo il tiratore e il portiere avversario, tutti verso la stessa porta
  nextKick() {
    const so = this.so, side = so.kicking, team = this.teams[side], def = this.teams[1 - side];
    team.dir = 1; def.dir = -1;
    for (const t of this.teams) t.players = so.saved[t.index].slice();
    for (const t of this.teams) t.players.forEach((p, i) => this.toCenter(p, t.index, i));
    const list = so.order[side], kicker = list[so.taken[side] % list.length];
    const gk = def.gk && def.players.indexOf(def.gk) >= 0 ? def.gk : def.players[0];
    team.players = [kicker]; def.players = [gk];
    gk.x = def.ownGoalX(); gk.z = 0; gk.facing = Math.PI;
    so.kicker = kicker;
    this.pendingSetPiece = { type: 'PENALTY', team: team, x: team.oppGoalX() - team.dir * CONFIG.PENALTY_SPOT, z: 0 };
    this.startSetPiece();
    // un umano della squadra che tira controlla il tiratore, uno di quella che para il portiere
    for (const h of this.humans) h.player = h.team === side ? kicker : gk;
    so.phase = 'kick'; so.kickT = 0;
    this.showBanner(team.data.short + ': ' + kicker.data.name, 2.2);
  }
  shootoutResult(scored, how) {
    const so = this.so;
    if (so.phase !== 'kick') return;
    const side = so.kicking;
    so.taken[side]++;
    if (scored) so.score[side]++;
    so.log.push({ team: side, name: so.kicker ? so.kicker.data.name : '', scored: scored });
    so.phase = 'result'; so.t = 0;
    this.ball.owner = null;
    this.setState('SHOOTOUT');
    this.showBanner((scored ? 'Gol! ' : how + ' ') + so.score[0] + '-' + so.score[1], 2, scored ? 'goal' : 'info');
    this.emit(scored ? 'goal' : 'save', { team: side, shootout: true });
    this.matchEvent(scored ? 'PENALTY_SCORED' : 'PENALTY_MISSED', { player: so.kicker, reason: 'Rigori' });
  }
  shootoutDecided() {
    const so = this.so, s = so.score, t = so.taken;
    if (t[0] <= 5 && t[1] <= 5) {
      const left = [5 - t[0], 5 - t[1]];
      if (s[0] + left[0] < s[1]) return 1;
      if (s[1] + left[1] < s[0]) return 0;
      if (t[0] === 5 && t[1] === 5 && s[0] !== s[1]) return s[0] > s[1] ? 0 : 1;
      return null;
    }
    // a oltranza: dopo ogni coppia di tiri
    if (t[0] === t[1] && s[0] !== s[1]) return s[0] > s[1] ? 0 : 1;
    return null;
  }
  stepShootout(dt, input) {
    const so = this.so;
    so.t += dt;
    if (so.phase === 'intro' || so.phase === 'result') {
      // pausa tra un rigore e l'altro (la grafica continua: posizioni e passi)
      this.tick(dt);
      this.stepBallFree(dt);
      for (const p of this.allPlayers()) { p.moveToward(p.x, p.z, false, dt); p.update(dt); }
      if (so.t < (so.phase === 'intro' ? 2.5 : 1.8)) return;
      if (so.phase === 'result') {
        const w = this.shootoutDecided();
        if (w !== null) return this.endShootout(w);
        so.kicking = so.taken[0] > so.taken[1] ? 1 : 0;
      }
      this.nextKick();
      return;
    }
    // rigore in corso: la partita normale gestisce rincorsa, tiro, volo, parata, gol e fondo
    super.step(dt, input);
    if (so.phase !== 'kick') return;
    if (this.state === 'PLAY') {
      so.kickT += dt;
      const b = this.ball, gk = this.teams[1 - so.kicking].players[0];
      if (b.owner && b.owner === gk) this.shootoutResult(false, 'Parato!');
      else if (b.owner && so.kickT > 0.25) this.shootoutResult(false, 'Niente gol!');
      else if (so.kickT > 1.2 && b.speed() < 1.2 && !b.inNet) this.shootoutResult(false, b.lastTouch === gk ? 'Parato!' : 'Fuori!');
      else if (so.kickT > 4) this.shootoutResult(false, 'Fuori!');
    }
  }
  endShootout(winner) {
    const so = this.so;
    for (const t of this.teams) t.players = so.saved[t.index].slice();
    so.phase = 'done';
    this.decided = winner;
    this.setState('FULLTIME');
    this.showBanner(this.teams[winner].data.name + ' vince ai rigori ' + so.score[0] + '-' + so.score[1], 6, 'goal');
    this.emit('whistle', { type: 'END' });
    this.matchEvent('FULL_TIME', { team: this.teams[winner], reason: 'Rigori ' + so.score[0] + '-' + so.score[1] });
  }
  // durante i rigori un gol vale solo per la serie, una palla fuori è un errore
  goal(team) {
    if (this.so) return this.shootoutResult(team.index === this.so.kicking, 'Autogol?');
    return super.goal(team);
  }
  whistle(type, team, x, z, text, kind, reason) {
    if (this.so) return this.shootoutResult(false, type === 'CORNER' ? 'Parato!' : 'Fuori!');
    return super.whistle(type, team, x, z, text, kind, reason);
  }

  // risultato finale per la competizione: 90 minuti, supplementari, rigori, chi passa
  result() {
    const s = [this.teams[0].score, this.teams[1].score];
    const reg = this.regScore || s;
    return {
      h: reg[0], a: reg[1],
      et: this.regScore && this.half >= 3 ? { h: s[0] - reg[0], a: s[1] - reg[1] } : null,
      pens: this.so && this.so.phase === 'done' ? { h: this.so.score[0], a: this.so.score[1] } : null,
      winner: this.decided !== null ? this.decided : (s[0] > s[1] ? 0 : s[0] < s[1] ? 1 : null),
    };
  }
}
