// ============================================================
// CARRIERA DA GIOCATORE — crei il tuo calciatore e giochi solo con lui
// Scegli nome, numero, ruolo, piede, aspetto e la squadra in cui cominci. In partita guidi sempre e solo lui
// (il motore lo tiene fisso: Match opts.humans[].lock), gli altri li muove l'IA.
// Dopo ogni partita arrivano punti esperienza: di più se giochi bene (voto), segni o vinci. A ogni livello hai
// punti da mettere sulle caratteristiche (velocità, tiro, passaggio...). A fine stagione le squadre più forti
// possono chiamarti, se hai giocato bene.
// Il campionato è una competizione normale (8 squadre, andata e ritorno) con comp.pro; si salva sul computer.
// ============================================================
const PRO_KEY = 'campoAperto.pro.v1';
const PRO = {
  START_RATING: 60,          // base degli attributi all'inizio (un ragazzo di 18 anni)
  POINTS_PER_LEVEL: 3,       // punti da mettere sulle caratteristiche a ogni livello
  MAX_ATTR: 95,
  ABILITY_LEVEL: 5,          // dal livello 5 si sceglie una caratteristica speciale
  ROLES: [['FW', 'Attaccante'], ['MF', 'Centrocampista'], ['DF', 'Difensore']],
  ATTRS: [['speed', 'Velocità'], ['accel', 'Accelerazione'], ['stamina', 'Resistenza'], ['shot', 'Tiro'], ['pass', 'Passaggio'],
    ['dribble', 'Dribbling'], ['defense', 'Difesa'], ['physical', 'Fisico']],
  ABILITIES: { FW: ['Bomber', 'Velocista', 'Dribblatore', 'Colpo di testa'], MF: ['Regista', 'Dribblatore', 'Instancabile'], DF: ['Muro', 'Colpo di testa', 'Instancabile'] },
};
// punti esperienza per passare dal livello l al successivo
function proXpNeed(l) { return 80 + l * 40; }

class ProCareer {
  constructor(game) {
    this.g = game;
    this.data = this.load();
    this.tab = 'player';
    this.draft = null;      // calciatore in creazione
    this.lockIdx = 10;      // posto del calciatore nella rosa della partita (lo calcola teamFor)
  }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(PRO_KEY) || 'null');
      if (!d || d.v !== 1 || !d.p || !d.p.attr || !Number.isInteger(d.team)) return null;
      return d;
    } catch (e) { return null; }
  }
  save() { try { localStorage.setItem(PRO_KEY, JSON.stringify(this.data)); } catch (e) { this.g.toast(tr('Salvataggio della carriera non riuscito'), true); } }
  get career() { return this.g.comps.career; }
  comp() { return this.data ? this.career.byId(this.data.compId) : null; }
  overall() { const p = this.data.p; return computeOverall(p.attr, p.role); }

  // ---------- il calciatore nella squadra ----------
  // dati del calciatore come quelli del database (stessa forma di generatePlayer)
  playerData(slot) {
    const p = this.data.p, lv = this.data.level;
    const ov = computeOverall(p.attr, p.role);
    return {
      name: p.name, number: p.number, pos: slot.pos, role: p.role, age: p.age, foot: p.foot,
      attr: Object.assign({}, p.attr, { gk: 20 }),
      // sangue freddo e visione crescono con l'esperienza
      hidden: { composure: Math.min(90, 52 + lv * 2), vision: Math.min(90, 54 + lv * 2), aggression: 50 },
      ability: p.ability || null, overall: ov, potential: ov, value: 0, morale: 85, form: 80,
      look: Object.assign({}, p.look), pro: true,
    };
  }
  // la squadra del calciatore con lui tra i titolari, al posto del compagno più debole del suo ruolo
  teamFor(comp, t) {
    const d = this.data;
    if (!d || !comp || comp.id !== d.compId || t !== d.team) return null;
    const base = this.g.db[t];
    const slots = FORMATIONS[base.formation] || FORMATIONS['4-4-2'];
    const players = base.players.slice();
    let idx = -1, worst = 1e9;
    for (let i = 1; i < 11; i++) if (slots[i].role === d.p.role && players[i].overall < worst) { worst = players[i].overall; idx = i; }
    if (idx < 0) idx = 10;
    // stesso numero di un compagno: il compagno prende il numero di chi esce
    const clash = players.findIndex((q, i) => i !== idx && q.number === d.p.number);
    if (clash >= 0) players[clash] = Object.assign({}, players[clash], { number: players[idx].number });
    players[idx] = this.playerData(slots[idx]);
    this.lockIdx = idx;
    const xi = players.slice(0, 11);
    const rating = Math.round(xi.reduce((s, p) => s + p.overall, 0) / xi.length);
    return Object.assign({}, base, { players: players, rating: rating, tactics: Object.assign({}, base.tactics) });
  }

  // ---------- inizio e fine ----------
  newDraft() {
    const skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];
    this.draft = { name: '', number: 9, role: 'FW', foot: 'Destro', team: 7, look: { skin: skin, hair: HAIR_COLORS[1], hairStyle: 'corti', height: 1.8, build: 1, boots: '#111111', beard: false } };
  }
  // attributi di partenza: un ragazzo con il profilo del suo ruolo (senza numeri a caso)
  startAttr(role) {
    const b = { speed: 0, accel: 0, stamina: 0, shot: 0, pass: 0, dribble: 0, defense: 0, physical: 0 };
    if (role === 'DF') { b.defense = 8; b.physical = 5; b.shot = -12; b.dribble = -6; }
    if (role === 'MF') { b.pass = 7; b.stamina = 6; b.dribble = 3; b.defense = -4; }
    if (role === 'FW') { b.shot = 8; b.speed = 5; b.dribble = 5; b.defense = -18; }
    const a = {};
    for (const k in b) a[k] = clamp(PRO.START_RATING + b[k], 30, 99);
    return a;
  }
  start() {
    const dr = this.draft;
    const name = String(dr.name || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (name.length < 2) return tr('Scrivi il nome del tuo calciatore');
    const number = clamp(Math.round(Number(dr.number) || 9), 1, 99);
    const old = this.comp();
    if (old) this.career.remove(old.id);
    this.data = {
      v: 1, p: { name: name, number: number, role: dr.role, foot: dr.foot, age: 18, attr: this.startAttr(dr.role), ability: null, look: Object.assign({}, dr.look) },
      team: dr.team, season: 1, level: 1, xp: 0, points: 0, compId: null,
      total: { apps: 0, goals: 0, ratingSum: 0, rated: 0, wins: 0, mvp: 0 },
      cur: { apps: 0, goals: 0, ratingSum: 0, rated: 0 }, log: [], history: [], offers: null,
    };
    const err = this.newComp();
    if (err) { this.data = null; return err; }
    this.draft = null;
    this.save();
    return null;
  }
  newComp() {
    const d = this.data;
    try {
      const comp = this.career.create({ kind: 'league', name: trf('Carriera di {0}', d.p.name) + ' · ' + this.g.teamName(d.team), teams: [0, 1, 2, 3, 4, 5, 6, 7], userTeam: d.team,
        legs: 2, halfSeconds: 180, difficulty: 1, pro: true });
      d.compId = comp.id;
      return null;
    } catch (e) { return tr(e.message); }
  }
  quit() {
    const c = this.comp();
    if (c) this.career.remove(c.id);
    this.data = null;
    try { localStorage.removeItem(PRO_KEY); } catch (e) { /* niente */ }
  }

  // ---------- esperienza ----------
  addXp(n) {
    const d = this.data;
    d.xp += Math.max(0, Math.round(n));
    let ups = 0;
    while (d.xp >= proXpNeed(d.level)) { d.xp -= proXpNeed(d.level); d.level++; d.points += PRO.POINTS_PER_LEVEL; ups++; }
    return ups;
  }
  // partita giocata con il motore: voto, gol e risultato del calciatore
  afterMatch(comp, f, m) {
    const d = this.data;
    if (!d || !comp || comp.id !== d.compId) return null;
    const side = f.home === d.team ? 0 : 1;
    const me = matchPlayers(m).find(p => p.team === side && p.name === d.p.name);
    const rating = me ? playerRating(me, m) : 6;
    const goals = me ? me.stats.goals || 0 : 0;
    const own = m.teams[side].score, opp = m.teams[1 - side].score;
    const res = own > opp ? 'V' : own < opp ? 'P' : 'N';
    // migliore in campo: il voto più alto della partita
    const best = matchPlayers(m).reduce((b, p) => Math.max(b, playerRating(p, m)), 0);
    const mvp = me && rating >= best;
    const xp = 20 + (rating - 6) * 18 + goals * 12 + (res === 'V' ? 12 : res === 'N' ? 5 : 0) + (mvp ? 15 : 0);
    return this.note(comp, f, side, { rating: rating, goals: goals, res: res, mvp: mvp, how: 'played', xp: xp });
  }
  // partita simulata: niente voto, poca esperienza; i gol vengono dai marcatori della simulazione
  afterSim(comp, f) {
    const d = this.data;
    if (!d || !comp || comp.id !== d.compId || !f || !f.played) return null;
    const side = f.home === d.team ? 0 : 1;
    const goals = (f.scorers || []).filter(s => s.team === side && s.name === d.p.name).length;
    const own = side === 0 ? f.h : f.a, opp = side === 0 ? f.a : f.h;
    const res = own > opp ? 'V' : own < opp ? 'P' : 'N';
    return this.note(comp, f, side, { rating: null, goals: goals, res: res, mvp: false, how: 'sim', xp: 8 + goals * 6 });
  }
  note(comp, f, side, r) {
    const d = this.data;
    for (const s of [d.total, d.cur]) {
      s.apps++; s.goals += r.goals;
      if (r.rating !== null) { s.ratingSum += r.rating; s.rated++; }
    }
    if (r.res === 'V') d.total.wins++;
    if (r.mvp) d.total.mvp++;
    const ups = this.addXp(r.xp);
    d.log.unshift({ season: d.season, vs: side === 0 ? f.away : f.home, home: side === 0, own: side === 0 ? f.h : f.a, opp: side === 0 ? f.a : f.h,
      rating: r.rating, goals: r.goals, res: r.res, mvp: r.mvp, how: r.how, xp: Math.round(r.xp) });
    d.log = d.log.slice(0, 40);
    this.save();
    return { xp: Math.round(r.xp), ups: ups, rating: r.rating, goals: r.goals, mvp: r.mvp };
  }
  // un punto su una caratteristica
  raise(k) {
    const d = this.data;
    if (!d || d.points <= 0 || !PRO.ATTRS.some(a => a[0] === k)) return;
    if (d.p.attr[k] >= PRO.MAX_ATTR) return;
    d.p.attr[k]++; d.points--;
    this.save();
  }
  setAbility(a) {
    const d = this.data;
    if (!d || d.level < PRO.ABILITY_LEVEL || !(PRO.ABILITIES[d.p.role] || []).includes(a)) return;
    d.p.ability = a;
    this.save();
  }

  // ---------- fine stagione ----------
  avg(s) { return s.rated ? Math.round(s.ratingSum / s.rated * 10) / 10 : null; }
  endSeason() {
    const d = this.data, comp = this.comp();
    if (!comp || comp.status !== 'finished') return null;
    const row = this.career.table(comp).find(r => r.team === d.team);
    const avg = this.avg(d.cur);
    const report = { season: d.season, team: d.team, pos: row ? row.pos : 8, champion: comp.champion, apps: d.cur.apps, goals: d.cur.goals, avg: avg, level: d.level };
    d.history.push(report);
    // premio di fine stagione: posizione della squadra e campionato vinto
    this.addXp((9 - report.pos) * 10 + (comp.champion === d.team ? 60 : 0));
    // età: dopo i 30 anni si perde un po' di fisico ogni stagione
    d.p.age++;
    if (d.p.age > 30) for (const k of ['speed', 'accel', 'stamina']) d.p.attr[k] = Math.max(30, d.p.attr[k] - 1);
    // offerte: squadre più forti della tua, se hai giocato bene (voto medio) o segnato molto
    const cur = this.g.db[d.team].rating;
    const good = (avg || 6) + d.cur.goals * 0.04;
    const offers = this.g.db.slice(0, 8).map((t, i) => ({ team: i, rating: t.rating })).filter(o => o.team !== d.team && o.rating > cur && good >= 6.4 + (o.rating - cur) * 0.05)
      .sort((a, b) => b.rating - a.rating).slice(0, 3).map(o => o.team);
    d.offers = offers;
    d.cur = { apps: 0, goals: 0, ratingSum: 0, rated: 0 };
    d.season++;
    this.save();
    return report;
  }
  // stagione nuova: resta (stesso campionato, calendario nuovo) o va in un'altra squadra
  nextSeason(team) {
    const d = this.data;
    if (!d || !d.offers) return tr('Prima chiudi la stagione');
    if (team !== d.team && !d.offers.includes(team)) return tr('Offerta non valida');
    d.offers = null;
    if (team === d.team) {
      this.career.newSeason(d.compId);
    } else {
      const old = this.comp();
      if (old) this.career.remove(old.id);
      d.team = team;
      const err = this.newComp();
      if (err) return err;
    }
    this.save();
    return null;
  }

  // ---------- schermata ----------
  open() { this.g.showScreen('pro'); this.render(); }
  status(t, err) { const s = $('pr-status'); s.className = 'status' + (err ? ' err' : ' ok'); s.textContent = t || ''; }
  render() {
    const d = this.data, comp = this.comp(), body = $('pr-body');
    this.status('');
    if (d && !comp && !d.offers) { this.quit(); return this.render(); }   // campionato eliminato: carriera finita
    $('pr-quit').hidden = !d;
    if (!d) return this.renderCreate();
    $('pr-title').textContent = d.p.name;
    $('pr-sub').textContent = trf('Livello {0}', d.level) + ' · ' + this.g.teamName(d.team) + ' · ' + trf('Stagione {0}', d.season);
    const finished = comp && comp.status === 'finished';
    let h = '<div class="actions" style="margin:0 0 14px">';
    if (d.offers) h += '';
    else if (finished) h += '<button class="primary" id="pr-end">' + tr('Chiudi la stagione') + '</button>';
    else h += '<button class="primary" id="pr-play">' + tr('Vai al campionato') + '</button>';
    h += '</div>';
    if (d.offers) h += this.offersHtml();
    else if (finished) h += '<p class="small">' + trf('Stagione finita: campione {0}. Chiudendo la stagione arrivano il premio in esperienza e le offerte delle altre squadre.', esc(this.g.teamName(comp.champion))) + '</p>';
    h += '<div class="tabs">' + [['player', 'Giocatore'], ['matches', 'Partite'], ['history', 'Storico']].map(x => '<button class="tab' + (this.tab === x[0] ? ' on' : '') + '" data-pr-tab="' + x[0] + '">' + tr(x[1]) + '</button>').join('') + '</div>';
    h += this.tab === 'player' ? this.playerHtml() : this.tab === 'matches' ? this.matchesHtml() : this.historyHtml();
    body.innerHTML = h;
    body.querySelectorAll('[data-pr-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.prTab; this.render(); });
    if ($('pr-play')) $('pr-play').onclick = () => this.g.comps.open(comp.id);
    if ($('pr-end')) $('pr-end').onclick = () => { const r = this.endSeason(); this.render(); if (r) this.status(trf('Stagione {0} chiusa: {1} gol in {2} partite', r.season, r.goals, r.apps)); };
    body.querySelectorAll('[data-pr-up]').forEach(b => b.onclick = () => { this.raise(b.dataset.prUp); this.render(); });
    body.querySelectorAll('[data-pr-ab]').forEach(b => b.onclick = () => { this.setAbility(b.dataset.prAb); this.render(); });
    body.querySelectorAll('[data-pr-go]').forEach(b => b.onclick = () => {
      const err = this.nextSeason(Number(b.dataset.prGo));
      this.render();
      this.status(err || trf('Stagione {0}: si gioca con {1}', this.data.season, this.g.teamName(this.data.team)), !!err);
    });
  }
  playerHtml() {
    const d = this.data, p = d.p, need = proXpNeed(d.level);
    const roleName = (PRO.ROLES.find(r => r[0] === p.role) || ['', ''])[1];
    let h = '<div class="pr-top"><div class="pr-badge"><b>' + p.number + '</b><span>' + tr('Forza') + ' ' + this.overall() + '</span></div><div>' +
      '<p><b translate="no">' + esc(p.name) + '</b> · ' + tr(roleName) + ' · ' + trf('{0} anni', p.age) + ' · ' + tr('piede') + ' ' + tr(p.foot.toLowerCase()) + (p.ability ? ' · <span class="pill">' + tr(p.ability) + '</span>' : '') + '</p>' +
      '<p class="small">' + trf('Livello {0}', d.level) + ' · ' + trf('{0} su {1} punti esperienza', d.xp, need) + '</p>' +
      '<div class="cc-prog big"><i style="width:' + Math.round(d.xp / need * 100) + '%"></i></div></div></div>';
    const t = d.total, avg = this.avg(t), cavg = this.avg(d.cur);
    h += '<div class="champ-grid"><div><span class="small">' + tr('Partite') + '</span><b>' + t.apps + '</b><span>' + trf('{0} in questa stagione', d.cur.apps) + '</span></div>' +
      '<div><span class="small">' + tr('Gol') + '</span><b>' + t.goals + '</b><span>' + trf('{0} in questa stagione', d.cur.goals) + '</span></div>' +
      '<div><span class="small">' + tr('Voto medio') + '</span><b>' + (avg === null ? '—' : avg.toLocaleString(uiLocale(), { minimumFractionDigits: 1 })) + '</b><span>' + (cavg === null ? '' : trf('{0} in questa stagione', cavg.toLocaleString(uiLocale(), { minimumFractionDigits: 1 }))) + '</span></div>' +
      '<div><span class="small">' + tr('Migliore in campo') + '</span><b>' + t.mvp + '</b><span>' + trf('{0} vittorie', t.wins) + '</span></div></div>';
    h += '<h3 style="margin-top:18px">' + tr('Caratteristiche') + (d.points ? ' <span class="pill">' + trf('{0} punti da usare', d.points) + '</span>' : '') + '</h3>';
    h += '<div class="pr-attrs">' + PRO.ATTRS.map(a => {
      const v = p.attr[a[0]];
      return '<div class="pr-attr"><span>' + tr(a[1]) + '</span><div class="bar"><div style="width:' + v + '%"></div></div><b>' + v + '</b>' +
        (d.points && v < PRO.MAX_ATTR ? '<button class="ghost sm" data-pr-up="' + a[0] + '" aria-label="' + esc(tr('Aumenta')) + ' ' + esc(tr(a[1])) + '">+1</button>' : '<span></span>') + '</div>';
    }).join('') + '</div>';
    h += '<p class="small">' + tr('A ogni livello hai 3 punti per migliorare il tuo calciatore. I punti esperienza arrivano dopo ogni partita: di più se il voto è alto, se segni e se vinci.') + '</p>';
    if (d.level >= PRO.ABILITY_LEVEL) {
      h += '<h3 style="margin-top:14px">' + tr('Caratteristica speciale') + '</h3><div class="segs">' + PRO.ABILITIES[p.role].map(a => '<button class="seg' + (p.ability === a ? ' on' : '') + '" data-pr-ab="' + esc(a) + '">' + tr(a) + '</button>').join('') + '</div>';
    } else h += '<p class="small">' + trf('Dal livello {0} potrai scegliere una caratteristica speciale.', PRO.ABILITY_LEVEL) + '</p>';
    return h;
  }
  matchesHtml() {
    const d = this.data;
    if (!d.log.length) return '<p class="small" style="margin-top:14px">' + tr('Ancora nessuna partita: vai al campionato e gioca la prima.') + '</p>';
    return '<div class="mg-head pr-head"><span>' + tr('Contro') + '</span><span>' + tr('Risultato') + '</span><span>' + tr('Voto') + '</span><span>' + tr('Gol') + '</span><span>' + tr('Esperienza') + '</span></div>' +
      d.log.map(l => '<div class="mg-row pr-row"><span translate="no">' + esc(this.g.teamName(l.vs)) + ' <small>' + tr(l.home ? 'in casa' : 'in trasferta') + '</small></span>' +
        '<span><span class="form"><i class="f' + l.res + '">' + trf(l.res) + '</i></span> ' + l.own + '-' + l.opp + '</span>' +
        '<span>' + (l.rating === null ? '<small>' + tr('sim') + '</small>' : '<b>' + l.rating.toLocaleString(uiLocale(), { minimumFractionDigits: 1 }) + '</b>') + (l.mvp ? ' ⭐' : '') + '</span>' +
        '<span>' + (l.goals || '') + '</span><span>+' + l.xp + '</span></div>').join('');
  }
  historyHtml() {
    const d = this.data;
    if (!d.history.length) return '<p class="small" style="margin-top:14px">' + tr('Ancora nessuna stagione conclusa.') + '</p>';
    return d.history.slice().reverse().map(r => '<div class="te-card" style="display:block"><b>' + trf('Stagione {0}', r.season) + '</b> · <span translate="no">' + esc(this.g.teamName(r.team)) + '</span> · ' + trf('{0}º posto', r.pos) +
      (r.champion === r.team ? ' · 🏆 ' + tr('Campione') : '') + '<p class="small">' + trf('{0} partite, {1} gol', r.apps, r.goals) + (r.avg !== null ? ' · ' + trf('voto medio {0}', r.avg.toLocaleString(uiLocale(), { minimumFractionDigits: 1 })) : '') + ' · ' + trf('Livello {0}', r.level) + '</p></div>').join('');
  }
  offersHtml() {
    const d = this.data;
    const btn = (t, stay) => '<button class="mg-team" data-pr-go="' + t + '"><i class="kd" style="background:' + this.g.db[t].kits.home[0] + '"></i><b translate="no">' + esc(this.g.teamName(t)) + '</b><small>' + (stay ? tr('Resta') : tr('Vai')) + ' · ' + tr('Forza') + ' ' + this.g.db[t].rating + '</small></button>';
    return '<div class="nextmatch"><h3>' + tr('Mercato di fine stagione') + '</h3><p class="small">' + (d.offers.length ? tr('Queste squadre ti vogliono. Puoi cambiare squadra o restare dove sei.') : tr('Nessuna squadra più forte ti ha cercato: gioca bene (voto alto, gol) per ricevere offerte.')) + '</p>' +
      '<div class="mg-teams">' + btn(d.team, true) + d.offers.map(t => btn(t, false)).join('') + '</div></div>';
  }
  // ---- creazione del calciatore ----
  renderCreate() {
    if (!this.draft) this.newDraft();
    const dr = this.draft, body = $('pr-body');
    $('pr-title').textContent = tr('Carriera da giocatore');
    $('pr-sub').textContent = '';
    const sw = (list, cur, key) => list.map(c => '<button class="swatch' + (c === cur ? ' on' : '') + '" style="background:' + c + '" data-pr-' + key + '="' + c + '" aria-label="' + c + '"></button>').join('');
    body.innerHTML = '<p class="sub">' + tr('Crea il tuo calciatore e gioca solo con lui, partita dopo partita: più giochi bene, più cresce. A fine stagione le squadre più forti possono chiamarti.') + '</p>' +
      '<div class="opts">' +
      '<label for="pr-name">' + tr('Nome') + '</label><input type="text" id="pr-name" maxlength="24" spellcheck="false" autocomplete="off" value="' + esc(dr.name) + '">' +
      '<label for="pr-num">' + tr('Numero') + '</label><input type="number" id="pr-num" min="1" max="99" value="' + dr.number + '" style="max-width:110px">' +
      '<label>' + tr('Ruolo') + '</label><div class="segs" id="pr-role"></div>' +
      '<label>' + tr('Piede') + '</label><div class="segs" id="pr-foot"></div>' +
      '<label>' + tr('Pelle') + '</label><div class="swatches">' + sw(SKIN_TONES, dr.look.skin, 'skin') + '</div>' +
      '<label>' + tr('Capelli') + '</label><div class="segs" id="pr-hair"></div>' +
      '<label>' + tr('Colore dei capelli') + '</label><div class="swatches">' + sw(HAIR_COLORS, dr.look.hair, 'haircol') + '</div>' +
      '</div>' +
      '<h3 style="margin-top:16px">' + tr('Squadra in cui cominci') + '</h3><p class="small">' + tr('Una squadra più debole ti fa giocare di più; quelle forti ti chiameranno se giochi bene.') + '</p>' +
      '<div class="mg-teams">' + this.g.db.slice(0, 8).map((t, i) => '<button class="mg-team' + (dr.team === i ? ' on' : '') + '" data-pr-team="' + i + '"><i class="kd" style="background:' + t.kits.home[0] + '"></i><b translate="no">' + esc(this.g.teamName(i)) + '</b><small>' + tr('Forza') + ' ' + t.rating + '</small></button>').join('') + '</div>' +
      '<div class="actions" style="margin-top:16px"><button class="primary" id="pr-start">' + tr('Inizia la carriera') + '</button></div>';
    const g = this.g;
    g.segmented('pr-role', PRO.ROLES.map(r => ({ label: r[1], value: r[0] })), dr.role, v => { dr.role = v; this.renderCreate(); });
    g.segmented('pr-foot', [{ label: 'Destro', value: 'Destro' }, { label: 'Sinistro', value: 'Sinistro' }], dr.foot, v => { dr.foot = v; this.renderCreate(); });
    g.segmented('pr-hair', HAIR_STYLES.map(s => ({ label: s.charAt(0).toUpperCase() + s.slice(1), value: s })), dr.look.hairStyle, v => { dr.look.hairStyle = v; this.renderCreate(); });
    $('pr-name').oninput = () => { dr.name = $('pr-name').value; };
    $('pr-num').oninput = () => { dr.number = $('pr-num').value; };
    body.querySelectorAll('[data-pr-skin]').forEach(b => b.onclick = () => { dr.look.skin = b.dataset.prSkin; this.renderCreate(); });
    body.querySelectorAll('[data-pr-haircol]').forEach(b => b.onclick = () => { dr.look.hair = b.dataset.prHaircol; this.renderCreate(); });
    body.querySelectorAll('[data-pr-team]').forEach(b => b.onclick = () => { dr.team = Number(b.dataset.prTeam); this.renderCreate(); });
    $('pr-start').onclick = () => {
      const err = this.start();
      if (err) { this.status(err, true); return; }
      this.tab = 'player';
      this.render();
      this.status(trf('Benvenuto a {0}! Vai al campionato e gioca la prima partita.', this.g.teamName(this.data.team)));
    };
  }
}
