// ============================================================
// CARRIERA DA ALLENATORE — più stagioni con la stessa squadra
// Un campionato a 8 squadre (andata e ritorno) giocato con le schermate delle competizioni, più:
// - rose che cambiano: a fine stagione i giovani crescono, i più anziani calano, chi è troppo vecchio si ritira
//   e al suo posto arriva un ragazzo del vivaio;
// - mercato: compri giocatori delle altre squadre o svincolati con il budget, vendi i tuoi;
// - formazione: scegli i titolari (i primi 11) e lo schema.
// Le rose stanno su questo computer (localStorage); il campionato è una competizione normale con comp.manager.
// ============================================================
const MANAGER_KEY = 'campoAperto.manager.v1';
const MANAGER = {
  TEAMS: 8,                 // le 8 squadre del database
  START_BUDGET: 6000000,
  PRIZES: [9000000, 7000000, 6000000, 5000000, 4200000, 3600000, 3000000, 2500000],  // premio per posizione
  MIN_ROSTER: 16, MAX_ROSTER: 23,
  SELL_SHARE: 0.85,         // si vende all'85% del valore
  MARKET_SIZE: 12,
};

// valore di mercato (stessa formula del database)
function playerValue(p) { return Math.round(Math.pow(p.overall / 10, 4) * (p.age < 25 ? 1.4 : p.age > 30 ? 0.6 : 1)) * 1000; }
function fmtMoney(v) { return v >= 1e6 ? (Math.round(v / 1e5) / 10).toLocaleString(uiLocale()) + ' M' : Math.round(v / 1000).toLocaleString(uiLocale()) + ' k'; }

// una stagione in più per un calciatore: crescita, maturità o calo
function agePlayer(p, rnd) {
  p.age++;
  let delta;
  if (p.age <= 21) delta = 2 + Math.floor(rnd() * 4);
  else if (p.age <= 24) delta = 1 + Math.floor(rnd() * 3);
  else if (p.age <= 29) delta = Math.floor(rnd() * 3) - 1;
  else if (p.age <= 32) delta = -1 - Math.floor(rnd() * 2);
  else delta = -2 - Math.floor(rnd() * 3);
  // i giovani non vanno oltre il loro potenziale
  if (delta > 0) delta = Math.max(0, Math.min(delta, p.potential - p.overall));
  if (delta) {
    for (const k in p.attr) {
      if (k === 'gk' && p.role !== 'GK') continue;
      p.attr[k] = clamp(p.attr[k] + delta + (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0), 25, 99);
    }
    p.overall = computeOverall(p.attr, p.role);
  }
  if (p.potential < p.overall) p.potential = p.overall;
  p.value = playerValue(p);
  return delta;
}
// ragazzo del vivaio: giovane, più debole, con margine di crescita
function youthPlayer(role, rating, number, rnd) {
  const saved = rand;
  rand = rnd;
  const slot = role === 'GK' ? FORMATIONS['4-4-2'][0] : role === 'DF' ? FORMATIONS['4-4-2'][2] : role === 'MF' ? FORMATIONS['4-4-2'][6] : FORMATIONS['4-4-2'][9];
  const p = generatePlayer(rating - 12, slot, number);
  rand = saved;
  p.age = 17 + Math.floor(rnd() * 3);
  p.potential = clamp(p.overall + 8 + Math.floor(rnd() * 14), p.overall, 95);
  p.value = playerValue(p);
  p.youth = true;
  return p;
}
function freeNumber(roster) {
  const used = new Set(roster.map(p => p.number));
  for (let n = 12; n < 100; n++) if (!used.has(n)) return n;
  return 99;
}

class Manager {
  constructor(game) {
    this.g = game;
    this.data = this.load();
    this.tab = 'squad';
    this.pick = null;   // calciatore scelto per lo scambio in formazione
  }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(MANAGER_KEY) || 'null');
      if (!d || d.v !== 1 || !Number.isInteger(d.team) || !d.rosters) return null;
      for (let t = 0; t < MANAGER.TEAMS; t++) if (!Array.isArray(d.rosters[t]) || d.rosters[t].length < 11) return null;
      return d;
    } catch (e) { return null; }
  }
  save() { try { localStorage.setItem(MANAGER_KEY, JSON.stringify(this.data)); } catch (e) { this.g.toast(tr('Salvataggio della carriera non riuscito'), true); } }
  get career() { return this.g.comps.career; }
  comp() { return this.data ? this.career.byId(this.data.compId) : null; }
  // generatore casuale della carriera: un seme salvato, così ogni passo è ripetibile
  rnd() { const r = makeRng(this.data.rng || 1); this.data.rng = Math.floor(r() * 2147483646) + 1; return r; }

  // squadra con la rosa della carriera (per la partita e per la simulazione)
  teamFor(comp, t) {
    if (!this.data || !comp || comp.id !== this.data.compId || !this.data.rosters[t]) return null;
    const base = this.g.db[t];
    const players = this.data.rosters[t];
    const xi = players.slice(0, 11);
    const rating = Math.round(xi.reduce((s, p) => s + p.overall, 0) / xi.length);
    const formation = t === this.data.team && FORMATIONS[this.data.formation] ? this.data.formation : base.formation;
    return Object.assign({}, base, { players: players, rating: rating, formation: formation, tactics: Object.assign({}, base.tactics) });
  }

  // ---------- inizio e fine ----------
  start(team) {
    const rosters = {};
    for (let t = 0; t < MANAGER.TEAMS; t++) rosters[t] = JSON.parse(JSON.stringify(this.g.db[t].players));
    const old = this.comp();
    if (old) this.career.remove(old.id);
    this.data = { v: 1, team: team, season: 1, budget: MANAGER.START_BUDGET, rosters: rosters, formation: this.g.db[team].formation,
      market: [], history: [], news: [], rng: (Math.floor(Math.random() * 2147483646) + 1), compId: null };
    let comp;
    try {
      comp = this.career.create({ kind: 'league', name: trf('Carriera · {0}', this.g.teamName(team)), teams: [0, 1, 2, 3, 4, 5, 6, 7], userTeam: team,
        legs: 2, halfSeconds: 180, difficulty: 1, manager: true });
    } catch (e) { this.data = null; this.g.toast(tr(e.message), true); return false; }
    this.data.compId = comp.id;
    this.refreshMarket();
    this.save();
    return true;
  }
  quit() {
    const c = this.comp();
    if (c) this.career.remove(c.id);
    this.data = null;
    try { localStorage.removeItem(MANAGER_KEY); } catch (e) { /* niente */ }
  }

  // fine stagione: premi, crescita dei giocatori, ritiri, mercato nuovo e calendario della stagione dopo
  endSeason() {
    const comp = this.comp();
    if (!comp || comp.status !== 'finished') return null;
    const d = this.data, rnd = this.rnd();
    const table = this.career.table(comp);
    const row = table.find(r => r.team === d.team);
    const pos = row ? row.pos : MANAGER.TEAMS;
    const prize = MANAGER.PRIZES[pos - 1] || MANAGER.PRIZES[MANAGER.PRIZES.length - 1];
    d.budget += prize;
    const report = { season: d.season, pos: pos, points: row ? row.pt : 0, champion: comp.champion, prize: prize, grew: [], retired: [] };
    for (let t = 0; t < MANAGER.TEAMS; t++) {
      const roster = d.rosters[t];
      const rating = this.g.db[t].rating;
      for (let i = roster.length - 1; i >= 0; i--) {
        const p = roster[i];
        const delta = agePlayer(p, rnd);
        if (t === d.team && delta >= 3) report.grew.push(p.name + ' +' + delta);
        const retire = p.age >= 37 || (p.age >= 34 && rnd() < 0.45);
        if (retire) {
          if (t === d.team) report.retired.push(p.name);
          const y = youthPlayer(p.role, rating, p.number, rnd);
          roster[i] = y;
        }
      }
      // le squadre dell'IA mettono i migliori in campo (il portiere sempre per primo)
      if (t !== d.team) this.autoLineup(t);
    }
    d.history.push(report);
    d.season++;
    this.career.newSeason(comp.id);
    this.refreshMarket();
    this.save();
    return report;
  }

  // titolari dell'IA: il miglior portiere, poi per ogni posto della formazione il migliore libero dello stesso ruolo
  autoLineup(t) {
    const roster = this.data.rosters[t], slots = FORMATIONS[this.g.db[t].formation];
    const free = roster.slice(), xi = [];
    for (const s of slots) {
      let best = free.filter(p => p.role === s.role).sort((a, b) => b.overall - a.overall)[0];
      if (!best && s.role !== 'GK') best = free.filter(p => p.role !== 'GK').sort((a, b) => b.overall - a.overall)[0];
      if (!best) best = free[0];
      xi.push(best); free.splice(free.indexOf(best), 1);
    }
    this.data.rosters[t] = xi.concat(free.sort((a, b) => b.overall - a.overall));
  }

  // ---------- mercato ----------
  refreshMarket() {
    const d = this.data, rnd = this.rnd(), out = [];
    // dalle altre squadre: soprattutto riserve, ogni tanto un titolare (più caro)
    for (let t = 0; t < MANAGER.TEAMS; t++) {
      if (t === d.team) continue;
      const r = d.rosters[t];
      const bench = r.slice(11).filter(p => p.role !== 'GK');
      if (bench.length) { const p = bench[Math.floor(rnd() * bench.length)]; out.push({ from: t, name: p.name }); }
      if (rnd() < 0.35) { const s = r.slice(1, 11); const p = s[Math.floor(rnd() * s.length)]; out.push({ from: t, name: p.name, star: true }); }
    }
    // svincolati: giocatori nuovi, senza squadra
    const roles = ['GK', 'DF', 'DF', 'MF', 'MF', 'FW'];
    while (out.length < MANAGER.MARKET_SIZE) {
      const role = roles[Math.floor(rnd() * roles.length)];
      const base = 64 + Math.floor(rnd() * 16);
      const p = youthPlayer(role, base + 12, 0, rnd);
      p.age = 20 + Math.floor(rnd() * 13); p.youth = false;
      p.potential = Math.max(p.overall, p.potential - 6); p.value = playerValue(p);
      out.push({ from: -1, player: p });
    }
    d.market = out;
  }
  marketList() {
    const d = this.data;
    return d.market.map((m, i) => {
      const p = m.from >= 0 ? d.rosters[m.from].find(q => q.name === m.name) : m.player;
      if (!p) return null;
      const price = Math.round(p.value * (m.star ? 1.35 : m.from >= 0 ? 1.1 : 0.8) / 1000) * 1000;
      return { i: i, p: p, from: m.from, price: price };
    }).filter(Boolean);
  }
  buy(i) {
    const d = this.data, item = this.marketList().find(x => x.i === i);
    const mine = d.rosters[d.team];
    if (!item) return tr('Giocatore non più disponibile');
    if (mine.length >= MANAGER.MAX_ROSTER) return trf('La rosa è piena: al massimo {0} giocatori', MANAGER.MAX_ROSTER);
    if (d.budget < item.price) return tr('Budget insufficiente');
    const p = item.p;
    if (item.from >= 0) {
      const seller = d.rosters[item.from];
      seller.splice(seller.indexOf(p), 1);
      // chi vende si rimpiazza con un ragazzo del vivaio
      if (seller.length < 18) seller.push(youthPlayer(p.role, this.g.db[item.from].rating, freeNumber(seller), this.rnd()));
      this.autoLineup(item.from);
    }
    p.number = mine.some(q => q.number === p.number) || !p.number ? freeNumber(mine) : p.number;
    mine.push(p);
    d.budget -= item.price;
    d.market.splice(i, 1);
    this.save();
    return null;
  }
  sell(idx) {
    const d = this.data, mine = d.rosters[d.team], p = mine[idx];
    if (!p) return tr('Giocatore non trovato');
    if (mine.length <= MANAGER.MIN_ROSTER) return trf('Servono almeno {0} giocatori in rosa', MANAGER.MIN_ROSTER);
    if (p.role === 'GK' && mine.filter(q => q.role === 'GK').length <= 1) return tr('Non puoi vendere l\'unico portiere');
    const gain = Math.round(p.value * MANAGER.SELL_SHARE / 1000) * 1000;
    mine.splice(idx, 1);
    if (mine[0].role !== 'GK') { const gk = mine.findIndex(q => q.role === 'GK'); const g0 = mine.splice(gk, 1)[0]; mine.unshift(g0); }
    d.budget += gain;
    // lo prende una squadra a caso con la rosa più corta
    const others = [];
    for (let t = 0; t < MANAGER.TEAMS; t++) if (t !== d.team) others.push(t);
    others.sort((a, b) => d.rosters[a].length - d.rosters[b].length);
    const to = others[0];
    p.number = freeNumber(d.rosters[to]);
    d.rosters[to].push(p);
    this.autoLineup(to);
    this.save();
    return null;
  }
  // formazione: scambia due calciatori (i primi 11 sono i titolari, il primo è il portiere)
  swap(a, b) {
    const r = this.data.rosters[this.data.team];
    if (!r[a] || !r[b] || a === b) return null;
    if ((a === 0 || b === 0) && r[a === 0 ? b : a].role !== 'GK') return tr('In porta va un portiere');
    [r[a], r[b]] = [r[b], r[a]];
    this.save();
    return null;
  }

  // ---------- schermata ----------
  open() { this.g.showScreen('manager'); this.render(); }
  status(t, err) { const s = $('mg-status'); s.className = 'status' + (err ? ' err' : ' ok'); s.textContent = t || ''; }
  render() {
    const body = $('mg-body'), d = this.data, comp = this.comp();
    this.status('');
    if (d && !comp) { this.quit(); return this.render(); }   // campionato eliminato dalle competizioni: carriera finita
    if (!d) {
      // nessuna carriera: si sceglie la squadra
      $('mg-title').textContent = tr('Carriera da allenatore');
      $('mg-sub').textContent = '';
      body.innerHTML = '<p class="sub">' + tr('Scegli una squadra e guidala stagione dopo stagione: campionato a 8 squadre con andata e ritorno, mercato, giovani che crescono e giocatori che invecchiano.') + '</p>' +
        '<div class="mg-teams">' + this.g.db.slice(0, MANAGER.TEAMS).map((t, i) => '<button class="mg-team" data-mg-start="' + i + '"><i class="kd" style="background:' + t.kits.home[0] + '"></i><b translate="no">' + esc(this.g.teamName(i)) + '</b><small>' + tr('Forza') + ' ' + t.rating + '</small></button>').join('') + '</div>';
      body.querySelectorAll('[data-mg-start]').forEach(b => b.onclick = () => { if (this.start(Number(b.dataset.mgStart))) { this.tab = 'squad'; this.render(); } });
      $('mg-quit').hidden = true;
      return;
    }
    $('mg-quit').hidden = false;
    $('mg-title').textContent = this.g.teamName(d.team);
    const row = this.career.table(comp).find(r => r.team === d.team);
    $('mg-sub').textContent = trf('Stagione {0}', d.season) + ' · ' + trf('Budget {0}', fmtMoney(d.budget)) + (row && row.pg ? ' · ' + trf('{0}º posto', row.pos) + ', ' + trf('{0} punti', row.pt) : '');
    const finished = comp.status === 'finished';
    let h = '<div class="actions" style="margin:0 0 14px">' +
      (finished ? '<button class="primary" id="mg-end">' + tr('Chiudi la stagione') + '</button>' : '<button class="primary" id="mg-play">' + tr('Vai al campionato') + '</button>') + '</div>';
    if (finished) h += '<p class="small">' + trf('Stagione finita: campione {0}. Chiudendola arrivano i premi, i giocatori crescono o invecchiano e parte il nuovo calendario.', esc(this.g.teamName(comp.champion))) + '</p>';
    h += '<div class="tabs">' + [['squad', 'Rosa'], ['market', 'Mercato'], ['history', 'Storico']].map(x => '<button class="tab' + (this.tab === x[0] ? ' on' : '') + '" data-mg-tab="' + x[0] + '">' + tr(x[1]) + '</button>').join('') + '</div>';
    if (this.tab === 'squad') h += this.squadHtml();
    else if (this.tab === 'market') h += this.marketHtml();
    else h += this.historyHtml();
    body.innerHTML = h;
    body.querySelectorAll('[data-mg-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.mgTab; this.pick = null; this.render(); });
    if ($('mg-play')) $('mg-play').onclick = () => this.g.comps.open(comp.id);
    if ($('mg-end')) $('mg-end').onclick = () => { const r = this.endSeason(); if (r) { this.tab = 'history'; this.render(); this.status(trf('Stagione {0} chiusa: {1}º posto, premio {2}', r.season, r.pos, fmtMoney(r.prize))); } };
    this.g.segmented && $('mg-form') && this.g.segmented('mg-form', Object.keys(FORMATIONS).map(f => ({ label: f, value: f })), d.formation, v => { d.formation = v; this.save(); this.render(); });
    body.querySelectorAll('[data-mg-row]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.mgRow);
      if (this.pick === null) { this.pick = i; this.render(); return; }
      const err = this.swap(this.pick, i);
      this.pick = null; this.render();
      if (err) this.status(err, true);
    });
    body.querySelectorAll('[data-mg-sell]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      this.g.confirmClick(b, tr('Sicuro?'), () => { const err = this.sell(Number(b.dataset.mgSell)); this.pick = null; this.render(); if (err) this.status(err, true); });
    });
    body.querySelectorAll('[data-mg-buy]').forEach(b => b.onclick = () => { const err = this.buy(Number(b.dataset.mgBuy)); this.render(); this.status(err || tr('Acquisto fatto: è nella tua rosa'), !!err); });
  }
  squadHtml() {
    const d = this.data, r = d.rosters[d.team], slots = FORMATIONS[d.formation] || FORMATIONS['4-4-2'];
    const roleShort = x => trf({ GK: 'POR', DF: 'DIF', MF: 'CEN', FW: 'ATT' }[x] || x);
    let h = '<div class="opts" style="margin:14px 0"><span class="lbl">' + tr('Formazione') + '</span><div class="segs" id="mg-form"></div></div>' +
      '<p class="small">' + tr('I primi 11 sono i titolari. Clicca un giocatore e poi un altro per scambiarli.') + '</p>' +
      '<div class="mg-head"><span>#</span><span>' + tr('Nome') + '</span><span>' + tr('Posto') + '</span><span>' + tr('Età') + '</span><span>' + tr('Forza') + '</span><span>' + tr('Potenziale') + '</span><span>' + tr('Valore') + '</span><span></span></div>';
    r.forEach((p, i) => {
      if (i === 11) h += '<div class="te-bench">' + tr('Riserve') + '</div>';
      const slot = i < 11 ? slots[i].pos : '—';
      const off = i < 11 && slots[i].role !== p.role;
      h += '<div class="mg-row' + (this.pick === i ? ' on' : '') + (off ? ' off' : '') + '" data-mg-row="' + i + '" role="button" tabindex="0">' +
        '<b>' + p.number + '</b><span translate="no">' + esc(p.name) + (p.youth ? ' <small class="pill">' + tr('vivaio') + '</small>' : '') + '</span>' +
        '<span>' + esc(tr(slot)) + ' <small>' + roleShort(p.role) + '</small></span><span>' + p.age + '</span><span><b>' + p.overall + '</b></span><span>' + p.potential + '</span>' +
        '<span>' + fmtMoney(p.value) + '</span><span><button class="ghost sm" data-mg-sell="' + i + '">' + tr('Vendi') + '</button></span></div>';
    });
    return h + '<p class="small">' + tr('Un giocatore fuori ruolo (in rosso) gioca peggio.') + '</p>';
  }
  marketHtml() {
    const d = this.data, list = this.marketList();
    const roleShort = x => trf({ GK: 'POR', DF: 'DIF', MF: 'CEN', FW: 'ATT' }[x] || x);
    if (!list.length) return '<p class="small" style="margin-top:14px">' + tr('Mercato vuoto: nuovi giocatori a fine stagione.') + '</p>';
    return '<p class="small" style="margin-top:14px">' + trf('Budget {0}. Il mercato si rinnova a ogni stagione; chi vende un giocatore lo rimpiazza con un ragazzo del vivaio.', fmtMoney(d.budget)) + '</p>' +
      '<div class="mg-head"><span></span><span>' + tr('Nome') + '</span><span>' + tr('Ruolo') + '</span><span>' + tr('Età') + '</span><span>' + tr('Forza') + '</span><span>' + tr('Potenziale') + '</span><span>' + tr('Prezzo') + '</span><span></span></div>' +
      list.map(x => '<div class="mg-row"><span></span><span translate="no">' + esc(x.p.name) + ' <small>' + (x.from >= 0 ? esc(this.g.teamName(x.from)) : tr('svincolato')) + '</small></span>' +
        '<span>' + roleShort(x.p.role) + '</span><span>' + x.p.age + '</span><span><b>' + x.p.overall + '</b></span><span>' + x.p.potential + '</span><span>' + fmtMoney(x.price) + '</span>' +
        '<span><button class="ghost sm" data-mg-buy="' + x.i + '"' + (x.price > d.budget ? ' disabled' : '') + '>' + tr('Compra') + '</button></span></div>').join('');
  }
  historyHtml() {
    const d = this.data;
    if (!d.history.length) return '<p class="small" style="margin-top:14px">' + tr('Ancora nessuna stagione conclusa.') + '</p>';
    return d.history.slice().reverse().map(r => '<div class="te-card" style="display:block"><b>' + trf('Stagione {0}', r.season) + '</b> · ' + trf('{0}º posto', r.pos) + ', ' + trf('{0} punti', r.points) +
      (r.champion === d.team ? ' · 🏆 ' + tr('Campione') : ' · ' + trf('campione {0}', esc(this.g.teamName(r.champion)))) + ' · ' + trf('premio {0}', fmtMoney(r.prize)) +
      (r.grew.length ? '<p class="small">' + trf('Cresciuti: {0}', esc(r.grew.join(', '))) + '</p>' : '') +
      (r.retired.length ? '<p class="small">' + trf('Ritirati (al loro posto un ragazzo del vivaio): {0}', esc(r.retired.join(', '))) + '</p>' : '') + '</div>').join('');
  }
}
