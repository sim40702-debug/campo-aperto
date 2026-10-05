// ============================================================
// COMPETIZIONI DELLA CARRIERA — campionato, torneo, coppe configurabili
// Le regole (calendario, classifica, tabellone, gironi, simulazione) sono in CompLogic (cloud/src/complogic.js),
// le stesse del server. Qui c'è lo stato delle competizioni del giocatore e il loro avanzamento.
// I risultati arrivano solo dal motore della partita (partita giocata) o dalla simulazione ufficiale con seme:
// non si possono scrivere a mano né "rilanciare". Si salvano sul computer e, con l'account, anche sul server.
// ============================================================

// ---------- altre squadre (oltre alle 8 del server): tutte originali ----------
const EXTRA_TEAM_TEMPLATES = [
  { name: 'Aquile del Lario', short: 'AQL', rating: 77, home: ['#0f3d6e', '#f2f2f2', '#0f3d6e'], away: ['#f2f2f2', '#0f3d6e', '#f2f2f2'] },
  { name: 'Grifoni di Lucca', short: 'GRI', rating: 75, home: ['#b8122e', '#111111', '#b8122e'], away: ['#f4d03f', '#111111', '#f4d03f'] },
  { name: 'Cervi di Sila', short: 'CER', rating: 69, home: ['#2d6a4f', '#d8f3dc', '#2d6a4f'], away: ['#d8f3dc', '#2d6a4f', '#d8f3dc'] },
  { name: 'Corsari di Levante', short: 'COR', rating: 74, home: ['#111827', '#ef4444', '#111827'], away: ['#ef4444', '#111827', '#ef4444'] },
  { name: 'Leoni di Marmo', short: 'LEO', rating: 79, home: ['#e7e5e4', '#1c1917', '#e7e5e4'], away: ['#1c1917', '#e7e5e4', '#1c1917'] },
  { name: 'Torre Nera', short: 'TOR', rating: 71, home: ['#1f1f1f', '#fbbf24', '#1f1f1f'], away: ['#fbbf24', '#1f1f1f', '#fbbf24'] },
  { name: 'Vele di Salina', short: 'VEL', rating: 66, home: ['#38bdf8', '#ffffff', '#38bdf8'], away: ['#ffffff', '#0369a1', '#ffffff'] },
  { name: 'Fiamme d\'Etna', short: 'FIA', rating: 72, home: ['#dc2626', '#f97316', '#dc2626'], away: ['#f97316', '#7f1d1d', '#f97316'] },
  { name: 'Querce di Romagna', short: 'QUE', rating: 67, home: ['#4d7c0f', '#fef9c3', '#4d7c0f'], away: ['#fef9c3', '#4d7c0f', '#fef9c3'] },
  { name: 'Arsenale Lagunare', short: 'ARS', rating: 76, home: ['#7c2d12', '#fde68a', '#7c2d12'], away: ['#fde68a', '#7c2d12', '#fde68a'] },
  { name: 'Lince Bianca', short: 'LIN', rating: 70, home: ['#f8fafc', '#334155', '#f8fafc'], away: ['#334155', '#f8fafc', '#334155'] },
  { name: 'Marinai di Ancona', short: 'MAR', rating: 68, home: ['#1e3a8a', '#fde047', '#1e3a8a'], away: ['#fde047', '#1e3a8a', '#fde047'] },
  { name: 'Pietra Serena', short: 'PIE', rating: 65, home: ['#9ca3af', '#1f2937', '#9ca3af'], away: ['#1f2937', '#9ca3af', '#1f2937'] },
  { name: 'Rondini di Tevere', short: 'RON', rating: 73, home: ['#7e22ce', '#f5f3ff', '#7e22ce'], away: ['#f5f3ff', '#7e22ce', '#f5f3ff'] },
  { name: 'Stambecchi Alpini', short: 'STB', rating: 67, home: ['#a16207', '#fefce8', '#a16207'], away: ['#fefce8', '#a16207', '#fefce8'] },
  { name: 'Ulivi di Puglia', short: 'ULI', rating: 69, home: ['#65a30d', '#1e293b', '#65a30d'], away: ['#1e293b', '#a3e635', '#1e293b'] },
  { name: 'Volpi Rosse', short: 'VOL', rating: 71, home: ['#ea580c', '#ffffff', '#ea580c'], away: ['#ffffff', '#ea580c', '#ffffff'] },
  { name: 'Cometa Azzurra', short: 'COM', rating: 78, home: ['#0ea5e9', '#0c4a6e', '#0ea5e9'], away: ['#0c4a6e', '#7dd3fc', '#0c4a6e'] },
  { name: 'Faro di Trieste', short: 'FAR', rating: 70, home: ['#ffffff', '#b91c1c', '#ffffff'], away: ['#b91c1c', '#ffffff', '#b91c1c'] },
  { name: 'Granata del Po', short: 'GRA', rating: 74, home: ['#7f1d1d', '#ffffff', '#7f1d1d'], away: ['#ffffff', '#7f1d1d', '#ffffff'] },
  { name: 'Orione', short: 'ORI', rating: 72, home: ['#312e81', '#c7d2fe', '#312e81'], away: ['#c7d2fe', '#312e81', '#c7d2fe'] },
  { name: 'Saette del Gargano', short: 'SAE', rating: 64, home: ['#facc15', '#1e40af', '#facc15'], away: ['#1e40af', '#facc15', '#1e40af'] },
  { name: 'Tritoni di Napoli', short: 'TRI', rating: 80, home: ['#22d3ee', '#083344', '#22d3ee'], away: ['#083344', '#22d3ee', '#083344'] },
  { name: 'Zefiro', short: 'ZEF', rating: 66, home: ['#a7f3d0', '#064e3b', '#a7f3d0'], away: ['#064e3b', '#a7f3d0', '#064e3b'] },
];
// generate sempre uguali (seme fisso) senza toccare la sequenza casuale del resto del gioco
function buildExtraTeams() {
  const prev = rand;
  setSeed(4242);
  try {
    return EXTRA_TEAM_TEMPLATES.map((t, i) => generateTeam(t, ['4-3-3', '4-4-2', '4-2-3-1'][i % 3]));
  } finally { rand = prev; }
}

// ---------- configurazioni pronte delle coppe (si possono creare anche coppe nuove) ----------
const CUP_PRESETS = [
  { id: 'nazionale', name: 'Coppa Nazionale', size: 16, groups: null, legs: 1, extraTime: true, penalties: true },
  { id: 'continentale', name: 'Coppa dei Campioni', size: 32, groups: { count: 8, qualify: 2, legs: 2 }, legs: 2, extraTime: true, penalties: true },
  { id: 'lampo', name: 'Coppa Lampo', size: 8, groups: null, legs: 1, extraTime: false, penalties: true },
  { id: 'tradizione', name: 'Coppa della Tradizione', size: 16, groups: null, legs: 1, extraTime: true, penalties: false },
];
const COMP_KINDS = { league: 'Campionato', tournament: 'Torneo', cup: 'Coppa' };

const CAREER_KEY = 'campoAperto.career.v1';
const CAREER_MAX_COMPS = 12;

class Career {
  // db: squadre del gioco (indice = identificativo); nameOf(i): nome della squadra (anche personalizzato)
  constructor(db, nameOf) {
    this.db = db; this.nameOf = nameOf || (i => db[i] ? db[i].name : '?');
    this.listeners = [];
    this.data = { v: 1, comps: [], updatedAt: 0 };
    this.profiles = new Map();
    try {
      const raw = localStorage.getItem(CAREER_KEY);
      if (raw) this.data = this.clean(JSON.parse(raw)) || this.data;
    } catch (e) { /* archivio non leggibile: si riparte vuoti */ }
  }
  onChange(fn) { this.listeners.push(fn); }
  // dati letti dal disco o dal server: solo competizioni ben formate, squadre esistenti
  clean(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.comps)) return null;
    const n = this.db.length;
    const okTeam = t => Number.isInteger(t) && t >= 0 && t < n;
    const comps = d.comps.filter(c => c && typeof c === 'object' && COMP_KINDS[c.kind] && Array.isArray(c.fixtures) && c.config &&
      Array.isArray(c.config.teams) && c.config.teams.every(okTeam) && c.fixtures.every(f => f && okTeam(f.home) && okTeam(f.away))).slice(0, CAREER_MAX_COMPS);
    return { v: 1, comps: comps, updatedAt: Number(d.updatedAt) || 0 };
  }
  save(silent, keepTime) {
    if (!keepTime) this.data.updatedAt = Date.now();
    try { localStorage.setItem(CAREER_KEY, JSON.stringify(this.data)); } catch (e) { /* spazio pieno: resta in memoria */ }
    if (!silent) for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } }
  }
  // sostituisce tutto (dati più recenti dall'account)
  // (con la data di quei dati: non è una modifica fatta qui)
  replace(d) { const c = this.clean(d); if (!c) return false; this.data = c; this.profiles.clear(); this.save(true, true); this.replaced = true; for (const fn of this.listeners) fn(this); this.replaced = false; return true; }
  get comps() { return this.data.comps; }
  byId(id) { return this.data.comps.find(c => c.id === id) || null; }
  profile(t) {
    if (!this.profiles.has(t)) this.profiles.set(t, CompLogic.teamProfile(this.db[t]));
    return this.profiles.get(t);
  }
  strength(t) { const p = this.profile(t); return p.ovr; }

  // ---------- creazione ----------
  // cfg: { kind, name, teams: [indici], userTeam (-1 = nessuna), legs, groups: {count, qualify, legs} | null,
  //        extraTime, penalties, halfSeconds, difficulty }
  create(cfg) {
    const kind = COMP_KINDS[cfg.kind] ? cfg.kind : 'league';
    const teams = [...new Set(cfg.teams)].filter(t => Number.isInteger(t) && t >= 0 && t < this.db.length);
    if (kind === 'league' && (teams.length < 4 || teams.length > 32)) throw new Error('Un campionato vuole da 4 a 32 squadre');
    if (kind !== 'league' && !CompLogic.isPow2(teams.length) && !(cfg.groups && cfg.groups.count)) throw new Error('Il tabellone vuole 4, 8, 16 o 32 squadre');
    if (this.data.comps.length >= CAREER_MAX_COMPS) throw new Error('Troppe competizioni salvate: eliminane una');
    const config = {
      teams: teams, userTeam: teams.indexOf(cfg.userTeam) >= 0 ? cfg.userTeam : -1,
      legs: cfg.legs === 2 ? 2 : 1,
      groups: kind === 'cup' && cfg.groups && cfg.groups.count ? { count: cfg.groups.count | 0, qualify: Math.max(1, cfg.groups.qualify | 0), legs: cfg.groups.legs === 2 ? 2 : 1 } : null,
      extraTime: cfg.extraTime !== false, penalties: cfg.penalties !== false,
      halfSeconds: [120, 180, 300].includes(cfg.halfSeconds) ? cfg.halfSeconds : 180,
      difficulty: [0, 1, 2].includes(cfg.difficulty) ? cfg.difficulty : 1,
    };
    if (kind === 'tournament') config.legs = 1;
    if (config.groups) {
      const per = teams.length / config.groups.count;
      if (!Number.isInteger(per) || per < 3) throw new Error('Le squadre devono dividersi in gironi da almeno 3');
      if (!CompLogic.isPow2(config.groups.count * config.groups.qualify)) throw new Error('Le qualificate devono essere 4, 8, 16 o 32');
    }
    const comp = {
      id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      kind: kind, name: String(cfg.name || COMP_KINDS[kind]).replace(/[<>]/g, '').trim().slice(0, 40) || COMP_KINDS[kind],
      season: 1, config: config, history: [], createdAt: Date.now(),
    };
    this.startSeason(comp, Math.floor(Math.random() * 2 ** 31) || 1);
    this.data.comps.unshift(comp);
    this.save();
    return comp;
  }
  remove(id) { this.data.comps = this.data.comps.filter(c => c.id !== id); this.save(); }

  // nuova stagione (o edizione): stesse squadre e regole, nuovo calendario/sorteggio, lo storico resta
  startSeason(comp, seed) {
    comp.seed = seed >>> 0 || 1;
    comp.fixtures = []; comp.nextId = 1;
    comp.status = 'active'; comp.champion = null; comp.summary = null; comp.userOut = false;
    comp.groups = null; comp.bracket = null; comp.stage = null;
    const cfg = comp.config, rng = CompLogic.compRng(CompLogic.seedFor(comp.seed, 'sorteggio'));
    if (comp.kind === 'league') {
      comp.stage = 'league';
      const order = this.shuffle(cfg.teams, rng);
      CompLogic.roundRobin(order, cfg.legs).forEach((games, r) => games.forEach(g => this.addFixture(comp, { stage: 'league', round: r, home: g.home, away: g.away })));
    } else if (cfg.groups) {
      comp.stage = 'groups';
      comp.groups = CompLogic.drawGroups(cfg.teams, t => this.strength(t), cfg.groups.count, rng);
      comp.groups.forEach((g, gi) => CompLogic.roundRobin(g, cfg.groups.legs).forEach((games, r) =>
        games.forEach(x => this.addFixture(comp, { stage: 'group', group: gi, round: r, home: x.home, away: x.away }))));
    } else {
      this.startKnockout(comp, CompLogic.drawBracket(cfg.teams, rng));
    }
  }
  newSeason(id) {
    const comp = this.byId(id);
    if (!comp || comp.status !== 'finished') return null;
    comp.season++;
    this.startSeason(comp, CompLogic.seedFor(comp.seed, 'stagione' + comp.season));
    this.save();
    return comp;
  }
  shuffle(arr, rng) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  addFixture(comp, f) {
    const fx = Object.assign({ id: 'f' + (comp.nextId++), played: false }, f);
    comp.fixtures.push(fx);
    return fx;
  }
  startKnockout(comp, seeds) {
    comp.stage = 'knockout';
    comp.bracket = CompLogic.buildBracket(seeds, { legs: comp.kind === 'cup' ? comp.config.legs : 1 });
    this.createTieFixtures(comp, 0);
  }
  // partite di un turno del tabellone: gara unica (la finale sempre) o andata e ritorno
  createTieFixtures(comp, r) {
    const round = comp.bracket[r];
    round.ties.forEach((t, i) => {
      if (t.fixtures.length) return;
      const neutral = round.size === 2;
      t.fixtures.push(this.addFixture(comp, { stage: 'ko', round: r, tie: i, leg: 1, home: t.a, away: t.b, neutral: neutral }).id);
      if (t.legs === 2) t.fixtures.push(this.addFixture(comp, { stage: 'ko', round: r, tie: i, leg: 2, home: t.b, away: t.a }).id);
    });
  }

  // ---------- consultazione ----------
  fixture(comp, id) { return comp.fixtures.find(f => f.id === id) || null; }
  // giornata o turno in corso: le partite ancora da giocare con il numero di turno più basso (e la fase attuale)
  currentRound(comp) {
    const open = comp.fixtures.filter(f => !f.played);
    if (!open.length) return null;
    const stageRank = { league: 0, group: 0, ko: 1 };
    open.sort((a, b) => stageRank[a.stage] - stageRank[b.stage] || a.round - b.round || (a.leg || 1) - (b.leg || 1) || (a.replay ? 1 : 0) - (b.replay ? 1 : 0));
    const f0 = open[0];
    const same = open.filter(f => f.stage === f0.stage && f.round === f0.round && (f.leg || 1) === (f0.leg || 1) && !!f.replay === !!f0.replay);
    return { stage: f0.stage, round: f0.round, leg: f0.leg || 1, replay: !!f0.replay, fixtures: same };
  }
  roundLabel(comp, cr) {
    if (!cr) return '';
    if (cr.stage === 'league') return 'Giornata ' + (cr.round + 1);
    if (cr.stage === 'group') return 'Fase a gironi, giornata ' + (cr.round + 1);
    const r = comp.bracket[cr.round];
    return (r ? r.name : 'Turno') + (cr.replay ? ', ripetizioni' : r && r.ties[0] && r.ties[0].legs === 2 ? (cr.leg === 1 ? ', andata' : ', ritorno') : '');
  }
  userFixture(comp, cr) {
    const u = comp.config.userTeam;
    if (!cr || u < 0) return null;
    return cr.fixtures.find(f => f.home === u || f.away === u) || null;
  }
  results(comp, stage, group) {
    return comp.fixtures.filter(f => f.played && f.stage === stage && (group === undefined || f.group === group))
      .map(f => ({ home: f.home, away: f.away, h: f.h, a: f.a }));
  }
  table(comp) { return CompLogic.standings(comp.config.teams, this.results(comp, 'league')); }
  groupTables(comp) { return (comp.groups || []).map((g, gi) => CompLogic.standings(g, this.results(comp, 'group', gi))); }
  // punti per partita nelle ultime 5 (forma) per la simulazione
  formOf(comp, t) {
    const last = comp.fixtures.filter(f => f.played && (f.home === t || f.away === t)).slice(-5);
    if (!last.length) return 1.4;
    return last.reduce((s, f) => { const gf = f.home === t ? f.h : f.a, gs = f.home === t ? f.a : f.h; return s + (gf > gs ? 3 : gf === gs ? 1 : 0); }, 0) / last.length;
  }
  progress(comp) {
    const total = comp.fixtures.length, played = comp.fixtures.filter(f => f.played).length;
    return { played: played, total: total };
  }
  // gol dell'andata per il ritorno, dal punto di vista della partita di ritorno [casa, trasferta]
  aggregateFor(comp, f) {
    if (f.stage !== 'ko' || f.leg !== 2) return [0, 0];
    const tie = comp.bracket[f.round].ties[f.tie];
    const first = this.fixture(comp, tie.fixtures[0]);
    if (!first || !first.played) return [0, 0];
    const g = (m, t) => (m.home === t ? m.h + (m.et ? m.et.h : 0) : m.a + (m.et ? m.et.a : 0));
    return [g(first, f.home), g(first, f.away)];
  }
  // regole di una partita: in eliminazione diretta serve un vincitore (tranne l'andata)
  matchRules(comp, f) {
    if (f.stage !== 'ko') return null;
    const tie = comp.bracket[f.round].ties[f.tie];
    if (tie.legs === 2 && f.leg === 1 && !f.replay) return null;
    return { extraTime: comp.config.extraTime, penalties: comp.config.penalties, aggregate: f.replay ? [0, 0] : this.aggregateFor(comp, f), neutral: !!f.neutral };
  }

  // ---------- risultati ----------
  // simulazione ufficiale: seme della competizione + partita, quindi sempre lo stesso risultato
  simulate(comp, f, opts) {
    const ko = this.matchRules(comp, f);
    const rng = CompLogic.compRng(CompLogic.seedFor(comp.seed, f.id + (opts && opts.salt ? ':' + opts.salt : '')));
    const r = CompLogic.simulateMatch(this.profile(f.home), this.profile(f.away), rng, Object.assign({
      formHome: this.formOf(comp, f.home), formAway: this.formOf(comp, f.away), neutral: !!f.neutral,
    }, ko ? { knockout: true, extraTime: ko.extraTime, penalties: ko.penalties, aggregate: ko.aggregate } : {}));
    return r;
  }
  // registra un risultato (partita giocata o simulata) e fa avanzare la competizione
  record(comp, fid, r, how) {
    const f = this.fixture(comp, fid);
    if (!f || f.played) return false;
    Object.assign(f, {
      played: true, how: how, at: Date.now(), inProgress: undefined,
      h: r.h | 0, a: r.a | 0, et: r.et ? { h: r.et.h | 0, a: r.et.a | 0 } : null, pens: r.pens ? { h: r.pens.h | 0, a: r.pens.a | 0 } : null,
      winner: r.winner === 0 || r.winner === 1 ? r.winner : null,
      scorers: (r.scorers || []).slice(0, 30).map(s => ({ team: s.team === 1 ? 1 : 0, name: String(s.name || '').slice(0, 40), minute: s.minute | 0 })),
    });
    this.advance(comp);
    this.save();
    return true;
  }
  simulateFixture(comp, fid) {
    const f = this.fixture(comp, fid);
    if (!f || f.played) return null;
    return this.record(comp, fid, this.simulate(comp, f), 'sim') ? f : null;
  }
  // simula la giornata in corso (except: partita da lasciare al giocatore)
  simulateRound(comp, except) {
    const cr = this.currentRound(comp);
    if (!cr) return 0;
    let n = 0;
    for (const f of cr.fixtures) if (f.id !== except && !f.played) { this.record(comp, f.id, this.simulate(comp, f), 'sim'); n++; }
    return n;
  }
  // fino alla fine (squadra eliminata o nessuna squadra del giocatore)
  simulateToEnd(comp) {
    let guard = 0;
    while (comp.status === 'active' && guard++ < 2000) { const cr = this.currentRound(comp); if (!cr) break; this.simulateRound(comp); }
  }

  // ---------- avanzamento ----------
  advance(comp) {
    const cfg = comp.config;
    if (comp.stage === 'league') {
      if (comp.fixtures.every(f => f.played)) this.finish(comp, this.table(comp)[0].team);
      return;
    }
    if (comp.stage === 'groups') {
      const group = comp.fixtures.filter(f => f.stage === 'group');
      if (!group.every(f => f.played)) return;
      const tables = this.groupTables(comp);
      comp.groupFinal = tables.map(t => t.map(r => r.team));
      const qualified = new Set(tables.flatMap(t => t.slice(0, cfg.groups.qualify).map(r => r.team)));
      if (cfg.userTeam >= 0 && !qualified.has(cfg.userTeam)) comp.userOut = true;
      this.startKnockout(comp, CompLogic.knockoutSeedsFromGroups(tables, cfg.groups.qualify));
      return;
    }
    if (comp.stage !== 'knockout') return;
    for (let r = 0; r < comp.bracket.length; r++) {
      const round = comp.bracket[r];
      let allDone = true;
      round.ties.forEach((t, i) => {
        if (t.winner !== null && t.winner !== undefined) return;
        if (t.a === null || t.b === null) { allDone = false; return; }
        const ms = t.fixtures.map(id => this.fixture(comp, id));
        if (ms.some(m => !m.played)) { allDone = false; return; }
        const out = CompLogic.tieOutcome(t, ms);
        if (out) {
          CompLogic.advanceBracket(comp.bracket, r, i, out.winner);
          t.agg = out.agg;
          const loser = out.winner === t.a ? t.b : t.a;
          if (loser === cfg.userTeam) comp.userOut = true;
        } else {
          // parità senza rigori: si ripete in casa dell'altra squadra
          const last = ms[ms.length - 1];
          t.fixtures.push(this.addFixture(comp, { stage: 'ko', round: r, tie: i, leg: (last.leg || 1) + 1, replay: true, home: last.away, away: last.home, neutral: !!last.neutral }).id);
          allDone = false;
        }
      });
      if (!allDone) return;
      if (r + 1 < comp.bracket.length) this.createTieFixtures(comp, r + 1);
      else { this.finish(comp, round.ties[0].winner); return; }
    }
  }
  finish(comp, champion) {
    comp.status = 'finished';
    comp.champion = champion;
    const table = comp.kind === 'league' ? this.table(comp) : CompLogic.standings(comp.config.teams, comp.fixtures.filter(f => f.played).map(f => ({ home: f.home, away: f.away, h: f.h + (f.et ? f.et.h : 0), a: f.a + (f.et ? f.et.a : 0) })));
    comp.summary = CompLogic.seasonSummary(table, comp.fixtures, this.nameOf);
    comp.summary.champion = champion;
    comp.summary.season = comp.season;
    if (comp.kind !== 'league') {
      const fin = comp.fixtures.filter(f => f.stage === 'ko' && f.round === comp.bracket.length - 1 && f.played).pop();
      if (fin) comp.summary.final = { home: fin.home, away: fin.away, h: fin.h, a: fin.a, et: fin.et, pens: fin.pens };
    }
    comp.history = (comp.history || []).concat([{ season: comp.season, champion: champion, summary: comp.summary }]).slice(-20);
  }

  // ---------- partite giocate dal giocatore ----------
  // all'avvio: segnata "in corso", così chiudere il gioco a metà non permette di rigiocarla (si simula)
  markInProgress(comp, fid) { const f = this.fixture(comp, fid); if (f && !f.played) { f.inProgress = Date.now(); this.save(true); } }
  clearInProgress(comp, fid) { const f = this.fixture(comp, fid); if (f) { delete f.inProgress; this.save(true); } }
  // partite lasciate a metà (gioco chiuso): risultato dalla simulazione ufficiale
  resolveAbandoned() {
    let n = 0;
    for (const c of this.data.comps) for (const f of c.fixtures) if (!f.played && f.inProgress) { this.record(c, f.id, this.simulate(c, f, { salt: 'abbandonata' }), 'sim'); n++; }
    return n;
  }
  // partita abbandonata dal menu: il tempo che manca si simula partendo dal punteggio attuale
  finishFromScore(comp, fid, score, fraction, scorers) {
    const f = this.fixture(comp, fid);
    if (!f || f.played) return null;
    const rest = this.simulate(comp, f, { salt: 'resto' });
    const k = clamp(1 - fraction, 0, 1);
    const extra = side => (side === 0 ? rest.h : rest.a) * k;
    const rnd = CompLogic.compRng(CompLogic.seedFor(comp.seed, f.id + ':resto2'));
    const add = side => { const x = extra(side); return Math.floor(x) + (rnd() < x - Math.floor(x) ? 1 : 0); };
    const h = score[0] + add(0), a = score[1] + add(1);
    const ko = this.matchRules(comp, f);
    const r = { h: h, a: a, et: null, pens: null, winner: h > a ? 0 : h < a ? 1 : null, scorers: scorers || [] };
    if (ko) {
      const agg = ko.aggregate, lvl = h + agg[0] === a + agg[1];
      if (lvl) { r.et = ko.extraTime ? { h: 0, a: 0 } : null; if (ko.penalties) { r.pens = rest.pens || { h: 5, a: 4 }; r.winner = rest.pens ? rest.winner : 0; } else r.winner = null; }
      else r.winner = h + agg[0] > a + agg[1] ? 0 : 1;
    }
    this.record(comp, fid, r, 'abbandonata');
    return f;
  }

  // ---------- riepilogo per il cruscotto ----------
  overview(comp) {
    const u = comp.config.userTeam, cr = this.currentRound(comp);
    const out = { id: comp.id, kind: comp.kind, name: comp.name, season: comp.season, status: comp.status, userTeam: u, userOut: !!comp.userOut,
      round: this.roundLabel(comp, cr), progress: this.progress(comp), champion: comp.champion };
    const next = this.userFixture(comp, cr);
    out.next = next ? { id: next.id, home: next.home, away: next.away } : null;
    if (u >= 0) {
      const last = comp.fixtures.filter(f => f.played && (f.home === u || f.away === u)).sort((a, b) => (a.at || 0) - (b.at || 0)).pop();
      out.last = last ? { home: last.home, away: last.away, h: last.h, a: last.a, et: last.et, pens: last.pens } : null;
      if (comp.kind === 'league') { const row = this.table(comp).find(r => r.team === u); out.position = row ? row.pos : null; out.points = row ? row.pt : 0; }
      else if (comp.stage === 'groups') { const gi = comp.groups.findIndex(g => g.indexOf(u) >= 0); const row = gi >= 0 ? this.groupTables(comp)[gi].find(r => r.team === u) : null; out.position = row ? row.pos : null; out.group = gi >= 0 ? CompLogic.GROUP_LETTERS[gi] : null; }
    }
    return out;
  }
}
