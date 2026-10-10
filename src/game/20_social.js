// ============================================================
// AMICI — pannello a destra, a metà schermo, nella Home: tutti i giocatori iscritti, richieste di amicizia, amici,
// inviti e sfide tra amici (campionato, torneo, coppa giocati insieme: vedi friendcomps.js sul server).
// Tutto arriva dal server (nessun giocatore inventato); degli altri si vede solo il nome pubblico.
// Aggiornamento leggero: all'apertura, al ritorno nella Home e ogni 45 secondi solo con il pannello aperto.
// ============================================================
const SOCIAL_OPEN_KEY = 'campoAperto.socialOpen.v1';
const SOCIAL_REFRESH_MS = 30000;

class SocialUI {
  constructor(game) {
    this.g = game; this.api = game.eco.api;
    this.friends = null; this.comps = null; this.users = null; this.usersQ = '';
    this.err = ''; this.busyReq = null; this.lastUser = this.api.username || null;
    let open = window.innerWidth > 900;
    try { const v = localStorage.getItem(SOCIAL_OPEN_KEY); if (v === '0' || v === '1') open = v === '1'; } catch (e) { /* preferenza non disponibile */ }
    this.setOpen(open, true);
    $('social-toggle').onclick = () => this.setOpen(!this.open);
    $('so-refresh').onclick = () => this.refresh();
    $('so-content').addEventListener('click', e => { const b = e.target.closest('[data-so]'); if (b) this.act(b); });
    this.api.onChange(() => {
      const u = this.api.loggedIn() ? this.api.username : null;
      if (u !== this.lastUser) { this.lastUser = u; this.friends = this.comps = this.users = null; this.render(); if (u) this.refresh(); }
    });
    // nella Home, anche con il pannello chiuso: il pallino deve mostrare gli inviti a giocare (una richiesta ogni 30 s)
    this.seenGames = new Set();
    // in tutti i menu (non in partita): così l'invito di un amico arriva anche nelle competizioni o nello Shop
    setInterval(() => {
      if (this.g.mode !== 'menu' || document.hidden || !this.ready()) return;
      if (this.g.screen === 'menu') this.refresh(); else this.pollInvites();
    }, SOCIAL_REFRESH_MS);
    // in partita (o fuori dalla Home) il gioco si fa vivo ogni minuto: gli amici vedono "in partita"
    setInterval(() => {
      if (document.hidden || !this.ready() || this.g.mode === 'menu') return;
      this.api.post('/api/presence', { status: 'match' }).catch(() => { /* server vecchio o rete assente: niente */ });
    }, 60000);
    $('invite-later').onclick = () => { $('invite-pop').hidden = true; };
    this.render();
  }
  setOpen(open, quiet) {
    this.open = !!open;
    $('social-body').hidden = !this.open;
    $('social-toggle').setAttribute('aria-expanded', String(this.open));
    if (!quiet) { try { localStorage.setItem(SOCIAL_OPEN_KEY, this.open ? '1' : '0'); } catch (e) { /* resta per questa sessione */ } }
    if (this.open && !quiet) this.refresh();
  }
  // ritorno nella Home: dati freschi (una richiesta, non a ripetizione)
  onHome() { if (this.api.loggedIn()) this.refresh(); else this.render(); }

  ready() { return this.api.configured() && this.api.loggedIn(); }
  // amici, sfide e giocatori dal server (una richiesta alla volta)
  refresh() {
    if (!this.ready()) { this.render(); return Promise.resolve(); }
    if (this.busyReq) return this.busyReq;
    const q = this.usersQ ? '?q=' + encodeURIComponent(this.usersQ) : '';
    this.busyReq = Promise.all([this.api.get('/api/friends'), this.api.get('/api/friendcomps'), this.api.get('/api/users' + q)]).then(([f, c, u]) => {
      this.friends = f; this.comps = c; this.users = u; this.err = '';
      // invito nuovo a una partita: avviso anche con il pannello chiuso
      for (const gi of f.games || []) if (!this.seenGames.has(gi.id)) { this.seenGames.add(gi.id); if (this.g.mode === 'menu') this.showInvite(gi); }
    }).catch(e => { this.err = e.status === 404 && e.code === 'NOT_FOUND' ? 'Il server non ha ancora gli amici: va aggiornato alla 0.9 (nella cartella cloud: npm run deploy).' : e.message; }).then(() => { this.busyReq = null; this.render(); if (this.g.screen === 'comps') this.g.comps.renderDashboard(); });
    return this.busyReq;
  }
  searchUsers(q) {
    this.usersQ = String(q || '').trim().slice(0, 16);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.api.get('/api/users' + (this.usersQ ? '?q=' + encodeURIComponent(this.usersQ) : '')).then(u => { this.users = u; this.renderUsers(); }).catch(e => this.g.toast(e.message, true));
    }, 300);
  }
  // fuori dalla Home: solo amici e inviti (una richiesta), senza ridisegnare la schermata in cui si è
  pollInvites() {
    if (this.busyReq) return;
    this.api.get('/api/friends').then(f => {
      this.friends = f;
      for (const gi of f.games || []) if (!this.seenGames.has(gi.id)) { this.seenGames.add(gi.id); if (this.g.mode === 'menu') this.showInvite(gi); }
      const n = this.pendingCount();
      $('social-badge').hidden = !n; $('social-badge').textContent = n;
    }).catch(() => { /* rete assente: si riprova tra poco */ });
  }
  // avviso in alto con Entra: l'invito di un amico a una partita online
  showInvite(gi) {
    $('invite-text').textContent = trf('{0} ti invita a giocare online', gi.from);
    $('invite-pop').hidden = false;
    $('invite-join').onclick = async () => {
      $('invite-pop').hidden = true;
      try {
        const r = await this.api.post('/api/invites/' + encodeURIComponent(gi.id) + '/accept');
        this.g.joinOnline({ code: r.room });
      } catch (e) { this.g.toast(e.message, true); }
      this.refresh();
    };
  }
  // stato di un amico: pallino verde online, giallo in partita; altrimenti quando si è visto l'ultima volta
  friendState(x) {
    if (x.status === 'match') return '<small><span class="so-dot match"></span>' + tr('in partita') + '</small>';
    if (x.status === 'online') return '<small><span class="so-dot online"></span>' + tr('online') + '</small>';
    if (!x.lastSeen) return '';
    const min = Math.max(1, Math.round((Date.now() - x.lastSeen) / 60000));
    return '<small><span class="so-dot"></span>' + (min < 60 ? trf('visto {0} min fa', min) : min < 1440 ? trf('visto {0} ore fa', Math.round(min / 60)) : trf('visto {0} giorni fa', Math.round(min / 1440))) + '</small>';
  }
  // numero di cose che aspettano una risposta: richieste di amicizia e inviti
  pendingCount() {
    if (!this.friends || !this.comps) return 0;
    return this.friends.incoming.length + (this.friends.games || []).length + this.comps.comps.filter(c => c.invited).length;
  }

  // ---------- disegno ----------
  render() {
    const box = $('so-content');
    const n = this.ready() ? this.pendingCount() : 0;
    $('social-badge').hidden = !n; $('social-badge').textContent = n;
    if (!this.api.configured()) { box.innerHTML = '<p class="small">Per gli amici serve il server online: impostalo in Impostazioni → Online.</p>'; return; }
    if (!this.api.loggedIn()) {
      box.innerHTML = '<p class="small" style="line-height:1.5">Accedi per vedere chi gioca, aggiungere amici e sfidarli in campionati, tornei e coppe.</p><button class="primary sm" data-so="login">Accedi</button>';
      return;
    }
    if (!this.friends || !this.comps) { box.innerHTML = '<p class="empty">' + esc(this.err || 'Caricamento…') + '</p>'; return; }
    // mentre si scrive nella ricerca non si ridisegna tutto (si perderebbe il punto in cui si scrive)
    if (document.activeElement && document.activeElement.id === 'so-q') { this.renderUsers(); return; }
    const f = this.friends, invites = this.comps.comps.filter(c => c.invited), mine = this.comps.comps.filter(c => !c.invited);
    let h = this.err ? '<p class="status err">' + esc(this.err) + '</p>' : '';
    const games = f.games || [];
    if (f.incoming.length || invites.length || games.length) {
      h += '<h3>Richieste e inviti</h3>';
      h += games.map(gi => '<div class="so-card inv"><span><b>' + esc(gi.from) + '</b> ti invita a giocare online</span><span class="small">1 contro 1, ognuno con la sua squadra · partita ' + esc(gi.room) + '</span>' +
        '<div class="acts"><button class="primary sm" data-so="joingame" data-i="' + gi.id + '">Entra</button><button class="ghost" data-so="nogame" data-i="' + gi.id + '">Rifiuta</button></div></div>').join('');
      h += f.incoming.map(r => '<div class="so-row"><span class="nm"><b>' + esc(r.username) + '</b><small>vuole essere tuo amico</small></span>' +
        '<button class="ghost" data-so="accept" data-u="' + esc(r.username) + '">Accetta</button><button class="ghost" data-so="remove" data-u="' + esc(r.username) + '" title="Rifiuta">✕</button></div>').join('');
      h += invites.map(c => '<div class="so-card inv"><span><b>' + esc(c.owner) + '</b> ti invita a <b>' + esc(c.name) + '</b></span>' +
        '<span class="small">' + COMP_KINDS[c.kind] + ' · ' + c.teams + ' squadre · ' + c.members + ' giocatori iscritti</span>' +
        '<div class="acts"><button class="primary sm" data-so="open" data-c="' + c.code + '">Scegli la squadra</button><button class="ghost" data-so="decline" data-c="' + c.code + '">Rifiuta</button></div></div>').join('');
    }
    h += '<h3>Le tue sfide <button class="ghost" data-so="new">Nuova sfida</button></h3>';
    h += mine.length ? mine.map(c => this.compCard(c)).join('') : '<p class="empty">Nessuna sfida: invita un amico con «Sfida».</p>';
    h += '<h3>Amici · ' + f.friends.length + ' <button class="ghost" data-so="ranking">Classifica</button></h3>';
    // amici online prima degli altri
    const order = x => x.status === 'online' ? 0 : x.status === 'match' ? 1 : 2;
    const fl = f.friends.slice().sort((a, b) => order(a) - order(b));
    h += fl.length ? fl.map(x => '<div class="so-row"><span class="nm"><b>' + esc(x.username) + '</b>' + (x.level ? ' <span class="so-lv" title="' + esc(tr('Livello nella classifica online')) + '">' + x.level + '</span>' : '') + this.friendState(x) + '</span>' +
      '<button class="ghost" data-so="play" data-u="' + esc(x.username) + '" title="Partita online 1 contro 1: ognuno con la sua squadra da 11">Gioca</button><button class="ghost" data-so="challenge" data-u="' + esc(x.username) + '" title="Campionato, torneo o coppa insieme">Sfida</button><button class="ghost" data-so="unfriend" data-u="' + esc(x.username) + '" title="Togli dagli amici">✕</button></div>').join('')
      : '<p class="empty">Ancora nessun amico: aggiungili dall\'elenco qui sotto.</p>';
    h += f.outgoing.map(x => '<div class="so-row"><span class="nm">' + esc(x.username) + '<small>richiesta inviata</small></span><button class="ghost" data-so="remove" data-u="' + esc(x.username) + '">Annulla</button></div>').join('');
    h += '<h3>Tutti i giocatori' + (this.users ? ' · ' + this.users.total : '') + '</h3><input type="text" class="so-search" id="so-q" placeholder="Cerca un nome" maxlength="16" spellcheck="false" autocomplete="off"><div id="so-users"></div>';
    box.innerHTML = h;
    const q = $('so-q');
    q.value = this.usersQ;
    q.oninput = () => this.searchUsers(q.value);
    this.renderUsers();
  }
  renderUsers() {
    const box = $('so-users');
    if (!box) return;
    if (!this.users) { box.innerHTML = '<p class="empty">Caricamento…</p>'; return; }
    const rel = { friend: '<span class="so-tag">amico</span>', sent: '<span class="so-tag">richiesta inviata</span>' };
    box.innerHTML = this.users.users.length ? this.users.users.map(u => '<div class="so-row"><span class="nm">' + esc(u.username) + (u.me ? ' <span class="so-tag">tu</span>' : '') + '</span>' +
      (u.me ? '' : u.relation === 'received' ? '<button class="ghost" data-so="accept" data-u="' + esc(u.username) + '">Accetta</button>' :
        rel[u.relation] || '<button class="ghost" data-so="add" data-u="' + esc(u.username) + '">Aggiungi</button>') + '</div>').join('') +
      (this.users.next ? '<p class="small">Ci sono altri giocatori: cerca il nome.</p>' : '')
      : '<p class="empty">Nessun giocatore con questo nome.</p>';
  }
  compCard(c) {
    const g = this.g;
    const state = c.status === 'OPEN' ? 'iscrizioni aperte' : c.status === 'FINISHED' ? 'conclusa' : esc(c.round || '');
    let line = '';
    if (c.status === 'FINISHED' && c.champion !== null && c.champion !== undefined) line = '🏆 ' + esc(g.teamName(c.champion));
    else if (c.next) line = esc(g.teamName(c.next.home)) + ' – ' + esc(g.teamName(c.next.away));
    else if (c.status === 'OPEN') line = c.members + ' iscritti su ' + c.teams + ' squadre';
    return '<div class="so-card"><span><b>' + esc(c.name) + '</b> <span class="pill">' + COMP_KINDS[c.kind] + '</span></span>' +
      '<span class="small">' + state + (c.myTeam !== null && c.myTeam !== undefined ? ' · ' + esc(g.teamName(c.myTeam)) : '') + '</span>' +
      (line ? '<span>' + line + '</span>' : '') +
      '<div class="acts"><button class="primary sm" data-so="open" data-c="' + c.code + '">Apri</button></div></div>';
  }
  // schede delle sfide nel cruscotto delle competizioni
  renderInto(box) {
    if (!this.ready()) { box.innerHTML = '<p class="empty">Accedi con l\'account per sfidare gli amici in campionati, tornei e coppe.</p>'; return; }
    if (!this.comps) { box.innerHTML = '<p class="empty">Caricamento…</p>'; this.refresh(); return; }
    const list = this.comps.comps;
    box.innerHTML = list.length ? list.map(c => this.compCard(c)).join('') : '<p class="empty">Nessuna sfida tra amici: creane una e invita chi vuoi dalla lista degli amici.</p>';
    box.querySelectorAll('[data-so]').forEach(b => b.onclick = () => this.act(b));
  }

  // ---------- azioni ----------
  async act(b) {
    const k = b.dataset.so, u = b.dataset.u, c = b.dataset.c;
    if (k === 'login') { this.g.eco.open('account'); return; }
    if (k === 'ranking') { this.g.ranking.open(this.g.screen); return; }
    if (k === 'new') { this.g.comps.openNewFriend([]); return; }
    if (k === 'challenge') { this.g.comps.openNewFriend([u]); return; }
    if (k === 'open') { this.g.comps.openFriend(c); return; }
    if (k === 'play') { this.g.createOnline('server', { invite: u }); return; }
    if (k === 'joingame' || k === 'nogame') {
      b.disabled = true;
      try {
        const r = await this.api.post('/api/invites/' + encodeURIComponent(b.dataset.i) + '/' + (k === 'joingame' ? 'accept' : 'decline'));
        if (k === 'joingame') this.g.joinOnline({ code: r.room });
      } catch (e) { this.g.toast(e.message, true); }
      this.refresh();
      return;
    }
    if (k === 'unfriend') { this.g.confirmClick(b, 'Sicuro?', () => this.post('/api/friends/remove', { username: u }, u + ' non è più tra gli amici')); return; }
    const calls = {
      add: ['/api/friends/request', { username: u }, 'Richiesta inviata a ' + u],
      accept: ['/api/friends/accept', { username: u }, u + ' ora è tuo amico'],
      remove: ['/api/friends/remove', { username: u }, null],
      decline: ['/api/friendcomps/' + c + '/decline', {}, 'Invito rifiutato'],
    }[k];
    if (calls) { b.disabled = true; await this.post(calls[0], calls[1], calls[2]); }
  }
  // invito di un amico nella stanza online aperta (dalla lobby o dal pulsante «Gioca»)
  async inviteToRoom(username, room) {
    try { await this.api.post('/api/invites', { username: username, room: room }); this.g.toast('Invito mandato a ' + username); return true; }
    catch (e) { this.g.toast(e.message, true); return false; }
  }
  async post(path, body, okText) {
    try {
      const r = await this.api.post(path, body);
      if (r && r.relation === 'friend' && path.endsWith('/request')) okText = r.username + ' ora è tuo amico';
      if (okText) this.g.toast(okText);
    } catch (e) { this.g.toast(e.message, true); }
    await this.refresh();
  }
}
