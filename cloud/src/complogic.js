// Regole delle competizioni: calendario all'italiana, classifica, tabellone a eliminazione diretta, gironi,
// simulazione statistica di una partita. Lo stesso file gira nel server (campionato del server per le scommesse) e
// nel gioco (carriera: campionato, torneo, coppe), dove build.js lo include come oggetto CompLogic.
// Tutto è deterministico: stessi dati e stesso seme danno sempre lo stesso risultato (niente risultati da "rilanciare").

// ---------- numeri casuali con seme ----------
export function compRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// seme derivato da un seme e da un'etichetta (FNV-1a): ogni partita ha il suo, indipendente dall'ordine di gioco
export function seedFor(seed, label) {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  const s = String(label);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) || 1;
}
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// ---------- calendario all'italiana (metodo del cerchio) ----------
// teams: identificativi. Restituisce i turni: [[{home, away}, ...], ...]. Con un numero dispari una squadra riposa
// a ogni turno. legs = 2: girone di ritorno con casa e trasferta invertite, nello stesso ordine.
// Ogni squadra gioca una volta per turno, mai contro sé stessa, ogni coppia una volta per girone.
export function roundRobin(teams, legs) {
  const list = teams.slice();
  if (list.length < 2) return [];
  if (list.length % 2) list.push(null);
  const n = list.length, half = n / 2;
  const rounds = [];
  let ring = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const order = [list[0]].concat(ring);
    const games = [];
    for (let i = 0; i < half; i++) {
      const a = order[i], b = order[n - 1 - i];
      if (a === null || b === null) continue;
      // casa e trasferta equilibrate: la squadra fissa alterna a ogni turno; nelle altre coppie gioca in casa chi sta
      // nella riga in alto del cerchio (ogni squadra ci passa metà dei turni)
      const swap = i === 0 && r % 2 === 1;
      games.push(swap ? { home: b, away: a } : { home: a, away: b });
    }
    rounds.push(games);
    ring = [ring[ring.length - 1]].concat(ring.slice(0, -1));
  }
  if (legs === 2) {
    const back = rounds.map(g => g.map(x => ({ home: x.away, away: x.home })));
    return rounds.concat(back);
  }
  return rounds;
}

// ---------- classifica ----------
// results: [{ home, away, h, a }] (solo partite giocate). Punti: vittoria 3, pareggio 1, sconfitta 0.
// Ordine: punti, poi scontri diretti tra le squadre a pari punti (punti, differenza reti), differenza reti, gol fatti,
// vittorie, e infine l'ordine di partenza (stabile).
export const POINTS = { win: 3, draw: 1, loss: 0 };
function emptyRow(team) {
  return { team: team, pg: 0, v: 0, n: 0, p: 0, gf: 0, gs: 0, dr: 0, pt: 0, form: [], cleanSheets: 0, winPct: 0, streak: '' };
}
function addResult(row, gf, gs) {
  row.pg++; row.gf += gf; row.gs += gs; row.dr = row.gf - row.gs;
  const r = gf > gs ? 'V' : gf === gs ? 'N' : 'P';
  if (r === 'V') { row.v++; row.pt += POINTS.win; } else if (r === 'N') { row.n++; row.pt += POINTS.draw; } else row.p++;
  if (gs === 0) row.cleanSheets++;
  row.form.push(r);
}
function miniTable(teams, results) {
  const rows = new Map(teams.map(t => [t, emptyRow(t)]));
  for (const m of results) {
    if (!rows.has(m.home) || !rows.has(m.away)) continue;
    addResult(rows.get(m.home), m.h, m.a); addResult(rows.get(m.away), m.a, m.h);
  }
  return rows;
}
export function standings(teams, results) {
  const order = new Map(teams.map((t, i) => [t, i]));
  const rows = miniTable(teams, results);
  // forma e serie dall'ordine cronologico delle partite
  for (const r of rows.values()) {
    r.winPct = r.pg ? Math.round(r.v / r.pg * 1000) / 10 : 0;
    const f = r.form;
    if (f.length) { let k = 1; while (k < f.length && f[f.length - 1 - k] === f[f.length - 1]) k++; r.streak = f[f.length - 1] + k; }
    r.form = f.slice(-5);
  }
  const list = [...rows.values()];
  list.sort((a, b) => b.pt - a.pt || order.get(a.team) - order.get(b.team));
  // gruppi a pari punti: scontri diretti
  const out = [];
  for (let i = 0; i < list.length;) {
    let j = i; while (j < list.length && list[j].pt === list[i].pt) j++;
    const group = list.slice(i, j);
    if (group.length > 1) {
      const ids = group.map(r => r.team), set = new Set(ids);
      const h2h = miniTable(ids, results.filter(m => set.has(m.home) && set.has(m.away)));
      group.sort((a, b) => {
        const x = h2h.get(a.team), y = h2h.get(b.team);
        return y.pt - x.pt || y.dr - x.dr || b.dr - a.dr || b.gf - a.gf || b.v - a.v || order.get(a.team) - order.get(b.team);
      });
    }
    out.push(...group);
    i = j;
  }
  out.forEach((r, i) => { r.pos = i + 1; });
  return out;
}

// ---------- eliminazione diretta ----------
export function roundName(teamsLeft) {
  return { 2: 'Finale', 4: 'Semifinali', 8: 'Quarti di finale', 16: 'Ottavi di finale', 32: 'Sedicesimi di finale', 64: 'Trentaduesimi' }[teamsLeft] || ('Turno a ' + teamsLeft);
}
export function isPow2(n) { return n >= 2 && (n & (n - 1)) === 0; }
// tabellone vuoto per n squadre (potenza di 2): un turno per livello, sfide collegate (il vincente di due sfide
// del turno prima si incontrano). seeds: squadre in ordine di tabellone (accoppiate 0-1, 2-3, ...).
export function buildBracket(seeds, opts) {
  opts = opts || {};
  if (!isPow2(seeds.length)) throw new Error('il tabellone vuole 2, 4, 8, 16, 32 o 64 squadre');
  const rounds = [];
  let size = seeds.length;
  while (size >= 2) {
    const ties = [];
    for (let i = 0; i < size / 2; i++) {
      const legs = size === 2 ? 1 : (opts.legs || 1);   // la finale è sempre in gara unica
      ties.push({ id: 'k' + rounds.length + '-' + i, round: rounds.length, a: null, b: null, legs: legs, winner: null, fixtures: [] });
    }
    rounds.push({ name: roundName(size), size: size, ties: ties });
    size /= 2;
  }
  rounds[0].ties.forEach((t, i) => { t.a = seeds[2 * i]; t.b = seeds[2 * i + 1]; });
  return rounds;
}
// sorteggio del tabellone: squadre in ordine casuale (con il seme)
export function drawBracket(teams, rng) { return shuffled(teams, rng); }

// esito di una sfida dalle sue partite giocate. matches: [{ home, away, h, a, et, pens, winner }] in ordine.
// Gara unica: vince chi vince la partita (supplementari e rigori compresi). Andata e ritorno: somma dei gol;
// in parità decidono supplementari e rigori del ritorno. Restituisce { winner, agg } o null se non è finita.
export function tieOutcome(tie, matches) {
  const done = matches.filter(m => m && m.played);
  if (!done.length) return null;
  const last = done[done.length - 1];
  if (last.replay || tie.legs === 1) {
    if (last.winner === undefined || last.winner === null) return null;
    return { winner: last.winner === 0 ? last.home : last.away, agg: null };
  }
  if (done.length < tie.legs) return null;
  const goals = t => done.reduce((s, m) => s + (m.home === t ? m.h + (m.et ? m.et.h : 0) : m.away === t ? m.a + (m.et ? m.et.a : 0) : 0), 0);
  const ga = goals(tie.a), gb = goals(tie.b);
  if (ga !== gb) return { winner: ga > gb ? tie.a : tie.b, agg: [ga, gb] };
  if (last.winner === undefined || last.winner === null) return null;   // parità senza rigori: serve la ripetizione
  return { winner: last.winner === 0 ? last.home : last.away, agg: [ga, gb] };
}
// porta il vincente nella sfida successiva
export function advanceBracket(rounds, r, i, winner) {
  const t = rounds[r].ties[i];
  t.winner = winner;
  if (r + 1 < rounds.length) {
    const next = rounds[r + 1].ties[Math.floor(i / 2)];
    if (i % 2 === 0) next.a = winner; else next.b = winner;
  }
}

// ---------- gironi ----------
// sorteggio con fasce: le squadre ordinate per forza vengono divise in fasce, una squadra per fascia in ogni girone
export function drawGroups(teams, strength, groupCount, rng) {
  const size = teams.length / groupCount;
  if (!Number.isInteger(size) || size < 2) throw new Error('le squadre devono dividersi in gironi uguali');
  const sorted = teams.slice().sort((a, b) => strength(b) - strength(a));
  const groups = Array.from({ length: groupCount }, () => []);
  for (let p = 0; p < size; p++) {
    const pot = shuffled(sorted.slice(p * groupCount, (p + 1) * groupCount), rng);
    pot.forEach((t, g) => groups[g].push(t));
  }
  return groups;
}
export const GROUP_LETTERS = 'ABCDEFGHIJKLMNOP';
// accoppiamenti dopo i gironi: le prime contro le seconde di un altro girone (A1-B2, B1-A2, C1-D2, ...);
// con una qualificata per girone, tabellone in ordine di girone
export function knockoutSeedsFromGroups(tables, qualify) {
  const G = tables.length;
  if (qualify === 1) return tables.map(t => t[0].team);
  const seeds = [];
  for (let g = 0; g < G; g += 2) {
    const A = tables[g], B = tables[g + 1] || tables[0];
    seeds.push(A[0].team, B[1].team, B[0].team, A[1].team);
  }
  if (qualify > 2) for (let q = 2; q < qualify; q++) for (const t of tables) seeds.push(t[q].team);
  return seeds;
}

// ---------- simulazione statistica ----------
// Forza dalle rose vere: attacco (attaccanti e centrocampisti), difesa (difensori e portiere), media della squadra.
// Ogni squadra segna secondo una distribuzione di Poisson: la media dipende dalla differenza tra il suo attacco e la
// difesa avversaria, dal fattore campo e dalla forma recente. La più forte vince più spesso, ma non sempre.
export const SIM = { baseHome: 1.42, baseAway: 1.13, k: 0.052, formK: 0.05, etShare: 1 / 3 };
export function teamProfile(team) {
  const xi = (team.players || []).slice(0, 11);
  const avg = (ps, f) => ps.length ? ps.reduce((s, p) => s + f(p), 0) / ps.length : 60;
  const fw = xi.filter(p => p.role === 'FW' || p.role === 'MF'), df = xi.filter(p => p.role === 'DF'), gk = xi.find(p => p.role === 'GK');
  const att = avg(fw, p => (p.attr.shot + p.attr.pass + p.attr.dribble + p.attr.speed) / 4);
  const def = avg(df, p => (p.attr.defense * 2 + p.attr.physical + p.attr.speed) / 4) * 0.8 + (gk ? gk.attr.gk : 60) * 0.2;
  return {
    att: att, def: def, ovr: avg(xi, p => p.overall), gk: gk ? gk.attr.gk : 60,
    shooters: xi.filter(p => p.role !== 'GK').map((p, i) => ({ name: p.name, w: p.role === 'FW' ? 3 + p.attr.shot / 40 : p.role === 'MF' ? 1.4 + p.attr.shot / 60 : 0.45, shot: p.attr.shot })),
  };
}
function poisson(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L && k < 15);
  return k - 1;
}
// form: punti per partita nelle ultime 5 (0..3), 1.4 se non nota
export function expectedGoals(home, away, ctx) {
  ctx = ctx || {};
  const fh = ctx.formHome === undefined ? 1.4 : ctx.formHome, fa = ctx.formAway === undefined ? 1.4 : ctx.formAway;
  const neutral = !!ctx.neutral;
  const bh = neutral ? (SIM.baseHome + SIM.baseAway) / 2 : SIM.baseHome, ba = neutral ? (SIM.baseHome + SIM.baseAway) / 2 : SIM.baseAway;
  const lh = bh * Math.exp(SIM.k * (home.att - away.def)) * (1 + SIM.formK * (fh - 1.4));
  const la = ba * Math.exp(SIM.k * (away.att - home.def)) * (1 + SIM.formK * (fa - 1.4));
  return [Math.max(0.15, Math.min(5, lh)), Math.max(0.1, Math.min(5, la))];
}
function pickScorer(profile, rng) {
  const tot = profile.shooters.reduce((s, p) => s + p.w, 0);
  let r = rng() * tot;
  for (const p of profile.shooters) { r -= p.w; if (r <= 0) return p.name; }
  return profile.shooters.length ? profile.shooters[0].name : '';
}
// rigori: 5 a testa alternati, si chiude appena una non può più rimontare; poi a oltranza
export function simulateShootout(home, away, rng) {
  const kickers = pr => pr.shooters.slice().sort((a, b) => b.shot - a.shot);
  const ks = [kickers(home), kickers(away)], gks = [home.gk, away.gk];
  const score = [0, 0], taken = [0, 0], log = [];
  const kick = side => {
    const list = ks[side], k = list[taken[side] % Math.max(1, list.length)] || { shot: 60, name: '' };
    const p = Math.max(0.55, Math.min(0.92, 0.76 + (k.shot - gks[1 - side]) / 350));
    const ok = rng() < p;
    taken[side]++; if (ok) score[side]++;
    log.push({ team: side, name: k.name, scored: ok });
  };
  for (let i = 0; i < 5; i++) {
    for (const s of [0, 1]) {
      kick(s);
      const left = [5 - taken[0], 5 - taken[1]];
      if (score[0] + left[0] < score[1] || score[1] + left[1] < score[0]) return { h: score[0], a: score[1], winner: score[0] > score[1] ? 0 : 1, kicks: log };
    }
  }
  while (score[0] === score[1]) { kick(0); kick(1); if (taken[0] > 40) break; }
  return { h: score[0], a: score[1], winner: score[0] > score[1] ? 0 : 1, kicks: log };
}
// partita simulata. opts.knockout: serve un vincitore (supplementari se opts.extraTime, poi rigori se opts.penalties);
// opts.aggregate: [gol già fatti da casa, gol già fatti da trasferta] nell'andata (per il ritorno).
export function simulateMatch(home, away, rng, opts) {
  opts = opts || {};
  const [lh, la] = expectedGoals(home, away, opts);
  const h = poisson(lh, rng), a = poisson(la, rng);
  const scorers = [];
  const addGoals = (n, side, from, to) => {
    for (let i = 0; i < n; i++) scorers.push({ team: side, name: pickScorer(side === 0 ? home : away, rng), minute: from + Math.floor(rng() * (to - from)) + 1 });
  };
  addGoals(h, 0, 0, 90); addGoals(a, 1, 0, 90);
  const out = { h: h, a: a, et: null, pens: null, winner: h > a ? 0 : h < a ? 1 : null, scorers: scorers };
  if (opts.knockout) {
    const ag = opts.aggregate || [0, 0];
    const level = (x, y) => x + ag[0] === y + ag[1];
    if (level(h, a)) {
      let eh = 0, ea = 0;
      if (opts.extraTime) {
        eh = poisson(lh * SIM.etShare * 0.9, rng); ea = poisson(la * SIM.etShare * 0.9, rng);
        addGoals(eh, 0, 90, 120); addGoals(ea, 1, 90, 120);
        out.et = { h: eh, a: ea };
      }
      if (level(h + eh, a + ea)) {
        if (opts.penalties !== false) { const p = simulateShootout(home, away, rng); out.pens = { h: p.h, a: p.a }; out.winner = p.winner; out.shootout = p.kicks; }
        else out.winner = null;   // niente rigori: ripetizione
      } else out.winner = h + eh + ag[0] > a + ea + ag[1] ? 0 : 1;
    } else out.winner = h + ag[0] > a + ag[1] ? 0 : 1;
  }
  scorers.sort((x, y) => x.minute - y.minute);
  return out;
}

// ---------- riepilogo di una stagione ----------
export function seasonSummary(table, matches, nameOf) {
  const played = matches.filter(m => m.played);
  const goals = played.reduce((s, m) => s + m.h + m.a, 0);
  const scorers = new Map();
  for (const m of played) for (const s of (m.scorers || [])) {
    const team = s.team === 0 ? m.home : m.away, key = team + '|' + s.name;
    const e = scorers.get(key) || { team: team, name: s.name, goals: 0 };
    e.goals++; scorers.set(key, e);
  }
  const top = [...scorers.values()].sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 10);
  const bestAtt = table.slice().sort((a, b) => b.gf - a.gf)[0], bestDef = table.slice().sort((a, b) => a.gs - b.gs)[0];
  let biggest = null;
  for (const m of played) { const d = Math.abs(m.h - m.a); if (!biggest || d > biggest.d) biggest = { d: d, home: m.home, away: m.away, h: m.h, a: m.a }; }
  return {
    champion: table[0] ? table[0].team : null,
    table: table.map(r => ({ team: r.team, pt: r.pt, v: r.v, n: r.n, p: r.p, gf: r.gf, gs: r.gs })),
    bestAttack: bestAtt ? { team: bestAtt.team, gf: bestAtt.gf } : null,
    bestDefense: bestDef ? { team: bestDef.team, gs: bestDef.gs } : null,
    topScorers: top, matches: played.length, goals: goals, avgGoals: played.length ? Math.round(goals / played.length * 100) / 100 : 0,
    biggestWin: biggest,
  };
}

// ---------- stato di una competizione: calendario, risultati, avanzamento ----------
// Lo stesso codice muove le competizioni sul computer (Career nel gioco) e quelle tra amici (sul server).
// comp: { kind, name, season, seed, config, fixtures, nextId, stage, groups, bracket, status, champion, summary, history }
// ctx: { profile(t) -> teamProfile della squadra t, nameOf(t) -> nome della squadra t }
export const COMP_KINDS = { league: 'Campionato', tournament: 'Torneo', cup: 'Coppa' };

// configurazione controllata di una competizione nuova (errori leggibili). nTeams: squadre esistenti (0..nTeams-1)
export function makeCompConfig(cfg, nTeams) {
  cfg = cfg || {};
  const kind = COMP_KINDS[cfg.kind] ? cfg.kind : 'league';
  const teams = [...new Set(Array.isArray(cfg.teams) ? cfg.teams : [])].filter(t => Number.isInteger(t) && t >= 0 && t < nTeams);
  if (kind === 'league' && (teams.length < 4 || teams.length > 32)) throw new Error('Un campionato vuole da 4 a 32 squadre');
  if (kind !== 'league' && !isPow2(teams.length) && !(cfg.groups && cfg.groups.count)) throw new Error('Il tabellone vuole 4, 8, 16 o 32 squadre');
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
    if (!isPow2(config.groups.count * config.groups.qualify)) throw new Error('Le qualificate devono essere 4, 8, 16 o 32');
  }
  const name = String(cfg.name || COMP_KINDS[kind]).replace(/[<>]/g, '').trim().slice(0, 40) || COMP_KINDS[kind];
  return { kind: kind, name: name, config: config };
}

// nuova stagione (o edizione): stesse squadre e regole, nuovo calendario o sorteggio; lo storico resta
export function startSeason(comp, seed, ctx) {
  comp.seed = seed >>> 0 || 1;
  comp.fixtures = []; comp.nextId = 1;
  comp.status = 'active'; comp.champion = null; comp.summary = null; comp.userOut = false;
  comp.groups = null; comp.bracket = null; comp.stage = null;
  const cfg = comp.config, rng = compRng(seedFor(comp.seed, 'sorteggio'));
  if (comp.kind === 'league') {
    comp.stage = 'league';
    roundRobin(shuffled(cfg.teams, rng), cfg.legs).forEach((games, r) => games.forEach(g => addFixture(comp, { stage: 'league', round: r, home: g.home, away: g.away })));
  } else if (cfg.groups) {
    comp.stage = 'groups';
    comp.groups = drawGroups(cfg.teams, t => ctx.profile(t).ovr, cfg.groups.count, rng);
    comp.groups.forEach((g, gi) => roundRobin(g, cfg.groups.legs).forEach((games, r) =>
      games.forEach(x => addFixture(comp, { stage: 'group', group: gi, round: r, home: x.home, away: x.away }))));
  } else {
    startKnockout(comp, drawBracket(cfg.teams, rng));
  }
}
// stagione successiva di una competizione finita (seme derivato: sempre lo stesso calendario per quella stagione)
export function nextSeason(comp, ctx) {
  if (comp.status !== 'finished') return false;
  comp.season++;
  startSeason(comp, seedFor(comp.seed, 'stagione' + comp.season), ctx);
  return true;
}
export function addFixture(comp, f) {
  const fx = Object.assign({ id: 'f' + (comp.nextId++), played: false }, f);
  comp.fixtures.push(fx);
  return fx;
}
export function startKnockout(comp, seeds) {
  comp.stage = 'knockout';
  comp.bracket = buildBracket(seeds, { legs: comp.kind === 'cup' ? comp.config.legs : 1 });
  createTieFixtures(comp, 0);
}
// partite di un turno del tabellone: gara unica (la finale sempre, in campo neutro) o andata e ritorno
export function createTieFixtures(comp, r) {
  const round = comp.bracket[r];
  round.ties.forEach((t, i) => {
    if (t.fixtures.length) return;
    const neutral = round.size === 2;
    t.fixtures.push(addFixture(comp, { stage: 'ko', round: r, tie: i, leg: 1, home: t.a, away: t.b, neutral: neutral }).id);
    if (t.legs === 2) t.fixtures.push(addFixture(comp, { stage: 'ko', round: r, tie: i, leg: 2, home: t.b, away: t.a }).id);
  });
}

export function findFixture(comp, id) { return comp.fixtures.find(f => f.id === id) || null; }
// giornata o turno in corso: le partite ancora da giocare con il turno più basso (e la fase attuale)
export function currentRound(comp) {
  const open = comp.fixtures.filter(f => !f.played);
  if (!open.length) return null;
  const stageRank = { league: 0, group: 0, ko: 1 };
  open.sort((a, b) => stageRank[a.stage] - stageRank[b.stage] || a.round - b.round || (a.leg || 1) - (b.leg || 1) || (a.replay ? 1 : 0) - (b.replay ? 1 : 0));
  const f0 = open[0];
  const same = open.filter(f => f.stage === f0.stage && f.round === f0.round && (f.leg || 1) === (f0.leg || 1) && !!f.replay === !!f0.replay);
  return { stage: f0.stage, round: f0.round, leg: f0.leg || 1, replay: !!f0.replay, fixtures: same };
}
export function roundLabel(comp, cr) {
  if (!cr) return '';
  if (cr.stage === 'league') return 'Giornata ' + (cr.round + 1);
  if (cr.stage === 'group') return 'Fase a gironi, giornata ' + (cr.round + 1);
  const r = comp.bracket[cr.round];
  return (r ? r.name : 'Turno') + (cr.replay ? ', ripetizioni' : r && r.ties[0] && r.ties[0].legs === 2 ? (cr.leg === 1 ? ', andata' : ', ritorno') : '');
}
export function compResults(comp, stage, group) {
  return comp.fixtures.filter(f => f.played && f.stage === stage && (group === undefined || f.group === group))
    .map(f => ({ home: f.home, away: f.away, h: f.h, a: f.a }));
}
export function leagueTable(comp) { return standings(comp.config.teams, compResults(comp, 'league')); }
export function groupTables(comp) { return (comp.groups || []).map((g, gi) => standings(g, compResults(comp, 'group', gi))); }
// punti per partita nelle ultime 5 (forma) per la simulazione
export function formOf(comp, t) {
  const last = comp.fixtures.filter(f => f.played && (f.home === t || f.away === t)).slice(-5);
  if (!last.length) return 1.4;
  return last.reduce((s, f) => { const gf = f.home === t ? f.h : f.a, gs = f.home === t ? f.a : f.h; return s + (gf > gs ? 3 : gf === gs ? 1 : 0); }, 0) / last.length;
}
export function compProgress(comp) {
  return { played: comp.fixtures.filter(f => f.played).length, total: comp.fixtures.length };
}
// gol dell'andata per il ritorno, dal punto di vista della partita di ritorno [casa, trasferta]
export function aggregateFor(comp, f) {
  if (f.stage !== 'ko' || f.leg !== 2) return [0, 0];
  const tie = comp.bracket[f.round].ties[f.tie];
  const first = findFixture(comp, tie.fixtures[0]);
  if (!first || !first.played) return [0, 0];
  const g = (m, t) => (m.home === t ? m.h + (m.et ? m.et.h : 0) : m.a + (m.et ? m.et.a : 0));
  return [g(first, f.home), g(first, f.away)];
}
// regole di una partita: in eliminazione diretta serve un vincitore (tranne all'andata)
export function matchRules(comp, f) {
  if (f.stage !== 'ko') return null;
  const tie = comp.bracket[f.round].ties[f.tie];
  if (tie.legs === 2 && f.leg === 1 && !f.replay) return null;
  return { extraTime: comp.config.extraTime, penalties: comp.config.penalties, aggregate: f.replay ? [0, 0] : aggregateFor(comp, f), neutral: !!f.neutral };
}

// simulazione ufficiale: seme della competizione + partita (+ sale), quindi sempre lo stesso risultato
export function simulateFixture(comp, f, ctx, salt) {
  const ko = matchRules(comp, f);
  const rng = compRng(seedFor(comp.seed, f.id + (salt ? ':' + salt : '')));
  return simulateMatch(ctx.profile(f.home), ctx.profile(f.away), rng, Object.assign({
    formHome: formOf(comp, f.home), formAway: formOf(comp, f.away), neutral: !!f.neutral,
  }, ko ? { knockout: true, extraTime: ko.extraTime, penalties: ko.penalties, aggregate: ko.aggregate } : {}));
}
// registra un risultato (partita giocata o simulata) e fa avanzare la competizione. Un risultato già registrato
// non cambia più: restituisce false.
export function recordResult(comp, fid, r, how, at, ctx) {
  const f = findFixture(comp, fid);
  if (!f || f.played) return false;
  Object.assign(f, {
    played: true, how: how, at: at, inProgress: undefined,
    h: r.h | 0, a: r.a | 0, et: r.et ? { h: r.et.h | 0, a: r.et.a | 0 } : null, pens: r.pens ? { h: r.pens.h | 0, a: r.pens.a | 0 } : null,
    winner: r.winner === 0 || r.winner === 1 ? r.winner : null,
    scorers: (r.scorers || []).slice(0, 30).map(s => ({ team: s.team === 1 ? 1 : 0, name: String(s.name || '').slice(0, 40), minute: s.minute | 0 })),
  });
  if (r.by) f.by = String(r.by).slice(0, 24);
  advanceComp(comp, ctx);
  return true;
}
// simula le partite della giornata in corso; skip(f) = true per lasciarne alcune (quelle dei giocatori)
export function simulateCurrentRound(comp, ctx, at, skip) {
  const cr = currentRound(comp);
  if (!cr) return 0;
  let n = 0;
  for (const f of cr.fixtures) if (!f.played && !(skip && skip(f))) { recordResult(comp, f.id, simulateFixture(comp, f, ctx), 'sim', at, ctx); n++; }
  return n;
}
// risultato di una partita lasciata a metà: il tempo che manca si simula partendo dal punteggio attuale.
// score [casa, trasferta], fraction: parte della partita già giocata (0..1)
export function resultFromScore(comp, f, score, fraction, scorers, ctx) {
  const rest = simulateFixture(comp, f, ctx, 'resto');
  const k = Math.min(1, Math.max(0, 1 - fraction));
  const rnd = compRng(seedFor(comp.seed, f.id + ':resto2'));
  const add = side => { const x = (side === 0 ? rest.h : rest.a) * k; return Math.floor(x) + (rnd() < x - Math.floor(x) ? 1 : 0); };
  const h = (score[0] | 0) + add(0), a = (score[1] | 0) + add(1);
  const ko = matchRules(comp, f);
  const r = { h: h, a: a, et: null, pens: null, winner: h > a ? 0 : h < a ? 1 : null, scorers: scorers || [] };
  if (ko) {
    const agg = ko.aggregate, lvl = h + agg[0] === a + agg[1];
    if (lvl) { r.et = ko.extraTime ? { h: 0, a: 0 } : null; if (ko.penalties) { r.pens = rest.pens || { h: 5, a: 4 }; r.winner = rest.pens ? rest.winner : 0; } else r.winner = null; }
    else r.winner = h + agg[0] > a + agg[1] ? 0 : 1;
  }
  return r;
}
// completa il risultato dei 90 minuti di una partita a eliminazione diretta finita in parità (partita online tra
// due giocatori, che si gioca senza supplementari): supplementari e rigori dalla simulazione ufficiale
export function completeKnockout(comp, f, r, ctx) {
  const ko = matchRules(comp, f);
  const out = Object.assign({}, r, { et: null, pens: null });
  out.winner = r.h > r.a ? 0 : r.h < r.a ? 1 : null;
  if (!ko) return out;
  const agg = ko.aggregate;
  if (r.h + agg[0] !== r.a + agg[1]) { out.winner = r.h + agg[0] > r.a + agg[1] ? 0 : 1; return out; }
  const rng = compRng(seedFor(comp.seed, f.id + ':supplementari'));
  const [lh, la] = expectedGoals(ctx.profile(f.home), ctx.profile(f.away), { neutral: !!f.neutral });
  let eh = 0, ea = 0;
  if (ko.extraTime) { eh = poisson(lh * SIM.etShare * 0.9, rng); ea = poisson(la * SIM.etShare * 0.9, rng); out.et = { h: eh, a: ea }; out.etSimulated = true; }
  if (r.h + eh + agg[0] !== r.a + ea + agg[1]) { out.winner = r.h + eh + agg[0] > r.a + ea + agg[1] ? 0 : 1; return out; }
  if (ko.penalties) { const p = simulateShootout(ctx.profile(f.home), ctx.profile(f.away), rng); out.pens = { h: p.h, a: p.a }; out.winner = p.winner; out.pensSimulated = true; }
  else out.winner = null;
  return out;
}
// controlla un risultato dichiarato da un giocatore per la partita f (numeri interi, supplementari e rigori solo
// quando le regole li prevedono e il punteggio li richiede). Restituisce il risultato pulito o lancia un errore.
export function checkResult(comp, f, r) {
  const int = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!r || typeof r !== 'object' || !int(r.h, 30) || !int(r.a, 30)) throw new Error('Risultato non valido');
  const out = { h: r.h, a: r.a, et: null, pens: null, winner: r.h > r.a ? 0 : r.h < r.a ? 1 : null, scorers: [] };
  const ko = matchRules(comp, f);
  if (ko) {
    const agg = ko.aggregate;
    let h = r.h + agg[0], a = r.a + agg[1];
    if (h === a && ko.extraTime) {
      if (!r.et || !int(r.et.h, 15) || !int(r.et.a, 15)) throw new Error('Mancano i supplementari');
      out.et = { h: r.et.h, a: r.et.a }; h += r.et.h; a += r.et.a;
    } else if (r.et) throw new Error('Supplementari non previsti');
    if (h === a) {
      if (ko.penalties) {
        if (!r.pens || !int(r.pens.h, 40) || !int(r.pens.a, 40) || r.pens.h === r.pens.a) throw new Error('Mancano i rigori');
        out.pens = { h: r.pens.h, a: r.pens.a }; out.winner = r.pens.h > r.pens.a ? 0 : 1;
      } else out.winner = null;
    } else { if (r.pens) throw new Error('Rigori non previsti'); out.winner = h > a ? 0 : 1; }
  } else if (r.et || r.pens) throw new Error('Supplementari e rigori non previsti in questa partita');
  const total = out.h + out.a + (out.et ? out.et.h + out.et.a : 0);
  out.scorers = (Array.isArray(r.scorers) ? r.scorers : []).slice(0, total).filter(s => s && typeof s === 'object')
    .map(s => ({ team: s.team === 1 ? 1 : 0, name: String(s.name || '').replace(/[<>]/g, '').slice(0, 40), minute: Math.max(0, Math.min(130, s.minute | 0)) }));
  return out;
}

// ---------- avanzamento ----------
export function advanceComp(comp, ctx) {
  const cfg = comp.config;
  if (comp.stage === 'league') {
    if (comp.fixtures.every(f => f.played)) finishComp(comp, leagueTable(comp)[0].team, ctx);
    return;
  }
  if (comp.stage === 'groups') {
    const group = comp.fixtures.filter(f => f.stage === 'group');
    if (!group.every(f => f.played)) return;
    const tables = groupTables(comp);
    comp.groupFinal = tables.map(t => t.map(r => r.team));
    const qualified = new Set(tables.flatMap(t => t.slice(0, cfg.groups.qualify).map(r => r.team)));
    if (cfg.userTeam >= 0 && !qualified.has(cfg.userTeam)) comp.userOut = true;
    startKnockout(comp, knockoutSeedsFromGroups(tables, cfg.groups.qualify));
    return;
  }
  if (comp.stage !== 'knockout') return;
  for (let r = 0; r < comp.bracket.length; r++) {
    const round = comp.bracket[r];
    let allDone = true;
    round.ties.forEach((t, i) => {
      if (t.winner !== null && t.winner !== undefined) return;
      if (t.a === null || t.b === null) { allDone = false; return; }
      const ms = t.fixtures.map(id => findFixture(comp, id));
      if (ms.some(m => !m.played)) { allDone = false; return; }
      const out = tieOutcome(t, ms);
      if (out) {
        advanceBracket(comp.bracket, r, i, out.winner);
        t.agg = out.agg;
        const loser = out.winner === t.a ? t.b : t.a;
        if (loser === cfg.userTeam) comp.userOut = true;
      } else {
        // parità senza rigori: si ripete in casa dell'altra squadra
        const last = ms[ms.length - 1];
        t.fixtures.push(addFixture(comp, { stage: 'ko', round: r, tie: i, leg: (last.leg || 1) + 1, replay: true, home: last.away, away: last.home, neutral: !!last.neutral }).id);
        allDone = false;
      }
    });
    if (!allDone) return;
    if (r + 1 < comp.bracket.length) createTieFixtures(comp, r + 1);
    else { finishComp(comp, round.ties[0].winner, ctx); return; }
  }
}
export function finishComp(comp, champion, ctx) {
  comp.status = 'finished';
  comp.champion = champion;
  const table = comp.kind === 'league' ? leagueTable(comp) : standings(comp.config.teams, comp.fixtures.filter(f => f.played).map(f => ({ home: f.home, away: f.away, h: f.h + (f.et ? f.et.h : 0), a: f.a + (f.et ? f.et.a : 0) })));
  comp.summary = seasonSummary(table, comp.fixtures, ctx.nameOf);
  comp.summary.champion = champion;
  comp.summary.season = comp.season;
  if (comp.kind !== 'league') {
    const fin = comp.fixtures.filter(f => f.stage === 'ko' && f.round === comp.bracket.length - 1 && f.played).pop();
    if (fin) comp.summary.final = { home: fin.home, away: fin.away, h: fin.h, a: fin.a, et: fin.et, pens: fin.pens };
  }
  comp.history = (comp.history || []).concat([{ season: comp.season, champion: champion, summary: comp.summary }]).slice(-20);
}
