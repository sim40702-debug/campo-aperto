// ============================================================
// ALLENAMENTO — campo libero con sfide a punti: tiri, punizioni, rigori, dribbling, passaggi
// Si usa il motore vero (fisica, portiere, barriera, mirino) con pochi giocatori in campo, come fanno i rigori
// di una coppa (08_shootout.js): gli altri restano fuori (p.gone). Si attacca sempre verso destra (x positiva).
// I record stanno su questo computer (localStorage); l'allenamento non passa dal server e non dà monete.
// ============================================================
const TRAINING_KEY = 'campoAperto.training.v1';
const DRILLS = [
  { id: 'shots', name: 'Tiri in porta', tries: 10, target: 5, text: 'Da fuori area, solo contro il portiere: tira prima che esca.' },
  { id: 'freekick', name: 'Punizioni', tries: 10, target: 3, text: 'Con la barriera: muovi il mirino e calcia a giro.' },
  { id: 'penalty', name: 'Rigori', tries: 10, target: 7, text: 'Dal dischetto: scegli l\'angolo e la forza.' },
  { id: 'dribble', name: 'Dribbling', tries: 8, target: 4, text: 'Supera due difensori con la finta e segna.' },
  { id: 'pass', name: 'Passaggi', seconds: 60, target: 15, text: 'Tieni palla con tre compagni contro due difensori: passaggi riusciti in 60 secondi.' },
];
const drillById = id => DRILLS.find(d => d.id === id) || DRILLS[0];

function loadTrainingRecords() {
  try { const r = JSON.parse(localStorage.getItem(TRAINING_KEY) || '{}'); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; }
}
function saveTrainingRecord(id, score) {
  const r = loadTrainingRecords();
  const best = Number.isFinite(r[id]) ? r[id] : -1;
  if (score > best) { r[id] = score; try { localStorage.setItem(TRAINING_KEY, JSON.stringify(r)); } catch (e) { /* niente spazio */ } return true; }
  return false;
}

class TrainingMatch extends Match {
  // opts.drill: id dell'esercizio. La partita non ha tempo: finisce quando finiscono i tentativi
  constructor(homeData, awayData, opts) {
    super(homeData, awayData, Object.assign({}, opts, { humanTeam: 0, halfSeconds: 100000 }));
    this.training = true;
    const d = drillById(opts && opts.drill);
    this.tr = { drill: d, done: 0, score: 0, phase: 'ready', t: 0, liveT: 0, playT: 0, timeLeft: d.seconds || 0, last: '', passBase: 0 };
    this.withRng(() => this.prepareSquads());
  }

  // chi resta in campo per l'esercizio (il portiere sempre primo: Team.gk è players[0])
  prepareSquads() {
    const [me, opp] = this.teams;
    me.dir = 1; opp.dir = -1;
    const d = this.tr.drill.id;
    const outfield = me.roster.filter(p => !p.isGK);
    const best = key => outfield.slice().sort((a, b) => b.attr[key] - a.attr[key])[0];
    this.trMain = d === 'dribble' ? best('dribble') : d === 'pass' ? best('pass') : best('shot');
    let mine = [this.trMain];
    if (d === 'pass') mine = mine.concat(outfield.filter(p => p !== this.trMain).sort((a, b) => b.attr.pass - a.attr.pass).slice(0, 3));
    const gk = opp.roster[0];
    const defenders = opp.roster.filter(p => !p.isGK && p.slot.role === 'DF');
    let theirs = [gk];
    if (d === 'freekick') theirs = [gk].concat(defenders.slice(0, 4));          // la barriera
    if (d === 'dribble') theirs = [gk].concat(defenders.slice(1, 3));
    if (d === 'pass') theirs = opp.roster.filter(p => !p.isGK).sort((a, b) => b.attr.defense - a.attr.defense).slice(0, 2);
    me.players = mine; opp.players = theirs;
    for (const t of this.teams) for (const p of t.roster) {
      p.gone = !t.players.includes(p);
      if (p.gone) { p.x = (t.index ? 1 : -1) * 80; p.z = 60; p.vx = 0; p.vz = 0; }
    }
    this.subsOn = false;
    this.ball.owner = null;
    this.setState('DEAD');
    this.tr.phase = 'ready'; this.tr.t = 0;
    this.showBanner(this.tr.drill.name, 2.5);
  }

  // niente orologio, niente fine dei tempi
  advanceClock() {}
  checkHalfEnd() { return false; }
  minute() { return 0; }

  step(dt, input) {
    const tr = this.tr;
    if (tr.phase === 'over') { this.realTime += dt; this.stateTime += dt; return; }
    if (tr.phase === 'ready' || tr.phase === 'result') {
      // pausa tra un tentativo e l'altro: la palla rotola, i giocatori si fermano
      tr.t += dt;
      this.realTime += dt; this.stateTime += dt;
      if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
      this.stepBallFree(dt);
      for (const p of this.allPlayers()) { p.moveToward(p.x, p.z, false, dt); p.update(dt); }
      this.recordReplay();
      if (tr.t > (tr.phase === 'ready' ? 1.6 : 1.4)) this.nextAttempt();
      return;
    }
    super.step(dt, input);
    if (tr.phase !== 'live') return;
    tr.liveT += dt;
    const b = this.ball, me = this.teams[0], opp = this.teams[1];
    if (tr.drill.id === 'pass') {
      tr.timeLeft -= dt;
      tr.score = me.stats.passesOk - tr.passBase;
      if (tr.timeLeft <= 0) { tr.timeLeft = 0; return this.finish(); }
      // palla persa: si ricomincia dal primo (senza contare)
      if (b.owner && b.owner.team === opp) this.attemptResult(null, 'Palla persa');
      return;
    }
    if (this.state !== 'PLAY') return;
    tr.playT += dt;   // tempo con la palla in gioco (dopo il calcio di una punizione o di un rigore)
    if (b.owner && b.owner.team === opp) return this.attemptResult(false, b.owner.isGK ? 'Parato!' : tr.drill.id === 'freekick' ? 'Respinta dalla barriera' : 'Palla persa');
    // tiro partito e pallone fermo fuori dalla porta: tentativo fallito
    const kicked = !b.owner && b.lastTouch && b.lastTouch.team === me;
    if (kicked && tr.playT > 1 && b.speed() < 1.2 && !b.inNet) return this.attemptResult(false, 'Niente gol');
    if (tr.playT > (tr.drill.id === 'dribble' ? 16 : 10)) return this.attemptResult(false, 'Tempo scaduto');
  }

  // prepara il prossimo tentativo
  nextAttempt() {
    const tr = this.tr, d = tr.drill.id, me = this.teams[0], opp = this.teams[1], b = this.ball, p = this.trMain;
    if (!tr.drill.seconds && tr.done >= tr.drill.tries) return this.finish();
    tr.phase = 'live'; tr.liveT = 0; tr.playT = 0; tr.t = 0;
    this.lastKick = null; this.offside = null; this.advantage = null; this.pendingPass = null;
    b.inNet = false; b.netHit = null;
    const gx = me.oppGoalX();
    const gk = opp.players.find(x => x.isGK);
    if (gk) { gk.x = opp.ownGoalX() - opp.dir * 0.6; gk.z = 0; gk.vx = 0; gk.vz = 0; gk.facing = Math.PI; }
    for (const x of this.allPlayers()) { x.stunned = 0; x.anim.dive = 0; x.anim.tackle = 0; x.anim.fall = 0; x.kickCooldown = 0; }
    if (d === 'freekick') {
      const dist = randRange(19, 28), z = randRange(-15, 15);
      this.pendingSetPiece = { type: 'FREE_KICK', team: me, x: gx - dist, z: z };
      p.x = gx - dist - 2; p.z = z;
      this.startSetPiece();
      for (const h of this.humans) h.player = p;
      return;
    }
    if (d === 'penalty') {
      this.pendingSetPiece = { type: 'PENALTY', team: me, x: gx - CONFIG.PENALTY_SPOT, z: 0 };
      this.startSetPiece();
      for (const h of this.humans) h.player = p;
      return;
    }
    // gioco libero: palla al piede del tuo calciatore
    let bx, bz;
    if (d === 'shots') { bx = gx - randRange(24, 31); bz = randRange(-13, 13); }
    else if (d === 'dribble') { bx = 8; bz = randRange(-8, 8); }
    else { bx = 6; bz = 0; }
    b.reset(bx, bz);
    p.x = bx - 0.6; p.z = bz; p.vx = 0; p.vz = 0; p.facing = 0;
    if (d === 'dribble') {
      const [d1, d2] = opp.players.filter(x => !x.isGK);
      if (d1) { d1.x = bx + 13; d1.z = bz + 3; d1.vx = 0; d1.vz = 0; }
      if (d2) { d2.x = bx + 24; d2.z = bz - 4; d2.vx = 0; d2.vz = 0; }
    }
    if (d === 'pass') {
      // tre compagni intorno e due difensori nel mezzo, in una zona di 30 metri
      const spots = [[16, -11], [16, 11], [26, 0]];
      me.players.slice(1).forEach((m, i) => { m.x = bx + spots[i][0] - 10; m.z = spots[i][1]; m.vx = 0; m.vz = 0; });
      opp.players.forEach((o, i) => { o.x = bx + 8 + i * 4; o.z = i ? 4 : -4; o.vx = 0; o.vz = 0; });
      tr.passBase = me.stats.passesOk - tr.score;
    }
    b.owner = p; b.lastTouch = p;
    this.possessionTeam = me;
    for (const h of this.humans) h.player = p;
    this.setState('PLAY');
  }

  // fine di un tentativo: ok = true (riuscito), false (sbagliato), null (non conta: passaggi)
  attemptResult(ok, text) {
    const tr = this.tr;
    if (tr.phase !== 'live') return;
    if (ok !== null) { tr.done++; if (ok) tr.score++; }
    tr.last = text;
    tr.phase = 'result'; tr.t = 0;
    this.ball.owner = null;
    this.setState('DEAD');
    this.showBanner(text, 1.4, ok ? 'goal' : 'info');
    if (!tr.drill.seconds && tr.done >= tr.drill.tries) tr.t = -0.6;   // l'ultimo: un attimo in più per vederlo
  }
  finish() {
    const tr = this.tr;
    tr.phase = 'over';
    tr.passed = tr.score >= tr.drill.target;
    tr.record = saveTrainingRecord(tr.drill.id, tr.score);
    this.ball.owner = null;
    this.setState('DEAD');
    this.showBanner(tr.passed ? 'Sfida superata!' : 'Sfida non superata', 3, tr.passed ? 'goal' : 'info');
  }

  // un gol: conta per l'esercizio (senza calcio d'inizio)
  goal(team) {
    const tr = this.tr;
    if (tr.drill.id === 'pass') return this.attemptResult(null, 'Gol! Ma qui conta tenere palla');
    team.score++;
    if (team.index === 0 && this.lastKick && this.lastKick.player) this.lastKick.player.stats.goals++;
    this.emit('goal', { team: team.index });
    this.attemptResult(team.index === 0, team.index === 0 ? 'Gol!' : 'Autogol');
  }
  // fischio (palla fuori, fallo, fuorigioco): il tentativo finisce
  whistle(type, team, x, z, text) {
    const tr = this.tr;
    if (tr.drill.id === 'pass') return this.attemptResult(null, type === 'OFFSIDE' || text === 'Fuorigioco' ? 'Fuorigioco' : 'Palla fuori');
    const gk = this.teams[1].players.find(p => p.isGK);
    const saved = type === 'CORNER' && this.ball.lastTouch === gk;
    this.attemptResult(false, saved ? 'Parato!' : type === 'FREE_KICK' || type === 'PENALTY' ? 'Fallo' : 'Fuori!');
  }
}

// ---------- schermata Allenamento ----------
Game.prototype.openTraining = function () { this.showScreen('training'); };

Game.prototype.renderTraining = function () {
  const rec = loadTrainingRecords();
  const last = this.trainingLast;
  $('tr-result').hidden = !last;
  if (last) {
    const d = drillById(last.drill);
    $('tr-result').className = 'tr-result' + (last.passed ? ' ok' : '');
    $('tr-result').innerHTML = '<b>' + esc(tr(last.passed ? 'Sfida superata!' : 'Sfida non superata')) + '</b> ' +
      esc(tr(d.name)) + ': ' + esc(trf(d.seconds ? '{0} passaggi (obiettivo {1})' : '{0} su {2} (obiettivo {1})', last.score, d.target, d.tries)) +
      (last.record && last.score > 0 ? ' · <span class="rec">' + esc(tr('Nuovo record!')) + '</span>' : '');
  }
  $('tr-list').innerHTML = DRILLS.map(d => {
    const best = Number.isFinite(rec[d.id]) ? rec[d.id] : null;
    const goal = d.seconds ? trf('Obiettivo: {0} passaggi in {1} secondi', d.target, d.seconds) : trf('Obiettivo: {0} su {1}', d.target, d.tries);
    return '<button class="tr-card' + (best !== null && best >= d.target ? ' done' : '') + '" data-drill="' + d.id + '"><b>' + esc(tr(d.name)) + '</b>' +
      '<small>' + esc(tr(d.text)) + '</small><span class="tr-goal">' + esc(goal) + '</span>' +
      '<span class="tr-best">' + (best === null ? esc(tr('Nessun record')) : esc(trf('Record: {0}', best))) + '</span></button>';
  }).join('');
  $('tr-list').querySelectorAll('[data-drill]').forEach(b => { b.onclick = () => this.startTraining(b.dataset.drill); });
};

Game.prototype.startTraining = function (drill) {
  this.compMatch = null;
  const s = this.setup;
  // la tua squadra della partita rapida contro la prossima squadra (il suo portiere e i suoi difensori)
  const away = s.away !== s.home ? s.away : (s.home + 1) % this.db.length;
  const m = new TrainingMatch(this.teamForMatch(s.home, true), this.teamForMatch(away, false), { drill: drill, difficulty: s.difficulty,
    weather: pickWeather(s.weather), timeOfDay: pickTimeOfDay(s.timeOfDay) });
  this.trainingDrill = drill;
  this.mode = 'offline';
  this.prepareMatchView(m, 'local', null);
  $('netind').hidden = true;
  $('hud').classList.add('training');
  this.renderTrainingHud();
};

// riquadro in alto: esercizio, tentativi, punti (o secondi rimasti)
Game.prototype.renderTrainingHud = function () {
  const m = this.match, box = $('tr-hud');
  const on = !!(m && m.training);
  box.hidden = !on;
  $('hud').classList.toggle('training', on);
  if (!on) return;
  const t = m.tr, d = t.drill;
  const line = d.seconds ? trf('{0} passaggi · {1} s', t.score, Math.ceil(t.timeLeft)) : trf('Gol {0} · tentativo {1}/{2}', t.score, Math.min(t.done + (t.phase === 'live' ? 1 : 0), d.tries) || 1, d.tries);
  const text = tr(d.name) + '  ·  ' + line + '  ·  ' + trf('obiettivo {0}', d.target);
  if (box.textContent !== text) box.textContent = text;
  // finito: si torna alla schermata Allenamento con il risultato
  if (t.phase === 'over' && m.stateTime > 2.6 && this.screen === 'match' && !t.leaving) {
    t.leaving = true;
    this.trainingLast = { drill: d.id, score: t.score, passed: t.passed, record: t.record };
    // subito dopo questo fotogramma (la partita serve ancora a chi disegna il fotogramma)
    setTimeout(() => { if (this.match === m) this.endTraining(); }, 0);
  }
};

// esci dall'allenamento (fine sfida, o Esci dal menu di pausa)
Game.prototype.endTraining = function () {
  this.match = null; this.paused = false; this.replay = null; this.mode = 'menu';
  $('pause').hidden = true; $('tr-hud').hidden = true; $('hud').classList.remove('training');
  this.startDemo();
  this.showScreen('training');
};
