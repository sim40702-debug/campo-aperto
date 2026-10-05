// ============================================================
// ECONOMIA — schermate: saldo, partite del server, centro partita, schedina, scommesse dei giocatori,
// negozio, personaggio e inventario, profilo, classifiche.
// Tutto quello che si vede viene dal server (saldo, quote, scommesse, oggetti): qui si mostra e si chiede,
// non si decide niente. Gli aggiornamenti sono a richiesta o a intervalli di secondi, solo sulla schermata aperta.
// ============================================================
const ECO_SCREENS = ['account', 'fixtures', 'center', 'bets', 'shop', 'character', 'profile'];
const MARKET_TABS = [['1X2', '1X2'], ['GOL', 'Gol'], ['CORNER', 'Corner'], ['CARTELLINI', 'Cartellini'], ['ALTRO', 'Altro']];
const REACTIONS = ['🔥', '👏', '💀', '👀'];
const SLOT_NAMES = { maglia: 'Maglia', pantaloncini: 'Pantaloncini', calzettoni: 'Calzettoni', scarpe: 'Scarpe', guanti: 'Guanti', capelli: 'Capelli', accessori: 'Accessori' };
const RARITY_NAMES = { comune: 'Comune', raro: 'Raro', epico: 'Epico', leggendario: 'Leggendario' };
const TX_NAMES = {
  INITIAL_BONUS: 'Monete di benvenuto', BET_PLACED: 'Scommessa giocata', BET_WON: 'Scommessa vinta', BET_REFUND: 'Scommessa annullata (rimborso)',
  SHOP_PURCHASE: 'Acquisto nel negozio', DAILY_REWARD: 'Bonus giornaliero', MATCH_REWARD: 'Premio spettatore', ACHIEVEMENT: 'Obiettivo', SEASON_PRIZE: 'Premio di stagione',
};
const FEED_FAST_MS = 6000, FEED_SLOW_MS = 20000;

class Economy {
  constructor(game) {
    this.g = game;
    this.api = new CampoApi(() => game.settings.apiUrl || DEFAULT_API_URL);
    this.skew = 0;                 // differenza tra l'orologio del server e quello del computer
    this.timers = [];
    this.slip = { items: [], copiedFrom: null, key: null, min: false };
    this.fx = null;                // partita aperta nel centro partita
    this.feed = { codes: new Set(), newest: 0, oldest: 0, empty: 0 };
    this.btTab = 'open'; this.btCursor = null; this.lb = { metric: 'profit', period: 'week' };
    this.shopCat = 'tutti'; this.shopItems = [];
    this.loadouts = new Map();     // aspetto dei giocatori (dal server), per pochi minuti
    this.api.onChange(() => { this.renderWallet(); this.pullPrefs(); });
    settingsSavedHook = s => this.prefsChanged(s);
    this.bind();
    this.renderWallet();
    if (this.api.loggedIn()) this.api.refresh().catch(() => this.renderWallet());
  }

  // ---------- generale ----------
  now() { return Date.now() + this.skew; }
  sync(serverTime) { if (serverTime) this.skew = serverTime - Date.now(); }
  balance() { return this.api.me ? this.api.me.balance : null; }
  renderWallet() {
    const b = this.balance();
    document.querySelectorAll('[data-balance]').forEach(el => { el.textContent = fmtCoins(b); });
    const logged = this.api.loggedIn();
    $('eco-user').textContent = logged ? 'Profilo' : 'Accedi';
    $('home-name').textContent = logged ? (this.api.username || 'Profilo') : 'Ospite';
    this.drawHomeAvatar();
  }
  // avatar nella scheda del giocatore in alto: l'aspetto indossato (dal server), testa e spalle
  drawHomeAvatar() {
    const cv = $('home-avatar');
    const user = this.api.loggedIn() ? this.api.username : null;
    const lo = user && this.loadouts.get(user.toLowerCase());
    drawAvatar(cv, lo && lo.lo ? lo.lo : { items: {}, number: 10, name: '' }, 'capelli');
    if (user && !lo && !this.avatarLoading) {
      this.avatarLoading = true;
      this.loadoutOf(user).then(() => { this.avatarLoading = false; this.drawHomeAvatar(); }, () => { this.avatarLoading = false; });
    }
  }
  msg(id, text, isErr) {
    const el = $(id);
    el.hidden = !text; el.textContent = text || '';
    el.className = 'ecomsg' + (isErr ? ' err' : '');
  }
  errText(e) {
    if (!e) return 'Errore';
    if (e.code === 'NO_SERVER') return 'Il server dell\'economia non è impostato: chiedi l\'indirizzo a chi gestisce il gioco e scrivilo in Impostazioni, Online.';
    return e.message || 'Errore';
  }
  every(ms, fn) { const id = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, ms); this.timers.push(id); return id; }
  stopTimers() { for (const id of this.timers) { clearInterval(id); clearTimeout(id); } this.timers = []; }

  bind() {
    const g = this.g;
    $('eco-wallet').onclick = () => this.open('profile');
    $('eco-user').onclick = () => this.open(this.api.loggedIn() ? 'profile' : 'account');
    document.querySelectorAll('[data-eco]').forEach(b => b.onclick = () => this.open(b.dataset.eco));
    // account
    $('ac-login').onclick = () => this.doLogin();
    $('ac-pass').onkeydown = e => { if (e.key === 'Enter') this.doLogin(); };
    $('ac-register').onclick = () => this.doRegister();
    $('ac-back').onclick = () => g.showScreen('menu');
    $('ac-server-edit').onclick = () => g.openSettings('online', 'account');
    // partite
    $('fx-back').onclick = () => g.showScreen('menu');
    $('fx-refresh').onclick = () => this.loadFixtures();
    $('fx-ai').onclick = () => { g.setup.side = -1; g.showScreen('setup'); };
    // centro partita
    $('mc-back').onclick = () => this.open('fixtures');
    $('mc-more').onclick = () => this.loadFeed('older');
    $('mc-watch').onclick = () => this.watch();
    // schedina
    $('slip-min').onclick = () => { this.slip.min = !this.slip.min; this.renderSlip(); };
    $('slip-clear').onclick = () => { this.slip.items = []; this.slip.copiedFrom = null; this.slip.conflict = null; this.slipChanged(); };
    $('slip-stake').oninput = () => {
      this.slip.key = null; this.renderSlipTotals();
      clearTimeout(this.quoteTimer); if (this.slip.items.length) this.quoteTimer = setTimeout(() => this.requote(), 400);
    };
    $('slip-confirm').onclick = () => this.confirmBet();
    $('slip-public').onchange = () => { this.slip.key = null; };
    // scommesse
    document.querySelectorAll('[data-bt]').forEach(b => b.onclick = () => { this.btTab = b.dataset.bt; this.loadBets(false); });
    $('bt-more').onclick = () => this.loadBets(true);
    $('bt-back').onclick = () => g.showScreen('menu');
    $('bt-open').onclick = () => this.openBetCode();
    $('bt-code').onkeydown = e => { if (e.key === 'Enter') this.openBetCode(); };
    $('bt-code').oninput = () => { const v = $('bt-code').value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); if (v !== $('bt-code').value) $('bt-code').value = v; };
    // negozio e personaggio
    $('sh-back').onclick = () => g.showScreen('menu');
    $('sh-char').onclick = () => this.open('character');
    $('ch-back').onclick = () => g.showScreen('menu');
    $('ch-shop').onclick = () => this.open('shop');
    $('ch-save').onclick = () => this.saveAvatar();
    $('ch-name').oninput = () => { const v = $('ch-name').value.toUpperCase().replace(/[^A-Z0-9 .'-]/g, ''); if (v !== $('ch-name').value) $('ch-name').value = v; this.drawCharPreview(); };
    $('ch-number').oninput = () => this.drawCharPreview();
    // profilo
    $('pf-back').onclick = () => g.showScreen('menu');
    $('pf-logout').onclick = () => g.confirmClick($('pf-logout'), 'Sicuro? Esci', async () => { await this.api.logout(); g.showScreen('menu'); g.toast('Sei uscito dall\'account'); });
    $('pf-public').onchange = () => this.setPrivacy($('pf-public').checked);
    $('pf-tx-more').onclick = () => this.loadTx(true);
    // pannello durante la visione
    $('fxs-min').onclick = () => { $('fxside').classList.toggle('min'); $('fxs-min').textContent = $('fxside').classList.contains('min') ? 'Apri' : 'Riduci'; };
    document.querySelectorAll('[data-fxs]').forEach(b => b.onclick = () => {
      document.querySelectorAll('[data-fxs]').forEach(x => x.classList.toggle('on', x === b));
      $('fxs-ev').hidden = b.dataset.fxs !== 'ev'; $('fxs-bets').hidden = b.dataset.fxs !== 'bets';
    });
    $('fxs-reward').onclick = () => this.claimWatchReward();
  }

  // apre una schermata dell'economia. Senza account: prima l'accesso (tranne le partite, che si possono guardare)
  open(name) {
    if (name === 'inventory') { this.open('character'); setTimeout(() => $('inventory-title').scrollIntoView({ block: 'start' }), 60); return; }
    const needsLogin = ['bets', 'shop', 'character', 'profile'].includes(name);
    if (needsLogin && !this.api.loggedIn()) { this.afterLogin = name; name = 'account'; }
    this.g.showScreen(name);
  }

  // chiamata da Game.showScreen
  onShow(name) {
    this.stopTimers();
    const slipScreens = ['fixtures', 'center', 'bets'];
    this.slipVisible = slipScreens.includes(name);
    this.renderSlip();
    if (name === 'menu') { this.renderWallet(); if (this.api.loggedIn() && !this.api.me) this.api.refresh().catch(() => {}); }
    if (name === 'account') this.renderAccount();
    if (name === 'fixtures') { this.loadFixtures(); this.every(20000, () => this.loadFixtures(true)); this.every(1000, () => this.tickCountdowns()); }
    if (name === 'center') this.startCenter();
    if (name === 'bets') this.loadBets(false);
    if (name === 'shop') this.loadShop();
    if (name === 'character') this.loadCharacter();
    if (name === 'profile') this.loadProfile();
    if (slipScreens.includes(name) && this.slip.items.length) { this.requote(); this.every(20000, () => this.requote()); }
  }

  // ---------- comandi personalizzati sull'account ----------
  // Con l'account i comandi seguono il giocatore su ogni computer; senza, restano solo su questo (localStorage).
  // Vince la configurazione modificata per ultima.
  controlsOf(s) { return { keys: s.keys, padKeys: s.padKeys, mouse: s.mouse, padLayout: s.padLayout, deadzone: s.deadzone, vibration: s.vibration, assistReceive: s.assistReceive }; }
  prefsChanged(s) {
    if (this.applyingPrefs) return;
    const sig = JSON.stringify(this.controlsOf(s));
    if (sig === this.lastControlsSig) return;
    const first = this.lastControlsSig === undefined;
    this.lastControlsSig = sig;
    if (first) return;                         // primo salvataggio dopo l'avvio: niente di nuovo
    s.controlsUpdatedAt = Date.now();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* */ }
    if (!this.api.loggedIn()) return;
    clearTimeout(this.prefsTimer);
    this.prefsTimer = setTimeout(() => {
      this.api.post('/api/me/prefs', { prefs: Object.assign(this.controlsOf(this.g.settings), { updatedAt: this.g.settings.controlsUpdatedAt }) }).catch(() => { /* al prossimo cambio */ });
    }, 1500);
  }
  pullPrefs() {
    const me = this.api.me, s = this.g.settings;
    if (this.lastControlsSig === undefined) this.lastControlsSig = JSON.stringify(this.controlsOf(s));
    if (!me) return;
    if (!me.prefs) {
      // account senza comandi salvati: si salvano quelli di questo computer, se sono stati personalizzati
      if (s.controlsUpdatedAt && !this.prefsSent) { this.prefsSent = true; this.api.post('/api/me/prefs', { prefs: Object.assign(this.controlsOf(s), { updatedAt: s.controlsUpdatedAt }) }).catch(() => {}); }
      return;
    }
    if (this.prefsSeen === me.prefs.updatedAt) return;
    this.prefsSeen = me.prefs.updatedAt;
    const local = s.controlsUpdatedAt || 0;
    if ((me.prefs.updatedAt || 0) > local) {
      // configurazione dell'account più recente: si applica qui
      this.applyingPrefs = true;
      const p = me.prefs;
      if (p.keys) s.keys = Object.assign({}, s.keys, p.keys);
      if (p.padKeys) s.padKeys = Object.assign({}, s.padKeys, p.padKeys);
      for (const k of ['mouse', 'padLayout', 'deadzone', 'vibration', 'assistReceive']) if (p[k] !== undefined) s[k] = p[k];
      s.controlsUpdatedAt = p.updatedAt;
      this.g.input.setKeys(s.keys); this.g.input.setPadKeys(s.padKeys); this.g.input.mouseEnabled = s.mouse; this.g.applyPadSettings();
      saveSettings(s);
      this.lastControlsSig = JSON.stringify(this.controlsOf(s));
      this.applyingPrefs = false;
      if (this.g.screen === 'settings') this.g.renderSettings();
    } else if (local > (me.prefs.updatedAt || 0)) {
      this.api.post('/api/me/prefs', { prefs: Object.assign(this.controlsOf(s), { updatedAt: local }) }).catch(() => {});
    }
  }

  // ---------- account ----------
  renderAccount() {
    const ok = this.api.configured();
    $('ac-noserver').hidden = ok;
    $('ac-noserver').textContent = 'Il server dell\'economia non è impostato. Scrivi il suo indirizzo (https://…) in Impostazioni, Online.';
    $('ac-server').textContent = this.api.base() || 'nessuno';
    $('ac-login').disabled = $('ac-register').disabled = !ok;
    $('ac-status').textContent = ''; $('ac-status').className = 'status';
    if (this.api.username) $('ac-user').value = this.api.username;
  }
  acStatus(text, isErr) { $('ac-status').textContent = text; $('ac-status').className = 'status' + (isErr ? ' err' : ' ok'); }
  async doLogin() {
    const u = $('ac-user').value.trim(), p = $('ac-pass').value;
    if (!u || !p) return this.acStatus('Scrivi nome utente e password', true);
    this.acStatus('Accesso…');
    try {
      await this.api.login(u, p);
      $('ac-pass').value = '';
      this.g.toast('Bentornato, ' + this.api.username);
      this.afterAuth();
    } catch (e) { this.acStatus(this.errText(e), true); }
  }
  async doRegister() {
    const u = $('ac-new-user').value.trim(), p = $('ac-new-pass').value, p2 = $('ac-new-pass2').value;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(u)) return this.acStatus('Nome utente: da 3 a 16 caratteri tra lettere, numeri e _', true);
    if (p.length < 8) return this.acStatus('La password deve avere almeno 8 caratteri', true);
    if (p !== p2) return this.acStatus('Le due password non coincidono', true);
    this.acStatus('Creo l\'account…');
    try {
      await this.api.register(u, p);
      $('ac-new-pass').value = $('ac-new-pass2').value = '';
      this.g.toast('Account creato: ' + fmtCoins(this.balance()) + ' monete di benvenuto');
      this.afterAuth();
    } catch (e) { this.acStatus(this.errText(e), true); }
  }
  afterAuth() {
    const next = this.afterLogin || 'menu';
    this.afterLogin = null;
    if (next === 'menu') this.g.showScreen('menu'); else this.open(next);
  }
  needLogin() {
    if (this.api.loggedIn()) return false;
    this.afterLogin = this.g.screen;
    this.g.showScreen('account');
    return true;
  }

  // ---------- partite ----------
  async loadFixtures(quiet) {
    if (!this.api.configured()) { this.msg('fx-msg', this.errText({ code: 'NO_SERVER' }), true); $('fx-list').innerHTML = ''; return; }
    try {
      const r = await this.api.get('/api/fixtures');
      this.sync(r.serverTime);
      this.fixtures = r;
      this.msg('fx-msg', '');
      this.renderFixtures();
    } catch (e) { if (!quiet || !this.fixtures) this.msg('fx-msg', this.errText(e), true); }
  }
  renderFixtures() {
    const r = this.fixtures;
    const row = f => {
      const score = f.score ? '<span class="sc">' + f.score[0] + ' – ' + f.score[1] + '</span>' : '<span class="small">contro</span>';
      const pill = f.phase === 'LIVE' ? '<span class="pill live">In corso</span>' : f.phase === 'OPEN' ? '<span class="pill open">Scommesse aperte</span>' : f.phase === 'CLOSED' ? '<span class="pill">Chiuse</span>' : '<span class="pill">Finita</span>';
      return '<button class="fxrow ' + (f.phase === 'LIVE' ? 'live' : f.phase === 'OPEN' ? 'open' : '') + '" data-fx="' + esc(f.code) + '">' +
        '<span class="when" data-countdown="' + f.kickoffAt + '" data-phase="' + f.phase + '">' + this.whenText(f) + '</span>' +
        '<span class="vs"><span class="kitdot" style="background:' + esc(f.home.kit) + '"></span>' + esc(f.home.name) + ' ' + score + ' ' + esc(f.away.name) + '<span class="kitdot" style="background:' + esc(f.away.kit) + '"></span></span>' +
        pill + '<span class="small">' + f.bets + (f.bets === 1 ? ' scommessa' : ' scommesse') + '</span></button>';
    };
    const grp = (title, list) => list.length ? '<div class="fxgroup">' + title + '</div>' + list.map(row).join('') : '';
    $('fx-list').innerHTML = grp('In corso', r.live) + grp('Prossime', r.next) + grp('Finite', r.finished) ||
      '<p class="empty">Nessuna partita in programma: il server ne crea di nuove ogni pochi minuti.</p>';
    $('fx-list').querySelectorAll('[data-fx]').forEach(b => b.onclick = () => this.openCenter(b.dataset.fx));
  }
  whenText(f) {
    const t = this.now();
    if (f.phase === 'LIVE' || (t >= f.kickoffAt && f.phase !== 'FINISHED' && !f.result)) return 'In corso';
    if (f.phase === 'FINISHED' || f.result) return new Date(f.kickoffAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const s = Math.max(0, Math.round((f.kickoffAt - t) / 1000));
    return 'tra ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  tickCountdowns() {
    let refetch = false;
    document.querySelectorAll('[data-countdown]').forEach(el => {
      const k = Number(el.dataset.countdown);
      if (el.dataset.phase === 'OPEN' || el.dataset.phase === 'CLOSED') {
        el.textContent = this.whenText({ kickoffAt: k, phase: el.dataset.phase });
        if (this.now() > k + 1500) refetch = true;
      }
    });
    if (refetch && !this.fxReload) { this.fxReload = true; setTimeout(() => { this.fxReload = false; this.loadFixtures(true); }, 1500); }
  }

  // ---------- centro partita ----------
  openCenter(code) { this.centerCode = code; this.g.showScreen('center'); }
  startCenter() {
    const code = this.centerCode;
    if (!code) return;
    if (!this.fx || this.fx.code !== code) {
      this.fx = null; this.mcTab = this.mcTab || '1X2';
      this.feed = { codes: new Set(), newest: 0, oldest: 0, empty: 0 };
      $('mc-feed').innerHTML = '<p class="empty">Carico le scommesse…</p>';
      $('mc-markets').innerHTML = ''; $('mc-popular').innerHTML = ''; $('mc-stats').innerHTML = ''; $('mc-events').innerHTML = '';
      $('mc-teams').textContent = ''; $('mc-state').textContent = '';
    }
    this.loadCenter().then(() => this.loadFeed('first'));
    this.loadSocialStats();
    this.every(15000, () => this.loadCenter(true));
    this.every(20000, () => this.loadSocialStats());
    this.every(1000, () => this.renderCenterState());
    this.scheduleFeed(FEED_FAST_MS);
  }
  // aggiornamento del feed: ogni 6 s se arrivano scommesse nuove, ogni 20 s se è tutto fermo
  scheduleFeed(ms) {
    const id = setTimeout(async () => {
      if (this.g.screen !== 'center') return;
      let got = 0;
      if (document.visibilityState === 'visible') got = await this.loadFeed('newer');
      this.feed.empty = got ? 0 : this.feed.empty + 1;
      this.scheduleFeed(this.feed.empty >= 3 ? FEED_SLOW_MS : FEED_FAST_MS);
    }, ms);
    this.timers.push(id);
  }
  async loadCenter(quiet) {
    try {
      const d = await this.api.get('/api/fixtures/' + encodeURIComponent(this.centerCode));
      this.sync(d.serverTime);
      const prev = this.fx && this.fx.code === d.code ? this.fx : null;
      this.fx = d;
      this.msg('mc-msg', '');
      this.renderCenter();
      // partita liquidata mentre la si guardava: aggiorna gli esiti (✅/❌) delle scommesse già mostrate
      if (prev && !prev.settled && d.settled) { this.refreshFeedStatuses(); this.api.refreshBalance().catch(() => {}); }
    } catch (e) { if (!quiet) this.msg('mc-msg', this.errText(e), true); }
  }
  renderCenter() {
    const f = this.fx;
    if (!f) return;
    $('mc-title').textContent = f.home.short + ' – ' + f.away.short;
    const sc = f.score ? '<span class="sc">' + f.score[0] + ' – ' + f.score[1] + '</span>' : '<span class="small">contro</span>';
    $('mc-teams').innerHTML = '<span class="kitdot" style="background:' + esc(f.home.kit) + '"></span>' + esc(f.home.name) + ' ' + sc + ' ' + esc(f.away.name) + '<span class="kitdot" style="background:' + esc(f.away.kit) + '"></span>';
    this.renderCenterState();
    // schede dei mercati
    $('mc-tabs').innerHTML = MARKET_TABS.map(([id, label]) => '<button class="tab' + (this.mcTab === id ? ' on' : '') + '" data-mt="' + id + '" role="tab">' + label + '</button>').join('');
    $('mc-tabs').querySelectorAll('[data-mt]').forEach(b => b.onclick = () => { this.mcTab = b.dataset.mt; this.renderCenter(); });
    this.renderMarkets();
    // cronaca: solo gli eventi già avvenuti (il server non manda quelli futuri)
    const evs = (f.events || []).filter(e => EVENT_TEXT[e.type]).slice().reverse();
    $('mc-events-card').hidden = !evs.length && f.phase !== 'LIVE';
    $('mc-events').innerHTML = evs.length ? evs.slice(0, 40).map(e => this.eventLine(f, e)).join('') : '<p class="empty">Nessun evento per ora.</p>';
    if (f.result) {
      const R = f.result;
      $('mc-events').insertAdjacentHTML('afterbegin', '<p class="small">Finale: tiri ' + R.shots[0] + '–' + R.shots[1] + ', in porta ' + R.onTarget[0] + '–' + R.onTarget[1] + ', corner ' + R.corners[0] + '–' + R.corners[1] + ', cartellini ' + R.cards[0] + '–' + R.cards[1] + '</p>');
    }
  }
  eventLine(f, e) {
    const team = e.team === 0 ? f.home.short : e.team === 1 ? f.away.short : '';
    return '<div class="ev">' + e.minute + "' " + EVENT_TEXT[e.type] + (team ? ' · ' + esc(team) : '') + (e.player ? ' · ' + esc(e.player) : '') + (e.detail ? ' <span class="small">(' + esc(e.detail) + ')</span>' : '') + '</div>';
  }
  renderCenterState() {
    const f = this.fx;
    if (!f) return;
    const t = this.now();
    let st;
    if (f.phase === 'OPEN' && t < f.closesAt) { const s = Math.round((f.closesAt - t) / 1000); st = 'Scommesse aperte: chiudono tra ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    else if (t < f.kickoffAt) { const s = Math.max(0, Math.round((f.kickoffAt - t) / 1000)); st = 'Scommesse chiuse. Calcio d\'inizio tra ' + s + ' s'; }
    else if (f.phase === 'FINISHED' || f.result) st = f.settled ? 'Finita, scommesse liquidate' : 'Finita, liquidazione in corso';
    else st = 'In corso';
    $('mc-state').textContent = st;
    // la fase cambia con l'orologio: si chiede subito al server invece di aspettare il prossimo giro
    if ((f.phase === 'OPEN' && t >= f.closesAt) || (f.phase === 'CLOSED' && t >= f.kickoffAt) || (f.phase === 'LIVE' && f.durationMs && t >= f.kickoffAt + f.durationMs)) {
      if (!this.phaseReload) { this.phaseReload = true; setTimeout(() => { this.phaseReload = false; this.loadCenter(true); }, 1200); }
    }
    const canWatch = t >= f.kickoffAt && f.seed !== undefined;
    const sameEngine = f.engine === ENGINE_ID;
    $('mc-watch').disabled = !canWatch || !sameEngine;
    $('mc-watch').textContent = f.phase === 'FINISHED' ? 'Guarda dall\'inizio' : 'Guarda partita';
    $('mc-watch').title = !sameEngine ? 'Questa partita è stata calcolata con un altro motore (' + f.engine + ', il tuo gioco ha ' + ENGINE_ID + '): aggiorna il gioco per guardarla in 3D. Cronaca e risultato restano qui.' : !canWatch ? 'Si può guardare dal calcio d\'inizio' : '';
  }
  renderMarkets() {
    const f = this.fx;
    if (!f || !f.markets) return;
    const open = f.phase === 'OPEN' && this.now() < f.closesAt;
    const list = f.markets.filter(m => m.group === this.mcTab && m.sels.length);
    $('mc-markets').innerHTML = (!open ? '<p class="small">' + (f.phase === 'OPEN' || f.phase === 'CLOSED' ? 'Scommesse chiuse: la partita sta per iniziare.' : 'Scommesse chiuse.') + '</p>' : '') +
      (list.length ? list.map(m => '<div class="mkt"><h4>' + esc(m.label) + '</h4><div class="sels">' + m.sels.map(s => {
        const on = this.slip.items.some(i => i.fixture === f.code && i.market === m.id && i.selection === s.id);
        // smorzata se non può vincere insieme alle selezioni già in schedina (cliccandola si vede il motivo)
        const blocked = !on && open && this.blockedSel(f.code, m.id, s.id);
        return '<button class="sel' + (on ? ' on' : '') + (blocked ? ' blocked' : '') + '" data-m="' + esc(m.id) + '" data-s="' + esc(s.id) + '"' + (open ? '' : ' disabled') +
          (blocked ? ' title="Incompatibile con la schedina"' : '') + '><span>' + esc(s.label) + '</span><b>' + fmtOdds(s.odds) + '</b></button>';
      }).join('') + '</div></div>').join('') : '<p class="empty">Nessun mercato in questa scheda.</p>');
    $('mc-markets').querySelectorAll('[data-m]').forEach(b => b.onclick = () => this.toggleSelection(b.dataset.m, b.dataset.s));
  }

  // selezioni incompatibili con la schedina, calcolate una volta per ogni stato della schedina (non a ogni disegno)
  blockedSel(fixture, market, selection) {
    const sl = this.slip;
    if (!sl.items.some(i => i.fixture === fixture)) return false;
    const sig = fixture + '#' + this.slipSig();
    if (this.blockCache && this.blockCache.sig === sig && market + ':' + selection in this.blockCache.map) return this.blockCache.map[market + ':' + selection];
    if (!this.blockCache || this.blockCache.sig !== sig) this.blockCache = { sig: sig, map: {} };
    const r = BetLogic.checkAdd(sl.items, { fixture: fixture, market: market, selection: selection });
    return (this.blockCache.map[market + ':' + selection] = !r.ok && r.code === 'INCOMPATIBLE');
  }

  async loadSocialStats() {
    const code = this.centerCode;
    try {
      const [pop, st] = await Promise.all([this.api.get('/api/fixtures/' + code + '/popular'), this.api.get('/api/fixtures/' + code + '/stats')]);
      if (code !== this.centerCode) return;
      $('mc-popular').innerHTML = pop.top.length ? pop.top.map(p =>
        '<div class="poprow"><span>' + esc(p.selectionLabel) + ' <span class="small">' + esc(p.marketLabel) + '</span></span><b>' + p.share + '%</b>' +
        '<span class="small">' + p.bets + (p.bets === 1 ? ' giocata' : ' giocate') + ' · ' + fmtCoins(p.coins) + ' 🪙</span><span></span>' +
        '<div class="bar"><div style="width:' + p.share + '%"></div></div></div>').join('') : '<p class="empty">Ancora nessuna giocata.</p>';
      const sp = st.split1X2;
      $('mc-stats').innerHTML = '<div class="statgrid"><span>Scommesse</span><b>' + st.bets + '</b><span>Giocatori</span><b>' + st.players + '</b><span>Monete puntate</span><b>' + fmtCoins(st.coins) + '</b></div>' +
        (sp.bets ? '<p class="small" style="margin:10px 0 0">Esito finale, quota delle giocate (' + sp.bets + ')</p><div class="split">' +
          [['1', '#ffd84a'], ['X', '#9fd8ff'], ['2', '#57c26e']].map(([k, c]) => sp[k] ? '<div style="width:' + sp[k] + '%;background:' + c + '">' + k + ' ' + sp[k] + '%</div>' : '').join('') + '</div>' : '') +
        (st.topMarket ? '<p class="small">Mercato più giocato: ' + esc(st.topMarket.label) + ' (' + st.topMarket.bets + ')</p>' : '') +
        (st.biggestPotential ? '<p class="small">Vincita possibile più alta: ' + fmtCoins(st.biggestPotential.amount) + ' 🪙 di ' + esc(st.biggestPotential.user) + '</p>' : '');
    } catch (e) { /* le statistiche sono un di più: riprova al prossimo giro */ }
  }

  // ---------- scommesse dei giocatori (feed) ----------
  // first: prima pagina; older: "Mostra altre"; newer: solo le nuove (aggiornamento leggero, senza doppioni)
  async loadFeed(kind) {
    const code = this.centerCode;
    if (!code) return 0;
    const q = kind === 'older' ? '?before=' + this.feed.oldest : kind === 'newer' ? '?after=' + this.feed.newest : '';
    let r;
    try { r = await this.api.get('/api/fixtures/' + code + '/bets' + q); } catch (e) { if (kind === 'first') $('mc-feed').innerHTML = '<p class="empty">' + esc(this.errText(e)) + '</p>'; return 0; }
    if (code !== this.centerCode) return 0;
    if (kind === 'first') this.feed.codes = new Set();   // la prima pagina ridisegna tutto: nessun doppione, nessun buco
    const fresh = r.bets.filter(b => !this.feed.codes.has(b.code));
    fresh.forEach(b => this.feed.codes.add(b.code));
    if (r.cursor) {
      if (kind === 'first') { this.feed.newest = r.cursor.newest; this.feed.oldest = r.cursor.oldest; }
      else if (kind === 'older') this.feed.oldest = r.cursor.oldest;
      else { this.feed.newest = Math.max(this.feed.newest, r.cursor.newest); if (!this.feed.oldest) this.feed.oldest = r.cursor.oldest; }
    }
    const box = $('mc-feed');
    if (kind === 'first') box.innerHTML = '';
    if (box.querySelector('.empty')) box.innerHTML = '';
    const html = fresh.map(b => this.betCard(b)).join('');
    if (kind === 'newer') box.insertAdjacentHTML('afterbegin', html); else box.insertAdjacentHTML('beforeend', html);
    if (!box.children.length) box.innerHTML = '<p class="empty">Nessuna scommessa pubblica su questa partita. Sii il primo!</p>';
    if (kind !== 'newer') $('mc-more').hidden = !r.more;
    this.wireBetCards(box);
    return fresh.length;
  }
  async refreshFeedStatuses() {
    const codes = [...this.feed.codes].slice(0, 50);
    if (!codes.length) return;
    try {
      const r = await this.api.post('/api/bets/status', { codes: codes });
      for (const b of r.bets) {
        const el = document.querySelector('#mc-feed [data-bet="' + b.code + '"]');
        if (el && el.dataset.status !== b.status) this.updateBetCard(b.code);
      }
    } catch (e) { /* al prossimo aggiornamento */ }
  }
  async updateBetCard(code) {
    try {
      const b = await this.api.get('/api/bets/' + code);
      document.querySelectorAll('[data-bet="' + code + '"]').forEach(el => {
        el.outerHTML = this.betCard(b);
      });
      document.querySelectorAll('[data-bet="' + code + '"]').forEach(el => this.wireBetCards(el.parentNode));
    } catch (e) { /* resta com'era */ }
  }

  betCard(b) {
    const st = b.status;
    const badge = st === 'WON' ? '<span class="pill won">✅ Vinta +' + fmtCoins(b.payout) + '</span>' : st === 'LOST' ? '<span class="pill lost">❌ Persa</span>' : st === 'VOID' ? '<span class="pill void">↩ Annullata</span>' : '<span class="pill">In corso</span>';
    const itemIcon = s => s === 'WON' ? '✅' : s === 'LOST' ? '❌' : s === 'VOID' ? '↩' : '•';
    const anyOpen = b.items.some(i => i.status === 'OPEN' && i.kickoffAt > this.now());
    const when = new Date(b.createdAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return '<div class="betcard ' + (st === 'WON' ? 'won' : st === 'LOST' ? 'lost' : st === 'OPEN' ? 'open' : '') + '" data-bet="' + esc(b.code) + '" data-status="' + st + '">' +
      '<div class="who"><b>' + esc(b.user) + '</b>' + (b.mine ? '<span class="pill">Tua</span>' : '') + '<span>' + (b.type === 'MULTIPLA' ? 'Multipla' : 'Singola') + '</span><span>' + when + '</span><span>' + esc(b.code) + '</span>' + badge +
      (b.copiedFrom ? '<span>copiata da ' + esc(b.copiedFrom) + '</span>' : '') + (b.mine && b.visibility === 'private' ? '<span class="pill">Privata</span>' : '') + '</div>' +
      '<div class="items">' + b.items.map(i => '<div class="it"><span>' + itemIcon(i.status) + '</span><span><b>' + esc(i.selectionLabel) + '</b> <span class="small">' + esc(i.marketLabel) + ' · ' + esc(i.home) + ' – ' + esc(i.away) + '</span></span><span class="small" style="margin-left:auto">@' + fmtOdds(i.odds) + '</span></div>').join('') + '</div>' +
      '<div class="money">' + fmtCoins(b.stake) + ' 🪙 @' + fmtOdds(b.odds) + ' <span class="small">→ ' + fmtCoins(b.potentialPayout) + ' 🪙 possibili</span></div>' +
      '<div class="acts">' + REACTIONS.map(r => '<button class="react' + (b.myReactions.includes(r) ? ' on' : '') + '" data-react="' + r + '"' + (b.mine ? ' disabled title="Non puoi reagire alle tue scommesse"' : '') + '>' + r + (b.reactions[r] ? ' ' + b.reactions[r] : '') + '</button>').join('') +
      (!b.mine && anyOpen ? '<button class="ghost" data-copy="1">Copia scommessa</button>' : '') +
      (b.copies ? '<span class="small">' + b.copies + (b.copies === 1 ? ' copia' : ' copie') + '</span>' : '') +
      (b.mine ? '<button class="ghost" data-share="1">Condividi</button><button class="ghost" data-vis="' + (b.visibility === 'private' ? 'public' : 'private') + '">' + (b.visibility === 'private' ? 'Rendi pubblica' : 'Rendi privata') + '</button>' : '') +
      '</div></div>';
  }
  wireBetCards(root) {
    root.querySelectorAll('.betcard').forEach(card => {
      if (card.dataset.wired) return;
      card.dataset.wired = '1';
      const code = card.dataset.bet;
      card.querySelectorAll('[data-react]').forEach(btn => btn.onclick = () => this.react(code, btn.dataset.react));
      const cp = card.querySelector('[data-copy]'); if (cp) cp.onclick = () => this.copyBet(code);
      const sh = card.querySelector('[data-share]'); if (sh) sh.onclick = () => this.shareBet(code);
      const vs = card.querySelector('[data-vis]'); if (vs) vs.onclick = () => this.setVisibility(code, vs.dataset.vis);
    });
  }
  async react(code, emoji) {
    if (this.needLogin()) return;
    try {
      const r = await this.api.post('/api/bets/' + code + '/react', { emoji: emoji });
      document.querySelectorAll('[data-bet="' + code + '"] [data-react]').forEach(btn => {
        const e = btn.dataset.react;
        btn.textContent = e + (r.reactions[e] ? ' ' + r.reactions[e] : '');
        if (e === emoji) btn.classList.toggle('on', r.on);
      });
    } catch (e) { this.g.toast(this.errText(e), true); }
  }
  async shareBet(code) {
    try {
      await this.api.post('/api/bets/' + code + '/share');
      try { await navigator.clipboard.writeText(code); this.g.toast('Codice ' + code + ' copiato: chi lo apre in Scommesse vede la giocata'); }
      catch (e) { this.g.toast('Condivisa: il codice è ' + code); }
    } catch (e) { this.g.toast(this.errText(e), true); }
  }
  async setVisibility(code, vis) {
    try { await this.api.post('/api/bets/' + code + '/visibility', { visibility: vis }); await this.updateBetCard(code); this.g.toast(vis === 'private' ? 'Scommessa privata' : 'Scommessa pubblica'); }
    catch (e) { this.g.toast(this.errText(e), true); }
  }

  // ---------- schedina ("La mia schedina") ----------
  // Più selezioni anche della stessa partita, se possono vincere insieme: il controllo è BetLogic (lo stesso
  // codice del server), immediato; quote, quota collegata, bonus e vincita li conferma il server a ogni cambio.
  slipItem(f, market, selection) {
    const m = f.markets.find(x => x.id === market), s = m && m.sels.find(x => x.id === selection);
    if (!s) return null;
    return { fixture: f.code, home: f.home.name, away: f.away.name, kickoffAt: f.kickoffAt, market: market, selection: selection, marketLabel: m.label, selectionLabel: s.label, odds: s.odds, available: true };
  }
  toggleSelection(market, selection) {
    const f = this.fx, sl = this.slip;
    const item = this.slipItem(f, market, selection);
    if (!item) return;
    const i = sl.items.findIndex(x => x.fixture === f.code && x.market === market && x.selection === selection);
    if (i >= 0) { sl.items.splice(i, 1); sl.conflict = null; this.slipChanged(); return; }
    const chk = BetLogic.checkAdd(sl.items, item);
    if (chk.ok) { sl.items.push(item); sl.conflict = null; sl.copiedFrom = null; this.slipChanged(); return; }
    if (chk.code === 'TOO_MANY') { this.g.toast('Al massimo ' + BetLogic.MAX_SELECTIONS + ' selezioni in una schedina', true); return; }
    // incompatibile: non entra; si mostra il motivo e quale selezione lo causa, con la scelta di sostituirla
    sl.conflict = { item: item, with: chk.conflicts };
    sl.min = false;
    this.renderSlip();
  }
  conflictText(c) {
    const lab = x => '«' + x.marketLabel + ': ' + x.selectionLabel + '»';
    const others = c.with.map(k => this.slip.items[k]).filter(Boolean);
    return others.length === 1 ? lab(c.item) + ' non si può combinare con ' + lab(others[0]) + '.'
      : lab(c.item) + ' non può vincere insieme a ' + others.map(lab).join(' e ') + '.';
  }
  resolveConflict(replace) {
    const sl = this.slip, c = sl.conflict;
    sl.conflict = null;
    if (replace && c) {
      sl.items = sl.items.filter((_, k) => !c.with.includes(k));
      if (BetLogic.checkAdd(sl.items, c.item).ok) sl.items.push(c.item);
      sl.copiedFrom = null;
    }
    this.slipChanged();
  }
  // ogni cambio della schedina: nuova chiave di invio, disegno subito (stima locale), quote dal server poco dopo
  slipChanged() {
    const sl = this.slip;
    sl.key = null; sl.min = false; sl.quote = null;
    $('slip-status').textContent = '';
    this.renderSlip();
    if (this.g.screen === 'center') this.renderMarkets();
    clearTimeout(this.quoteTimer);
    if (sl.items.length) this.quoteTimer = setTimeout(() => this.requote(), 250);
  }
  slipSig() { return this.slip.items.map(i => i.fixture + '|' + i.market + '|' + i.selection + '|' + i.odds).join(';'); }

  renderSlip() {
    const sl = this.slip, el = $('slip');
    el.hidden = !this.slipVisible || (!sl.items.length && !sl.conflict);
    document.body.classList.toggle('slip-open', !el.hidden && !sl.min);
    el.classList.toggle('min', sl.min);
    $('slip-min').textContent = sl.min ? 'Apri' : 'Riduci';
    $('slip-count').textContent = sl.items.length ? sl.items.length + (sl.items.length === 1 ? ' selezione' : ' selezioni') : '';
    if (el.hidden) return;
    if (sl.publicDefault === undefined) { sl.publicDefault = true; $('slip-public').checked = this.api.me ? this.api.me.publicBets : true; }
    const q = sl.quote && sl.quote.sig === this.slipSig() ? sl.quote : null;
    const conflictIdx = sl.conflict ? sl.conflict.with : [];
    // selezioni raggruppate per partita, nell'ordine in cui sono entrate
    const groups = [];
    sl.items.forEach((it, k) => {
      let g = groups.find(x => x.fixture === it.fixture);
      if (!g) groups.push(g = { fixture: it.fixture, home: it.home, away: it.away, kickoffAt: it.kickoffAt, idx: [] });
      g.idx.push(k);
    });
    const item = (it, k) => {
      const qi = q && q.items[k];
      return '<div class="slip-it' + (it.available === false ? ' bad' : '') + (conflictIdx.includes(k) ? ' conflict' : '') + '">' +
        '<div class="row"><span><b>' + esc(it.selectionLabel) + '</b> <span class="small">' + esc(it.marketLabel) + '</span></span>' +
        '<span><b>' + fmtOdds(it.odds) + '</b><button class="x" data-rm="' + k + '" aria-label="Togli">×</button></span></div>' +
        (qi && qi.redundant ? '<div class="small">Già compresa nelle altre selezioni: non cambia la quota e non conta per il bonus</div>' : '') +
        (it.origOdds && Math.abs(it.origOdds - it.odds) > 1e-9 ? '<div class="chg">Quota cambiata: originale ' + fmtOdds(it.origOdds) + ', ora ' + fmtOdds(it.odds) + '</div>' : '') +
        (it.available === false ? '<div class="chg">' + (it.reason === 'CLOSED' ? 'Mercato chiuso: non si può più giocare' : 'Selezione non disponibile') + '</div>' : '') + '</div>';
    };
    $('slip-items').innerHTML = (sl.copiedFrom ? '<p class="small" style="margin:0 0 6px">Copiata da ' + esc(sl.copiedFrom) + ': controlla quote e puntata, poi conferma.</p>' : '') +
      groups.map(g => {
        const qg = q && q.groups.find(x => x.fixture === g.fixture);
        return '<div class="slip-match"><div class="slip-mh"><b>' + esc(g.home) + ' – ' + esc(g.away) + '</b><span class="small">' +
          new Date(g.kickoffAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + '</span></div>' +
          g.idx.map(k => item(sl.items[k], k)).join('') +
          (qg && qg.correlated ? '<div class="slip-corr">Selezioni collegate della stessa partita: quota della partita <b>' + fmtOdds(qg.odds) + '</b> invece di ' + fmtOdds(qg.product) + '</div>' : '') + '</div>';
      }).join('');
    $('slip-items').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sl.items.splice(Number(b.dataset.rm), 1); sl.conflict = null; this.slipChanged(); });
    // conflitto: la selezione nuova non è entrata
    const cb = $('slip-conflict');
    cb.hidden = !sl.conflict;
    if (sl.conflict) {
      $('slip-conflict-text').textContent = this.conflictText(sl.conflict);
      $('slip-conflict-replace').onclick = () => this.resolveConflict(true);
      $('slip-conflict-cancel').onclick = () => this.resolveConflict(false);
    }
    this.renderSlipTotals();
  }
  renderSlipTotals() {
    const sl = this.slip;
    const q = sl.quote && sl.quote.sig === this.slipSig() ? sl.quote : null;
    const ok = sl.items.length && sl.items.every(i => i.available !== false && i.odds) && (!q || q.valid);
    // stima immediata con le stesse regole del server (senza la quota collegata, che arriva dal server)
    const local = sl.items.length ? BetLogic.slipTotals(sl.items) : null;
    const base = q ? q.baseOdds : local && local.base, bonus = q ? q.bonusPct : local && local.bonus;
    const total = q ? q.totalOdds : local && local.total, count = q ? q.bonusCount : local && local.bonusCount;
    const next = q ? q.nextBonus : local && local.next;
    const stake = Math.floor(Number($('slip-stake').value));
    const pre = q ? '' : '≈ ';
    $('slip-sel').textContent = sl.items.length;
    $('slip-base').textContent = ok && base ? pre + fmtOdds(base) : '—';
    $('slip-bonus').textContent = bonus ? '+' + Math.round(bonus * 100) + '%' : 'nessuno';
    $('slip-bonus-note').textContent = (count !== null && count !== undefined ? count + (count === 1 ? ' selezione valida' : ' selezioni valide') + ' per il bonus' : '') +
      (next ? ' · con ' + next.at + ' il bonus diventa +' + Math.round(next.bonus * 100) + '%' : '');
    $('slip-odds').textContent = ok && total ? pre + fmtOdds(total) : '—';
    $('slip-win').textContent = ok && total && stake > 0 ? pre + fmtCoins(BetLogic.payoutFor(stake, total)) + ' 🪙' : '—';
    $('slip-confirm').disabled = !ok || !(stake >= 1) || !!sl.conflict;
  }
  // quote attuali, quota collegata, bonus e vincita dal server per tutta la schedina
  async requote() {
    const sl = this.slip;
    if (!sl.items.length) return;
    const stake = Math.floor(Number($('slip-stake').value));
    try {
      const r = await this.api.post('/api/slip/quote', { items: sl.items.map(i => ({ fixture: i.fixture, market: i.market, selection: i.selection })), stake: stake > 0 ? stake : undefined });
      this.sync(r.serverTime);
      r.items.forEach((q, k) => {
        const it = sl.items[k];
        if (!it || it.fixture !== q.fixture || it.market !== q.market || it.selection !== q.selection) return;
        if (q.odds && it.odds && Math.abs(q.odds - it.odds) > 1e-9 && !it.origOdds) it.origOdds = it.odds;
        if (q.odds) it.odds = q.odds;
        it.available = q.available; it.reason = q.reason;
        it.marketLabel = q.marketLabel || it.marketLabel; it.selectionLabel = q.selectionLabel || it.selectionLabel;
        it.home = q.home || it.home; it.away = q.away || it.away;
      });
      r.sig = this.slipSig();
      sl.quote = r;
      if (!r.valid && r.errors.length) { $('slip-status').className = 'status err'; $('slip-status').textContent = r.errors[0].message; }
      this.renderSlip();
    } catch (e) { /* si riprova al prossimo giro o alla conferma */ }
  }
  // copia: mette le selezioni in schedina con le quote originali, poi chiede quelle attuali. Non gioca niente.
  async copyBet(code) {
    try {
      const b = await this.api.get('/api/bets/' + code);
      this.slip.items = b.items.map(i => ({ fixture: i.fixture, home: i.home, away: i.away, kickoffAt: i.kickoffAt, market: i.market, selection: i.selection, marketLabel: i.marketLabel, selectionLabel: i.selectionLabel, odds: i.odds, origOdds: i.odds, available: true }));
      this.slip.copiedFrom = b.code; this.slip.key = null; this.slip.min = false; this.slip.conflict = null; this.slip.quote = null;
      this.slipVisible = true;
      $('slip-stake').value = Math.max(1, Math.min(b.stake, this.balance() || b.stake));
      this.renderSlip();
      await this.requote();
      $('slip-status').className = 'status'; $('slip-status').textContent = 'Scommessa copiata: niente è stato giocato. Controlla e conferma.';
      if (this.g.screen === 'center') this.renderMarkets();
    } catch (e) { this.g.toast(this.errText(e), true); }
  }
  async confirmBet() {
    if (this.needLogin()) return;
    const s = this.slip, st = $('slip-status');
    const stake = Math.floor(Number($('slip-stake').value));
    if (!(stake >= 1)) { st.className = 'status err'; st.textContent = 'Scrivi una puntata di almeno 1 moneta'; return; }
    // la chiave resta la stessa se si riprova dopo un errore di rete: il server non registra due volte
    if (!s.key) s.key = newClientKey();
    $('slip-confirm').disabled = true;
    st.className = 'status'; st.textContent = 'Invio…';
    try {
      const r = await this.api.post('/api/bets', {
        items: s.items.map(i => ({ fixture: i.fixture, market: i.market, selection: i.selection, odds: i.odds })),
        stake: stake, clientKey: s.key, visibility: $('slip-public').checked ? 'public' : 'private', copiedFrom: s.copiedFrom || undefined,
      });
      this.g.toast('Scommessa ' + r.bet.code + ' giocata: ' + fmtCoins(r.bet.stake) + ' 🪙 @' + fmtOdds(r.bet.odds));
      s.items = []; s.copiedFrom = null; s.key = null; s.quote = null; s.conflict = null;
      st.textContent = '';
      this.renderSlip();
      this.api.refreshBalance().catch(() => {});
      if (this.g.screen === 'center') { this.renderMarkets(); this.loadFeed('newer'); this.loadCenter(true); this.loadSocialStats(); }
      if (this.g.screen === 'bets') this.loadBets(false);
    } catch (e) {
      st.className = 'status err';
      if (e.code === 'ODDS_CHANGED') {
        for (const c of e.data.changes || []) {
          const it = s.items.find(i => i.fixture === c.fixture && i.market === c.market && i.selection === c.selection);
          if (it) { if (!it.origOdds) it.origOdds = c.old; it.odds = c.new; }
        }
        s.key = null;
        this.renderSlip();
        st.textContent = 'Quota cambiata: controlla le nuove quote e conferma di nuovo';
      } else if (e.code === 'BETTING_CLOSED') { s.key = null; await this.requote(); st.textContent = e.message; }
      else if (e.code === 'INCOMPATIBLE' || e.code === 'DUPLICATE' || e.code === 'PAYOUT_TOO_HIGH' || e.code === 'ODDS_TOO_HIGH') { s.key = null; st.textContent = e.message; }
      else if (e.code === 'INSUFFICIENT_FUNDS') { s.key = null; st.textContent = 'Saldo insufficiente (' + fmtCoins(this.balance()) + ' 🪙)'; this.api.refreshBalance().catch(() => {}); }
      else if (e.code === 'OFFLINE') st.textContent = e.message + '. Puoi riprovare: la scommessa non verrà registrata due volte.';
      else { s.key = null; st.textContent = this.errText(e); }
      this.renderSlipTotals();
    }
  }

  // ---------- guardare una partita del server ----------
  watch() {
    const f = this.fx;
    if (!f || f.seed === undefined) return;
    if (f.engine !== ENGINE_ID) { this.g.toast('Partita calcolata con un altro motore: aggiorna il gioco per guardarla in 3D', true); return; }
    this.g.startFixtureWatch(f);
  }
  async claimWatchReward() {
    const w = this.g.fxw;
    if (!w || this.needLogin()) return;
    try {
      const r = await this.api.post('/api/fixtures/' + w.fx.code + '/watch-reward');
      this.g.toast('Premio spettatore: +' + r.amount + ' 🪙');
      $('fxs-reward').hidden = true; w.rewardDone = true;
      this.api.refreshBalance().catch(() => {});
    } catch (e) { this.g.toast(this.errText(e), true); if (e.code === 'ALREADY_CLAIMED' || e.code === 'DAILY_LIMIT') { $('fxs-reward').hidden = true; w.rewardDone = true; } }
  }

  // ---------- le mie scommesse, feed globale, classifiche, oggi ----------
  async loadBets(more) {
    document.querySelectorAll('[data-bt]').forEach(b => b.classList.toggle('on', b.dataset.bt === this.btTab));
    const list = $('bt-list');
    if (!more) { list.innerHTML = '<p class="empty">Carico…</p>'; this.btCursor = null; }
    $('bt-filters').hidden = this.btTab !== 'top';
    this.msg('bt-msg', '');
    try {
      if (this.btTab === 'top') return this.renderLeaderboard();
      if (this.btTab === 'today') {
        const t = await this.api.get('/api/stats/today');
        list.innerHTML = '<div class="side-card"><h3>Oggi (' + esc(t.day) + ')</h3><div class="statgrid">' +
          '<span>Scommesse giocate</span><b>' + t.bets + '</b><span>Giocatori</span><b>' + t.players + '</b><span>Monete puntate</span><b>' + fmtCoins(t.coins) + '</b>' +
          '<span>Scommesse vinte</span><b>' + t.won + '</b><span>Monete vinte</span><b>' + fmtCoins(t.paid) + '</b></div>' +
          (t.biggestWin ? '<p class="small">Vincita più alta: ' + fmtCoins(t.biggestWin.amount) + ' 🪙 di ' + esc(t.biggestWin.user) + ' @' + fmtOdds(t.biggestWin.odds) + ' (' + esc(t.biggestWin.code) + ')</p>' : '') + '</div>';
        $('bt-more').hidden = true;
        return;
      }
      const cur = more && this.btCursor ? 'before=' + this.btCursor : '';
      const path = this.btTab === 'feed' ? '/api/feed' + (cur ? '?' + cur : '') : '/api/me/bets?status=' + this.btTab + (cur ? '&' + cur : '');
      const r = await this.api.get(path);
      if (!more) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', r.bets.map(b => this.betCard(b)).join(''));
      if (!list.children.length) list.innerHTML = '<p class="empty">' + (this.btTab === 'open' ? 'Nessuna scommessa in corso. Apri Partite per giocare.' : this.btTab === 'settled' ? 'Ancora nessuna scommessa conclusa.' : 'Nessuna scommessa pubblica.') + '</p>';
      this.btCursor = r.next;
      $('bt-more').hidden = !r.next;
      this.wireBetCards(list);
    } catch (e) { list.innerHTML = ''; this.msg('bt-msg', this.errText(e), true); }
  }
  async renderLeaderboard() {
    const metrics = [['profit', 'Profitto'], ['roi', 'ROI'], ['winrate', '% vinte'], ['bets', 'Scommesse'], ['streak', 'Serie']];
    const periods = [['day', 'Oggi'], ['week', 'Settimana'], ['month', 'Mese'], ['season', 'Stagione']];
    const f = $('bt-filters');
    f.innerHTML = metrics.map(([k, l]) => '<button class="seg' + (this.lb.metric === k ? ' on' : '') + '" data-lm="' + k + '">' + l + '</button>').join('') + '<span style="width:14px"></span>' +
      (this.lb.metric === 'streak' ? '' : periods.map(([k, l]) => '<button class="seg' + (this.lb.period === k ? ' on' : '') + '" data-lp="' + k + '">' + l + '</button>').join(''));
    f.querySelectorAll('[data-lm]').forEach(b => b.onclick = () => { this.lb.metric = b.dataset.lm; this.renderLeaderboard(); });
    f.querySelectorAll('[data-lp]').forEach(b => b.onclick = () => { this.lb.period = b.dataset.lp; this.renderLeaderboard(); });
    const r = await this.api.get('/api/leaderboard?metric=' + this.lb.metric + '&period=' + this.lb.period);
    const me = this.api.username;
    const head = r.metric === 'streak' ? '<tr><th>#</th><th>Giocatore</th><th>Serie attuale</th><th>Record</th></tr>'
      : '<tr><th>#</th><th>Giocatore</th><th>Profitto</th><th>ROI</th><th>% vinte</th><th>Scommesse</th></tr>';
    const rows = r.rows.map(x => r.metric === 'streak'
      ? '<tr' + (x.user === me ? ' style="color:var(--flood)"' : '') + '><td>' + x.rank + '</td><td>' + esc(x.user) + '</td><td class="n">' + x.streak + '</td><td class="n">' + x.bestStreak + '</td></tr>'
      : '<tr' + (x.user === me ? ' style="color:var(--flood)"' : '') + '><td>' + x.rank + '</td><td>' + esc(x.user) + '</td><td class="n">' + (x.profit > 0 ? '+' : '') + fmtCoins(x.profit) + '</td><td class="n">' + x.roi + '%</td><td class="n">' + x.winRate + '%</td><td class="n">' + x.bets + '</td></tr>').join('');
    $('bt-list').innerHTML = '<p class="small">Classifica per bravura, non per saldo. Solo profili pubblici; ROI e % vinte con almeno 5 scommesse decise. La serie conta le scommesse vinte di fila.</p>' +
      (rows ? '<table class="lbtable">' + head + rows + '</table>' : '<p class="empty">Ancora nessuno in classifica per questo periodo.</p>');
    $('bt-more').hidden = true;
  }
  async openBetCode() {
    const code = $('bt-code').value.trim().toUpperCase();
    if (!/^BET-[A-Z0-9]{5}$/.test(code)) { this.msg('bt-msg', 'Il codice ha la forma BET-XXXXX', true); return; }
    try {
      const b = await this.api.get('/api/bets/' + code);
      this.msg('bt-msg', '');
      $('bt-list').innerHTML = this.betCard(b);
      $('bt-more').hidden = true;
      this.wireBetCards($('bt-list'));
    } catch (e) { this.msg('bt-msg', e.status === 404 ? 'Scommessa non trovata (o non condivisa)' : this.errText(e), true); }
  }

  // ---------- negozio ----------
  async loadShop() {
    try {
      const r = await this.api.get('/api/shop');
      this.shopItems = r.items; this.shopCats = r.categories;
      this.msg('sh-msg', '');
      this.renderShop();
    } catch (e) { this.msg('sh-msg', this.errText(e), true); }
  }
  renderShop() {
    const cats = ['tutti'].concat(this.shopCats || []);
    $('sh-tabs').innerHTML = cats.map(c => '<button class="tab' + (this.shopCat === c ? ' on' : '') + '" data-sc="' + c + '">' + (c === 'tutti' ? 'Tutti' : SLOT_NAMES[c] || c) + '</button>').join('');
    $('sh-tabs').querySelectorAll('[data-sc]').forEach(b => b.onclick = () => { this.shopCat = b.dataset.sc; this.renderShop(); });
    const bal = this.balance();
    const items = this.shopItems.filter(i => this.shopCat === 'tutti' || i.category === this.shopCat);
    $('sh-grid').innerHTML = items.map(i => '<div class="item ' + esc(i.rarity) + '"><canvas width="370" height="236" data-prev="' + esc(i.id) + '"></canvas>' +
      '<span class="rar">' + esc(RARITY_NAMES[i.rarity] || i.rarity) + ' · ' + esc(SLOT_NAMES[i.category] || i.category) + '</span><b>' + esc(i.name) + '</b>' +
      (i.owned ? '<span class="small">' + (i.equipped ? 'Indossato' : 'Nel tuo inventario') + '</span><button class="seg' + (i.equipped ? ' on' : '') + '" data-eq="' + esc(i.id) + '"' + (i.equipped ? ' disabled' : '') + '>' + (i.equipped ? 'Indossato' : 'Indossa') + '</button>'
        : '<span class="price">' + fmtCoins(i.price) + ' 🪙</span><button class="seg" data-buy="' + esc(i.id) + '"' + (bal !== null && bal < i.price ? ' disabled title="Saldo insufficiente"' : '') + '>Compra</button>') + '</div>').join('');
    $('sh-grid').querySelectorAll('[data-prev]').forEach(cv => {
      const it = this.shopItems.find(x => x.id === cv.dataset.prev);
      drawAvatar(cv, { items: { [it.category]: it.data }, number: 10, name: '' }, it.category);
    });
    $('sh-grid').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => {
      const it = this.shopItems.find(x => x.id === b.dataset.buy);
      this.g.confirmClick(b, 'Sicuro? ' + fmtCoins(it.price) + ' 🪙', () => this.buy(it));
    });
    $('sh-grid').querySelectorAll('[data-eq]').forEach(b => b.onclick = () => this.equip(b.dataset.eq).then(() => this.loadShop()));
  }
  async buy(it) {
    try {
      await this.api.post('/api/shop/buy', { item: it.id });
      this.g.toast(it.name + ' comprato: è nel tuo inventario');
      await this.api.refreshBalance();
      this.loadouts.delete((this.api.username || '').toLowerCase());
      await this.loadShop();
    } catch (e) { this.g.toast(this.errText(e), true); }
  }
  async equip(id) {
    try { await this.api.post('/api/inventory/equip', { item: id }); this.loadouts.delete((this.api.username || '').toLowerCase()); }
    catch (e) { this.g.toast(this.errText(e), true); }
  }

  // ---------- personaggio e inventario ----------
  async loadCharacter() {
    try {
      const [inv, lo] = await Promise.all([this.api.get('/api/inventory'), this.api.get('/api/players/' + encodeURIComponent(this.api.username) + '/loadout')]);
      this.inv = inv.items; this.myLoadout = lo;
      this.loadouts.set(lo.username.toLowerCase(), { at: Date.now(), lo: lo });
      $('ch-number').value = lo.number; $('ch-name').value = lo.name;
      this.msg('ch-msg', '');
      this.renderInventory();
      this.drawCharPreview();
    } catch (e) { this.msg('ch-msg', this.errText(e), true); }
  }
  renderInventory() {
    const slots = Object.keys(SLOT_NAMES);
    $('ch-inv').innerHTML = (this.inv.length ? '' : '<p class="empty">Inventario vuoto: gli oggetti si comprano nel negozio.</p>') + slots.map(sl => {
      const own = this.inv.filter(i => i.category === sl);
      if (!own.length) return '';
      const eq = own.find(i => i.equipped);
      return '<div class="invrow"><span class="lbl">' + SLOT_NAMES[sl] + '</span><div class="segs"><button class="seg' + (!eq ? ' on' : '') + '" data-un="' + sl + '">Nessuno</button>' +
        own.map(i => '<button class="seg' + (i.equipped ? ' on' : '') + '" data-eqi="' + esc(i.id) + '">' + esc(i.name) + '<small>' + esc(RARITY_NAMES[i.rarity] || '') + '</small></button>').join('') + '</div></div>';
    }).join('');
    $('ch-inv').querySelectorAll('[data-eqi]').forEach(b => b.onclick = async () => { await this.equip(b.dataset.eqi); this.loadCharacter(); });
    $('ch-inv').querySelectorAll('[data-un]').forEach(b => b.onclick = async () => {
      try { await this.api.post('/api/inventory/unequip', { slot: b.dataset.un }); this.loadouts.delete(this.api.username.toLowerCase()); this.loadCharacter(); } catch (e) { this.g.toast(this.errText(e), true); }
    });
  }
  drawCharPreview() {
    if (!this.myLoadout) return;
    const lo = Object.assign({}, this.myLoadout, { number: Number($('ch-number').value) || this.myLoadout.number, name: $('ch-name').value });
    drawAvatar($('ch-preview'), lo, null);
  }
  async saveAvatar() {
    try {
      const r = await this.api.post('/api/me/avatar', { number: Number($('ch-number').value), name: $('ch-name').value });
      this.loadouts.delete(this.api.username.toLowerCase());
      this.g.toast('Salvato: numero ' + r.number + (r.name ? ', ' + r.name : ''));
      this.loadCharacter();
    } catch (e) { this.msg('ch-msg', this.errText(e), true); }
  }

  // aspetto di un giocatore (pubblico) per vestirlo in partita
  async loadoutOf(username) {
    if (!username || !/^[A-Za-z0-9_]{3,16}$/.test(username) || !this.api.configured()) return null;
    const k = username.toLowerCase(), c = this.loadouts.get(k);
    if (c && Date.now() - c.at < 5 * 60000) return c.lo;
    try {
      const lo = await this.api.get('/api/players/' + encodeURIComponent(username) + '/loadout');
      this.loadouts.set(k, { at: Date.now(), lo: lo });
      return lo;
    } catch (e) { this.loadouts.set(k, { at: Date.now(), lo: null }); return null; }
  }
  // veste i calciatori degli umani in partita. Ogni umano ha un attaccante (poi centrocampisti, difensori) della
  // sua squadra; l'ordine è uguale su tutti i computer. L'aspetto si legge dal server, mai dagli altri giocatori.
  dressMatch(m, localId, names) {
    if (!m || !m.humans || !m.humans.length) return;
    const per = [[], []];
    for (const h of m.humans) if (h.team === 0 || h.team === 1) per[h.team].push(h);
    const rank = { FW: 0, MF: 1, DF: 2 };
    per.forEach((hs, t) => {
      const cands = m.teams[t].players.filter(p => !p.isGK).slice().sort((a, b) => (rank[a.data.role] - rank[b.data.role]) || (a.slotIndex - b.slotIndex));
      hs.forEach((h, k) => {
        const p = cands[k];
        if (!p) return;
        const user = h.id === localId && localId === 'local' ? this.api.username : (names && names[h.id]) || (h.id === localId ? this.api.username : null);
        if (!user) return;
        this.loadoutOf(user).then(lo => { if (lo && this.g.match === m) this.g.renderer.setCosmetic(p, lo); });
      });
    });
  }

  // ---------- profilo ----------
  async loadProfile() {
    try {
      const me = await this.api.refresh();
      this.sync(me.serverTime);
      this.msg('pf-msg', '');
      $('pf-title').textContent = me.username;
      $('pf-stats').innerHTML = '<span>Saldo</span><b>' + fmtCoins(me.balance) + ' 🪙</b><span>Scommesse</span><b>' + me.stats.bets + '</b><span>Vinte</span><b>' + me.stats.won + '</b><span>Perse</span><b>' + me.stats.lost + '</b>' +
        '<span>In corso</span><b>' + me.stats.open + '</b><span>Profitto</span><b>' + (me.stats.profit > 0 ? '+' : '') + fmtCoins(me.stats.profit) + '</b><span>Serie attuale</span><b>' + me.streak + '</b><span>Serie record</span><b>' + me.bestStreak + '</b>';
      $('pf-public').checked = me.publicBets;
      $('pf-ach').innerHTML = me.achievements.map(a => '<div class="' + (a.earnedAt ? 'got' : '') + '"><b>' + esc(a.name) + '</b> <span class="small">+' + a.reward + ' 🪙</span><br><span class="small">' + esc(a.description) + '</span></div>').join('');
      const d = me.daily;
      $('pf-daily').innerHTML = (d.claimed ? '<p class="small">Già riscosso oggi (serie di ' + d.streak + ' giorni). Torna domani.</p>'
        : '<p class="small">Serie: giorno ' + d.streak + (d.weekendEvent ? '. Evento del fine settimana: bonus doppio!' : '') + '</p><button class="primary" id="pf-claim">Riscuoti +' + d.amount + ' 🪙</button>');
      if ($('pf-claim')) $('pf-claim').onclick = () => this.claimDaily();
      $('pf-since').textContent = 'Account creato il ' + new Date(me.createdAt).toLocaleDateString('it-IT') + '. Nome pubblico: ' + me.username + '. Gli altri vedono solo il nome, mai saldo o dati dell\'account.';
      this.loadTx(false);
    } catch (e) { this.msg('pf-msg', this.errText(e), true); }
  }
  async claimDaily() {
    try { const r = await this.api.post('/api/me/daily'); this.g.toast('Bonus giornaliero: +' + r.amount + ' 🪙'); this.loadProfile(); }
    catch (e) { this.g.toast(this.errText(e), true); }
  }
  async setPrivacy(v) {
    try { await this.api.post('/api/me/privacy', { publicBets: v }); if (this.api.me) this.api.me.publicBets = v; this.g.toast(v ? 'Le tue scommesse sono pubbliche' : 'Le tue scommesse non sono più visibili agli altri'); }
    catch (e) { $('pf-public').checked = !v; this.g.toast(this.errText(e), true); }
  }
  async loadTx(more) {
    try {
      const r = await this.api.get('/api/me/transactions' + (more && this.txCursor ? '?before=' + this.txCursor : ''));
      const html = r.transactions.map(t => '<div class="txrow"><span class="small">' + new Date(t.createdAt).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span>' +
        '<span>' + esc(TX_NAMES[t.type] || t.type) + (/^BET-/.test(t.reference) ? ' <span class="small">' + esc(t.reference) + '</span>' : '') + '</span>' +
        '<span class="amt ' + (t.amount >= 0 ? 'pos' : 'neg') + '">' + (t.amount > 0 ? '+' : '') + fmtCoins(t.amount) + '</span><span class="small">saldo ' + fmtCoins(t.balanceAfter) + '</span></div>').join('');
      if (more) $('pf-tx').insertAdjacentHTML('beforeend', html); else $('pf-tx').innerHTML = html || '<p class="empty">Nessun movimento.</p>';
      this.txCursor = r.next;
      $('pf-tx-more').hidden = !r.next;
    } catch (e) { /* il resto del profilo resta visibile */ }
  }
}

const EVENT_TEXT = {
  KICK_OFF: 'Calcio d\'inizio', GOAL: '⚽ Gol', YELLOW_CARD: '🟨 Ammonizione', SECOND_YELLOW: '🟨🟨 Seconda ammonizione', RED_CARD: '🟥 Espulsione',
  PENALTY: 'Rigore', CORNER: 'Calcio d\'angolo', HALF_TIME: 'Fine primo tempo', FULL_TIME: 'Fine partita', OFFSIDE: 'Fuorigioco', SHOT_ON_TARGET: 'Tiro in porta',
};

// ---------- disegno del personaggio (anteprima 2D) ----------
// lo stesso aspetto che il gioco disegna in 3D: maglia con motivo, pantaloncini, calzettoni, scarpe, guanti,
// capelli, accessori, numero e nome. focus: categoria da ingrandire (anteprima di un oggetto del negozio)
function drawAvatar(cv, lo, focus) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const it = (lo && lo.items) || {};
  const base = { shirt: '#1e56c8', trim: '#f3f5ee', shorts: '#f3f5ee', socks: '#1e56c8', boots: '#151515', skin: '#d9a77e', hair: '#2a1a10', hairStyle: 'corti' };
  const shirtColor = base.shirt, pat = it.maglia || null;
  const shorts = it.pantaloncini ? it.pantaloncini.color : base.shorts;
  const socks = it.calzettoni ? it.calzettoni.color : base.socks, stripe = it.calzettoni && it.calzettoni.stripe;
  const boots = it.scarpe ? it.scarpe.color : base.boots;
  const gloves = it.guanti ? it.guanti.color : null;
  const hair = it.capelli ? it.capelli.color : base.hair, hairStyle = it.capelli ? it.capelli.style : base.hairStyle;
  const acc = it.accessori || null;
  // zoom sulla parte dell'oggetto (coordinate del disegno: figura alta 380 in un riquadro 300x380)
  const zoom = { capelli: [150, 70, 2.1], accessori: acc && acc.kind === 'fascia' ? [150, 70, 2.1] : [150, 170, 1.5], maglia: [150, 150, 1.25], pantaloncini: [150, 225, 1.6], calzettoni: [150, 295, 1.6], scarpe: [150, 345, 2.2], guanti: [150, 215, 1.7] }[focus];
  g.save();
  if (zoom) { const s = Math.min(W / 300, H / 380) * zoom[2]; g.translate(W / 2, H / 2); g.scale(s, s); g.translate(-zoom[0], -zoom[1]); }
  else { const s = Math.min(W / 300, H / 380); g.translate((W - 300 * s) / 2, (H - 380 * s) / 2); g.scale(s, s); }
  const rr = (x, y, w, h, r, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill(); };
  // gambe
  for (const sx of [118, 160]) {
    rr(sx, 238, 22, 50, 8, base.skin);
    rr(sx - 1, 282, 24, 56, 8, socks);
    if (stripe) { g.fillStyle = stripe; g.fillRect(sx - 1, 290, 24, 7); g.fillRect(sx - 1, 302, 24, 4); }
    rr(sx - 6, 334, 34, 16, 7, boots);
  }
  // pantaloncini
  rr(110, 210, 80, 46, 10, shorts);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(149, 228, 2, 28);
  // braccia
  const sleeve = pat && pat.pattern === 'maniche' ? pat.color : shirtColor;
  for (const [sx, dir] of [[86, -1], [198, 1]]) {
    g.save(); g.translate(sx + 8, 112); g.rotate(dir * 0.18);
    rr(-9, 0, 18, 40, 8, sleeve);
    if (pat && pat.pattern === 'bordi') { g.fillStyle = pat.color; g.fillRect(-9, 34, 18, 6); }
    rr(-7, 38, 14, 46, 7, base.skin);
    if (acc && acc.kind === 'polsini') { g.fillStyle = acc.color; g.fillRect(-8, 70, 16, 8); }
    if (acc && acc.kind === 'capitano' && dir === -1) { g.fillStyle = acc.color; g.fillRect(-10, 14, 20, 9); g.fillStyle = '#111'; g.font = 'bold 8px Arial'; g.textAlign = 'center'; g.fillText('C', 0, 22); }
    g.beginPath(); g.fillStyle = gloves || base.skin; g.arc(0, 88, gloves ? 10 : 7, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // maglia
  rr(100, 104, 100, 112, 16, shirtColor);
  g.save(); g.beginPath(); g.rect(100, 104, 100, 112); g.clip();
  if (pat) {
    g.fillStyle = pat.color;
    if (pat.pattern === 'righe') for (let x = 108; x < 200; x += 22) g.fillRect(x, 104, 9, 112);
    if (pat.pattern === 'fascia') { g.save(); g.translate(150, 160); g.rotate(-0.72); g.fillRect(-90, -11, 180, 22); g.restore(); }
    if (pat.pattern === 'bordi') { g.fillRect(100, 206, 100, 10); g.fillRect(100, 104, 8, 112); g.fillRect(192, 104, 8, 112); }
  }
  g.restore();
  const collar = pat && (pat.pattern === 'colletto' || pat.pattern === 'bordi') ? pat.color : base.trim;
  g.fillStyle = collar; g.beginPath(); g.moveTo(130, 104); g.lineTo(150, 124); g.lineTo(170, 104); g.lineTo(162, 104); g.lineTo(150, 116); g.lineTo(138, 104); g.fill();
  // nome e numero (in partita sono sulla schiena: qui sul petto per vederli)
  g.fillStyle = pat && pat.pattern === 'righe' ? '#111' : base.trim;
  g.textAlign = 'center';
  if (lo && lo.name) { g.font = '700 13px "Saira Condensed", Arial, sans-serif'; g.fillText(String(lo.name).slice(0, 12), 150, 142); }
  g.font = '800 40px "Saira Condensed", Arial, sans-serif'; g.fillText(String((lo && lo.number) || 10), 150, 184);
  // testa
  rr(141, 90, 18, 16, 4, base.skin);
  g.beginPath(); g.fillStyle = base.skin; g.arc(150, 70, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(141, 72, 2.6, 0, Math.PI * 2); g.arc(159, 72, 2.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = hair;
  if (hairStyle === 'cresta') { g.beginPath(); g.moveTo(140, 50); g.quadraticCurveTo(150, 22, 160, 50); g.closePath(); g.fill(); g.fillRect(124, 52, 52, 4); }
  else if (hairStyle === 'ricci') { for (let a = Math.PI * 1.05; a <= Math.PI * 1.95; a += 0.22) { g.beginPath(); g.arc(150 + Math.cos(a) * 25, 66 + Math.sin(a) * 25, 9, 0, Math.PI * 2); g.fill(); } }
  else if (hairStyle === 'rasati') { g.globalAlpha = 0.45; g.beginPath(); g.arc(150, 68, 26, Math.PI * 1.02, Math.PI * 1.98); g.fill(); g.globalAlpha = 1; }
  else if (hairStyle === 'medi') { g.beginPath(); g.arc(150, 66, 28, Math.PI * 0.95, Math.PI * 2.05); g.fill(); g.fillRect(122, 62, 9, 26); g.fillRect(169, 62, 9, 26); }
  else { g.beginPath(); g.arc(150, 66, 27, Math.PI * 1.02, Math.PI * 1.98); g.fill(); }
  if (acc && acc.kind === 'fascia') { g.fillStyle = acc.color; g.fillRect(123, 56, 54, 7); }
  g.restore();
}
