// ============================================================
// COMPETIZIONI DELLA CARRIERA — campionato, torneo, coppe configurabili
// Le regole (calendario, classifica, tabellone, gironi, simulazione) sono in CompLogic (cloud/src/complogic.js),
// le stesse del server. Qui c'è lo stato delle competizioni del giocatore e il loro avanzamento.
// I risultati arrivano solo dal motore della partita (partita giocata) o dalla simulazione ufficiale con seme:
// non si possono scrivere a mano né "rilanciare". Si salvano sul computer e, con l'account, anche sul server.
// ============================================================

// ---------- configurazioni pronte delle coppe (si possono creare anche coppe nuove) ----------
const CUP_PRESETS = [
  { id: 'nazionale', name: 'Coppa Nazionale', size: 16, groups: null, legs: 1, extraTime: true, penalties: true },
  { id: 'continentale', name: 'Coppa dei Campioni', size: 32, groups: { count: 8, qualify: 2, legs: 2 }, legs: 2, extraTime: true, penalties: true },
  { id: 'lampo', name: 'Coppa Lampo', size: 8, groups: null, legs: 1, extraTime: false, penalties: true },
  { id: 'tradizione', name: 'Coppa della Tradizione', size: 16, groups: null, legs: 1, extraTime: true, penalties: false },
];
const COMP_KINDS = CompLogic.COMP_KINDS;

const CAREER_KEY = 'campoAperto.career.v1';
const CAREER_MAX_COMPS = 12;

// Competizioni sul computer. Calendario, risultati e avanzamento sono in CompLogic (le stesse funzioni delle
// competizioni tra amici sul server): qui ci sono l'archivio, il salvataggio e le partite del giocatore.
class Career {
  // db: squadre del gioco (indice = identificativo); nameOf(i): nome della squadra (anche personalizzato)
  constructor(db, nameOf) {
    this.db = db; this.nameOf = nameOf || (i => db[i] ? db[i].name : '?');
    this.listeners = [];
    this.data = { v: 1, comps: [], updatedAt: 0 };
    this.profiles = new Map();
    this.ctx = { profile: t => this.profile(t), nameOf: t => this.nameOf(t) };
    // carriera da allenatore (src/game/24_manager.js): le sue competizioni usano le rose che cambiano di stagione in stagione
    this.rosterTeam = null;   // (comp, t) -> squadra con la rosa della carriera, oppure null
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
  // contesto delle regole per una competizione: quella della carriera da allenatore usa le sue rose
  ctxFor(comp) {
    if (!comp || !comp.manager || !this.rosterTeam) return this.ctx;
    return { profile: t => CompLogic.teamProfile(this.rosterTeam(comp, t) || this.db[t]), nameOf: this.ctx.nameOf };
  }

  // ---------- creazione ----------
  // cfg: { kind, name, teams: [indici], userTeam (-1 = nessuna), legs, groups: {count, qualify, legs} | null,
  //        extraTime, penalties, halfSeconds, difficulty }
  create(cfg) {
    const made = CompLogic.makeCompConfig(cfg, this.db.length);
    if (this.data.comps.length >= CAREER_MAX_COMPS) throw new Error('Troppe competizioni salvate: eliminane una');
    const comp = {
      id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      kind: made.kind, name: made.name, season: 1, config: made.config, history: [], createdAt: Date.now(),
    };
    if (cfg.manager) comp.manager = true;   // competizione della carriera da allenatore
    this.startSeason(comp, Math.floor(Math.random() * 2 ** 31) || 1);
    this.data.comps.unshift(comp);
    this.save();
    return comp;
  }
  remove(id) { this.data.comps = this.data.comps.filter(c => c.id !== id); this.save(); }
  startSeason(comp, seed) { CompLogic.startSeason(comp, seed, this.ctxFor(comp)); }
  newSeason(id) {
    const comp = this.byId(id);
    if (!comp || !CompLogic.nextSeason(comp, this.ctxFor(comp))) return null;
    this.save();
    return comp;
  }

  // ---------- consultazione ----------
  fixture(comp, id) { return CompLogic.findFixture(comp, id); }
  currentRound(comp) { return CompLogic.currentRound(comp); }
  roundLabel(comp, cr) { return CompLogic.roundLabel(comp, cr); }
  userFixture(comp, cr) {
    const u = comp.config.userTeam;
    if (!cr || u < 0) return null;
    return cr.fixtures.find(f => f.home === u || f.away === u) || null;
  }
  table(comp) { return CompLogic.leagueTable(comp); }
  groupTables(comp) { return CompLogic.groupTables(comp); }
  formOf(comp, t) { return CompLogic.formOf(comp, t); }
  progress(comp) { return CompLogic.compProgress(comp); }
  aggregateFor(comp, f) { return CompLogic.aggregateFor(comp, f); }
  matchRules(comp, f) { return CompLogic.matchRules(comp, f); }

  // ---------- risultati ----------
  // simulazione ufficiale: seme della competizione + partita, quindi sempre lo stesso risultato
  simulate(comp, f, opts) { return CompLogic.simulateFixture(comp, f, this.ctxFor(comp), opts && opts.salt); }
  // registra un risultato (partita giocata o simulata) e fa avanzare la competizione
  record(comp, fid, r, how) {
    if (!CompLogic.recordResult(comp, fid, r, how, Date.now(), this.ctxFor(comp))) return false;
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
    const n = CompLogic.simulateCurrentRound(comp, this.ctxFor(comp), Date.now(), f => f.id === except);
    if (n) this.save();
    return n;
  }
  // fino alla fine (squadra eliminata o nessuna squadra del giocatore)
  simulateToEnd(comp) {
    let guard = 0;
    while (comp.status === 'active' && guard++ < 2000) { if (!CompLogic.currentRound(comp)) break; CompLogic.simulateCurrentRound(comp, this.ctxFor(comp), Date.now()); }
    this.save();
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
    this.record(comp, fid, CompLogic.resultFromScore(comp, f, score, fraction, scorers, this.ctxFor(comp)), 'abbandonata');
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
