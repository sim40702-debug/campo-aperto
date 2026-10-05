// ============================================================
// GIOCO — schermate, ciclo principale, HUD, partite offline e online
// modalità: 'menu' (partita dimostrativa), 'offline', 'host', 'client'
// ============================================================
const $ = id => document.getElementById(id);
const SCREENS = ['menu', 'setup', 'online', 'lobby', 'settings', 'help', 'hud', 'pause', 'fulltime'];
const CAMERA_NAMES = ['Televisiva', 'Larga', 'Dietro al giocatore'];

class Game {
  constructor() {
    this.settings = loadSettings();
    if (!this.settings.name) { this.settings.name = 'Giocatore ' + (10 + Math.floor(Math.random() * 90)); saveSettings(this.settings); }
    this.db = buildDatabase(2026);
    setSeed(Date.now() % 100000);
    this.renderer = new Renderer($('stage'), this.settings.quality);
    this.renderer.setResolutionScale(this.settings.resScale);
    this.renderer.camMode = this.settings.camera || 0;
    this.audio = new GameAudio();
    this.audio.setVolumes({ master: this.settings.volMaster, sfx: this.settings.volSfx, crowd: this.settings.volCrowd, muted: this.settings.muted });
    this.input = new Input(this.settings.keys, this.settings.padKeys);
    this.input.mouseEnabled = this.settings.mouse;
    this.applyPadSettings();
    this.input.onAction = a => this.flashChip(a);
    this.input.onBlur = () => { if (this.mode === 'offline' && this.screen === 'match' && !this.paused) this.togglePause(true); };
    // tastiera nei menu: frecce per spostarsi, Esc per tornare indietro
    this.input.onUiKey = (code) => this.onUiKey(code);
    // cambio tastiera <-> controller: aggiorna i suggerimenti sullo schermo
    this.input.onDevice = d => {
      if (d !== 'pad') document.body.classList.remove('pad-nav');
      this.chipKey = null; this.updateChips();
      if (this.screen === 'help') this.renderHelp();
      this.updateReplayTag();
    };
    this.input.onPadConnect = (on, gp) => this.onPadConnect(on, gp);
    window.addEventListener('mousemove', () => document.body.classList.remove('pad-nav'));
    this.mode = 'menu'; this.screen = 'menu';
    this.match = null; this.demo = null; this.net = null;
    this.paused = false; this.replay = null; this.replayPending = null;
    this.setup = { home: 0, away: 4, side: 0, difficulty: 1, halfSeconds: 180, formation: null, mentality: 1 };
    this.restoreSetup();
    this.acc = 0; this.last = performance.now(); this.time = 0; this.lastFrameAt = performance.now();
    this.perf = { t: 0, frames: 0, good: 0 };
    this.settingsReturn = 'menu';
    this.bindUI();
    this.startDemo();
    this.showScreen('menu');
    requestAnimationFrame(t => this.loop(t));
    // l'host continua a simulare anche se la finestra non disegna (es. ridotta a icona)
    this.bgTimer = setInterval(() => {
      if (this.mode === 'host' && performance.now() - this.lastFrameAt > 120) this.tickHost(Math.min(0.25, (performance.now() - this.lastFrameAt) / 1000), true);
    }, 50);
    window.addEventListener('beforeunload', () => { if (this.net) this.net.link.leave(); });
  }

  // ---------- SCHERMATE ----------
  showScreen(name) {
    this.screen = name;
    for (const id of SCREENS) $(id).hidden = true;
    const panel = { menu: 'menu', setup: 'setup', online: 'online', lobby: 'lobby', settings: 'settings', help: 'help', fulltime: 'fulltime', match: 'hud' }[name];
    if (panel) {
      const el = $(panel);
      el.hidden = false;
      el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
    }
    if (name === 'setup') this.renderSetup();
    if (name === 'online') this.renderOnline();
    if (name === 'settings') this.renderSettings();
    if (name === 'help') this.renderHelp();
    // in partita i tasti di gioco non devono far scorrere la pagina o spostare il focus
    this.input.gameKeysActive = name === 'match';
    if (name === 'match') { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
    const first = panel && name !== 'match' ? $(panel).querySelector('.primary, .mode') : null;
    // nel menu principale il primo pulsante si evidenzia solo se si usa controller o tastiera
    if (first && (name !== 'menu' || this.input.lastDevice === 'pad')) setTimeout(() => first.focus({ preventScroll: true }), 30);
  }

  toast(text, isErr) {
    const t = $('toast');
    t.textContent = text; t.className = isErr ? 'err' : ''; t.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { t.hidden = true; }, isErr ? 5000 : 3000);
  }
  busy(text, onCancel) {
    $('busy').hidden = !text;
    if (text) { $('busy-text').textContent = text; $('busy-cancel').onclick = () => { $('busy').hidden = true; if (onCancel) onCancel(); }; }
  }

  bindUI() {
    const unlockAudio = () => this.audio.init();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    // suono di conferma per ogni pulsante
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) this.audio.ui(); });
    $('btn-quick').onclick = () => { this.setup.side = this.setup.side === -1 ? 0 : this.setup.side; this.showScreen('setup'); };
    $('btn-watch').onclick = () => { this.setup.side = -1; this.showScreen('setup'); };
    $('btn-online').onclick = () => this.showScreen('online');
    $('btn-settings').onclick = () => this.openSettings('grafica', 'menu');
    $('btn-controls').onclick = () => this.openHelp('menu');
    $('help-back').onclick = () => this.closeHelp();
    $('help-keys').onclick = () => { const r = this.helpReturn; this.openSettings('controlli', r === 'pause' ? 'pause' : 'menu'); };
    $('version').textContent = 'Versione ' + GAME_VERSION + (IS_DESKTOP ? ', app desktop' : ', browser');
    if (IS_DESKTOP) { $('li-quit').hidden = false; $('btn-quit').onclick = () => window.close(); }
    $('setup-back').onclick = () => { if (this.setup.side === -1) this.setup.side = 0; this.showScreen('menu'); };
    $('setup-start').onclick = () => this.startMatch();
    document.querySelectorAll('[data-cycle]').forEach(b => b.onclick = () => {
      const [which, delta] = b.dataset.cycle.split(':');
      this.cycleTeam(this.setup, which, Number(delta));
      this.setup.formation = null;
      this.renderSetup();
    });
    $('pause-resume').onclick = () => this.togglePause(false);
    $('pause-camera').onclick = () => this.cycleCamera();
    $('pause-settings').onclick = () => { $('pause').hidden = true; this.openSettings('grafica', 'pause'); };
    $('pause-help').onclick = () => { $('pause').hidden = true; this.openHelp('pause'); };
    // ricominciare o uscire fanno perdere la partita: serve una conferma (secondo clic)
    $('pause-restart').onclick = () => this.confirmClick($('pause-restart'), 'Sicuro? Ricomincia', () => { this.togglePause(false); this.startMatch(); });
    $('pause-quit').onclick = () => this.confirmClick($('pause-quit'), 'Sicuro? Esci', () => this.quitToMenu());
    $('ft-rematch').onclick = () => { if (this.mode === 'host') this.net.host.backToLobby(); else this.startMatch(); };
    $('ft-setup').onclick = () => { this.quitToMenu(); this.showScreen('setup'); };
    $('ft-menu').onclick = () => this.quitToMenu();
    // online
    $('on-name').value = this.settings.name;
    $('on-name').onchange = () => { this.settings.name = $('on-name').value.trim().slice(0, 16) || this.settings.name; saveSettings(this.settings); };
    $('on-code').oninput = () => { const v = normalizeCode($('on-code').value); if ($('on-code').value !== v) $('on-code').value = v; };
    $('on-code').onkeydown = e => { if (e.key === 'Enter') this.joinOnline(); };
    $('on-create').onclick = () => this.createOnline();
    $('on-create-lan').onclick = () => this.createOnline(true);
    $('on-join').onclick = () => this.joinOnline();
    $('on-back').onclick = () => this.showScreen('menu');
    $('on-server-edit').onclick = () => this.openSettings('online', 'online');
    $('lb-copy').onclick = () => this.copyCode();
    $('lb-leave').onclick = () => this.leaveOnline(true);
    $('lb-start').onclick = () => { if (this.net && this.net.host) { const m = this.net.host.start(); if (m) this.enterOnlineMatch(m); } };
    document.querySelectorAll('[data-side]').forEach(b => b.onclick = () => this.pickSide(Number(b.dataset.side)));
    document.querySelectorAll('[data-lcycle]').forEach(b => b.onclick = () => {
      if (!this.net || !this.net.host) return;
      const [which, delta] = b.dataset.lcycle.split(':');
      const s = Object.assign({}, this.net.host.settings);
      this.cycleTeam(s, which, Number(delta));
      this.net.host.setSettings(s);
    });
    // impostazioni
    document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.settingsTab = b.dataset.tab; this.renderSettings(); });
    $('st-back').onclick = () => this.closeSettings();
    $('st-full').onclick = () => this.toggleFullscreen();
    document.addEventListener('fullscreenchange', () => { this.renderer.resize(); if (this.screen === 'settings') this.renderSettings(); });
  }

  cycleTeam(s, which, delta) {
    const n = this.db.length;
    let v = (s[which] + delta + n) % n;
    const other = which === 'home' ? s.away : s.home;
    if (v === other) v = (v + delta + n) % n;
    s[which] = v;
  }

  // pulsanti a scelta singola
  segmented(container, options, value, onPick) {
    const el = $(container);
    el.innerHTML = '';
    options.forEach(o => {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.className = 'seg' + (o.value === value ? ' on' : '');
      b.setAttribute('aria-pressed', o.value === value);
      b.onclick = () => onPick(o.value);
      el.appendChild(b);
    });
  }

  renderSetup() {
    const s = this.setup;
    const fill = (prefix, t, kitName) => {
      $(prefix + '-name').textContent = t.name;
      $(prefix + '-meta').textContent = 'Forza ' + t.rating + ', allenatore ' + t.coach;
      const k = t.kits[kitName];
      $(prefix + '-kit').innerHTML = k.map(c => '<span style="background:' + c + '"></span>').join('');
      const best = t.players.slice(0, 11).slice().sort((a, b) => b.overall - a.overall).slice(0, 3);
      $(prefix + '-stars').textContent = 'Da tenere d\'occhio: ' + best.map(p => p.name + ' (' + p.overall + ')').join(', ');
    };
    fill('home', this.db[s.home], 'home');
    fill('away', this.db[s.away], 'away');
    const mine = s.side === 1 ? this.db[s.away] : this.db[s.home];
    if (!s.formation) s.formation = mine.formation;
    this.segmented('opt-side', [{ label: 'Casa', value: 0 }, { label: 'Ospiti', value: 1 }, { label: 'Nessuna (guardo)', value: -1 }], s.side, v => { s.side = v; s.formation = null; this.renderSetup(); });
    this.segmented('opt-diff', [{ label: 'Facile', value: 0 }, { label: 'Normale', value: 1 }, { label: 'Difficile', value: 2 }], s.difficulty, v => { s.difficulty = v; this.renderSetup(); });
    this.segmented('opt-len', [{ label: '2 min', value: 120 }, { label: '3 min', value: 180 }, { label: '5 min', value: 300 }], s.halfSeconds, v => { s.halfSeconds = v; this.renderSetup(); });
    this.segmented('opt-form', Object.keys(FORMATIONS).map(f => ({ label: f, value: f })), s.formation, v => { s.formation = v; this.renderSetup(); });
    this.segmented('opt-ment', MENTALITIES.map((m, i) => ({ label: m, value: i })), s.mentality, v => { s.mentality = v; this.renderSetup(); });
    $('row-form').style.opacity = s.side === -1 ? 0.4 : 1;
  }

  teamForMatch(idx, isMine) {
    const t = this.db[idx];
    const copy = Object.assign({}, t);
    copy.tactics = Object.assign({}, t.tactics);
    if (isMine) { copy.formation = this.setup.formation || t.formation; copy.tactics.mentality = this.setup.mentality; }
    return copy;
  }

  startDemo() {
    const a = randInt(0, 7); let b = randInt(0, 7); if (b === a) b = (a + 1) % 8;
    this.demo = new Match(this.db[a], this.db[b], { humanTeam: -1, halfSeconds: 900 });
    this.renderer.localId = null; this.renderer.names = null;
    this.renderer.setupMatch(this.demo);
  }

  // prepara l'HUD per una partita (offline o online)
  prepareMatchView(m, localId, names) {
    this.match = m;
    this.renderer.localId = localId; this.renderer.names = names || null;
    this.renderer.setupMatch(m);
    this.replay = null; this.replayPending = null; this.paused = false;
    this.demo = null; this.acc = 0;
    $('sb-home').textContent = m.teams[0].data.short;
    $('sb-away').textContent = m.teams[1].data.short;
    $('sb-home-kit').style.background = m.teams[0].kit[0];
    $('sb-away-kit').style.background = m.teams[1].kit[0];
    $('replay-tag').hidden = true;
    this.input.releaseAll(); this.pressBuf = null;
    this.renderChips(!!m.humanById(localId));
    this.showScreen('match');
    this.audio.whistle(1);
  }

  startMatch() {
    const s = this.setup;
    const home = this.teamForMatch(s.home, s.side === 0), away = this.teamForMatch(s.away, s.side === 1);
    const m = new Match(home, away, { humanTeam: s.side, difficulty: s.difficulty, halfSeconds: s.halfSeconds });
    // la prossima volta il menu propone la stessa partita
    this.settings.lastSetup = { home: s.home, away: s.away, side: s.side, difficulty: s.difficulty, halfSeconds: s.halfSeconds, formation: s.formation, mentality: s.mentality };
    saveSettings(this.settings);
    this.mode = 'offline';
    this.prepareMatchView(m, 'local', null);
    $('netind').hidden = true;
  }

  quitToMenu() {
    if (this.net) this.leaveOnline(false);
    this.mode = 'menu';
    this.match = null; this.paused = false; this.replay = null;
    $('pause').hidden = true;
    this.startDemo();
    this.showScreen('menu');
  }

  togglePause(v) {
    if (!this.match) return;
    this.paused = v === undefined ? !this.paused : v;
    $('pause').hidden = !this.paused;
    if (this.paused) {
      const online = this.mode !== 'offline';
      $('pause-online').hidden = !online;
      $('pause-restart').hidden = online;
      $('pause-quit').textContent = this.mode === 'host' ? 'Chiudi la partita per tutti' : online ? 'Esci dalla partita' : 'Esci al menu';
      $('pause-camera').textContent = 'Telecamera: ' + CAMERA_NAMES[this.renderer.camMode];
      $('pause-restart').textContent = 'Ricomincia';
      for (const id of ['pause-restart', 'pause-quit']) { $(id).classList.remove('confirm'); $(id)._armed = false; }
      $('pause-keys').textContent = this.pauseHint();
      this.input.gameKeysActive = false;
      this.renderPauseTactics();
      const el = $('pause'); el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
      setTimeout(() => $('pause-resume').focus({ preventScroll: true }), 30);
    } else {
      this.input.gameKeysActive = this.screen === 'match';
      this.input.releaseAll();
      this.pressBuf = null;
    }
  }

  // pulsante con conferma: il primo clic chiede conferma, il secondo (entro 3 secondi) esegue
  confirmClick(btn, askText, fn) {
    if (btn._armed) { btn._armed = false; btn.classList.remove('confirm'); fn(); return; }
    const orig = btn.textContent;
    btn._armed = true; btn.classList.add('confirm'); btn.textContent = askText;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn._armed = false; btn.classList.remove('confirm'); btn.textContent = orig; }, 3000);
  }
  pauseHint() {
    return this.btn('pause') + ' riprende, ' + this.btn('help') + ' mostra i comandi' + (this.input.lastDevice === 'pad' ? ', ' + padName(1, this.settings.padLayout) + ' torna indietro' : '');
  }

  renderPauseTactics() {
    const m = this.match;
    const h = m.humanById(this.renderer.localId);
    // la tattica si cambia solo offline (online la decide la simulazione dell'host)
    if (!h || this.mode !== 'offline') { $('pause-tactics').hidden = true; return; }
    $('pause-tactics').hidden = false;
    const team = m.teams[h.team];
    this.segmented('pt-ment', MENTALITIES.map((x, i) => ({ label: x, value: i })), team.tactics.mentality, v => { team.tactics.mentality = v; this.renderPauseTactics(); });
    this.segmented('pt-press', [{ label: 'Attesa', value: 0.3 }, { label: 'Normale', value: 0.6 }, { label: 'Alto', value: 0.9 }], team.tactics.pressing, v => { team.tactics.pressing = v; this.renderPauseTactics(); });
    this.segmented('pt-form', Object.keys(FORMATIONS).map(f => ({ label: f, value: f })), team.formation, v => {
      team.formation = v;
      team.players.forEach((p, i) => { p.slot = FORMATIONS[v][i]; });
      this.renderPauseTactics();
    });
  }

  cycleCamera() {
    this.renderer.camMode = (this.renderer.camMode + 1) % 3;
    this.settings.camera = this.renderer.camMode; saveSettings(this.settings);
    $('pause-camera').textContent = 'Telecamera: ' + CAMERA_NAMES[this.renderer.camMode];
    this.flashNote('Telecamera ' + CAMERA_NAMES[this.renderer.camMode].toLowerCase());
  }

  flashNote(text) {
    const n = $('note');
    n.textContent = text; n.hidden = false;
    clearTimeout(this._noteT);
    this._noteT = setTimeout(() => { n.hidden = true; }, 1400);
  }

  toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement) { d.exitFullscreen().catch(() => {}); return; }
    const el = d.documentElement;
    if (!el.requestFullscreen) { this.toast('Schermo intero non disponibile qui. Nell\'app usa F11.', true); return; }
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      // Esc resta il tasto della pausa: per uscire si tiene premuto Esc o si usa F11
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(() => {});
    }).catch(() => this.toast('Il browser non ha permesso lo schermo intero', true));
  }

  // ---------- ULTIMA PARTITA ----------
  // ripristina squadre e opzioni dell'ultima partita giocata (controllando che siano ancora valide)
  restoreSetup() {
    const l = this.settings.lastSetup, s = this.setup, n = this.db.length;
    if (!l) return;
    const okIdx = v => Number.isInteger(v) && v >= 0 && v < n;
    if (okIdx(l.home) && okIdx(l.away) && l.home !== l.away) { s.home = l.home; s.away = l.away; }
    if (l.side === 0 || l.side === 1) s.side = l.side;
    if ([0, 1, 2].includes(l.difficulty)) s.difficulty = l.difficulty;
    if ([120, 180, 300].includes(l.halfSeconds)) s.halfSeconds = l.halfSeconds;
    if (typeof l.formation === 'string' && FORMATIONS[l.formation]) s.formation = l.formation;
    if (Number.isInteger(l.mentality) && l.mentality >= 0 && l.mentality < MENTALITIES.length) s.mentality = l.mentality;
  }

  // ---------- CONTROLLER E NAVIGAZIONE ----------
  applyPadSettings() {
    const s = this.settings, I = this.input;
    I.padEnabled = s.padEnabled; I.deadzone = s.deadzone; I.vibration = s.vibration;
    this.chipKey = null;
  }
  // nome del comando per il dispositivo in uso (tastiera o controller)
  btn(action) {
    const I = this.input;
    if (I.lastDevice === 'pad' && I.pad[action] !== null && I.pad[action] !== undefined) return padName(I.pad[action], this.settings.padLayout);
    const k = I.keys[action];
    return keyName(k[0] || k[1]);
  }
  onPadConnect(on, gp) {
    const name = String(gp && gp.id || 'controller').replace(/\s*\(.*$/, '').slice(0, 40) || 'controller';
    if (on) {
      let t = 'Controller collegato: ' + name;
      if (!this.settings.padEnabled) t += ' (disattivato nelle impostazioni)';
      else if (gp && gp.mapping !== 'standard') t += '. Mappatura non standard: se i pulsanti non corrispondono, cambiali in Impostazioni, Controlli.';
      this.toast(t);
    } else {
      this.toast('Controller scollegato', true);
      // partita offline guidata col controller: pausa automatica
      if (this.mode === 'offline' && this.screen === 'match' && !this.paused && this.input.lastDevice === 'pad') this.togglePause(true);
      this.input.setDevice('kb');
    }
    if (this.screen === 'settings') this.renderSettings();
  }

  // elementi su cui ci si può spostare nella schermata visibile
  navRoot() {
    if (!$('busy').hidden) return $('busy');
    if (this.screen === 'match') return this.paused && !$('pause').hidden ? $('pause') : null;
    const id = { menu: 'menu', setup: 'setup', online: 'online', lobby: 'lobby', settings: 'settings', help: 'help', fulltime: 'fulltime' }[this.screen];
    return id ? $(id) : null;
  }
  navItems(root) {
    return [...root.querySelectorAll('button, input, select')].filter(el => !el.disabled && el.offsetParent !== null && !el.closest('[hidden]'));
  }
  focusEl(el) {
    el.focus({ preventScroll: true });
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // sposta il focus sull'elemento più vicino nella direzione indicata
  navigate(dir) {
    const root = this.navRoot();
    if (!root) return false;
    const items = this.navItems(root);
    if (!items.length) return false;
    const cur = items.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) {
      // niente selezionato: si parte dal pulsante principale della schermata
      const main = items.find(el => el.classList.contains('primary') || el.classList.contains('mode'));
      this.focusEl(main || items[0]);
      return true;
    }
    if (cur.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = Number(cur.step) || 1;
      const v = clamp(Number(cur.value) + (dir === 'right' ? step : -step), Number(cur.min), Number(cur.max));
      if (v !== Number(cur.value)) { cur.value = v; cur.dispatchEvent(new Event('input')); cur.dispatchEvent(new Event('change')); }
      return true;
    }
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    let best = null, bs = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const q = el.getBoundingClientRect();
      // distanza tra i bordi più vicini, così si salta bene tra righe di pulsanti di larghezza diversa
      const ex = q.left + q.width / 2, ey = q.top + q.height / 2;
      const along = vx ? (ex - cx) * vx : (ey - cy) * vy;
      if (along < 4) continue;
      const ortho = vx ? Math.max(0, Math.abs(ey - cy) - (q.height + r.height) / 2) : Math.max(0, Math.abs(ex - cx) - (q.width + r.width) / 2);
      const sc = along + ortho * 3;
      if (sc < bs) { bs = sc; best = el; }
    }
    if (best) this.focusEl(best);
    return true;
  }
  // un passo indietro (Esc o B): chiude la schermata attuale
  uiBack() {
    if (!$('busy').hidden) { $('busy-cancel').click(); return; }
    switch (this.screen) {
      case 'match': if (this.paused) this.togglePause(false); break;
      case 'setup': $('setup-back').click(); break;
      case 'online': $('on-back').click(); break;
      case 'settings': this.closeSettings(); break;
      case 'help': this.closeHelp(); break;
    }
  }
  // tasti nei menu (la partita non è in corso o è in pausa)
  onUiKey(code) {
    if (code === 'Escape') {
      // in partita Esc è il tasto della pausa (gestito dal ciclo); se è stato tolto, chiude comunque la pausa
      if (this.screen === 'match' && this.input.keys.pause.includes('Escape')) return false;
      this.uiBack();
      return true;
    }
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (dirs[code]) {
      const a = document.activeElement;
      // sugli slider le frecce destra/sinistra cambiano il valore (comportamento normale)
      if (a && a.type === 'range' && (code === 'ArrowLeft' || code === 'ArrowRight')) return false;
      return this.navigate(dirs[code]);
    }
    return false;
  }
  // controller nei menu: croce/levetta per spostarsi, A conferma, B indietro, LB/RB cambiano scheda
  padMenuNav(dt) {
    const inMenu = this.screen !== 'match' || this.paused || !$('busy').hidden;
    if (!inMenu) { this.input.navHold.dir = null; return; }
    let cmd = this.input.navCommand(dt);
    if (!cmd) return;
    document.body.classList.add('pad-nav');
    if (this.input.capture && cmd === 'back') { const fn = this.input.capture; this.input.capture = null; fn(null); return; }
    if (cmd === 'back') { this.uiBack(); return; }
    if (cmd === 'start') { if (this.screen === 'match') return; cmd = 'accept'; }
    if (cmd === 'prev' || cmd === 'next') {
      if (this.screen === 'settings') {
        const tabs = [...document.querySelectorAll('[data-tab]')].map(b => b.dataset.tab);
        const i = tabs.indexOf(this.settingsTab || 'grafica');
        this.settingsTab = tabs[(i + (cmd === 'next' ? 1 : -1) + tabs.length) % tabs.length];
        this.renderSettings();
        const t = document.querySelector('[data-tab="' + this.settingsTab + '"]'); if (t) t.focus({ preventScroll: true });
      }
      return;
    }
    if (cmd === 'accept') {
      const root = this.navRoot();
      const a = document.activeElement;
      if (!root || !a || !root.contains(a) || a === document.body) { this.navigate('down'); return; }
      if (a.type === 'range') return;
      if (a.tagName === 'INPUT' && a.type === 'text') { a.select && a.select(); return; }
      a.click();
      return;
    }
    this.navigate(cmd);
  }

  // ---------- SCHERMATA COMANDI ----------
  openHelp(ret) {
    // in partita offline il gioco si ferma mentre si leggono i comandi
    if (ret === 'pause' && this.screen === 'match' && !this.paused) this.togglePause(true);
    $('pause').hidden = true;
    this.helpReturn = ret;
    this.showScreen('help');
  }
  closeHelp() {
    if (this.helpReturn === 'pause' && this.match) { this.showScreen('match'); this.togglePause(true); }
    else this.showScreen('menu');
  }
  renderHelp() {
    const I = this.input, L = this.settings.padLayout;
    const k = a => { const ks = I.keys[a].filter(Boolean); return ks.length ? ks.map(keyName).join(' / ') : '—'; };
    const g = a => padName(I.pad[a], L);
    const mouse = this.settings.mouse;
    // movimento: prima i tasti principali (es. WASD), poi gli alternativi (es. frecce)
    const dirKeys = slot => ['up', 'left', 'down', 'right'].map(a => I.keys[a][slot] ? keyName(I.keys[a][slot]) : '').join('');
    const move = [dirKeys(0), dirKeys(1)].filter(Boolean).join(' / ') || '—';
    const sections = [
      ['Movimento', [
        ['Muovi il calciatore', move, 'Levetta sinistra o croce'],
        ['Scatto (tieni premuto, consuma energia)', k('sprint'), g('sprint')],
        ['Camminata lenta', '—', 'Levetta poco inclinata'],
      ]],
      ['Con la palla', [
        ['Passaggio rasoterra: verso la direzione; senza direzione al compagno più libero', k('pass') + (mouse ? ' / Clic sx' : ''), g('pass')],
        ['Lancio lungo o cross', k('long'), g('long')],
        ['Passaggio filtrante (nello spazio davanti al compagno)', k('through'), g('through')],
        ['Tiro: tieni premuto per caricare, rilascia per calciare. Su o giù scelgono il palo, senza direzione l\'angolo lontano dal portiere', k('shoot') + (mouse ? ' / Clic dx' : ''), g('shoot')],
      ]],
      ['Senza palla', [
        ['Contrasto (da vicino, senza penalità se sei lontano)', k('pass'), g('pass')],
        ['Scivolata (rischiosa, possibile fallo)', k('shoot'), g('shoot')],
        ['Pressing: tieni premuto e il calciatore va da solo sul portatore o sulla palla', k('press'), g('press')],
        ['Cambio giocatore: il più vicino alla palla, o chi deve ricevere il tuo passaggio', k('switch'), g('switch')],
        ['Cambio verso una direzione', '—', 'Levetta destra (colpetto)'],
      ]],
      ['Calci piazzati', [
        ['Rimessa, corner, rinvio, calcio d\'inizio: passaggio corto o lancio, con o senza direzione', k('pass') + ' / ' + k('long'), g('pass') + ' / ' + g('long')],
        ['Punizione: passaggio, lancio, filtrante oppure tiro caricato', k('shoot'), g('shoot')],
        ['Rigore: carica il tiro, su o giù per il lato', k('shoot'), g('shoot')],
        ['Rigore contro: tieni su o giù per scegliere dove si tuffa il tuo portiere', move, 'Levetta sinistra'],
      ]],
      ['Partita', [
        ['Pausa (tattica, impostazioni, ricomincia)', k('pause'), g('pause')],
        ['Telecamera', k('camera'), g('camera')],
        ['Audio sì/no', k('mute'), g('mute')],
        ['Questa schermata', k('help'), g('help')],
        ['Salta il replay', 'Spazio / Invio / ' + k('pass'), g('pass')],
      ]],
      ['Menu', [
        ['Spostati tra i pulsanti', 'Frecce o Tab', 'Croce o levetta sinistra'],
        ['Conferma', 'Invio', padName(0, L)],
        ['Indietro', 'Esc', padName(1, L)],
        ['Schede delle impostazioni', 'Clic', padName(4, L) + ' / ' + padName(5, L)],
      ]],
    ];
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const dev = this.input.lastDevice;
    let html = '';
    for (const [title, rows] of sections) {
      html += '<h3>' + esc(title) + '</h3><table class="helptable"><tr><th></th><th' + (dev !== 'pad' ? ' class="cur"' : '') + '>Tastiera</th><th' + (dev === 'pad' ? ' class="cur"' : '') + '>Controller</th></tr>';
      for (const r of rows) html += '<tr><td>' + esc(r[0]) + '</td><td class="k">' + esc(r[1]) + '</td><td class="k">' + esc(r[2]) + '</td></tr>';
      html += '</table>';
    }
    $('help-body').innerHTML = html;
    const pc = this.input.padConnected();
    $('help-pad').textContent = pc ? 'Controller collegato' + (this.settings.padEnabled ? '' : ' ma disattivato nelle impostazioni') + '.' : 'Nessun controller collegato: collegalo e premi un pulsante.';
  }

  // ---------- IMPOSTAZIONI ----------
  openSettings(tab, ret) { this.settingsTab = tab; this.settingsReturn = ret; this.showScreen('settings'); }
  closeSettings() {
    saveSettings(this.settings);
    this.input.capture = null; this.input.padCapture = null;
    const r = this.settingsReturn;
    if (r === 'pause') { this.showScreen('match'); this.togglePause(true); }
    else this.showScreen(r === 'online' ? 'online' : 'menu');
  }

  renderSettings() {
    const s = this.settings, tab = this.settingsTab || 'grafica';
    document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab; });
    const save = () => saveSettings(s);
    // grafica
    this.segmented('st-quality', QUALITY_LEVELS.map(q => ({ label: q.label, value: q.id })), s.quality, v => { s.quality = v; this.renderer.setQuality(v); save(); this.renderSettings(); });
    const res = $('st-res');
    res.value = Math.round(s.resScale * 100); $('st-res-out').textContent = res.value + '%';
    res.oninput = () => { s.resScale = res.value / 100; $('st-res-out').textContent = res.value + '%'; this.renderer.setResolutionScale(s.resScale); this.updateDrawInfo(); };
    res.onchange = save;
    $('st-dyn').checked = s.dynamicRes;
    $('st-dyn').onchange = () => { s.dynamicRes = $('st-dyn').checked; if (!s.dynamicRes) this.renderer.setDynamicScale(1); save(); this.updateDrawInfo(); };
    this.segmented('st-fps', [{ label: 'Schermo', value: 0 }, { label: '30', value: 30 }, { label: '60', value: 60 }, { label: '120', value: 120 }, { label: '144', value: 144 }], s.fpsLimit, v => { s.fpsLimit = v; save(); this.renderSettings(); });
    $('st-full').textContent = document.fullscreenElement ? 'Disattiva' : 'Attiva';
    $('st-showfps').checked = s.showFps;
    $('st-showfps').onchange = () => { s.showFps = $('st-showfps').checked; $('fps').hidden = !s.showFps; save(); };
    this.updateDrawInfo();
    // audio
    const vol = (id, key) => {
      const el = $(id);
      el.value = Math.round(s[key] * 100); $(id + '-out').textContent = el.value + '%';
      el.oninput = () => { s[key] = el.value / 100; $(id + '-out').textContent = el.value + '%'; this.applyAudio(); };
      el.onchange = save;
    };
    vol('st-vm', 'volMaster'); vol('st-vs', 'volSfx'); vol('st-vc', 'volCrowd');
    $('st-mute').checked = s.muted;
    $('st-mute').onchange = () => { s.muted = $('st-mute').checked; this.applyAudio(); save(); };
    // controlli
    this.renderKeys();
    $('st-keys-reset').onclick = () => { s.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS)); this.input.setKeys(s.keys); save(); this.chipKey = null; this.renderKeys(); this.toast('Tasti della tastiera predefiniti'); };
    $('st-pad-reset').onclick = () => { s.padKeys = JSON.parse(JSON.stringify(DEFAULT_PAD)); this.input.setPadKeys(s.padKeys); save(); this.chipKey = null; this.renderKeys(); this.toast('Pulsanti del controller predefiniti'); };
    $('st-mouse').checked = s.mouse;
    $('st-mouse').onchange = () => { s.mouse = $('st-mouse').checked; this.input.mouseEnabled = s.mouse; save(); };
    $('st-pad').checked = s.padEnabled;
    $('st-pad').onchange = () => { s.padEnabled = $('st-pad').checked; this.applyPadSettings(); save(); this.renderSettings(); };
    this.segmented('st-padlayout', [{ label: 'Xbox', value: 'xbox' }, { label: 'PlayStation', value: 'ps' }], s.padLayout, v => { s.padLayout = v; this.chipKey = null; save(); this.renderSettings(); });
    $('st-vib').checked = s.vibration;
    $('st-vib').onchange = () => { s.vibration = $('st-vib').checked; this.applyPadSettings(); save(); if (s.vibration) this.input.rumble(200, 0.6, 0.6); };
    const dz = $('st-dz');
    dz.value = Math.round(s.deadzone * 100); $('st-dz-out').textContent = dz.value + '%';
    dz.oninput = () => { s.deadzone = dz.value / 100; $('st-dz-out').textContent = dz.value + '%'; this.applyPadSettings(); };
    dz.onchange = save;
    $('st-assist').checked = s.assistReceive;
    $('st-assist').onchange = () => { s.assistReceive = $('st-assist').checked; save(); };
    const pc = this.input.padConnected();
    $('st-pad-status').className = 'small' + (pc ? ' ok' : '');
    $('st-pad-status').textContent = !s.padEnabled ? 'Controller disattivato.' : pc ? 'Controller collegato' + (this.input.padId ? ': ' + this.input.padId.replace(/\s*\(.*$/, '').slice(0, 48) : '') + '.' : 'Nessun controller collegato. Collegalo (USB o Bluetooth) e premi un pulsante.';
    // online
    $('st-server').value = s.server;
    $('st-server').onchange = () => { s.server = $('st-server').value.trim(); save(); };
    $('st-server-test').onclick = () => this.testServer();
  }

  updateDrawInfo() {
    const d = this.renderer.drawingSize();
    $('st-drawinfo').textContent = d.w + ' × ' + d.h + ' pixel (rapporto ' + d.ratio.toFixed(2) + ', schermo ' + (window.devicePixelRatio || 1).toFixed(2) + 'x' +
      (this.renderer.dynScale < 1 ? ', dinamica ' + Math.round(this.renderer.dynScale * 100) + '%' : '') + ')';
  }

  applyAudio() {
    const s = this.settings;
    this.audio.setVolumes({ master: s.volMaster, sfx: s.volSfx, crowd: s.volCrowd, muted: s.muted });
  }

  renderKeys() {
    const box = $('st-keys');
    const L = this.settings.padLayout;
    box.innerHTML = '<span class="kh">Azione</span><span class="kh">Tasto</span><span class="kh">Alternativo</span><span class="kh">Controller</span>';
    const saveKeys = () => {
      this.settings.keys = JSON.parse(JSON.stringify(this.input.keys));
      this.settings.padKeys = JSON.parse(JSON.stringify(this.input.pad));
      saveSettings(this.settings);
      this.chipKey = null;
    };
    for (const a of ACTIONS) {
      const lab = document.createElement('span'); lab.textContent = a.label; box.appendChild(lab);
      for (let slot = 0; slot < 2; slot++) {
        const b = document.createElement('button');
        b.className = 'keybtn';
        b.dataset.bind = a.id + ':' + slot;
        b.textContent = keyName(this.input.keys[a.id][slot]);
        b.setAttribute('aria-label', a.label + (slot ? ', tasto alternativo' : ', tasto principale'));
        b.onclick = () => {
          this.input.padCapture = null;
          b.classList.add('wait'); b.textContent = slot ? 'Premi… (⌫ toglie)' : 'Premi…';
          this.input.capture = code => {
            // il tasto alternativo si può togliere con Backspace o Canc
            if (slot === 1 && (code === 'Backspace' || code === 'Delete')) { this.input.keys[a.id][1] = null; this.input.setKeys(this.input.keys); saveKeys(); }
            else if (code) {
              const prev = this.input.codeToAction[code];
              this.input.bind(a.id, slot, code); saveKeys();
              if (prev && prev !== a.id) this.toast(keyName(code) + ' tolto da “' + ACTIONS.find(x => x.id === prev).label + '”');
            }
            this.renderKeys();
            setTimeout(() => { const el = document.querySelector('[data-bind="' + a.id + ':' + slot + '"]'); if (el) el.focus({ preventScroll: true }); }, 0);
          };
        };
        box.appendChild(b);
      }
      const pb = document.createElement('button');
      pb.className = 'keybtn pad';
      pb.dataset.bind = a.id + ':pad';
      pb.textContent = padName(this.input.pad[a.id], L);
      pb.setAttribute('aria-label', a.label + ', pulsante del controller');
      pb.onclick = () => {
        this.input.capture = null;
        if (!this.input.padConnected()) { this.toast('Collega un controller e premi un suo pulsante per assegnarlo', true); return; }
        pb.classList.add('wait'); pb.textContent = 'Premi un pulsante…';
        clearTimeout(this._padCapT);
        this._padCapT = setTimeout(() => { if (this.input.padCapture) { this.input.padCapture = null; this.renderKeys(); } }, 6000);
        this.input.padCapture = btnIdx => {
          clearTimeout(this._padCapT);
          if (btnIdx !== null && btnIdx !== undefined) {
            const prev = this.input.actionOfPad(btnIdx);
            this.input.bindPad(a.id, btnIdx); saveKeys();
            if (prev && prev !== a.id) this.toast(padName(btnIdx, L) + ' tolto da “' + ACTIONS.find(x => x.id === prev).label + '”');
          }
          this.renderKeys();
          setTimeout(() => { const el = document.querySelector('[data-bind="' + a.id + ':pad"]'); if (el) el.focus({ preventScroll: true }); }, 0);
        };
      };
      box.appendChild(pb);
    }
  }

  async testServer() {
    const st = $('st-server-status');
    this.settings.server = $('st-server').value.trim(); saveSettings(this.settings);
    st.className = 'status'; st.textContent = 'Provo…';
    try {
      const ws = await new NetLink(this.settings.server).open(4000);
      ws.close();
      st.className = 'status ok'; st.textContent = 'Server raggiungibile';
    } catch (e) { st.className = 'status err'; st.textContent = e.message; }
  }

  // ---------- CICLO PRINCIPALE ----------
  loop(t) {
    requestAnimationFrame(tt => this.loop(tt));
    // limite fps: salta i fotogrammi in eccesso (la simulazione recupera il tempo al passo dopo)
    const lim = this.settings.fpsLimit;
    if (lim > 0 && t - this.last < 1000 / lim - 1.5) return;
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.lastFrameAt = performance.now();
    this.time += dt;
    const R = this.renderer;
    this.watchPerformance(dt);
    // controller: lettura una volta per fotogramma, poi navigazione nei menu
    this.input.pollPads(dt);
    if (this.input.padJust.some(Boolean)) this.audio.init();
    this.padMenuNav(dt);
    if (this.screen === 'match' && this.match) {
      if (this.input.consumeAction('pause')) this.togglePause();
      if (this.input.consumeAction('help')) this.openHelp('pause');
      if (!this.paused) {
        if (this.input.consumeAction('camera')) this.cycleCamera();
        if (this.input.consumeAction('mute')) { this.settings.muted = !this.settings.muted; this.applyAudio(); saveSettings(this.settings); this.flashNote(this.settings.muted ? 'Audio disattivato' : 'Audio attivo'); }
      }
      if (this.mode === 'offline') this.updateOffline(dt);
      else if (this.mode === 'host') this.tickHost(dt, false);
      else if (this.mode === 'client') this.updateClient(dt);
      this.updateHeldChips(dt);
    } else if (this.screen === 'fulltime' && this.match) {
      if (this.mode === 'host') this.tickHost(dt, false);
      else if (this.mode === 'client' && this.net) { const ev = this.net.client.update(dt); for (const e of ev) this.handleEvent(e); R.syncFromMatch(this.match, dt); }
      else R.syncFromMatch(this.match, dt);
    } else if (this.mode === 'host' && this.net && this.net.host && this.net.host.match) {
      // l'host è nelle impostazioni o nei comandi: la partita online non si deve fermare
      this.tickHost(dt, true);
    } else if (this.demo) {
      this.acc += dt;
      while (this.acc >= CONFIG.DT) { this.demo.update(CONFIG.DT, null); this.demo.events.length = 0; this.acc -= CONFIG.DT; }
      if (this.demo.state === 'FULLTIME') this.startDemo();
      R.syncFromMatch(this.demo, dt, this.acc / CONFIG.DT);
      R.menuCamera(this.time);
      this.audio.crowd(0.1);
    }
    R.render();
    if (!this.loaded) { this.loaded = true; $('loading').classList.add('out'); setTimeout(() => { $('loading').hidden = true; }, 650); }
    this.input.endFrame();
  }

  // fps e risoluzione dinamica (misura ogni secondo)
  watchPerformance(dt) {
    const pf = this.perf;
    pf.t += dt; pf.frames++;
    if (pf.t < 1) return;
    const fps = pf.frames / pf.t;
    pf.t = 0; pf.frames = 0;
    if (this.settings.showFps) { $('fps').hidden = false; $('fps').textContent = Math.round(fps) + ' fps, ' + Math.round(this.renderer.renderer.getPixelRatio() * 100) / 100 + 'x'; }
    if (!this.settings.dynamicRes) return;
    const target = this.settings.fpsLimit > 0 ? this.settings.fpsLimit : 60;
    const R = this.renderer;
    // ogni cambio di risoluzione costa un piccolo scatto: si cambia solo con misure stabili e non troppo spesso.
    // Si scende dopo 2 secondi lenti di fila, si risale dopo 6 secondi buoni, mai due cambi a meno di 4 secondi.
    pf.since = (pf.since === undefined ? 4 : pf.since) + 1;
    if (fps < target * 0.85) { pf.good = 0; pf.bad = (pf.bad || 0) + 1; }
    else if (fps > target * 0.97) { pf.bad = 0; pf.good++; }
    else { pf.good = 0; pf.bad = 0; }
    if (pf.since < 4) return;
    if (pf.bad >= 2 || (pf.bad >= 1 && fps < target * 0.5)) {
      if (R.setDynamicScale(R.dynScale - (fps < target * 0.6 ? 0.15 : 0.08))) pf.since = 0;
      pf.bad = 0;
    } else if (pf.good >= 6 && R.dynScale < 1) {
      if (R.setDynamicScale(R.dynScale + 0.05)) pf.since = 0;
      pf.good = 0;
    }
  }

  // ---------- COMANDI DI GIOCO ----------
  // legge i comandi e li porta sul campo: con la telecamera "dietro al giocatore" su = verso la porta avversaria.
  // Con buffer: un tasto premuto in un fotogramma senza passi di simulazione (schermi a 120-144 Hz)
  // resta in attesa del passo successivo invece di andare perso.
  gameInput(useBuffer) {
    const inp = this.input.read();
    const m = this.match;
    if (this.renderer.camMode === 2 && m) {
      const h = m.humanById(this.renderer.localId);
      const dir = h ? m.teams[h.team].dir : 1;
      const sx = inp.mx, sz = inp.mz;
      inp.mx = -dir * sz; inp.mz = dir * sx;
      if (inp.switchDir) { const a = inp.switchDir; inp.switchDir = [-dir * a[1], dir * a[0]]; }
    }
    if (!useBuffer) return inp;
    const buf = this.pressBuf || (this.pressBuf = { pressed: {}, switchDir: null });
    for (const k in inp.pressed) if (inp.pressed[k]) buf.pressed[k] = true;
    if (inp.switchDir) buf.switchDir = inp.switchDir;
    inp.pressed = Object.assign({}, buf.pressed);
    inp.switchDir = buf.switchDir;
    return inp;
  }
  // il calciatore che controlla questo computer (o null)
  localPlayer() {
    const m = this.match, h = m && m.humanById ? m.humanById(this.renderer.localId) : null;
    return h ? h.player : null;
  }

  // ----- partita offline: simulazione a passo fisso, pausa e replay fermano il tempo
  updateOffline(dt) {
    const m = this.match, R = this.renderer;
    if (this.paused) { R.syncFromMatch(m, 0, this.acc / CONFIG.DT); return; }
    if (this.playReplay(dt)) return;
    this.acc += dt;
    let first = true;
    const lh = m.humanById('local');
    if (lh) lh.assist = this.settings.assistReceive;
    const frameInput = m.humans.length ? this.gameInput(true) : null;
    while (this.acc >= CONFIG.DT) {
      const input = frameInput && !first ? Object.assign({}, frameInput, { pressed: {}, switchDir: null }) : frameInput;
      if (first) this.pressBuf = null;
      first = false;
      m.update(CONFIG.DT, input);
      this.acc -= CONFIG.DT;
      for (const e of m.events) this.handleEvent(this.eventFromMatch(m, e));
      m.events.length = 0;
    }
    this.afterSim(m, dt, 0.55, false, this.acc / CONFIG.DT);
  }

  // ----- host: la simulazione continua sempre, anche in pausa e durante il replay
  tickHost(dt, background) {
    const h = this.net && this.net.host;
    if (!h || !h.match) return;
    let input = null;
    if (!background && !this.paused && this.screen === 'match') input = this.gameInput(true);
    const lh = h.match.humanById(this.net.link.id);
    if (lh) lh.assist = this.settings.assistReceive;
    const evs = h.update(dt, input);
    if (h.localUsed) this.pressBuf = null;
    if (background) return;
    for (const e of evs) this.handleEvent(this.eventFromMatch(h.match, e));
    if (this.screen === 'fulltime') { this.renderer.syncFromMatch(h.match, dt); return; }
    if (this.playReplay(dt)) return;
    this.afterSim(h.match, dt, 0.7, true, h.acc / CONFIG.DT);
    this.updateNetIndicator();
  }

  // ----- client: manda i comandi e mostra lo stato interpolato
  updateClient(dt) {
    const c = this.net.client;
    if (!c.match) return;
    const input = !this.paused ? this.gameInput(false) : { mx: 0, mz: 0, sprint: false, shoot: false, press: false, pressed: {} };
    c.sendInput(input);
    const evs = c.update(dt);
    for (const e of evs) this.handleEvent(e);
    if (this.playReplay(dt)) { this.updateNetIndicator(); return; }
    this.afterSim(c.match, dt, 0.7, true);
    this.updateNetIndicator();
  }

  afterSim(m, dt, replaySpeed, online, alpha) {
    const R = this.renderer;
    if (this.replayPending && m.state === 'GOAL' && m.stateTime > 1.6) {
      this.replayPending = false;
      let frames = m.replay.slice();
      // online la partita non si ferma: replay breve (2 s attorno al gol) che finisce prima della ripresa
      if (online) {
        // il buffer scorre: il gol è avvenuto stateTime secondi fa
        const end = Math.max(0, Math.min(frames.length, frames.length - Math.round(m.stateTime * 60) + 24));
        frames = frames.slice(Math.max(0, end - 120), end);
      }
      // copia: i fotogrammi del buffer vengono riusati mentre la partita va avanti
      frames = frames.map(f => f.slice());
      if (frames.length > 10) { this.replay = { frames: frames, i: 0, speed: replaySpeed }; this.updateReplayTag(); $('replay-tag').hidden = false; }
    }
    R.syncFromMatch(m, dt, alpha);
    const excite = m.state === 'GOAL' ? 1 : Math.max(0, (Math.abs(m.ball.x) - 25) / 30);
    this.audio.crowd(excite);
    this.updateHUD();
    if (m.state === 'FULLTIME' && m.stateTime > 2.5 && this.screen === 'match') this.showFullTime();
  }

  playReplay(dt) {
    if (!this.replay) return false;
    const rp = this.replay, m = this.match;
    rp.i += dt * 60 * rp.speed;
    const skip = this.input.consume('Space') || this.input.consumeAction('pass') || this.input.consume('Enter');
    if (rp.i >= rp.frames.length - 1 || skip || (this.mode !== 'offline' && m.state !== 'GOAL' && rp.i > 10 && m.state !== 'KICKOFF')) {
      this.replay = null; $('replay-tag').hidden = true; return false;
    }
    this.renderer.syncFromReplay(rp.frames[Math.floor(rp.i)], m, dt);
    this.updateHUD();
    return true;
  }

  // evento della simulazione locale -> stesso formato degli eventi di rete
  eventFromMatch(m, e) {
    const ev = { type: e.type, x: m.ball.x, z: m.ball.z };
    if (e.type === 'kick') ev.power = e.data.power;
    if (e.type === 'whistle') ev.kind = e.data.type;
    if (e.type === 'goal') ev.team = e.data.team;
    return ev;
  }

  // vibrazione del controller (solo se lo si sta usando)
  rumble(ms, strong, weak) {
    if (this.input.lastDevice === 'pad' && this.settings.vibration) this.input.rumble(ms, strong, weak);
  }
  handleEvent(e) {
    const R = this.renderer, m = this.match;
    switch (e.type) {
      case 'kick': {
        this.audio.kick(e.power || 10); R.burst('grass', e.x, e.z, { amount: Math.min(1.5, (e.power || 10) / 18) });
        // calcio del tuo calciatore: piccolo colpo nelle mani
        const me = this.localPlayer();
        if (me && dist2(me.x, me.z, e.x, e.z) < 1.6) this.rumble(e.power > 20 ? 110 : 60, e.power > 20 ? 0.45 : 0.15, 0.5);
        break;
      }
      case 'tackle': { R.burst('dust', e.x, e.z); const me = this.localPlayer(); if (me && dist2(me.x, me.z, e.x, e.z) < 3) this.rumble(140, 0.7, 0.3); break; }
      case 'whistle': this.audio.whistle(e.kind === 'END' ? 3 : e.kind === 'HALF' ? 2 : 1); break;
      case 'post': this.audio.post(); this.rumble(160, 0.3, 0.8); if (m && this.mode !== 'client') m.showBanner('Palo!', 1.2); else if (m) m.banner = { text: 'Palo!', t: 1.2 }; break;
      case 'save': this.audio.roar(false); break;
      case 'goal': {
        this.audio.roar(true);
        this.replayPending = true;
        const team = m && m.teams[e.team];
        R.burst('confetti', Math.sign(e.x || 1) * 46, 0, { colors: team ? [team.kit[0], team.kit[1]] : null });
        R.shake = 0.6;
        this.rumble(450, 1, 0.7);
        break;
      }
    }
  }

  // ---------- HUD ----------
  // riquadri dei comandi in basso: cambiano con il dispositivo (tastiera o controller) e con la situazione
  renderChips(show) {
    this.chipsShown = show;
    this.chipKey = null;
    this.chipCtx = 'att'; this.chipCtxT = 0;
    this.updateChips();
  }
  chipContext() {
    const m = this.match, h = m && m.humanById(this.renderer.localId);
    if (!h) return 'att';
    const o = m.ball.owner;
    const theirs = o ? o.team.index !== h.team : (m.possessionTeam && m.possessionTeam.index !== h.team);
    return theirs ? 'def' : 'att';
  }
  updateChips(dt) {
    const box = $('chips');
    if (!this.chipsShown) { box.hidden = true; return; }
    box.hidden = false;
    // il cambio attacco/difesa si applica solo se dura un attimo (niente sfarfallio nelle palle contese)
    const want = this.chipContext();
    if (want !== this.chipCtx) { this.chipCtxT += dt || 0; if (this.chipCtxT > 0.3) { this.chipCtx = want; this.chipCtxT = 0; } }
    else this.chipCtxT = 0;
    const key = this.chipCtx + '|' + this.input.lastDevice + '|' + this.settings.padLayout;
    if (key === this.chipKey) return;
    this.chipKey = key;
    const list = this.chipCtx === 'def'
      ? [['pass', 'Contrasto'], ['shoot', 'Scivolata'], ['press', 'Pressing'], ['switch', 'Cambio'], ['sprint', 'Scatto'], ['pause', 'Pausa']]
      : [['pass', 'Passaggio'], ['long', 'Lancio'], ['through', 'Filtrante'], ['shoot', 'Tiro'], ['switch', 'Cambio'], ['sprint', 'Scatto'], ['pause', 'Pausa']];
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    box.innerHTML = list.map(c => '<span class="chip" data-chip="' + c[0] + '" title="' + c[1] + '"><b>' + esc(this.btn(c[0])) + '</b><span class="cl">' + c[1] + '</span></span>').join('');
  }
  updateReplayTag() {
    const sm = $('replay-tag').querySelector('small');
    if (sm) sm.textContent = (this.input.lastDevice === 'pad' ? this.btn('pass') : 'Spazio') + ' per saltare';
  }
  flashChip(action) {
    if (this.screen !== 'match') return;
    const el = document.querySelector('[data-chip="' + action + '"]');
    if (!el) return;
    el.classList.add('hit');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('hit'), 160);
  }
  updateHeldChips(dt) {
    this.updateChips(dt);
    for (const a of ['shoot', 'sprint', 'press']) {
      const el = document.querySelector('[data-chip="' + a + '"]');
      if (el) el.classList.toggle('held', !this.paused && this.input.held(a));
    }
  }

  // scrive nel DOM solo se il valore è cambiato: evita ricalcoli della pagina a ogni fotogramma
  setText(id, v) { const c = this._hudCache || (this._hudCache = {}); v = String(v); if (c[id] === v) return; c[id] = v; $(id).textContent = v; }
  setStyle(id, prop, v) { const c = this._hudCache || (this._hudCache = {}); const k = id + '.' + prop; if (c[k] === v) return; c[k] = v; $(id).style[prop] = v; }
  setHidden(id, v) { const c = this._hudCache || (this._hudCache = {}); const k = id + '.h'; if (c[k] === v) return; c[k] = v; $(id).hidden = v; }

  updateHUD() {
    const m = this.match;
    this.setText('sb-score', m.teams[0].score + ' – ' + m.teams[1].score);
    const min = m.minute();
    this.setText('sb-time', m.state === 'HALFTIME' ? 'Int.' : m.state === 'FULLTIME' ? 'Fine' : (min + 1) + "'");
    const bn = $('banner');
    if (m.banner && !this.replay) {
      const cls = m.state === 'GOAL' ? 'banner goal' : 'banner';
      if (bn.hidden || bn.textContent !== m.banner.text) { bn.textContent = m.banner.text; bn.className = cls; }
      bn.hidden = false;
    } else if (!bn.hidden) bn.hidden = true;
    if (m.state === 'GOAL' && m.lastGoal && !this.replay && m.stateTime > 0.6) {
      this.setHidden('scorer', false);
      this.setText('scorer', m.lastGoal.minute + "'  " + m.lastGoal.scorer + (m.lastGoal.own ? ' (autogol)' : ''));
    } else this.setHidden('scorer', true);
    const h = m.humanById(this.renderer.localId);
    const c = h && h.player;
    if (c) {
      this.setHidden('pc', false);
      this.setText('pc-num', c.data.number);
      this.setText('pc-name', c.data.name);
      this.setText('pc-role', c.data.pos + ', ' + c.data.overall);
      this.setStyle('pc-energy', 'width', Math.round(c.energy) + '%');
      this.setStyle('pc-energy', 'background', c.energy < 40 ? 'var(--signal)' : 'var(--turf-light)');
      this.setStyle('pc-power', 'width', Math.round(h.shootCharge * 100) + '%');
      this.setText('pc-tip', this.playerTip(m, h, c));
    } else this.setHidden('pc', true);
    // minimappa: 30 volte al secondo bastano
    const now = performance.now();
    if (!this._mmT || now - this._mmT > 32) { this._mmT = now; this.drawMinimap(m, c); }
  }

  // suggerimento contestuale sotto il nome del calciatore (con i tasti del dispositivo in uso)
  playerTip(m, h, c) {
    const B = a => this.btn(a);
    const sp = m.setPiece;
    if ((m.state === 'SETPIECE' || m.state === 'KICKOFF') && sp) {
      if (sp.taker === c && m.setPieceReady) {
        if (sp.type === 'PENALTY') return 'Tieni premuto ' + B('shoot') + ' per caricare, rilascia per tirare. Su o giù scelgono il lato';
        if (sp.type === 'FREE_KICK') return B('pass') + ' passaggio, ' + B('long') + ' lancio, ' + B('shoot') + ' tiro (tieni premuto)';
        if (sp.type === 'CORNER') return B('long') + ' cross in area, ' + B('pass') + ' corto. Con una direzione scegli il compagno';
        return B('pass') + ' passaggio corto, ' + B('long') + ' lancio lungo';
      }
      if (sp.type === 'PENALTY' && sp.team && sp.team.index !== h.team) return 'Tieni su o giù quando parte il tiro: il portiere si tuffa da quella parte';
      return '';
    }
    if (m.state === 'PLAY' && m.ball.owner === c && c.isGK) return 'Rinvio: ' + B('pass') + ' corto, ' + B('long') + ' lungo';
    return '';
  }

  drawMinimap(m, mine) {
    const cv = $('minimap'), g = cv.getContext('2d');
    // canvas nitido anche su schermi HiDPI
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = 210, cssH = 136;
    if (cv.width !== Math.round(cssW * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW, H = cssH, sx = W / 105, sz = H / 68;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,60,34,0.8)'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(243,245,238,0.45)'; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
    g.beginPath(); g.arc(W / 2, H / 2, 9.15 * sx, 0, Math.PI * 2); g.stroke();
    g.strokeRect(0.5, (34 - 20.16) * sz, 16.5 * sx, 40.32 * sz);
    g.strokeRect(W - 16.5 * sx - 0.5, (34 - 20.16) * sz, 16.5 * sx, 40.32 * sz);
    for (const t of m.teams) for (const p of t.players) {
      const human = m.controllerOf(p);
      g.fillStyle = p.isGK ? '#dddddd' : t.kit[0];
      g.beginPath(); g.arc((p.x + 52.5) * sx, (p.z + 34) * sz, p === mine ? 4 : 3, 0, Math.PI * 2); g.fill();
      if (p === mine) { g.strokeStyle = '#ffd84a'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
      else if (human) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.stroke(); g.lineWidth = 1; }
      else { g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke(); }
    }
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc((m.ball.x + 52.5) * sx, (m.ball.z + 34) * sz, 2.2, 0, Math.PI * 2); g.fill();
  }

  showFullTime() {
    const m = this.match;
    this.showScreen('fulltime');
    const [a, b] = m.teams;
    $('ft-score').textContent = a.data.name + '  ' + a.score + ' – ' + b.score + '  ' + b.data.name;
    const h = m.humanById(this.renderer.localId);
    const human = h ? m.teams[h.team] : null;
    $('ft-verdict').textContent = !human ? 'Partita terminata' : human.score > human.opponent().score ? 'Vittoria' : human.score === human.opponent().score ? 'Pareggio' : 'Sconfitta';
    $('ft-goals').textContent = m.log.length ? m.log.map(g => g.minute + "' " + g.scorer + ' (' + g.team.data.short + (g.own ? ', autogol' : '') + ')').join(', ') : 'Nessun gol';
    const tot = a.stats.possession + b.stats.possession || 1;
    const rows = [
      ['Possesso', Math.round(a.stats.possession / tot * 100) + '%', Math.round(b.stats.possession / tot * 100) + '%'],
      ['Tiri', a.stats.shots, b.stats.shots],
      ['Tiri in porta', a.stats.onTarget, b.stats.onTarget],
      ['Passaggi riusciti', a.stats.passesOk + ' su ' + a.stats.passes, b.stats.passesOk + ' su ' + b.stats.passes],
      ['Falli', a.stats.fouls, b.stats.fouls],
      ['Calci d\'angolo', a.stats.corners, b.stats.corners],
      ['Fuorigioco', a.stats.offsides, b.stats.offsides],
    ];
    $('ft-stats').innerHTML = '<tr><th>' + a.data.short + '</th><th></th><th>' + b.data.short + '</th></tr>' +
      rows.map(r => '<tr><td>' + r[1] + '</td><th>' + r[0] + '</th><td>' + r[2] + '</td></tr>').join('');
    $('ft-rematch').hidden = this.mode === 'client';
    $('ft-setup').hidden = this.mode !== 'offline';
    $('ft-wait').hidden = this.mode !== 'client';
    $('ft-rematch').textContent = this.mode === 'host' ? 'Torna alla lobby' : 'Rivincita';
    $('ft-menu').textContent = this.mode === 'host' ? 'Chiudi la partita' : this.mode === 'client' ? 'Esci' : 'Menu principale';
  }

  // ---------- ONLINE ----------
  renderOnline() {
    $('on-name').value = this.settings.name;
    $('on-server').textContent = this.settings.server;
    const blocked = BUILD_TARGET === 'web';
    $('online-webonly').hidden = !blocked;
    $('on-create').disabled = blocked; $('on-join').disabled = blocked;
    $('on-lan').hidden = !window.campoLan;
    $('on-create-lan').disabled = blocked;
    $('on-status').textContent = ''; $('on-status').className = 'status';
  }
  onlineName() {
    const n = $('on-name').value.trim().slice(0, 16);
    if (n) { this.settings.name = n; saveSettings(this.settings); }
    return this.settings.name;
  }
  onlineError(e) {
    this.busy(null);
    const st = $('on-status');
    st.className = 'status err';
    st.textContent = e.message + (e.code || e.lan ? '' : '. Controlla l\'indirizzo del server nelle impostazioni (' + this.settings.server + ').');
  }

  // ferma il server in rete locale (se questa sessione lo aveva avviato)
  stopLan() {
    if (!this.lanHosting) return;
    this.lanHosting = false; this.lanInfo = null;
    try { window.campoLan.hostStop().catch(() => {}); } catch (e) { /* ignora */ }
  }

  async createOnline(lan) {
    const name = this.onlineName();
    let url = this.settings.server, cancelled = false, link = null;
    this.busy(lan ? 'Avvio il server in rete locale…' : 'Creo la partita…', () => { cancelled = true; if (link) link.leave(); this.stopLan(); });
    try {
      if (lan) {
        const r = await window.campoLan.hostStart();
        if (cancelled) { try { window.campoLan.hostStop(); } catch (e) { /* ignora */ } return; }
        if (!r || r.error) { const er = new Error(r && r.error || 'Non riesco ad avviare il server in rete locale'); er.lan = true; throw er; }
        this.lanHosting = true; this.lanInfo = r;
        url = 'ws://127.0.0.1:' + r.port;
      }
      link = new NetLink(url);
      await link.create(name);
      if (cancelled) return;
      const host = new HostSession(link, this.db, name);
      this.net = { link: link, host: host };
      host.onChange = () => { if (this.screen === 'lobby') this.renderLobby(); };
      this.bindLinkEvents(link);
      this.busy(null);
      this.mode = 'menu';
      this.showLobby();
    } catch (e) { if (lan) this.stopLan(); if (!cancelled) { if (lan) e.lan = true; this.onlineError(e); } }
  }

  async joinOnline() {
    const name = this.onlineName();
    const code = normalizeCode($('on-code').value);
    if (!NET.CODE_RE.test(code)) { this.onlineError(new Error('Il codice è di 6 caratteri, lettere e numeri')); return; }
    let link = null, cancelled = false, viaLan = false;
    const tryLan = !!window.campoLan && code[0] === 'L'; // i codici della rete locale iniziano con L: gli altri non vengono mai cercati in rete
    this.busy((tryLan ? 'Cerco la partita ' : 'Entro nella partita ') + code + '…', () => { cancelled = true; if (link) link.leave(); });
    try {
      let url = this.settings.server;
      if (tryLan) {
        // prima cerco l'host nella rete locale, poi ripiego sul server impostato
        let f = null;
        try { f = await window.campoLan.find(code); } catch (e) { f = null; }
        if (cancelled) return;
        if (f && typeof f.url === 'string' && /^ws:\/\/[0-9.]+:\d+$/.test(f.url)) { url = f.url; viaLan = true; }
      }
      link = new NetLink(url);
      if (tryLan) $('busy-text').textContent = 'Entro nella partita ' + code + '…';
      await link.join(code, name);
      if (cancelled) return;
      const client = new ClientSession(link, this.db, name);
      this.net = { link: link, client: client };
      client.onLobby = () => { if (this.screen === 'lobby') this.renderLobby(); };
      client.onStart = m => this.enterOnlineMatch(m);
      client.onLobbyReturn = () => { this.mode = 'menu'; this.match = null; this.startDemo(); this.showLobby(); };
      client.onReject = reason => { this.leaveOnline(false); this.backToMenuWith(reason, true); };
      this.bindLinkEvents(link);
      client.hello();
      this.busy(null);
      this.showLobby();
    } catch (e) {
      if (cancelled) return;
      // codice di rete locale non trovato né sul server: suggerimento sulla rete, non solo sull'indirizzo del server
      if (tryLan && !viaLan && (!e.code || e.code === 'NOT_FOUND')) { e = new Error("Non trovo la partita nella rete locale. Siete sulla stessa rete? Sul computer dell'host il firewall deve consentire il gioco"); e.lan = true; }
      if (viaLan) e.lan = true;
      this.onlineError(e);
    }
  }

  bindLinkEvents(link) {
    link.on('reconnecting', () => this.updateNetIndicator());
    link.on('reconnected', () => { this.toast('Connessione ripristinata'); this.updateNetIndicator(); });
    link.on('host-lost', () => { this.toast('L\'host ha perso la connessione: lo aspetto qualche secondo…', true); this.updateNetIndicator(); });
    link.on('host-back', () => { this.toast('L\'host è tornato'); this.updateNetIndicator(); });
    link.on('closed', e => {
      if (!this.net || this.net.link !== link) return;
      const why = { 'host-left': 'L\'host ha chiuso la partita', kicked: 'Sei stato tolto dalla partita', 'server-stop': 'Il server è stato spento' }[e.reason] || 'La partita è stata chiusa';
      this.net = null; this.stopLan();
      this.backToMenuWith(why, true);
    });
    link.on('lost', () => {
      if (!this.net || this.net.link !== link) return;
      this.stopLan();
      if (this.net.host && this.net.host.match && this.mode === 'host') {
        // l'host perde il server: la partita continua offline contro l'IA
        const m = this.net.host.match;
        for (const h of m.humans.slice()) if (h.id !== link.id) m.removeHuman(h.id);
        this.net = null; this.mode = 'offline';
        $('netind').hidden = true;
        this.toast('Connessione al server persa: la partita continua offline', true);
      } else {
        this.net = null;
        this.backToMenuWith('Connessione persa e non ripristinata', true);
      }
    });
  }

  backToMenuWith(text, isErr) {
    this.mode = 'menu'; this.match = null; this.paused = false; this.replay = null;
    $('pause').hidden = true; $('netind').hidden = true; this.busy(null);
    this.startDemo();
    this.showScreen('menu');
    this.toast(text, isErr);
  }

  leaveOnline(toMenu) {
    const n = this.net;
    this.net = null;
    if (n) { if (n.client) n.client.close(); else n.link.leave(); }
    this.stopLan();
    $('netind').hidden = true;
    if (toMenu) { this.mode = 'menu'; this.match = null; this.startDemo(); this.showScreen('online'); }
  }

  showLobby() {
    this.showScreen('lobby');
    this.renderLobby(true);
  }

  renderLobby(flip) {
    if (!this.net) return;
    const isHost = !!this.net.host;
    const L = isHost ? this.net.host.lobbyState() : this.net.client.lobby;
    const code = this.net.link.code;
    const board = $('lb-board');
    if (flip || board.dataset.code !== code) {
      board.dataset.code = code;
      board.textContent = '';
      code.split('').forEach((ch, i) => { const sp = document.createElement('span'); sp.className = 'flap flip'; sp.style.animationDelay = (i * 0.06) + 's'; sp.textContent = ch; board.appendChild(sp); });
    }
    const li = isHost && this.lanHosting && this.lanInfo;
    $('lb-lan').hidden = !li;
    if (li) $('lb-lan').textContent = 'Rete locale: ' + (li.addresses.length ? li.addresses.map(a => a + ':' + li.port).join(' / ') : 'nessuna rete trovata') + ' — gli amici entrano con il codice. Se Windows chiede il permesso del firewall, consentilo.';
    $('lb-sub').textContent = isHost ? 'Sei l\'host: la partita gira sul tuo computer. Tieni aperto il gioco finché giocate.' : 'Sei collegato alla partita. Scegli una squadra e aspetta l\'avvio.';
    if (!L) { $('lb-list-0').innerHTML = '<li class="empty">Caricamento…</li>'; return; }
    const s = L.settings, myId = this.net.link.id;
    const teams = [this.db[s.home], this.db[s.away]];
    [0, 1].forEach(i => {
      $('lb-team-' + i).textContent = teams[i].name;
      $('lb-kit-' + i).style.background = teams[i].kits[i === 0 ? 'home' : 'away'][0];
      $('lb-col-' + i).style.borderTopColor = teams[i].kits[i === 0 ? 'home' : 'away'][0];
    });
    const me = L.members.find(m => m.id === myId);
    for (const side of [0, 1, -1]) {
      const list = L.members.filter(m => m.side === side);
      $('lb-list-' + side).innerHTML = list.length ? list.map(m => {
        const dot = !m.connected ? 'dot bad' : m.ping > 150 ? 'dot warn' : 'dot';
        return '<li class="' + (m.id === myId ? 'me' : '') + '"><span class="' + dot + '" title="' + (m.connected ? 'Collegato' : 'Disconnesso') + '"></span><span class="nm"></span>' +
          (m.isHost ? '<span class="tag">host</span>' : '') + '<span class="ping"></span></li>';
      }).join('') : '<li class="empty">Nessuno</li>';
      // i nomi vanno inseriti come testo (mai come HTML)
      const items = $('lb-list-' + side).querySelectorAll('.nm');
      const pings = $('lb-list-' + side).querySelectorAll('.ping');
      list.forEach((m, i) => { if (items[i]) items[i].textContent = m.name; if (pings[i]) pings[i].textContent = m.isHost ? '' : m.connected ? m.ping + ' ms' : 'perso'; });
      const btn = document.querySelector('[data-side="' + side + '"]');
      btn.classList.toggle('on', !!me && me.side === side);
      btn.disabled = L.phase !== 'lobby' || (side >= 0 && list.length >= NET.MAX_PER_TEAM && !(me && me.side === side));
    }
    $('lb-host-opts').hidden = !isHost;
    if (isHost) {
      $('lb-home-name').textContent = teams[0].name; $('lb-away-name').textContent = teams[1].name;
      const h = this.net.host;
      this.segmented('lb-len', [{ label: '2 min', value: 120 }, { label: '3 min', value: 180 }, { label: '5 min', value: 300 }], s.halfSeconds, v => h.setSettings({ halfSeconds: v }));
      this.segmented('lb-diff', [{ label: 'Facile', value: 0 }, { label: 'Normale', value: 1 }, { label: 'Difficile', value: 2 }], s.difficulty, v => h.setSettings({ difficulty: v }));
      $('lb-start').disabled = !h.canStart();
      $('lb-settings-ro').textContent = '';
    } else {
      $('lb-settings-ro').textContent = 'Durata di un tempo ' + (s.halfSeconds / 60) + ' minuti, IA ' + ['facile', 'normale', 'difficile'][s.difficulty] + '.';
    }
    $('lb-start').hidden = !isHost;
    $('lb-wait').hidden = isHost;
    $('lb-leave').textContent = isHost ? 'Chiudi la partita' : 'Esci dalla lobby';
  }

  pickSide(side) {
    if (!this.net) return;
    if (this.net.host) { if (!this.net.host.setSide(this.net.link.id, side)) this.toast('Squadra al completo', true); }
    else this.net.client.requestSide(side);
  }

  copyCode() {
    const code = this.net && this.net.link.code;
    if (!code) return;
    const done = () => { $('lb-copied').textContent = 'Codice copiato: ' + code; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => { $('lb-copied').textContent = 'Copia non riuscita: il codice è ' + code; });
    else $('lb-copied').textContent = 'Il codice è ' + code;
  }

  enterOnlineMatch(m) {
    const isHost = !!this.net.host;
    this.mode = isHost ? 'host' : 'client';
    const names = {};
    if (isHost) for (const mm of this.net.host.members.values()) names[mm.id] = mm.name;
    else Object.assign(names, this.net.client.names);
    this.prepareMatchView(m, this.net.link.id, names);
    $('netind').hidden = false;
    this.updateNetIndicator();
  }

  updateNetIndicator() {
    const n = this.net;
    if (!n || $('netind').hidden) return;
    const link = n.link;
    let cls = 'dot', text;
    if (link.state === 'reconnecting') { cls = 'dot warn'; text = 'Riconnessione…'; }
    else if (link.state !== 'online') { cls = 'dot bad'; text = 'Disconnesso'; }
    else if (n.host) {
      const others = [...n.host.members.values()].filter(m => !m.isHost);
      const lost = others.filter(m => !m.connected).length;
      text = 'Host, ' + others.length + (others.length === 1 ? ' giocatore' : ' giocatori') + (lost ? ', ' + lost + ' in attesa' : '') + ', server ' + link.rtt + ' ms';
      if (lost) cls = 'dot warn';
    } else {
      const r = n.client.rtt;
      text = 'Online, ' + r + ' ms';
      if (r > 150) cls = 'dot warn';
    }
    $('net-dot').className = cls;
    if ($('net-text').textContent !== text) $('net-text').textContent = text;
  }
}

window.addEventListener('load', () => {
  try {
    window.game = new Game();
  } catch (err) {
    const e = document.getElementById('fatal');
    e.hidden = false;
    e.textContent = 'Il gioco non è partito: ' + err.message + '. Serve un browser con WebGL attivo.';
    document.getElementById('loading').hidden = true;
    console.error(err);
  }
});
