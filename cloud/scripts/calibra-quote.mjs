// Calibrazione delle quote con il motore vero del gioco (Monte Carlo).
// Per ogni coppia di squadre (casa, ospite) simula molte partite con la stessa durata delle partite del server
// e salva le medie che servono al modello delle quote (src/odds-model.json).
// Uso: node scripts/calibra-quote.mjs [partite per coppia] [thread]   (prima: npm run engine)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';

export const HALF_SECONDS = 90;   // deve coincidere con FIXTURE_HALF_SECONDS del server

async function simulate(jobs) {
  const { Match, buildDatabase, makeRng } = await import('../src/engine.gen.js');
  const db = buildDatabase(2026);
  const out = [];
  for (const j of jobs) {
    const m = new Match(db[j.h], db[j.a], { halfSeconds: HALF_SECONDS, humanTeam: -1, rng: makeRng(j.seed) });
    while (m.state !== 'FULLTIME') m.update(1 / 60, null);
    const ev = m.timeline, side = e => e.team;
    const count = (types, t) => ev.filter(e => types.includes(e.type) && side(e) === t).length;
    const first = types => { const e = ev.find(x => types.includes(x.type)); return e ? side(e) : -1; };
    const goals = ev.filter(e => e.type === 'GOAL');
    const [s0, s1] = m.teams.map(t => t.stats);
    out.push({
      h: j.h, a: j.a, g: [m.teams[0].score, m.teams[1].score],
      g1: [goals.filter(e => e.half === 1 && e.team === 0).length, goals.filter(e => e.half === 1 && e.team === 1).length],
      c: [count(['CORNER'], 0), count(['CORNER'], 1)],
      k: [0, 1].map(t => count(['YELLOW_CARD', 'SECOND_YELLOW', 'RED_CARD'], t)),
      s: [s0.shots, s1.shots], o: [s0.onTarget, s1.onTarget],
      pos: s0.possession / ((s0.possession + s1.possession) || 1),
      red: ev.some(e => e.type === 'RED_CARD') ? 1 : 0, pen: ev.some(e => e.type === 'PENALTY') ? 1 : 0,
    });
  }
  return out;
}

if (isMainThread) {
  const per = +(process.argv[2] || 30), threads = +(process.argv[3] || cpus().length);
  const jobs = [];
  let seed = 1;
  for (let h = 0; h < 8; h++) for (let a = 0; a < 8; a++) if (h !== a) for (let i = 0; i < per; i++) jobs.push({ h, a, seed: 7919 * seed++ });
  const t0 = Date.now();
  const parts = Array.from({ length: threads }, (_, k) => jobs.filter((_, i) => i % threads === k));
  const results = (await Promise.all(parts.map(part => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: part });
    w.on('message', res); w.on('error', rej);
  })))).flat();
  const mean = (arr, f) => arr.reduce((s, r) => s + f(r), 0) / (arr.length || 1);
  const pairs = {};
  for (let h = 0; h < 8; h++) for (let a = 0; a < 8; a++) {
    if (h === a) continue;
    const r = results.filter(x => x.h === h && x.a === a);
    const r3 = v => Math.round(v * 1000) / 1000;
    pairs[h + '-' + a] = {
      n: r.length,
      g: [r3(mean(r, x => x.g[0])), r3(mean(r, x => x.g[1]))],
      c: [r3(mean(r, x => x.c[0])), r3(mean(r, x => x.c[1]))],
      k: [r3(mean(r, x => x.k[0])), r3(mean(r, x => x.k[1]))],
      s: [r3(mean(r, x => x.s[0])), r3(mean(r, x => x.s[1]))],
      o: [r3(mean(r, x => x.o[0])), r3(mean(r, x => x.o[1]))],
      // possesso: quota di partite in cui la squadra di casa ha avuto più palla (con un prior che evita 0 e 1)
      posHome: r3((r.filter(x => x.pos > 0.5).length + 2) / (r.length + 4)),
    };
  }
  const goalsAll = mean(results, x => x.g[0] + x.g[1]) || 1;
  const model = {
    engine: (await import('../src/engine.gen.js')).GAME_VERSION, halfSeconds: HALF_SECONDS, simsPerPair: per, created: new Date().toISOString(),
    firstHalfShare: Math.round(mean(results, x => x.g1[0] + x.g1[1]) / goalsAll * 1000) / 1000,
    redRate: Math.round(mean(results, x => x.red) * 1000) / 1000,
    penaltyRate: Math.round(mean(results, x => x.pen) * 1000) / 1000,
    pairs,
  };
  writeFileSync(new URL('../src/odds-model.json', import.meta.url), JSON.stringify(model, null, 1) + '\n');
  console.log('partite simulate', results.length, 'in', ((Date.now() - t0) / 1000).toFixed(0), 's; gol medi', goalsAll.toFixed(2),
    'quota primo tempo', model.firstHalfShare, 'rossi', model.redRate, 'rigori', model.penaltyRate);
} else {
  parentPort.postMessage(await simulate(workerData));
}
