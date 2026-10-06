// ============================================================
// SCHERMATE DELLE COMPETIZIONI — cruscotto, competizione (panoramica, classifica, gironi, calendario, tabellone,
// statistiche, storico), creazione. I dati vengono da Career (18_competitions.js); le partite si giocano con il
// motore vero (Game.startCompMatch) o si simulano con la simulazione ufficiale.
// ============================================================
const COMP_SCREENS = ['comps', 'comp', 'comp-new'];

class CompetitionsUI {
  constructor(game) {
    this.g = game;
    this.career = new Career(game.db, i => game.teamName(i));
    // con l'account ogni modifica va anche sul server (dopo 2 secondi, una volta sola)
    this.career.onChange(() => { if (game.eco) game.eco.careerChanged(); });
    this.compId = null; this.tab = 'over'; this.calRound = null;
    this.draft = null;
    this.friend = null;             // competizione tra amici aperta: { code, view } (dati dal server)
    // con una sfida tra amici aperta: aggiornamento leggero (15 s se si aspetta un amico, altrimenti 40 s)
    setInterval(() => {
      if (this.g.screen !== 'comp' || !this.friend || document.hidden) return;
      const v = this.friend.view, waiting = v.status === 'OPEN' || (v.pending || []).some(p => p.homeUser && p.awayUser);
      if (waiting || Date.now() - (this.friend.at || 0) > 40000) this.reloadFriend(true);
    }, 15000);
    this.bind();
    const n = this.career.resolveAbandoned();
    if (n) setTimeout(() => game.toast(n === 1 ? 'Una partita di competizione lasciata a metà è stata completata con la simulazione' : n + ' partite lasciate a metà sono state completate con la simulazione'), 800);
  }
  get comp() {
    if (this.friend) {
      // lo stato arriva dal server; "la mia squadra" è quella di chi guarda
      const v = this.friend.view, c = v.comp;
      if (!c) return null;
      c.id = v.code; c.config.userTeam = v.myTeam === null ? -1 : v.myTeam;
      return c;
    }
    return this.compId ? this.career.byId(this.compId) : null;
  }
  name(t) { return esc(this.g.teamName(t)); }
  kit(t) { const k = this.g.db[t] && this.g.db[t].kits.home; return k ? k[0] : '#888'; }
  // squadre guidate dagli amici: accanto al nome della squadra quello del giocatore
  owners() {
    if (!this.friend) return null;
    const v = this.friend.view;
    if (v._owners && v._owners.rev === v.rev) return v._owners.map;
    const map = new Map(v.members.filter(m => m.status === 'ACCEPTED' && m.team !== null).map(m => [m.team, m.username]));
    v._owners = { rev: v.rev, map: map };
    return map;
  }
  teamTag(t, mine) {
    const o = this.owners(), who = o && o.get(t);
    return '<span class="tt' + (mine ? ' mine' : '') + '"><i class="kd" style="background:' + this.kit(t) + '"></i>' + this.name(t) + (who ? '<small class="who">' + esc(who) + '</small>' : '') + '</span>';
  }
  score(f) {
    if (!f.played) return '<span class="sc none">–</span>';
    let s = f.h + '-' + f.a;
    if (f.et) s += ' <small>d.t.s. ' + (f.h + f.et.h) + '-' + (f.a + f.et.a) + '</small>';
    if (f.pens) s += ' <small>rig. ' + f.pens.h + '-' + f.pens.a + '</small>';
    return '<span class="sc">' + s + '</span>';
  }
  how(f) {
    if (this.friend && f.played && f.how === 'played') return f.by === 'online' ? '<span class="pill played" title="Giocata online tra amici">online</span>' : '<span class="pill played" title="Giocata da ' + esc(f.by || '') + '">giocata</span>';
    return !f.played ? '' : f.how === 'played' ? '<span class="pill played" title="Giocata da te">giocata</span>' : f.how === 'abbandonata' ? '<span class="pill" title="Lasciata a metà: il resto è stato simulato">abbandonata</span>' : '<span class="pill" title="Simulazione ufficiale">sim</span>';
  }

  bind() {
    const g = this.g;
    $('btn-comps').onclick = () => this.openDashboard();
    $('comps-back').onclick = () => g.showScreen('menu');
    $('cp-back').onclick = () => this.openDashboard();
    $('cn-back').onclick = () => this.openDashboard();
    $('cl-friends-new').onclick = () => this.openNewFriend([]);
    $('cp-delete').onclick = () => {
      if (this.friend) {
        const v = this.friend.view;
        g.confirmClick($('cp-delete'), v.isOwner ? 'Sicuro? Elimina per tutti' : 'Sicuro? Lascia', () => this.friendPost(v.isOwner ? 'cancel' : 'leave', {}, v.isOwner ? 'Competizione eliminata' : 'Hai lasciato la competizione', true));
        return;
      }
      g.confirmClick($('cp-delete'), 'Sicuro? Elimina', () => { this.career.remove(this.compId); this.openDashboard(); g.toast('Competizione eliminata'); });
    };
    document.querySelectorAll('[data-new]').forEach(b => b.onclick = () => this.openNew(b.dataset.new));
    $('cn-create').onclick = () => this.create();
    $('cn-name').oninput = () => { if (this.draft) this.draft.name = $('cn-name').value; };
    $('cn-team').onchange = () => { if (this.draft) { this.draft.userTeam = Number($('cn-team').value); this.renderNew(); } };
  }

  // ---------- cruscotto ----------
  openDashboard() {
    this.friend = null;
    this.g.showScreen('comps');
    this.renderDashboard();
    if (this.g.social) this.g.social.refresh();
  }
  renderDashboard() {
    for (const kind of ['league', 'tournament', 'cup']) {
      const list = this.career.comps.filter(c => c.kind === kind);
      $('cl-' + kind).innerHTML = list.length ? list.map(c => this.card(c)).join('') :
        '<p class="empty">' + { league: 'Nessun campionato: creane uno con il calendario all\'italiana, classifica e stagioni.', tournament: 'Nessun torneo: 8, 16 o 32 squadre, eliminazione diretta fino alla finale.', cup: 'Nessuna coppa: scegli un modello o crea il tuo formato (gironi, andata e ritorno, supplementari, rigori).' }[kind] + '</p>';
    }
    document.querySelectorAll('#comps [data-open]').forEach(b => b.onclick = () => this.open(b.dataset.open));
    if (this.g.social) this.g.social.renderInto($('cl-friends'));
    if (this.g.eco && this.g.eco.renderServerLeague) this.g.eco.renderServerLeague($('cl-server'));
  }
  card(c) {
    const o = this.career.overview(c), u = o.userTeam;
    const pr = o.progress, pct = pr.total ? Math.round(pr.played / pr.total * 100) : 0;
    const team = u >= 0 ? this.teamTag(u, true) + (o.userOut ? ' <span class="pill lost">eliminata</span>' : '') +
      (o.position ? ' <span class="pos">' + (o.group ? 'Girone ' + o.group + ', ' : '') + o.position + 'º' + (c.kind === 'league' ? ' · ' + o.points + ' pt' : '') + '</span>' : '') : '<span class="small">Solo simulazione</span>';
    const lastTxt = o.last ? this.name(o.last.home) + ' ' + o.last.h + '-' + o.last.a + ' ' + this.name(o.last.away) + (o.last.pens ? ' (rig. ' + o.last.pens.h + '-' + o.last.pens.a + ')' : o.last.et ? ' (d.t.s.)' : '') : '—';
    const nextTxt = o.status === 'finished' ? '<b>🏆 ' + this.name(o.champion) + '</b>' : o.next ? this.name(o.next.home) + ' – ' + this.name(o.next.away) : '<span class="small">' + (o.userOut ? 'eliminata: si può simulare il resto' : 'nessuna partita in questa giornata') + '</span>';
    return '<div class="comp-card' + (o.status === 'finished' ? ' done' : '') + '">' +
      '<div class="cc-top"><b>' + esc(o.name) + '</b><span class="pill">' + (c.kind === 'league' ? 'Stagione ' : 'Edizione ') + o.season + '</span>' + (o.status === 'finished' ? '<span class="pill won">conclusa</span>' : '<span class="pill">' + esc(o.round) + '</span>') + '</div>' +
      '<div class="cc-team">' + team + '</div>' +
      '<div class="cc-row"><span>' + (o.status === 'finished' ? 'Vincitore' : 'Prossima') + '</span><span>' + nextTxt + '</span></div>' +
      '<div class="cc-row"><span>Ultima</span><span>' + lastTxt + '</span></div>' +
      '<div class="cc-prog" title="' + pr.played + ' di ' + pr.total + ' partite"><i style="width:' + pct + '%"></i></div>' +
      '<div class="cc-foot"><span class="small">' + pr.played + ' di ' + pr.total + ' partite</span><button class="primary sm" data-open="' + c.id + '">' + (o.status === 'finished' ? 'Visualizza' : 'Continua') + '</button></div></div>';
  }

  // ---------- competizione ----------
  open(id, tab) {
    this.friend = null;
    this.compId = id; this.tab = tab || 'over'; this.calRound = null;
    this.g.showScreen('comp');
    this.render();
  }
  tabs(c) {
    const t = [['over', 'Panoramica']];
    if (c.kind === 'league') t.push(['table', 'Classifica']);
    if (c.groups) t.push(['groups', 'Gironi']);
    t.push(['cal', 'Calendario']);
    if (c.bracket) t.push(['bracket', 'Tabellone']);
    t.push(['stats', 'Statistiche']);
    if (c.history && c.history.length) t.push(['hist', 'Storico']);
    return t;
  }
  render() {
    if (this.friend && this.friend.view.status === 'OPEN') return this.renderFriendLobby();
    const c = this.comp;
    if (!c) return this.openDashboard();
    $('cp-title').textContent = c.name;
    $('cp-season').textContent = COMP_KINDS[c.kind] + ' · ' + (c.kind === 'league' ? 'stagione ' : 'edizione ') + c.season + (this.friend ? ' · con gli amici' : '');
    $('cp-delete').textContent = this.friend && !this.friend.view.isOwner ? 'Lascia' : 'Elimina';
    $('cp-delete').hidden = !!this.friend && this.friend.view.myStatus !== 'ACCEPTED';
    const tabs = this.tabs(c);
    if (!tabs.some(t => t[0] === this.tab)) this.tab = 'over';
    $('cp-tabs').innerHTML = tabs.map(t => '<button class="tab' + (t[0] === this.tab ? ' on' : '') + '" data-cpt="' + t[0] + '" role="tab">' + t[1] + '</button>').join('');
    document.querySelectorAll('[data-cpt]').forEach(b => b.onclick = () => { this.tab = b.dataset.cpt; this.render(); });
    $('cp-status').textContent = '';
    const body = { over: () => this.renderOver(c), table: () => this.renderTable(c), groups: () => this.renderGroups(c), cal: () => this.renderCal(c),
      bracket: () => this.renderBracket(c), stats: () => this.renderStats(c), hist: () => this.renderHist(c) }[this.tab]();
    $('cp-body').innerHTML = body;
    this.bindBody(c);
  }
  bindBody(c) {
    const b = id => $('cp-body').querySelector('#' + id);
    if (this.friend) return this.bindFriendBody(c, b);
    if (b('cp-play')) b('cp-play').onclick = () => this.play(c);
    if (b('cp-sim')) b('cp-sim').onclick = () => this.simUser(c);
    if (b('cp-simround')) b('cp-simround').onclick = () => { const n = this.career.simulateRound(c); this.flash('Giornata simulata (' + n + ' partite)'); this.render(); };
    if (b('cp-simend')) b('cp-simend').onclick = () => this.g.confirmClick(b('cp-simend'), 'Sicuro? Simula tutto', () => { this.career.simulateToEnd(c); this.render(); });
    if (b('cp-newseason')) b('cp-newseason').onclick = () => { this.career.newSeason(c.id); this.flash(c.kind === 'league' ? 'Nuova stagione: calendario pronto' : 'Nuova edizione: sorteggio fatto'); this.render(); };
    $('cp-body').querySelectorAll('[data-calr]').forEach(x => x.onclick = () => { this.calRound = Number(x.dataset.calr); this.render(); });
  }
  flash(t, err) { const s = $('cp-status'); s.className = 'status ' + (err ? 'err' : 'ok'); s.textContent = t; }

  renderOver(c) {
    if (this.friend) return this.renderFriendOver(c);
    const u = c.config.userTeam, cr = this.career.currentRound(c);
    let h = '';
    if (c.status === 'finished') h += this.championCard(c);
    else {
      const f = this.career.userFixture(c, cr);
      h += '<div class="cp-round"><span class="small">In corso</span><b>' + esc(this.career.roundLabel(c, cr)) + '</b></div>';
      if (f) {
        const rules = this.career.matchRules(c, f);
        const where = f.neutral ? 'Campo neutro' : f.home === u ? 'In casa' : 'In trasferta';
        let note = '';
        if (rules && f.leg === 2 && !f.replay) note = 'Ritorno: all\'andata ' + this.name(f.home) + ' ' + rules.aggregate[0] + ', ' + this.name(f.away) + ' ' + rules.aggregate[1] + '. ';
        if (f.replay) note = 'Ripetizione dopo il pareggio. ';
        if (rules) note += 'Serve un vincitore: ' + [rules.extraTime ? 'supplementari' : null, rules.penalties ? 'rigori' : 'ripetizione in caso di parità'].filter(Boolean).join(' e ') + '.';
        h += '<div class="nextmatch"><div class="nm-teams">' + this.teamTag(f.home, f.home === u) + '<span class="vs">contro</span>' + this.teamTag(f.away, f.away === u) + '</div>' +
          '<p class="small">' + where + ' · tempi da ' + (c.config.halfSeconds / 60) + ' minuti · IA ' + ['facile', 'normale', 'difficile'][c.config.difficulty] + (note ? ' · ' + note : '') + '</p>' +
          '<div class="actions" style="margin-top:12px"><button class="primary" id="cp-play">Gioca</button><button class="ghost" id="cp-sim">Simula partita</button></div>' +
          '<p class="small">Il risultato torna da solo nella competizione; le altre partite della giornata si simulano.</p></div>';
      } else {
        h += '<div class="nextmatch"><p>' + (u < 0 ? 'Nessuna squadra scelta: le partite si simulano.' : c.userOut ? 'La tua squadra è stata eliminata. Puoi simulare il resto della competizione.' : 'La tua squadra riposa in questa giornata.') + '</p>' +
          '<div class="actions" style="margin-top:12px"><button class="primary" id="cp-simround">Simula giornata</button>' + (u < 0 || c.userOut ? '<button class="ghost" id="cp-simend">Simula fino alla fine</button>' : '') + '</div></div>';
      }
      if (u >= 0) h += this.userStrip(c);
    }
    return h + this.recentAndProgress(c);
  }
  // risultati della giornata appena giocata (o di quella in corso) e avanzamento
  recentAndProgress(c) {
    let h = '';
    const last = c.fixtures.filter(f => f.played).sort((a, b) => (a.at || 0) - (b.at || 0)).pop();
    if (last) {
      const same = c.fixtures.filter(f => f.stage === last.stage && f.round === last.round && (f.leg || 1) === (last.leg || 1) && f.played);
      h += '<h3 style="margin-top:22px">Ultimi risultati · ' + esc(this.career.roundLabel(c, { stage: last.stage, round: last.round, leg: last.leg || 1, replay: !!last.replay })) + '</h3>' + this.fixtureList(c, same);
    }
    const pr = this.career.progress(c), pct = pr.total ? Math.round(pr.played / pr.total * 100) : 0;
    h += '<div class="cc-prog big"><i style="width:' + pct + '%"></i></div><p class="small">' + pr.played + ' di ' + pr.total + ' partite giocate · ' + c.fixtures.filter(f => f.how === 'played').length + (this.friend ? ' giocate dagli amici' : ' giocate da te') + '</p>';
    return h;
  }
  userStrip(c) {
    const o = this.career.overview(c);
    const parts = [];
    if (o.position) parts.push((o.group ? 'Girone ' + o.group + ': ' : '') + o.position + 'º posto' + (c.kind === 'league' ? ', ' + o.points + ' punti' : ''));
    if (o.last) parts.push('ultima: ' + this.name(o.last.home) + ' ' + o.last.h + '-' + o.last.a + ' ' + this.name(o.last.away));
    if (c.kind === 'league') { const row = this.career.table(c).find(r => r.team === c.config.userTeam); if (row && row.form.length) parts.push('forma ' + this.formDots(row.form)); }
    return '<p class="cp-strip">' + this.teamTag(c.config.userTeam, true) + ' ' + parts.join(' · ') + '</p>';
  }
  formDots(form) { return '<span class="form">' + form.map(r => '<i class="f' + r + '" title="' + { V: 'Vittoria', N: 'Pareggio', P: 'Sconfitta' }[r] + '">' + r + '</i>').join('') + '</span>'; }
  championCard(c) {
    const s = c.summary || {};
    let h = '<div class="champion"><span class="small">' + (c.kind === 'league' ? 'Campione' : 'Vincitore') + ' · ' + (c.kind === 'league' ? 'stagione ' : 'edizione ') + c.season + '</span><b>🏆 ' + this.name(c.champion) + '</b>';
    if (s.final) h += '<p>Finale: ' + this.name(s.final.home) + ' ' + s.final.h + '-' + s.final.a + ' ' + this.name(s.final.away) + (s.final.et ? ' (d.t.s. ' + (s.final.h + s.final.et.h) + '-' + (s.final.a + s.final.et.a) + ')' : '') + (s.final.pens ? ', rigori ' + s.final.pens.h + '-' + s.final.pens.a : '') + '</p>';
    h += '<div class="champ-grid">';
    if (c.kind === 'league' && s.bestAttack) h += '<div><span class="small">Miglior attacco</span><b>' + this.name(s.bestAttack.team) + '</b><span>' + s.bestAttack.gf + ' gol fatti</span></div><div><span class="small">Miglior difesa</span><b>' + this.name(s.bestDefense.team) + '</b><span>' + s.bestDefense.gs + ' gol subiti</span></div>';
    if (s.topScorers && s.topScorers[0]) h += '<div><span class="small">Capocannoniere</span><b>' + esc(s.topScorers[0].name) + '</b><span>' + s.topScorers[0].goals + ' gol, ' + this.name(s.topScorers[0].team) + '</span></div>';
    h += '<div><span class="small">Partite</span><b>' + (s.matches || 0) + '</b><span>' + (s.goals || 0) + ' gol, media ' + (s.avgGoals || 0) + '</span></div></div>';
    if (!this.friend || this.friend.view.isOwner) h += '<div class="actions" style="margin-top:14px"><button class="primary" id="cp-newseason">' + (c.kind === 'league' ? 'Nuova stagione' : 'Nuova edizione') + '</button></div>';
    else h += '<p class="small" style="margin-top:12px">La nuova stagione la avvia ' + esc(this.friend.view.owner) + ', che ha creato la competizione.</p>';
    h += '</div>';
    if (c.kind === 'league') h += '<h3 style="margin-top:20px">Classifica finale</h3>' + this.tableHtml(this.career.table(c), c);
    return h;
  }
  fixtureList(c, list) {
    if (!list.length) return '<p class="empty">Nessuna partita.</p>';
    const u = c.config.userTeam;
    return '<div class="fx-list">' + list.map(f => '<div class="fx-item' + (f.home === u || f.away === u ? ' mine' : '') + '">' +
      '<span class="h">' + this.teamTag(f.home, f.home === u) + '</span>' + this.score(f) + '<span class="a">' + this.teamTag(f.away, f.away === u) + '</span>' + this.how(f) + '</div>').join('') + '</div>';
  }

  tableHtml(rows, c, qualify) {
    const u = c.config.userTeam;
    return '<div class="tbl-wrap"><table class="stand"><thead><tr><th>Pos</th><th class="tl">Squadra</th><th>PG</th><th>V</th><th>N</th><th>P</th><th>GF</th><th>GS</th><th>DR</th><th>PT</th><th class="tl">Forma</th><th title="Partite senza subire gol">CS</th><th>% V</th><th>Serie</th></tr></thead><tbody>' +
      rows.map(r => '<tr class="' + (r.team === u ? 'mine' : '') + (qualify && r.pos <= qualify ? ' q' : '') + '"><td>' + r.pos + '</td><td class="tl">' + this.teamTag(r.team, r.team === u) + '</td><td>' + r.pg + '</td><td>' + r.v + '</td><td>' + r.n + '</td><td>' + r.p + '</td><td>' + r.gf + '</td><td>' + r.gs + '</td><td>' + (r.dr > 0 ? '+' : '') + r.dr + '</td><td><b>' + r.pt + '</b></td><td class="tl">' + this.formDots(r.form) + '</td><td>' + r.cleanSheets + '</td><td>' + r.winPct + '</td><td>' + (r.streak || '—') + '</td></tr>').join('') +
      '</tbody></table></div>';
  }
  renderTable(c) {
    const rows = this.career.table(c);
    return '<p class="small">Vittoria 3 punti, pareggio 1, sconfitta 0. A pari punti contano gli scontri diretti, poi la differenza reti e i gol fatti. Forma: ultime 5 partite.</p>' + this.tableHtml(rows, c);
  }
  renderGroups(c) {
    const tables = this.career.groupTables(c), q = c.config.groups.qualify;
    return '<p class="small">Passano il turno le prime ' + q + ' di ogni girone (evidenziate).</p><div class="groups">' +
      tables.map((t, gi) => '<div><h3>Girone ' + CompLogic.GROUP_LETTERS[gi] + '</h3>' + this.tableHtml(t, c, q) + '</div>').join('') + '</div>';
  }
  renderCal(c) {
    // turni nell'ordine in cui si giocano
    const keys = [];
    for (const f of c.fixtures) { const k = f.stage + ':' + f.round + ':' + (f.leg || 1) + ':' + (f.replay ? 1 : 0); if (keys.indexOf(k) < 0) keys.push(k); }
    const rank = k => { const [st, r, l, rp] = k.split(':'); return (st === 'ko' ? 1e6 : 0) + Number(r) * 100 + Number(l) * 2 + Number(rp); };
    keys.sort((a, b) => rank(a) - rank(b));
    const cr = this.career.currentRound(c);
    const curKey = cr ? cr.stage + ':' + cr.round + ':' + cr.leg + ':' + (cr.replay ? 1 : 0) : keys[keys.length - 1];
    let i = this.calRound === null ? Math.max(0, keys.indexOf(curKey)) : clamp(this.calRound, 0, keys.length - 1);
    const [st, r, l, rp] = keys[i].split(':');
    const list = c.fixtures.filter(f => f.stage === st && f.round === Number(r) && (f.leg || 1) === Number(l) && !!f.replay === (rp === '1'));
    const label = this.career.roundLabel(c, { stage: st, round: Number(r), leg: Number(l), replay: rp === '1' });
    return '<div class="calnav"><button class="arrow" data-calr="' + (i - 1) + '"' + (i <= 0 ? ' disabled' : '') + ' aria-label="Turno precedente">‹</button><b>' + esc(label) + '</b><span class="small">' + (i + 1) + ' di ' + keys.length + '</span><button class="arrow" data-calr="' + (i + 1) + '"' + (i >= keys.length - 1 ? ' disabled' : '') + ' aria-label="Turno successivo">›</button></div>' +
      (st === 'group' ? this.groupedByGroup(c, list) : this.fixtureList(c, list));
  }
  groupedByGroup(c, list) {
    return (c.groups || []).map((g, gi) => '<h3 class="gsub">Girone ' + CompLogic.GROUP_LETTERS[gi] + '</h3>' + this.fixtureList(c, list.filter(f => f.group === gi))).join('');
  }
  renderBracket(c) {
    const u = c.config.userTeam;
    return '<div class="bracket">' + c.bracket.map((r, ri) => '<div class="br-col"><h3>' + esc(r.name) + '</h3>' + r.ties.map(t => {
      const ms = t.fixtures.map(id => this.career.fixture(c, id)).filter(Boolean);
      const line = (team, side) => {
        if (team === null) return '<div class="br-team tbd">da decidere</div>';
        const goals = ms.filter(m => m.played).map(m => (m.home === team ? m.h : m.a) + (m.et ? (m.home === team ? m.et.h : m.et.a) : 0));
        const pens = ms.filter(m => m.pens).map(m => (m.home === team ? m.pens.h : m.pens.a));
        return '<div class="br-team' + (t.winner === team ? ' win' : t.winner !== null && t.winner !== undefined ? ' out' : '') + (team === u ? ' mine' : '') + '">' + this.teamTag(team, team === u) +
          '<span class="br-g">' + goals.join(' · ') + (pens.length ? ' <small>(' + pens.join('') + ')</small>' : '') + '</span></div>';
      };
      return '<div class="br-tie' + (ri === c.bracket.length - 1 ? ' final' : '') + '">' + line(t.a, 0) + line(t.b, 1) + (t.legs === 2 ? '<span class="small">andata e ritorno' + (t.agg ? ', totale ' + t.agg.join('-') : '') + '</span>' : '') + '</div>';
    }).join('') + '</div>').join('') + '</div>' + (c.champion !== null && c.champion !== undefined ? '<p class="champ-line">🏆 ' + this.name(c.champion) + '</p>' : '');
  }
  renderStats(c) {
    const played = c.fixtures.filter(f => f.played);
    const sc = new Map();
    for (const f of played) for (const s of (f.scorers || [])) {
      const team = s.team === 0 ? f.home : f.away, k = team + '|' + s.name;
      const e = sc.get(k) || { team: team, name: s.name, goals: 0 }; e.goals++; sc.set(k, e);
    }
    const top = [...sc.values()].sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 15);
    const goals = played.reduce((s, f) => s + f.h + f.a + (f.et ? f.et.h + f.et.a : 0), 0);
    const t = CompLogic.standings(c.config.teams, played.map(f => ({ home: f.home, away: f.away, h: f.h + (f.et ? f.et.h : 0), a: f.a + (f.et ? f.et.a : 0) })));
    const ba = t.filter(r => r.pg).sort((a, b) => b.gf / b.pg - a.gf / a.pg)[0], bd = t.filter(r => r.pg).sort((a, b) => a.gs / a.pg - b.gs / b.pg)[0];
    let big = null; for (const f of played) { const d = Math.abs(f.h - f.a); if (!big || d > Math.abs(big.h - big.a)) big = f; }
    if (!played.length) return '<p class="empty">Ancora nessuna partita giocata.</p>';
    return '<div class="champ-grid">' +
      '<div><span class="small">Partite</span><b>' + played.length + '</b><span>' + c.fixtures.filter(f => f.how === 'played').length + (this.friend ? ' giocate dagli amici, ' : ' giocate da te, ') + played.filter(f => f.how === 'sim').length + ' simulate</span></div>' +
      '<div><span class="small">Gol</span><b>' + goals + '</b><span>media ' + (goals / played.length).toFixed(2) + ' a partita</span></div>' +
      (ba ? '<div><span class="small">Miglior attacco</span><b>' + this.name(ba.team) + '</b><span>' + ba.gf + ' gol in ' + ba.pg + ' partite</span></div>' : '') +
      (bd ? '<div><span class="small">Miglior difesa</span><b>' + this.name(bd.team) + '</b><span>' + bd.gs + ' gol subiti in ' + bd.pg + '</span></div>' : '') +
      (big ? '<div><span class="small">Vittoria più larga</span><b>' + big.h + '-' + big.a + '</b><span>' + this.name(big.home) + ' – ' + this.name(big.away) + '</span></div>' : '') +
      '</div><h3 style="margin-top:20px">Marcatori</h3>' + (top.length ? '<div class="tbl-wrap"><table class="stand"><thead><tr><th>#</th><th class="tl">Giocatore</th><th class="tl">Squadra</th><th>Gol</th></tr></thead><tbody>' +
      top.map((s, i) => '<tr class="' + (s.team === c.config.userTeam ? 'mine' : '') + '"><td>' + (i + 1) + '</td><td class="tl">' + esc(s.name) + '</td><td class="tl">' + this.teamTag(s.team) + '</td><td><b>' + s.goals + '</b></td></tr>').join('') + '</tbody></table></div>' : '<p class="empty">Nessun gol.</p>');
  }
  renderHist(c) {
    return '<div class="fx-list">' + c.history.slice().reverse().map(h => {
      const s = h.summary || {}, ts = s.topScorers && s.topScorers[0];
      return '<div class="hist"><b>' + (c.kind === 'league' ? 'Stagione ' : 'Edizione ') + h.season + '</b><span>🏆 ' + this.name(h.champion) + '</span>' +
        (ts ? '<span class="small">Capocannoniere: ' + esc(ts.name) + ' (' + ts.goals + ')</span>' : '') + (s.bestAttack ? '<span class="small">Miglior attacco: ' + this.name(s.bestAttack.team) + ' (' + s.bestAttack.gf + ')</span>' : '') + '</div>';
    }).join('') + '</div>';
  }

  // ---------- giocare e simulare ----------
  play(c) {
    const cr = this.career.currentRound(c), f = this.career.userFixture(c, cr);
    if (!f) return;
    this.g.startCompMatch(c, f);
  }
  simUser(c) {
    const cr = this.career.currentRound(c), f = this.career.userFixture(c, cr);
    if (!f) return;
    this.career.simulateFixture(c, f.id);
    this.career.simulateRound(c);
    this.flash('Partita simulata: ' + this.g.teamName(f.home) + ' ' + f.h + '-' + f.a + ' ' + this.g.teamName(f.away) + (f.pens ? ' (rigori ' + f.pens.h + '-' + f.pens.a + ')' : f.et ? ' (d.t.s.)' : ''));
    const keep = $('cp-status').textContent;
    this.render();
    this.flash(keep);
  }
  // fine della partita giocata: il risultato del motore va nella competizione, il resto della giornata si simula
  matchFinished(cm, m) {
    const c = this.career.byId(cm.compId);
    if (!c) return null;
    const r = m.result ? m.result() : { h: m.teams[0].score, a: m.teams[1].score, winner: null };
    if (!m.result) r.winner = r.h > r.a ? 0 : r.h < r.a ? 1 : null;
    r.scorers = m.log.filter(g => !g.own).map(g => ({ team: g.team.index, name: g.scorer, minute: g.minute }));
    this.career.record(c, cm.fid, r, 'played');
    this.career.simulateRound(c);
    return c;
  }
  // uscita a metà: il tempo che manca si simula dal punteggio attuale
  matchAbandoned(cm, m) {
    const c = this.career.byId(cm.compId);
    if (!c) return null;
    const played = m.half <= 2 ? ((m.half - 1) * 2700 + m.clock) / 5400 : 1;
    const scorers = m.log.filter(g => !g.own).map(g => ({ team: g.team.index, name: g.scorer, minute: g.minute }));
    const f = this.career.finishFromScore(c, cm.fid, [m.teams[0].score, m.teams[1].score], played, scorers);
    this.career.simulateRound(c);
    return f;
  }

  // ---------- competizioni tra amici (sul server) ----------
  get api() { return this.g.eco.api; }
  async openFriend(code, tab) {
    if (!this.api.loggedIn()) { this.g.eco.open('account'); return; }
    try {
      const v = await this.api.get('/api/friendcomps/' + encodeURIComponent(code));
      this.friend = { code: code, view: v, at: Date.now() };
      this.compId = null; this.tab = tab || 'over'; this.calRound = null;
      this.g.showScreen('comp');
      this.render();
    } catch (e) { this.g.toast(e.message, true); if (this.g.social) this.g.social.refresh(); }
  }
  // dati nuovi dal server; quiet: ridisegna solo se qualcosa è cambiato (niente sfarfallio, niente selezioni perse)
  async reloadFriend(quiet) {
    if (!this.friend) return;
    const code = this.friend.code;
    try {
      const v = await this.api.get('/api/friendcomps/' + encodeURIComponent(code));
      if (!this.friend || this.friend.code !== code) return;
      const old = this.friend.view;
      const same = old.rev === v.rev && old.status === v.status && JSON.stringify(old.pending) === JSON.stringify(v.pending) && JSON.stringify(old.members) === JSON.stringify(v.members);
      this.friend.view = v; this.friend.at = Date.now();
      if (this.g.screen === 'comp' && (!quiet || !same)) { const st = $('cp-status').textContent, cls = $('cp-status').className; this.render(); if (st) { $('cp-status').textContent = st; $('cp-status').className = cls; } }
    } catch (e) {
      if (e.status === 404) { this.g.toast('La competizione non esiste più', true); this.openDashboard(); }
      else if (!quiet) this.flash(e.message, true);
    }
  }
  async friendPost(action, body, okText, leave) {
    const code = this.friend && this.friend.code;
    if (!code) return null;
    try {
      const r = await this.api.post('/api/friendcomps/' + encodeURIComponent(code) + '/' + action, body || {});
      if (leave) { this.g.toast(okText); this.openDashboard(); return r; }
      await this.reloadFriend(false);
      if (okText) this.flash(okText);
      if (this.g.social) this.g.social.refresh();
      return r;
    } catch (e) { this.flash(e.message, true); return null; }
  }

  // iscrizioni aperte: partecipanti, squadre, inviti, avvio
  renderFriendLobby() {
    const v = this.friend.view, cfg = v.config, g = this.g;
    $('cp-title').textContent = v.name;
    $('cp-season').textContent = COMP_KINDS[v.kind] + ' · iscrizioni aperte';
    $('cp-tabs').innerHTML = '';
    $('cp-delete').textContent = v.isOwner ? 'Elimina' : 'Lascia';
    $('cp-delete').hidden = v.myStatus !== 'ACCEPTED';
    const taken = new Map(v.members.filter(m => m.status === 'ACCEPTED' && m.team !== null).map(m => [m.team, m.username]));
    let h = '<p class="small" style="line-height:1.5">' + esc(v.owner) + ' ha creato questa ' + COMP_KINDS[v.kind].toLowerCase() + ' con ' + cfg.teams.length + ' squadre. ' + esc(this.friendRules(v)) +
      ' Ognuno sceglie una squadra; le altre le guida l\'IA.</p>';
    h += '<h3>Partecipanti</h3><div class="fx-list">' + v.members.map(m => '<div class="fx-item' + (m.me ? ' mine' : '') + '"><span class="h"><b>' + esc(m.username) + '</b>' + (m.owner ? ' <span class="pill">organizza</span>' : '') + '</span>' +
      '<span class="sc none"></span><span class="a">' + (m.status === 'ACCEPTED' && m.team !== null ? this.teamTag(m.team, m.me) : '<span class="small">' + (m.status === 'INVITED' ? 'invitato, deve rispondere' : 'ha lasciato') + '</span>') + '</span></div>').join('') + '</div>';
    if (v.myStatus === 'INVITED' || v.myStatus === 'ACCEPTED') {
      const free = cfg.teams.filter(t => !taken.has(t) || t === v.myTeam);
      h += '<h3 style="margin-top:20px">' + (v.myStatus === 'INVITED' ? 'Scegli la tua squadra' : 'La tua squadra') + '</h3><div class="actions" style="margin:0"><select class="sel" id="cpf-team">' +
        free.map(t => '<option value="' + t + '"' + (t === v.myTeam ? ' selected' : '') + '>' + esc(g.teamName(t)) + ' (forza ' + g.db[t].rating + ')</option>').join('') + '</select>' +
        (v.myStatus === 'INVITED' ? '<button class="primary sm" id="cpf-accept">Accetta l\'invito</button><button class="ghost" id="cpf-decline">Rifiuta</button>' : '<button class="ghost" id="cpf-change">Cambia squadra</button>') + '</div>';
    }
    if (v.isOwner) {
      const friends = (g.social && g.social.friends ? g.social.friends.friends : []).filter(f => !v.members.some(m => m.username === f.username && (m.status === 'ACCEPTED' || m.status === 'INVITED')));
      h += '<h3 style="margin-top:20px">Invita altri amici</h3>' + (friends.length ? '<div class="actions" style="margin:0"><select class="sel" id="cpf-friend">' + friends.map(f => '<option>' + esc(f.username) + '</option>').join('') + '</select><button class="ghost" id="cpf-invite">Invita</button></div>'
        : '<p class="empty">Nessun altro amico da invitare (aggiungili dal pannello Amici nella Home).</p>');
      const waiting = v.members.filter(m => m.status === 'INVITED').length;
      h += '<div class="actions" style="margin-top:22px"><button class="primary" id="cpf-start">Inizia la competizione</button></div><p class="small">' +
        (waiting ? waiting + (waiting === 1 ? ' invito senza risposta: se inizi ora scade' : ' inviti senza risposta: se inizi ora scadono') + ' e quelle squadre le guida l\'IA.' : 'Quando inizi si fa il calendario (o il sorteggio) e non si entra più.') + '</p>';
    } else if (v.myStatus === 'ACCEPTED') h += '<p class="small" style="margin-top:18px">Aspetta che ' + esc(v.owner) + ' avvii la competizione: la vedrai partire qui e nel pannello Amici.</p>';
    $('cp-body').innerHTML = h;
    $('cp-status').textContent = '';
    const b = id => $('cp-body').querySelector('#' + id);
    const team = () => Number(b('cpf-team').value);
    if (b('cpf-accept')) b('cpf-accept').onclick = () => this.friendPost('team', { team: team() }, 'Sei dentro con ' + g.teamName(team()));
    if (b('cpf-change')) b('cpf-change').onclick = () => this.friendPost('team', { team: team() }, 'Ora giochi con ' + g.teamName(team()));
    if (b('cpf-decline')) b('cpf-decline').onclick = () => this.friendPost('decline', {}, 'Invito rifiutato', true);
    if (b('cpf-invite')) b('cpf-invite').onclick = () => this.friendPost('invite', { username: b('cpf-friend').value }, 'Invito mandato a ' + b('cpf-friend').value);
    if (b('cpf-start')) b('cpf-start').onclick = () => this.friendPost('start', {}, 'Si parte! ' + (v.kind === 'league' ? 'Calendario pronto' : 'Sorteggio fatto'));
  }
  friendRules(v) {
    const cfg = v.config, parts = [];
    if (v.kind === 'league') parts.push(cfg.legs === 2 ? 'Andata e ritorno.' : 'Solo andata.');
    else {
      if (cfg.groups) parts.push(cfg.groups.count + ' gironi, passano le prime ' + cfg.groups.qualify + ', poi eliminazione diretta.');
      else parts.push('Eliminazione diretta' + (cfg.legs === 2 ? ' con andata e ritorno (finale secca).' : '.'));
      parts.push((cfg.extraTime ? 'Supplementari' : 'Niente supplementari') + ', ' + (cfg.penalties ? 'rigori.' : 'ripetizione in caso di parità.'));
    }
    parts.push('Tempi da ' + (cfg.halfSeconds / 60) + ' minuti, IA ' + ['facile', 'normale', 'difficile'][cfg.difficulty] + '.');
    return parts.join(' ');
  }

  // panoramica di una sfida in corso: la mia partita del turno e cosa si aspetta
  renderFriendOver(c) {
    const v = this.friend.view, u = v.myTeam, me = this.api.username;
    let h = '<div class="cp-members">' + v.members.filter(m => m.team !== null && (m.status === 'ACCEPTED' || m.status === 'LEFT')).map(m => '<span>' + (m.status === 'LEFT' ? esc(m.username) + ': ' : '') + this.teamTag(m.team, m.me) + (m.status === 'LEFT' ? ' <span class="small">(ha lasciato, ora IA)</span>' : '') +
      (!m.me && m.status === 'ACCEPTED' ? ' <button class="ghost sm-btn" data-friendly="' + esc(m.username) + '" title="Partita online 1 contro 1, fuori dalla competizione">Amichevole</button>' : '') + '</span>').join('') + '</div>';
    if (c.status === 'finished') return h + this.championCard(c) + this.recentAndProgress(c);
    h += '<div class="cp-round"><span class="small">In corso</span><b>' + esc(v.round) + '</b></div>';
    const p = u === null ? null : v.pending.find(x => x.home === u || x.away === u);
    if (p) {
      const f = this.career.fixture(c, p.fixture), rules = this.career.matchRules(c, f);
      const opp = p.home === u ? p.awayUser : p.homeUser;
      const where = f.neutral ? 'Campo neutro' : f.home === u ? 'In casa' : 'In trasferta';
      let note = '';
      if (rules && f.leg === 2 && !f.replay) note = 'Ritorno: all\'andata ' + this.name(f.home) + ' ' + rules.aggregate[0] + ', ' + this.name(f.away) + ' ' + rules.aggregate[1] + '. ';
      if (rules) note += 'Serve un vincitore. ';
      h += '<div class="nextmatch"><div class="nm-teams">' + this.teamTag(f.home, f.home === u) + '<span class="vs">contro</span>' + this.teamTag(f.away, f.away === u) + '</div>';
      if (!opp) {
        h += '<p class="small">' + where + ' · contro l\'IA · tempi da ' + (c.config.halfSeconds / 60) + ' minuti · IA ' + ['facile', 'normale', 'difficile'][c.config.difficulty] + (note ? ' · ' + esc(note) : '') + '</p>' +
          '<div class="actions" style="margin-top:12px"><button class="primary" id="cp-play">Gioca</button><button class="ghost" id="cp-sim">Simula partita</button></div>' +
          '<p class="small">Il risultato della partita va sul server da solo. Se esci a metà, il resto si simula dal punteggio; una partita iniziata e mai finita non si rigioca (decide la simulazione).</p>';
      } else {
        const mine = p.reports.find(r => r.username === me), theirs = p.reports.find(r => r.username === opp);
        const txt = r => r.kind === 'sim' ? 'la simulazione' : r.h + '-' + r.a;
        const lines = [];
        if (p.room) lines.push(p.room.host === me ? 'Hai aperto la stanza <b>' + esc(p.room.code) + '</b>: aspetta che ' + esc(opp) + ' entri.' : '<b>' + esc(opp) + '</b> ti aspetta nella stanza <b>' + esc(p.room.code) + '</b>.');
        if (mine) lines.push('Hai mandato: ' + txt(mine) + '.');
        if (theirs) lines.push(esc(opp) + ' ha mandato: ' + txt(theirs) + '.');
        if (mine && theirs) lines.push('<b>I due risultati non coincidono:</b> rigiocate la partita o chiedete entrambi la simulazione.');
        const joinable = p.room && p.room.host !== me;
        h += '<p class="small">' + where + ' · contro <b class="vsuser">' + esc(opp) + '</b> · si gioca online · tempi da ' + (c.config.halfSeconds / 60) + ' minuti' + (note ? ' · ' + esc(note) : '') + '</p>' +
          (lines.length ? '<p>' + lines.join(' ') + '</p>' : '') +
          '<div class="actions" style="margin-top:12px">' + (joinable ? '<button class="primary" id="cp-join">Entra nella partita</button>' : '<button class="primary" id="cp-online">' + (p.room ? 'Riapri la stanza' : 'Gioca online') + '</button>') +
          '<button class="ghost" id="cp-fsim">' + (theirs && theirs.kind === 'sim' ? 'Simula (l\'ha chiesto ' + esc(opp) + ')' : 'Chiedi la simulazione') + '</button></div>' +
          '<p class="small">Uno dei due apre la stanza, l\'altro entra da qui. A fine partita il gioco manda il risultato per entrambi: vale quando coincide.' + (rules ? ' In caso di parità, supplementari e rigori li decide la simulazione ufficiale.' : '') + '</p>';
      }
      h += '</div>';
    } else {
      h += '<div class="nextmatch"><p>' + (u === null ? 'Non hai una squadra in questa competizione.' : c.userOut ? 'La tua squadra è stata eliminata: guardi come va a finire.' : 'La tua squadra riposa in questo turno.') + '</p></div>';
    }
    const others = v.pending.filter(x => x !== p);
    if (others.length) {
      h += '<h3 style="margin-top:20px">Partite in attesa</h3><div class="fx-list">' + others.map(x => {
        const who = [x.homeUser, x.awayUser].filter(Boolean).filter(n => !x.reports.some(r => r.username === n));
        return '<div class="fx-item"><span class="h">' + this.teamTag(x.home) + '</span><span class="sc none">–</span><span class="a">' + this.teamTag(x.away) + '</span>' +
          '<span class="small">' + (who.length ? 'tocca a ' + who.map(esc).join(' e ') : 'risultati diversi') + '</span>' +
          (v.isOwner ? '<button class="ghost" data-force="' + x.fixture + '" title="Partita bloccata: decide la simulazione ufficiale">Simula</button>' : '') + '</div>';
      }).join('') + '</div>';
    }
    return h + this.recentAndProgress(c);
  }
  bindFriendBody(c, b) {
    const v = this.friend.view;
    const p = v.myTeam === null ? null : v.pending.find(x => x.home === v.myTeam || x.away === v.myTeam);
    const f = p ? this.career.fixture(c, p.fixture) : null;
    if (b('cp-play')) b('cp-play').onclick = () => this.friendPlay(c, f);
    if (b('cp-sim')) b('cp-sim').onclick = () => this.friendReport(f, { kind: 'sim' });
    if (b('cp-fsim')) b('cp-fsim').onclick = () => this.friendReport(f, { kind: 'sim' });
    if (b('cp-online')) b('cp-online').onclick = () => this.g.createOnline('server', { friend: this.friendMatchInfo(c, f, p) });
    if (b('cp-join')) b('cp-join').onclick = () => this.g.joinOnline({ code: p.room.code, friend: this.friendMatchInfo(c, f, p) });
    if (b('cp-newseason')) b('cp-newseason').onclick = () => this.friendPost('newseason', {}, c.kind === 'league' ? 'Nuova stagione: calendario pronto' : 'Nuova edizione: sorteggio fatto');
    $('cp-body').querySelectorAll('[data-friendly]').forEach(x => x.onclick = () => this.g.createOnline('server', { invite: x.dataset.friendly }));
    $('cp-body').querySelectorAll('[data-force]').forEach(x => x.onclick = () => this.g.confirmClick(x, 'Sicuro?', () => this.friendPost('force', { fixture: x.dataset.force }, 'Partita simulata')));
    $('cp-body').querySelectorAll('[data-calr]').forEach(x => x.onclick = () => { this.calRound = Number(x.dataset.calr); this.render(); });
  }
  // tutto quello che serve alla partita online tra due amici (squadre, regole, chi è chi)
  friendMatchInfo(c, f, p) {
    return { code: this.friend.code, fixture: f.id, season: c.season, compName: c.name, home: f.home, away: f.away,
      homeUser: p.homeUser, awayUser: p.awayUser, halfSeconds: c.config.halfSeconds, difficulty: c.config.difficulty };
  }
  async friendReport(f, body) {
    const r = await this.friendPost('report', Object.assign({ fixture: f.id }, body));
    if (!r) return r;
    if (r.status === 'recorded') this.flash('Risultato registrato: ' + this.g.teamName(r.fixture.home) + ' ' + r.fixture.h + '-' + r.fixture.a + ' ' + this.g.teamName(r.fixture.away) + (r.fixture.pens ? ' (rigori ' + r.fixture.pens.h + '-' + r.fixture.pens.a + ')' : r.fixture.et ? ' (d.t.s.)' : ''));
    else if (r.status === 'waiting') this.flash('Richiesta mandata: aspetta la risposta del tuo amico');
    else if (r.status === 'conflict') this.flash('La tua richiesta e quella del tuo amico non coincidono', true);
    return r;
  }
  // partita contro l'IA: il server segna l'inizio (una partita iniziata e mai finita non si rigioca)
  async friendPlay(c, f) {
    const code = this.friend.code;
    let r;
    try { r = await this.api.post('/api/friendcomps/' + encodeURIComponent(code) + '/report', { fixture: f.id, kind: 'kickoff' }); }
    catch (e) { this.flash(e.message, true); return; }
    if (r.status === 'abandoned') {
      this.g.toast('Questa partita era già iniziata e non è stata finita: risultato dalla simulazione (' + this.g.teamName(r.fixture.home) + ' ' + r.fixture.h + '-' + r.fixture.a + ' ' + this.g.teamName(r.fixture.away) + ')', true);
      await this.reloadFriend(false);
      return;
    }
    this.g.startCompMatch(c, f, { friend: code });
  }
  // fine partita (contro l'IA): il risultato del motore va al server
  friendMatchFinished(cm, m) {
    const r = m.result ? m.result() : { h: m.teams[0].score, a: m.teams[1].score };
    const result = { h: r.h, a: r.a, et: r.et || undefined, pens: r.pens || undefined, scorers: m.log.filter(g => !g.own).map(g => ({ team: g.team.index, name: g.scorer, minute: g.minute })) };
    return this.api.post('/api/friendcomps/' + encodeURIComponent(cm.friend) + '/report', { fixture: cm.fid, kind: 'score', result: result })
      .then(x => { if (this.g.social) this.g.social.refresh(); return x.finished ? 'Risultato registrato · la competizione è finita!' : 'Risultato registrato nella sfida tra amici'; })
      .catch(e => 'Risultato non registrato: ' + e.message);
  }
  friendMatchAbandoned(cm, m) {
    const fraction = m.half <= 2 ? ((m.half - 1) * 2700 + m.clock) / 5400 : 1;
    const scorers = m.log.filter(g => !g.own).map(g => ({ team: g.team.index, name: g.scorer, minute: g.minute }));
    return this.api.post('/api/friendcomps/' + encodeURIComponent(cm.friend) + '/report', { fixture: cm.fid, kind: 'abandon', h: m.teams[0].score, a: m.teams[1].score, fraction: fraction, scorers: scorers })
      .then(x => { this.g.toast('Partita lasciata a metà: il resto è stato simulato (' + this.g.teamName(x.fixture.home) + ' ' + x.fixture.h + '-' + x.fixture.a + ' ' + this.g.teamName(x.fixture.away) + ')'); })
      .catch(e => this.g.toast('Uscita non registrata: ' + e.message + '. Al prossimo «Gioca» decide la simulazione.', true));
  }
  // fine della partita online tra due amici (sia per chi ospita sia per chi entra): ognuno manda il risultato visto
  friendOnlineFinished(info, m) {
    const scorers = m.log.filter(g => !g.own).map(g => ({ team: g.team.index, name: g.scorer, minute: g.minute }));
    return this.api.post('/api/friendcomps/' + encodeURIComponent(info.code) + '/report', { fixture: info.fixture, kind: 'score', result: { h: m.teams[0].score, a: m.teams[1].score, scorers: scorers } })
      .then(x => x.status === 'recorded' ? 'Risultato registrato nella sfida tra amici' + (x.fixture.pens ? ' (rigori ' + x.fixture.pens.h + '-' + x.fixture.pens.a + ' dalla simulazione)' : x.fixture.et ? ' (supplementari dalla simulazione)' : '')
        : x.status === 'waiting' ? 'Risultato mandato: si registra quando lo manda anche il tuo amico' : 'I due risultati non coincidono: controllate nella competizione')
      .catch(e => 'Risultato non mandato: ' + e.message);
  }

  // ---------- creazione ----------
  // sfida tra amici: stessa schermata di creazione, con il tipo, la squadra obbligatoria e gli amici da invitare
  openNewFriend(invite) {
    const social = this.g.social;
    if (!social || !social.ready()) { this.g.eco.open('account'); return; }
    this.openNew('league');
    Object.assign(this.draft, { friends: true, invite: new Set(invite || []), name: 'Sfida tra amici', legs: 2, userTeam: Math.max(0, this.draft.userTeam), size: 8 });
    if (!social.friends) social.refresh().then(() => { if (this.g.screen === 'comp-new') this.renderNew(); });
    this.renderNew();
  }
  openNew(kind) {
    const nTeams = this.g.db.length;
    this.draft = { kind: kind, name: { league: 'Campionato', tournament: 'Torneo', cup: 'Coppa Nazionale' }[kind], size: kind === 'league' ? 16 : 16,
      legs: kind === 'league' ? 2 : 1, format: 'ko', extraTime: true, penalties: true, userTeam: this.g.setup ? this.g.setup.home : 0,
      halfSeconds: 120, difficulty: 1, preset: kind === 'cup' ? 'nazionale' : null, max: nTeams };
    if (kind === 'cup') this.applyPreset('nazionale');
    this.g.showScreen('comp-new');
    this.renderNew();
  }
  applyPreset(id) {
    const p = CUP_PRESETS.find(x => x.id === id);
    if (!p) return;
    Object.assign(this.draft, { preset: id, name: p.name, size: p.size, legs: p.legs, format: p.groups ? 'groups' : 'ko', extraTime: p.extraTime, penalties: p.penalties });
  }
  // squadre della competizione: le prime N nell'ordine del gioco, con dentro sempre la squadra scelta
  draftTeams() {
    const d = this.draft, all = this.g.db.map((t, i) => i);
    const teams = all.slice(0, d.size);
    if (d.userTeam >= 0 && teams.indexOf(d.userTeam) < 0) teams[teams.length - 1] = d.userTeam;
    return teams;
  }
  renderNew() {
    const d = this.draft, g = this.g;
    $('cn-title').textContent = d.friends ? 'Nuova sfida tra amici' : { league: 'Nuovo campionato', tournament: 'Nuovo torneo', cup: 'Nuova coppa' }[d.kind];
    $('cn-kind').hidden = $('cn-kind-l').hidden = !d.friends;
    $('cn-friends').hidden = $('cn-friends-l').hidden = !d.friends;
    if (d.friends) {
      g.segmented('cn-kind', [{ label: 'Campionato', value: 'league' }, { label: 'Torneo', value: 'tournament' }, { label: 'Coppa', value: 'cup' }], d.kind, v => {
        const keep = { friends: true, invite: d.invite, userTeam: d.userTeam, name: d.name };
        this.openNew(v); Object.assign(this.draft, keep); if (v === 'league') this.draft.legs = 2; this.renderNew();
      });
      const fr = g.social && g.social.friends ? g.social.friends.friends : null;
      $('cn-friends').innerHTML = !fr ? '<span class="small">Caricamento degli amici…</span>' : fr.length ? fr.map(f => '<button class="seg' + (d.invite.has(f.username) ? ' on' : '') + '" data-inv="' + esc(f.username) + '" aria-pressed="' + d.invite.has(f.username) + '">' + esc(f.username) + '</button>').join('')
        : '<span class="small">Nessun amico ancora: aggiungili dal pannello Amici nella Home (puoi anche creare la sfida e invitarli dopo).</span>';
      $('cn-friends').querySelectorAll('[data-inv]').forEach(b => b.onclick = () => { const u = b.dataset.inv; if (d.invite.has(u)) d.invite.delete(u); else d.invite.add(u); this.renderNew(); });
    }
    $('cn-name').value = d.name;
    const show = (id, v) => { $(id).hidden = !v; $(id + '-l').hidden = !v; };
    show('cn-preset', d.kind === 'cup');
    if (d.kind === 'cup') g.segmented('cn-preset', CUP_PRESETS.map(p => ({ label: p.name, value: p.id })).concat([{ label: 'Personalizzata', value: 'custom' }]), d.preset || 'custom', v => { if (v === 'custom') d.preset = null; else this.applyPreset(v); this.renderNew(); });
    const sizes = d.kind === 'league' ? [6, 8, 10, 12, 16, 20] : d.kind === 'tournament' ? [8, 16, 32] : d.format === 'groups' ? [16, 32] : [4, 8, 16, 32];
    if (sizes.indexOf(d.size) < 0) d.size = sizes[Math.min(1, sizes.length - 1)];
    g.segmented('cn-size', sizes.map(n => ({ label: n + ' squadre', value: n })), d.size, v => { d.size = v; d.preset = null; this.renderNew(); });
    show('cn-format', d.kind === 'cup');
    if (d.kind === 'cup') g.segmented('cn-format', [{ label: 'Eliminazione diretta', value: 'ko' }, { label: 'Gironi + eliminazione', value: 'groups' }], d.format, v => { d.format = v; d.preset = null; if (v === 'groups' && d.size < 16) d.size = 16; this.renderNew(); });
    show('cn-legs', d.kind !== 'tournament');
    g.segmented('cn-legs', [{ label: d.kind === 'league' ? 'Solo andata' : 'Gara unica', value: 1 }, { label: d.kind === 'league' ? 'Andata e ritorno' : 'Andata e ritorno (finale secca)', value: 2 }], d.legs, v => { d.legs = v; d.preset = null; this.renderNew(); });
    show('cn-et', d.kind !== 'league'); show('cn-pen', d.kind !== 'league');
    g.segmented('cn-et', [{ label: 'Sì', value: true }, { label: 'No', value: false }], d.extraTime, v => { d.extraTime = v; d.preset = null; this.renderNew(); });
    g.segmented('cn-pen', [{ label: 'Sì', value: true }, { label: 'No (ripetizione)', value: false }], d.penalties, v => { d.penalties = v; d.preset = null; this.renderNew(); });
    g.segmented('cn-len', [{ label: '2 min', value: 120 }, { label: '3 min', value: 180 }, { label: '5 min', value: 300 }], d.halfSeconds, v => { d.halfSeconds = v; this.renderNew(); });
    g.segmented('cn-diff', [{ label: 'Facile', value: 0 }, { label: 'Normale', value: 1 }, { label: 'Difficile', value: 2 }], d.difficulty, v => { d.difficulty = v; this.renderNew(); });
    const sel = $('cn-team');
    const opts = (d.friends ? '' : '<option value="-1">Nessuna (solo simulazione)</option>') + g.db.map((t, i) => '<option value="' + i + '">' + esc(g.teamName(i)) + ' (forza ' + t.rating + ')</option>').join('');
    const key = String(g.db.length) + '|' + JSON.stringify(g.settings.teamNames) + '|' + !!d.friends;
    if (sel.dataset.n !== key) { sel.innerHTML = opts; sel.dataset.n = key; }
    sel.value = String(d.userTeam);
    // riepilogo del formato
    const teams = this.draftTeams();
    let sum = teams.length + ' squadre: ' + teams.map(t => g.teamName(t)).join(', ') + '. ';
    if (d.kind === 'league') { const r = (teams.length % 2 ? teams.length : teams.length - 1) * d.legs; sum += r + ' giornate, ' + (teams.length * (teams.length - 1) / 2 * d.legs) + ' partite.'; }
    else if (d.kind === 'cup' && d.format === 'groups') sum += (teams.length / 4) + ' gironi da 4 (' + (d.legs === 2 ? 'andata e ritorno' : 'solo andata') + '), passano le prime 2, poi eliminazione diretta fino alla finale.';
    else { let n = teams.length; const rs = []; while (n >= 2) { rs.push(CompLogic.roundName(n)); n /= 2; } sum += rs.join(' → ') + '.'; }
    if (d.friends) sum += ' Ogni amico sceglie una squadra libera quando accetta; le altre le guida l\'IA. Si gioca online tra amici, contro l\'IA da soli.';
    $('cn-summary').textContent = sum;
    $('cn-status').textContent = '';
    $('cn-create').textContent = d.friends ? 'Crea e invita' : 'Crea';
  }
  create() {
    const d = this.draft;
    if (!d) return;
    const teams = this.draftTeams();
    const cfg = { kind: d.kind, name: $('cn-name').value || d.name, teams: teams, userTeam: d.userTeam, legs: d.legs, extraTime: d.extraTime, penalties: d.penalties,
      halfSeconds: d.halfSeconds, difficulty: d.difficulty, groups: d.kind === 'cup' && d.format === 'groups' ? { count: teams.length / 4, qualify: 2, legs: d.legs } : null };
    if (d.friends) { this.createFriend(cfg); return; }
    try {
      const c = this.career.create(cfg);
      this.open(c.id);
      this.flash(c.kind === 'league' ? 'Calendario pronto: ' + this.career.roundLabel(c, this.career.currentRound(c)) : 'Sorteggio fatto: ' + this.career.roundLabel(c, this.career.currentRound(c)));
    } catch (e) {
      const s = $('cn-status'); s.className = 'status err'; s.textContent = e.message;
    }
  }
  async createFriend(cfg) {
    const d = this.draft, btn = $('cn-create');
    btn.disabled = true;
    try {
      const v = await this.api.post('/api/friendcomps', Object.assign({}, cfg, { team: d.userTeam, invite: [...d.invite] }));
      if (this.g.social) this.g.social.refresh();
      await this.openFriend(v.code);
      this.flash(d.invite.size ? 'Creata: inviti mandati a ' + [...d.invite].join(', ') : 'Creata: invita gli amici e poi inizia');
    } catch (e) {
      const s = $('cn-status'); s.className = 'status err'; s.textContent = e.message;
    } finally { btn.disabled = false; }
  }
}
