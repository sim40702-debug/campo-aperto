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
    this.bind();
    const n = this.career.resolveAbandoned();
    if (n) setTimeout(() => game.toast(n === 1 ? 'Una partita di competizione lasciata a metà è stata completata con la simulazione' : n + ' partite lasciate a metà sono state completate con la simulazione'), 800);
  }
  get comp() { return this.compId ? this.career.byId(this.compId) : null; }
  name(t) { return esc(this.g.teamName(t)); }
  kit(t) { const k = this.g.db[t] && this.g.db[t].kits.home; return k ? k[0] : '#888'; }
  teamTag(t, mine) { return '<span class="tt' + (mine ? ' mine' : '') + '"><i class="kd" style="background:' + this.kit(t) + '"></i>' + this.name(t) + '</span>'; }
  score(f) {
    if (!f.played) return '<span class="sc none">–</span>';
    let s = f.h + '-' + f.a;
    if (f.et) s += ' <small>d.t.s. ' + (f.h + f.et.h) + '-' + (f.a + f.et.a) + '</small>';
    if (f.pens) s += ' <small>rig. ' + f.pens.h + '-' + f.pens.a + '</small>';
    return '<span class="sc">' + s + '</span>';
  }
  how(f) { return !f.played ? '' : f.how === 'played' ? '<span class="pill played" title="Giocata da te">giocata</span>' : f.how === 'abbandonata' ? '<span class="pill" title="Lasciata a metà: il resto è stato simulato">abbandonata</span>' : '<span class="pill" title="Simulazione ufficiale">sim</span>'; }

  bind() {
    const g = this.g;
    $('btn-comps').onclick = () => this.openDashboard();
    $('comps-back').onclick = () => g.showScreen('menu');
    $('cp-back').onclick = () => this.openDashboard();
    $('cn-back').onclick = () => this.openDashboard();
    $('cp-delete').onclick = () => g.confirmClick($('cp-delete'), 'Sicuro? Elimina', () => { this.career.remove(this.compId); this.openDashboard(); g.toast('Competizione eliminata'); });
    document.querySelectorAll('[data-new]').forEach(b => b.onclick = () => this.openNew(b.dataset.new));
    $('cn-create').onclick = () => this.create();
    $('cn-name').oninput = () => { if (this.draft) this.draft.name = $('cn-name').value; };
    $('cn-team').onchange = () => { if (this.draft) { this.draft.userTeam = Number($('cn-team').value); this.renderNew(); } };
  }

  // ---------- cruscotto ----------
  openDashboard() {
    this.g.showScreen('comps');
    this.renderDashboard();
  }
  renderDashboard() {
    for (const kind of ['league', 'tournament', 'cup']) {
      const list = this.career.comps.filter(c => c.kind === kind);
      $('cl-' + kind).innerHTML = list.length ? list.map(c => this.card(c)).join('') :
        '<p class="empty">' + { league: 'Nessun campionato: creane uno con il calendario all\'italiana, classifica e stagioni.', tournament: 'Nessun torneo: 8, 16 o 32 squadre, eliminazione diretta fino alla finale.', cup: 'Nessuna coppa: scegli un modello o crea il tuo formato (gironi, andata e ritorno, supplementari, rigori).' }[kind] + '</p>';
    }
    document.querySelectorAll('#comps [data-open]').forEach(b => b.onclick = () => this.open(b.dataset.open));
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
    const c = this.comp;
    if (!c) return this.openDashboard();
    $('cp-title').textContent = c.name;
    $('cp-season').textContent = COMP_KINDS[c.kind] + ' · ' + (c.kind === 'league' ? 'stagione ' : 'edizione ') + c.season;
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
    if (b('cp-play')) b('cp-play').onclick = () => this.play(c);
    if (b('cp-sim')) b('cp-sim').onclick = () => this.simUser(c);
    if (b('cp-simround')) b('cp-simround').onclick = () => { const n = this.career.simulateRound(c); this.flash('Giornata simulata (' + n + ' partite)'); this.render(); };
    if (b('cp-simend')) b('cp-simend').onclick = () => this.g.confirmClick(b('cp-simend'), 'Sicuro? Simula tutto', () => { this.career.simulateToEnd(c); this.render(); });
    if (b('cp-newseason')) b('cp-newseason').onclick = () => { this.career.newSeason(c.id); this.flash(c.kind === 'league' ? 'Nuova stagione: calendario pronto' : 'Nuova edizione: sorteggio fatto'); this.render(); };
    $('cp-body').querySelectorAll('[data-calr]').forEach(x => x.onclick = () => { this.calRound = Number(x.dataset.calr); this.render(); });
  }
  flash(t) { const s = $('cp-status'); s.className = 'status ok'; s.textContent = t; }

  renderOver(c) {
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
    // risultati della giornata appena giocata (o di quella in corso)
    const last = c.fixtures.filter(f => f.played).sort((a, b) => (a.at || 0) - (b.at || 0)).pop();
    if (last) {
      const same = c.fixtures.filter(f => f.stage === last.stage && f.round === last.round && (f.leg || 1) === (last.leg || 1) && f.played);
      h += '<h3 style="margin-top:22px">Ultimi risultati · ' + esc(this.career.roundLabel(c, { stage: last.stage, round: last.round, leg: last.leg || 1, replay: !!last.replay })) + '</h3>' + this.fixtureList(c, same);
    }
    const pr = this.career.progress(c), pct = pr.total ? Math.round(pr.played / pr.total * 100) : 0;
    h += '<div class="cc-prog big"><i style="width:' + pct + '%"></i></div><p class="small">' + pr.played + ' di ' + pr.total + ' partite giocate · ' + c.fixtures.filter(f => f.how === 'played').length + ' giocate da te</p>';
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
    h += '<div class="actions" style="margin-top:14px"><button class="primary" id="cp-newseason">' + (c.kind === 'league' ? 'Nuova stagione' : 'Nuova edizione') + '</button></div></div>';
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
      '<div><span class="small">Partite</span><b>' + played.length + '</b><span>' + c.fixtures.filter(f => f.how === 'played').length + ' giocate da te, ' + played.filter(f => f.how === 'sim').length + ' simulate</span></div>' +
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

  // ---------- creazione ----------
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
    $('cn-title').textContent = { league: 'Nuovo campionato', tournament: 'Nuovo torneo', cup: 'Nuova coppa' }[d.kind];
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
    const opts = '<option value="-1">Nessuna (solo simulazione)</option>' + g.db.map((t, i) => '<option value="' + i + '">' + esc(g.teamName(i)) + ' (forza ' + t.rating + ')</option>').join('');
    if (sel.dataset.n !== String(g.db.length) + '|' + JSON.stringify(g.settings.teamNames)) { sel.innerHTML = opts; sel.dataset.n = String(g.db.length) + '|' + JSON.stringify(g.settings.teamNames); }
    sel.value = String(d.userTeam);
    // riepilogo del formato
    const teams = this.draftTeams();
    let sum = teams.length + ' squadre: ' + teams.map(t => g.teamName(t)).join(', ') + '. ';
    if (d.kind === 'league') { const r = (teams.length % 2 ? teams.length : teams.length - 1) * d.legs; sum += r + ' giornate, ' + (teams.length * (teams.length - 1) / 2 * d.legs) + ' partite.'; }
    else if (d.kind === 'cup' && d.format === 'groups') sum += (teams.length / 4) + ' gironi da 4 (' + (d.legs === 2 ? 'andata e ritorno' : 'solo andata') + '), passano le prime 2, poi eliminazione diretta fino alla finale.';
    else { let n = teams.length; const rs = []; while (n >= 2) { rs.push(CompLogic.roundName(n)); n /= 2; } sum += rs.join(' → ') + '.'; }
    $('cn-summary').textContent = sum;
    $('cn-status').textContent = '';
  }
  create() {
    const d = this.draft;
    if (!d) return;
    const teams = this.draftTeams();
    const cfg = { kind: d.kind, name: $('cn-name').value || d.name, teams: teams, userTeam: d.userTeam, legs: d.legs, extraTime: d.extraTime, penalties: d.penalties,
      halfSeconds: d.halfSeconds, difficulty: d.difficulty, groups: d.kind === 'cup' && d.format === 'groups' ? { count: teams.length / 4, qualify: 2, legs: d.legs } : null };
    try {
      const c = this.career.create(cfg);
      this.open(c.id);
      this.flash(c.kind === 'league' ? 'Calendario pronto: ' + this.career.roundLabel(c, this.career.currentRound(c)) : 'Sorteggio fatto: ' + this.career.roundLabel(c, this.career.currentRound(c)));
    } catch (e) {
      const s = $('cn-status'); s.className = 'status err'; s.textContent = e.message;
    }
  }
}
