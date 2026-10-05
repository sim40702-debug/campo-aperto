// ============================================================
// GUARDA PARTITA — partite del server viste nel gioco
// Il server calcola la partita con lo stesso motore e lo stesso seme; dal calcio d'inizio il seme è pubblico e
// il gioco la rigioca uguale, in tempo reale, allineata all'orologio del server (nessuna seconda simulazione:
// è la stessa). Gli eventi del server servono da controllo: se il gioco va diversamente (versione diversa,
// dati alterati) la visione si ferma e vale solo il risultato del server.
// ============================================================
const TEAM_DB_SEED_SERVER = 2026;   // come cloud/src/simulate.js (e Game: buildDatabase(2026))
const FXW_EVENTS_MS = 5000, FXW_BETS_MS = 12000, FXW_CATCHUP_STEPS = 1500;

class FixtureWatch {
  constructor(game, fx) {
    this.g = game; this.fx = fx;
    const db = buildDatabase(TEAM_DB_SEED_SERVER);   // database delle squadre identico a quello del server
    this.m = new Match(db[fx.home.id], db[fx.away.id], { halfSeconds: fx.halfSeconds, humanTeam: -1, rng: makeRng(fx.seed) });
    // partita già finita: si guarda dall'inizio; in corso: si salta al minuto attuale
    this.fromStart = fx.phase === 'FINISHED';
    this.startWall = Date.now();
    this.serverEvents = (fx.events || []).slice();
    this.evSeq = this.serverEvents.reduce((s, e) => Math.max(s, e.seq), 0);
    this.localGoals = [];
    this.desync = false; this.rewardDone = false;
    this.timers = [];
    this.lastShownSeq = -1;
  }

  // secondi di partita che dovrebbero essere trascorsi adesso
  target() {
    const t = this.fromStart ? (Date.now() - this.startWall) / 1000 : (this.g.eco.now() - this.fx.kickoffAt) / 1000;
    return Math.max(0, Math.min(t, this.fx.durationMs / 1000 + 1));
  }

  begin() {
    $('fxs-title').textContent = this.fx.home.short + ' – ' + this.fx.away.short;
    $('fxs-reward').hidden = true;
    this.renderEvents();
    if (!this.fromStart) this.timers.push(setInterval(() => { if (document.visibilityState === 'visible') this.pollEvents(); }, FXW_EVENTS_MS));
    this.timers.push(setInterval(() => { if (document.visibilityState === 'visible') this.pollBets(); }, FXW_BETS_MS));
    this.pollBets();
  }
  stop() { for (const id of this.timers) clearInterval(id); this.timers = []; }

  update(dt) {
    const g = this.g, m = this.m;
    const target = this.target();
    const behind = target - m.realTime;
    // molto indietro (entrata a partita iniziata): avanti veloce senza suoni ed effetti, a blocchi per fotogramma
    const fast = behind > 1;
    let steps = 0;
    const max = fast ? FXW_CATCHUP_STEPS : 12;
    while (m.realTime + CONFIG.DT * 0.5 < target && steps < max && m.state !== 'FULLTIME') {
      m.update(CONFIG.DT, null);
      steps++;
      for (const e of m.events) {
        if (e.type === 'ref' && e.data && e.data.type === 'GOAL') this.localGoals.push({ t: e.data.t, team: e.data.team });
        if (!fast) g.handleEvent(g.eventFromMatch(m, e));
      }
      m.events.length = 0;
    }
    // a fine partita il motore fa solo scorrere il tempo (niente più casualità): serve alla schermata finale
    if (m.state === 'FULLTIME') { m.update(dt, null); m.events.length = 0; }
    if (fast) { g.flashNote('Sincronizzazione con il server… ' + Math.round(m.realTime) + ' s'); g.replayPending = false; }
    this.check();
    if (this.desync) return;
    if (g.playReplay(dt)) return;
    const alpha = clamp((target - m.realTime) / CONFIG.DT + 1, 0, 1);
    g.afterSim(m, dt, 0.7, true, alpha);
    if (m.realTime * 1000 >= this.lastRender + 1000 || this.lastRender === undefined) { this.lastRender = m.realTime * 1000; this.renderEvents(); this.updateReward(); }
  }

  // controllo con gli eventi del server: i gol devono coincidere (stessa squadra, stesso istante)
  check() {
    if (this.desync) return;
    const known = this.fromStart ? this.fx.durationMs : (this.knownUntil || Math.max(0, (this.fx.elapsedMs || 0)));
    const upTo = Math.min(this.m.realTime * 1000 - 200, known - 200);
    if (upTo <= 0) return;
    const srv = this.serverEvents.filter(e => e.type === 'GOAL' && e.t_ms <= upTo);
    const loc = this.localGoals.filter(e => e.t * 1000 <= upTo);
    const same = srv.length === loc.length && srv.every((e, i) => e.team === loc[i].team && Math.abs(e.t_ms - loc[i].t * 1000) < 60);
    if (same) return;
    this.desync = true;
    this.g.toast('La partita sul tuo computer non coincide con quella del server: vale il risultato del server. Motore del server ' + this.fx.engine + ', del gioco ' + ENGINE_ID + '.', true);
    this.g.stopFixtureWatch(true);
  }

  async pollEvents() {
    try {
      const r = await this.g.eco.api.get('/api/fixtures/' + this.fx.code + '/events?after=' + this.evSeq);
      this.g.eco.sync(r.serverTime);
      for (const e of r.events) { this.serverEvents.push(e); this.evSeq = Math.max(this.evSeq, e.seq); }
      this.knownUntil = r.serverTime - this.fx.kickoffAt;
    } catch (e) { /* la visione continua: il controllo aspetta i prossimi eventi */ }
  }
  async pollBets() {
    try {
      const r = await this.g.eco.api.get('/api/fixtures/' + this.fx.code + '/bets');
      const box = $('fxs-bets');
      box.innerHTML = r.bets.length ? r.bets.slice(0, 10).map(b => this.g.eco.betCard(Object.assign({}, b, { items: b.items.filter(i => i.fixture === this.fx.code).concat(b.items.filter(i => i.fixture !== this.fx.code)) }))).join('') : '<p class="empty">Nessuna scommessa pubblica.</p>';
      // durante la partita si guarda soltanto: niente "copia" (le scommesse sono chiuse)
      box.querySelectorAll('[data-copy]').forEach(b => b.remove());
      this.g.eco.wireBetCards(box);
    } catch (e) { /* riprova al prossimo giro */ }
  }
  // cronaca: solo fino al punto della partita che si sta guardando (niente anticipazioni)
  renderEvents() {
    const now = this.m.realTime * 1000;
    const evs = this.serverEvents.filter(e => EVENT_TEXT[e.type] && e.t_ms <= now);
    const last = evs.length ? evs[evs.length - 1].seq : 0;
    if (last === this.lastShownSeq) return;
    this.lastShownSeq = last;
    $('fxs-ev').innerHTML = evs.length ? evs.slice().reverse().slice(0, 30).map(e => this.g.eco.eventLine(this.fx, e)).join('') : '<p class="empty">Nessun evento per ora.</p>';
  }
  updateReward() {
    const show = !this.fromStart && !this.rewardDone && this.g.eco.api.loggedIn() && this.m.realTime * 1000 >= this.fx.durationMs / 2 && this.m.state !== 'FULLTIME';
    $('fxs-reward').hidden = !show;
    if (show) $('fxs-reward').textContent = 'Premio spettatore +20 🪙';
  }
}
