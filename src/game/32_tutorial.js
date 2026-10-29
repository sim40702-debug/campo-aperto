// ============================================================
// TUTORIAL — prima partita guidata, passo dopo passo (Allenamento → Tutorial)
// Campo quasi vuoto, motore vero. Un passo alla volta, con la frase in alto e i tasti che usi tu (tastiera o
// controller, anche rimappati): muoversi, scattare, passare, fare la finta, tirare in porta, rubare la palla.
// Ogni passo finisce da solo quando lo fai giusto; se sbagli (palla fuori, parata) si riprova lo stesso passo.
// Alla fine: "Tutorial completato" (si ricorda sul computer) e il trofeo.
// ============================================================
const TUTORIAL_KEY = 'campoAperto.tutorial.v1';
function tutorialDone() { try { return localStorage.getItem(TUTORIAL_KEY) === '1'; } catch (e) { return false; } }

// i passi: testo (con {0} = tasto) e controllo
const TUTORIAL_STEPS = [
  { id: 'move', text: 'Muoviti con {0}: porta il pallone nel cerchio giallo', keys: ['dir'] },
  { id: 'sprint', text: 'Tieni premuto {0} mentre ti muovi per scattare fino al prossimo cerchio', keys: ['sprint'] },
  { id: 'pass', text: 'Passa la palla al compagno con {0}', keys: ['pass'] },
  { id: 'feint', text: 'Con la palla premi {0} per fare la finta e saltare l\'uomo', keys: ['dribble'] },
  { id: 'shot', text: 'Tieni premuto {0} per caricare il tiro, lascialo per calciare: segna!', keys: ['shoot'] },
  { id: 'tackle', text: 'Ora difendi: avvicinati all\'avversario e premi {0} per rubargli la palla', keys: ['pass'] },
];

class TutorialMatch extends TrainingMatch {
  constructor(homeData, awayData, opts) {
    super(homeData, awayData, Object.assign({}, opts, { drill: 'shots' }));
    this.tutorial = true;
    this.tu = { i: 0, t: 0, ok: false, sprinted: false, base: 0, finished: false };
    this.withRng(() => this.setupStep());
  }
  // chi è in campo: tu, due compagni, il portiere (e il difensore solo nell'ultimo passo)
  prepareSquads() {
    const [me, opp] = this.teams;
    me.dir = 1; opp.dir = -1;
    const outfield = me.roster.filter(p => !p.isGK);
    this.trMain = outfield.slice().sort((a, b) => b.attr.shot - a.attr.shot)[0];
    this.mates = outfield.filter(p => p !== this.trMain).slice(0, 2);
    this.def = opp.roster.filter(p => !p.isGK && p.slot.role === 'DF')[0];
    me.players = [this.trMain].concat(this.mates);
    opp.players = [opp.roster[0]];
    for (const t of this.teams) for (const p of t.roster) {
      p.gone = !t.players.includes(p);
      if (p.gone) { p.x = (t.index ? 1 : -1) * 80; p.z = 60; p.vx = 0; p.vz = 0; }
    }
    this.subsOn = false;
    this.ball.owner = null;
    this.setState('DEAD');
  }
  step(dt, input) {
    const tu = this.tu;
    if (!tu) return super.step(dt, input);
    if (tu.finished) { this.realTime += dt; this.stateTime += dt; if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; } return; }
    // tra un passo e l'altro un attimo di pausa ("Bravo!")
    if (tu.ok) {
      this.rememberPositions();   // la grafica continua a muovere pallone e giocatori nella pausa (28_training.js)
      tu.t += dt; this.realTime += dt; this.stateTime += dt;
      if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
      this.stepBallFree(dt);
      for (const p of this.allPlayers()) { p.moveToward(p.x, p.z, false, dt); p.update(dt); }
      if (tu.t > 1.3) { tu.i++; tu.ok = false; tu.t = 0; if (tu.i >= TUTORIAL_STEPS.length) this.finishTutorial(); else this.setupStep(); }
      return;
    }
    Match.prototype.step.call(this, dt, input);
    tu.t += dt;
    this.checkStep(input);
  }
  advanceClock() {}
  // niente fuorigioco nel tutorial
  onKick(p, kind) { super.onKick(p, kind); this.offside = null; }

  // prepara il passo tu.i: posizioni, pallone, cerchio da raggiungere
  setupStep() {
    const tu = this.tu, me = this.teams[0], opp = this.teams[1], b = this.ball, p = this.trMain;
    const s = TUTORIAL_STEPS[tu.i];
    tu.t = 0; tu.sprinted = false; tu.target = null;
    this.lastKick = null; this.offside = null; this.advantage = null; this.pendingPass = null;
    b.inNet = false; b.netHit = null;
    for (const x of this.allSlots()) { x.stunned = 0; x.gkAi = null; x.anim.dive = 0; x.anim.tackle = 0; x.anim.fall = 0; x.kickCooldown = 0; }
    const gk = opp.roster[0];
    gk.x = opp.ownGoalX() - opp.dir * 0.6; gk.z = 0; gk.vx = gk.vz = 0;
    const place = (q, x, z) => { q.x = x; q.z = z; q.vx = 0; q.vz = 0; q.facing = 0; };
    // il difensore entra solo per l'ultimo passo
    const def = this.def;
    const withDef = s.id === 'tackle';
    if (def) { def.gone = !withDef; opp.players = withDef ? [gk, def] : [gk]; if (!withDef) place(def, 80, 60); }
    if (s.id === 'move') { place(p, -10, 0); place(this.mates[0], 5, -18); place(this.mates[1], 5, 18); tu.target = { x: 2, z: -7 }; }
    if (s.id === 'sprint') { tu.target = { x: 26, z: 6 }; }
    if (s.id === 'pass') { place(this.mates[0], p.x + 12, p.z - 9); tu.base = me.stats.passesOk; }
    // scatto, passaggio e finta: il pallone torna al piede di chi comandi, fermo (0.24.4)
    if (s.id === 'sprint' || s.id === 'pass' || s.id === 'feint') {
      const q = this.humans[0].player && this.humans[0].player.team === me && !this.humans[0].player.isGK ? this.humans[0].player : p;
      q.vx = 0; q.vz = 0;
      b.reset(q.x + Math.cos(q.facing) * 0.6, q.z + Math.sin(q.facing) * 0.6);
      b.owner = q; b.lastTouch = q; this.possessionTeam = me; this.humans[0].player = q;
    }
    if (s.id === 'feint') { /* chi ha ricevuto il passaggio fa la finta */ }
    if (s.id === 'shot') {
      const q = this.humans[0].player && this.humans[0].player.team === me ? this.humans[0].player : p;
      place(q, CONFIG.HALF_L - 20, -4); b.reset(q.x + 0.6, q.z); b.owner = q; b.lastTouch = q;
      this.humans[0].player = q;
    }
    if (s.id === 'tackle' && def) {
      // il difensore (avversario) porta palla verso di te, piano
      const q = this.humans[0].player && this.humans[0].player.team === me ? this.humans[0].player : p;
      place(q, 10, 0); place(def, 22, 0); def.facing = Math.PI;
      b.reset(def.x - 0.6, def.z); b.owner = def; b.lastTouch = def;
      this.possessionTeam = opp;
      this.humans[0].player = q;
    }
    if (s.id === 'move') { b.reset(p.x + 0.6, p.z); b.owner = p; b.lastTouch = p; this.humans[0].player = p; this.possessionTeam = me; }
    this.setState('PLAY');
    this.showBanner(trf('Passo {0} di {1}', tu.i + 1, TUTORIAL_STEPS.length), 1.6);
  }

  // il passo è riuscito?
  checkStep(input) {
    const tu = this.tu, s = TUTORIAL_STEPS[tu.i], me = this.teams[0], b = this.ball;
    const h = this.humans[0], p = h && h.player;
    if (!p) return;
    const near = t => t && Math.hypot(p.x - t.x, p.z - t.z) < 2.4;
    // il portiere avversario ha preso la palla: parata, si riprova (non deve mai rilanciare: non ha compagni)
    if (b.owner && b.owner.isGK && b.owner.team !== me) {
      if (s.id === 'shot') { this.setupStep(); this.showBanner(tr('Parato! Riprova'), 1.4); return; }
      b.owner = p; b.lastTouch = p;
    }
    let ok = false;
    if (s.id === 'move') ok = near(tu.target);
    if (s.id === 'sprint') { if (p.sprinting && p.speed() > 5) tu.sprinted = true; ok = tu.sprinted && near(tu.target); }
    if (s.id === 'pass') ok = me.stats.passesOk > tu.base;
    if (s.id === 'feint') ok = p.anim.feint > 0;
    if (s.id === 'tackle') ok = !!(b.owner && b.owner.team === me);
    // palla persa durante i primi passi: torna a te
    if (!ok && s.id !== 'tackle' && s.id !== 'shot' && b.owner && b.owner.team !== me) { b.owner = p; }
    // l'avversario è scappato troppo lontano: si ricomincia l'ultimo passo
    if (s.id === 'tackle' && !ok && (tu.t > 25 || (this.def && this.def.x < -35))) this.setupStep();
    if (s.id === 'shot' && !ok && tu.t > 12) this.setupStep();
    if (ok) this.stepDone();
  }
  stepDone() {
    const tu = this.tu, b = this.ball, s = TUTORIAL_STEPS[tu.i];
    tu.ok = true; tu.t = 0;
    // il pallone si ferma dov'è (accanto a te): prima continuava a rotolare con la velocità della corsa e "se ne
    // andava da solo" appena arrivavi nel cerchio (0.24.4). Dopo il tiro invece resta in rete.
    if (s.id !== 'shot') { b.vx = 0; b.vy = 0; b.vz = 0; b.spin = 0; b.topspin = 0; }
    b.owner = null;
    this.setState('DEAD');
    this.showBanner(pick(['Bravo!', 'Perfetto!', 'Ottimo!']), 1.2, 'goal');
  }
  finishTutorial() {
    const tu = this.tu;
    tu.finished = true;
    try { localStorage.setItem(TUTORIAL_KEY, '1'); } catch (e) { /* niente spazio */ }
    this.setState('DEAD');
    this.showBanner('Tutorial completato!', 3, 'goal');
    this.tr.phase = 'over'; this.tr.passed = true;
  }
  // gol: nel passo del tiro è giusto, prima non conta
  goal(team) {
    const tu = this.tu, s = TUTORIAL_STEPS[tu.i];
    if (team.index === 0 && s.id === 'shot') { team.score++; this.emit('goal', { team: 0 }); return this.stepDone(); }
    this.setupStep();
  }
  // palla fuori, parata, fallo: si riprova lo stesso passo
  whistle() {
    this.showBanner(tr('Riprova'), 1.2);
    this.setupStep();
  }
}

// ---------- nel gioco ----------
Game.prototype.startTutorial = function () {
  this.compMatch = null;
  const s = this.setup;
  const away = s.away !== s.home ? s.away : (s.home + 1) % this.db.length;
  const m = new TutorialMatch(this.teamForMatch(s.home, true), this.teamForMatch(away, false), { difficulty: 0, weather: 'clear', timeOfDay: 'day' });
  this.trainingDrill = 'tutorial';
  this.mode = 'offline';
  this.prepareMatchView(m, 'local', null);
  $('netind').hidden = true;
  $('hud').classList.add('training');
  this.renderTutorialHud();
};

// riquadro in alto con il passo e il tasto da usare; il cerchio giallo sul campo
Game.prototype.renderTutorialHud = function () {
  const m = this.match, box = $('tr-hud');
  if (!m || !m.tutorial) return;
  box.hidden = false;
  const tu = m.tu, s = TUTORIAL_STEPS[Math.min(tu.i, TUTORIAL_STEPS.length - 1)];
  const key = a => a === 'dir' ? (this.input.lastDevice === 'pad' ? tr('la levetta sinistra') : ['up', 'left', 'down', 'right'].map(x => this.btn(x)).join('')) : this.btn(a);
  const text = tu.finished ? tr('Tutorial completato! Ora prova una partita vera.') : trf('Passo {0} di {1}', tu.i + 1, TUTORIAL_STEPS.length) + ' · ' + trf(s.text, key(s.keys[0]));
  if (box.textContent !== text) box.textContent = text;
  this.renderer.setTutorialTarget(!tu.finished && !tu.ok && tu.target ? tu.target : null);
  if (tu.finished && m.stateTime > 3 && this.screen === 'match' && !tu.leaving) {
    tu.leaving = true;
    if (this.trophies) this.trophies.unlock('tutorial');
    this.trainingLast = null;
    setTimeout(() => { if (this.match === m) { this.renderer.setTutorialTarget(null); this.endTraining(); } }, 0);
  }
};

// cerchio giallo a terra (dove andare)
Renderer.prototype.setTutorialTarget = function (t) {
  if (!this.tutRing) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.2, 40), new THREE.MeshBasicMaterial({ color: 0xffd84a, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; g.add(ring);
    g.position.y = 0.03;
    this.tutRing = g; this.scene.add(g);
  }
  this.tutRing.visible = !!t;
  if (t) {
    this.tutRing.position.set(t.x, 0.03, t.z);
    const s = 1 + 0.08 * Math.sin(performance.now() / 180);
    this.tutRing.scale.set(s, 1, s);
  }
};
