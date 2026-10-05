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
