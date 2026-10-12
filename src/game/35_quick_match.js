// ============================================================
// PARTITA VELOCE ONLINE — «Cerca avversario» (Gioca online → Partita veloce; server: cloud/src/online.js)
// Si entra in una coda sul server. Quando ci sono due giocatori: chi aspettava da prima apre la stanza (host)
// e manda il codice al server, l'altro (guest) lo legge ed entra da solo. Le squadre le sceglie il caso,
// l'host gioca in casa e l'avversario fuori casa; la partita parte da sola appena siete in due.
// Serve l'account (la partita vale per la classifica online).
// ============================================================
const QUICK = {
  POLL_MS: 1500,          // ogni quanto si chiede al server "come va?"
  GUEST_WAIT_MS: 25000,   // il guest aspetta il codice al massimo 25 secondi, poi cerca un altro avversario
  HOST_WAIT_MS: 30000,    // l'host aspetta che l'avversario entri al massimo 30 secondi
  START_DELAY_MS: 1500,   // appena entrati in due: un attimo per vedersi nella lobby, poi si comincia
  HALF_SECONDS: 180,      // tempi da 3 minuti
};

class QuickMatch {
  constructor(game) {
    this.g = game; this.api = game.eco.api;
    this.run = null;      // ricerca in corso: { t0, timer, matchedAt, opponent }
    $('on-quick').onclick = () => this.start();
  }
  searching() { return !!this.run; }

  start() {
    const g = this.g;
    if (!g.onlineServer() || !this.api.configured()) { g.onlineError('Nessun server online impostato: aggiungilo in Impostazioni → Online'); return; }
    if (!this.api.loggedIn()) { g.onlineError(tr('Per la partita veloce serve l\'account: accedi dalla Home.')); return; }
    this.stop();
    const run = { t0: Date.now(), timer: 0, matchedAt: 0, opponent: '' };
    this.run = run;
    g.busy(this.text(run), () => this.cancel());
    this.step(run, 'join');
  }
  // testo dell'avviso mentre si cerca (con i secondi passati)
  text(run) {
    const sec = Math.floor((Date.now() - run.t0) / 1000);
    if (run.opponent) return trf('Trovato {0}: entro nella partita…', run.opponent);
    return trf('Cerco un avversario… {0} s', sec);
  }
  showText(run) { if (run === this.run && !$('busy').hidden) $('busy-text').textContent = this.text(run); }
  later(run, action) {
    clearTimeout(run.timer);
    run.timer = setTimeout(() => this.step(run, action), QUICK.POLL_MS);
  }

  async step(run, action) {
    if (run !== this.run) return;
    let r;
    try { r = await this.api.post('/api/online/queue', { action: action }); }
    catch (e) {
      if (run !== this.run) return;
      this.stop();
      this.g.onlineError(e.status === 404 ? tr('Il server non ha ancora la partita veloce: va aggiornato alla 0.20 (nella cartella cloud: npm run deploy).') : e.message);
      return;
    }
    if (run !== this.run) return;
    if (r.status === 'none') { run.opponent = ''; this.later(run, 'join'); return; }   // tolti dalla coda (computer fermo?): si rientra
    if (r.status === 'waiting') { run.matchedAt = 0; run.opponent = ''; this.showText(run); this.later(run, 'poll'); return; }
    run.opponent = r.opponent || '?';
    this.showText(run);
    if (r.status === 'matched' && r.role === 'host') { this.openRoom(run, r.opponent); return; }
    if (r.status === 'ready') { this.enterRoom(run, r); return; }
    // guest: aspetto il codice della stanza; se non arriva cerco un altro avversario
    if (!run.matchedAt) run.matchedAt = Date.now();
    if (Date.now() - run.matchedAt > QUICK.GUEST_WAIT_MS) {
      run.matchedAt = 0; run.opponent = '';
      try { await this.api.post('/api/online/queue', { action: 'leave' }); } catch (e) { /* niente */ }
      this.later(run, 'join');
      return;
    }
    this.later(run, 'poll');
  }

  // sono l'host: apro la stanza e mando il codice al server
  async openRoom(run, opponent) {
    clearTimeout(run.timer);
    this.g.busy(null);
    await this.g.createOnline('server', { quick: opponent });
    const net = this.g.net;
    if (run !== this.run) return;                       // annullato intanto
    if (!net || net.quick !== opponent) { this.cancel(); return; }   // stanza non creata (l'errore è già a schermo)
    try { await this.api.post('/api/online/queue', { action: 'room', room: net.link.code }); }
    catch (e) { this.cancel(); this.g.leaveOnline(true); this.g.onlineError(e.message); return; }
    run.timer = setTimeout(() => {
      if (run !== this.run) return;
      if (this.g.net === net && !net.quickStarted) {
        this.g.leaveOnline(true);
        this.g.toast(tr('L\'avversario non è entrato nella partita: cerco ancora'), true);
        this.start();
      }
    }, QUICK.HOST_WAIT_MS);
  }
  // sono il guest: c'è il codice, entro
  enterRoom(run, r) {
    this.stop();
    this.api.post('/api/online/queue', { action: 'leave' }).catch(() => {});
    this.g.busy(null);
    this.g.joinOnline({ code: r.room, quick: r.opponent });
  }

  // lobby dell'host: appena entra l'avversario si comincia (solo la prima volta: la rivincita la avvia l'host)
  tryStart() {
    const g = this.g, net = g.net;
    if (!net || !net.host || !net.quick || net.quickStarted || net.quickStarting || !net.host.canStart()) return;
    net.quickStarting = true;
    this.stop();
    this.api.post('/api/online/queue', { action: 'leave' }).catch(() => {});
    g.toast(trf('{0} è entrato: si comincia!', net.quick));
    setTimeout(() => {
      net.quickStarting = false;
      if (g.net !== net || g.screen !== 'lobby' || !net.host.canStart()) return;
      net.quickStarted = true;
      const m = net.host.start();
      if (m) { g.enterOnlineMatch(m); if (g.trophies) g.trophies.unlock('quick_match'); }
    }, QUICK.START_DELAY_MS);
  }

  // squadre a caso (diverse) e regole della partita veloce
  setupHost(host, linkId, name, opponent) {
    const n = this.g.db.length;
    const home = Math.floor(Math.random() * n);
    let away = Math.floor(Math.random() * (n - 1));
    if (away >= home) away++;
    Object.assign(host.settings, { home: home, away: away, halfSeconds: QUICK.HALF_SECONDS, difficulty: 1 });
    host.lockSides = { [name]: 0, [opponent]: 1 };
    host.members.get(linkId).side = 0;
  }

  stop() {
    const run = this.run;
    this.run = null;
    if (run) clearTimeout(run.timer);
  }
  // Annulla: esco dalla coda
  cancel() {
    const had = !!this.run;
    this.stop();
    if (had || (this.g.net && this.g.net.quick)) this.api.post('/api/online/queue', { action: 'leave' }).catch(() => {});
  }
}
