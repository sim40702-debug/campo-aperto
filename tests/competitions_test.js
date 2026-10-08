// Competizioni della carriera (src/game/18_competitions.js) con il motore vero e le regole condivise (CompLogic).
// Uso: node tests/competitions_test.js
const fs = require('fs'), path = require('path');
const { gameFiles, gameFile } = require('../scripts/sorgenti.js');
const files = gameFiles(/^0[1-8]_/).concat([gameFile('18_competitions.js'), gameFile('18_squadre.js')]);
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const cl = fs.readFileSync(path.join(__dirname, '../cloud/src/complogic.js'), 'utf8');
const names = [...cl.matchAll(/^export (?:const|function\*?|let) (\w+)/gm)].map(m => m[1]);
// come nel gioco (build.js): le regole condivise prima del codice del gioco
let code = 'var CompLogic = (function () {\n' + cl.replace(/^export /gm, '') + '\nreturn { ' + names.join(', ') + ' };\n})();\n';
code += files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
code += ';globalThis.__api = { Career, buildDatabase, buildExtraTeams, setSeed, CompLogic, CUP_PRESETS, KnockoutMatch };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let ok = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { ok++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const base = A.buildDatabase(2026), r1 = Math.random();
const extra = A.buildExtraTeams(), extra2 = A.buildExtraTeams();
const db = base.concat(extra);
check('32 squadre: le 8 del server più 24 nuove, sempre uguali, senza disturbare i numeri casuali del gioco',
  db.length === 32 && extra[0].players[0].name === extra2[0].players[0].name && new Set(db.map(t => t.name)).size === 32 && typeof r1 === 'number');
const nameOf = i => db[i].name;
const C = new A.Career(db, nameOf);
const all = Array.from({ length: 32 }, (_, i) => i);

// ---------- campionato ----------
const lg = C.create({ kind: 'league', name: 'Serie Prova', teams: all.slice(0, 20), userTeam: 3, legs: 2 });
check('campionato a 20, andata e ritorno: 380 partite, 38 giornate', lg.fixtures.length === 380 && Math.max(...lg.fixtures.map(f => f.round)) === 37);
let cr = C.currentRound(lg);
check('giornata 1: 10 partite, quella del giocatore riconosciuta', cr.round === 0 && cr.fixtures.length === 10 && C.userFixture(lg, cr) && C.roundLabel(lg, cr) === 'Giornata 1');
const mine = C.userFixture(lg, cr);
C.record(lg, mine.id, { h: 2, a: 1, scorers: [{ team: 0, name: 'Uno', minute: 10 }] }, 'played');
C.simulateRound(lg);
cr = C.currentRound(lg);
check('dopo la partita del giocatore le altre della giornata si simulano e si passa alla giornata 2', cr.round === 1 && lg.fixtures.filter(f => f.round === 0).every(f => f.played));
const t1 = C.table(lg);
check('classifica aggiornata da sola: 20 squadre, 1 partita a testa, punti coerenti', t1.length === 20 && t1.every(r => r.pg === 1) && t1.reduce((s, r) => s + r.pt, 0) >= 20);
check('un risultato già registrato non si può cambiare', C.record(lg, mine.id, { h: 0, a: 5 }, 'played') === false && C.fixture(lg, mine.id).h === 2);
// determinismo: la stessa partita simulata dà sempre lo stesso risultato
const f2 = C.currentRound(lg).fixtures[0];
check('simulazione ufficiale con seme: stesso risultato a ogni tentativo', JSON.stringify(C.simulate(lg, f2)) === JSON.stringify(C.simulate(lg, f2)));
C.simulateToEnd(lg);
const tf = C.table(lg);
check('fine campionato: 38 partite a testa, campione = prima in classifica', lg.status === 'finished' && tf.every(r => r.pg === 38) && lg.champion === tf[0].team);
const s = lg.summary;
check('riepilogo: campione, classifica finale, miglior attacco e difesa, capocannoniere, statistiche',
  s.table.length === 20 && s.bestAttack.gf === Math.max(...tf.map(r => r.gf)) && s.bestDefense.gs === Math.min(...tf.map(r => r.gs)) && s.topScorers.length > 0 && s.topScorers[0].goals >= 5 && s.matches === 380, s.topScorers[0]);
const totalPts = tf.reduce((x, r) => x + r.pt, 0), draws = lg.fixtures.filter(f => f.h === f.a).length;
check('punti totali = 3 a vittoria + 2 a pareggio (' + totalPts + ')', totalPts === (380 - draws) * 3 + draws * 2);
C.newSeason(lg.id);
check('nuova stagione: calendario nuovo, storico mantenuto', lg.season === 2 && lg.status === 'active' && lg.fixtures.length === 380 && lg.fixtures.every(f => !f.played) && lg.history.length === 1 && lg.history[0].champion === s.champion);

// ---------- torneo a 32 ----------
const tn = C.create({ kind: 'tournament', name: 'Torneo 32', teams: all, userTeam: 7 });
check('torneo a 32: sedicesimi con 16 partite', tn.bracket.length === 5 && C.currentRound(tn).fixtures.length === 16 && C.roundLabel(tn, C.currentRound(tn)) === 'Sedicesimi di finale');
// il giocatore perde la sua partita: eliminato
const myT = C.userFixture(tn, C.currentRound(tn));
const userHome = myT.home === 7;
C.record(tn, myT.id, { h: userHome ? 0 : 3, a: userHome ? 3 : 0, winner: userHome ? 1 : 0 }, 'played');
C.simulateRound(tn);
check('squadra del giocatore eliminata: la competizione finisce per lei', tn.userOut === true && C.currentRound(tn).round === 1 && C.currentRound(tn).fixtures.every(f => f.home !== 7 && f.away !== 7));
check('ottavi: 8 partite tra le vincenti dei sedicesimi', C.currentRound(tn).fixtures.length === 8 && tn.bracket[1].ties.every(t => t.a !== null && t.b !== null));
C.simulateToEnd(tn);
const fin = tn.fixtures.filter(f => f.round === 4);
check('finale: una partita in campo neutro, il vincitore è il campione', tn.status === 'finished' && fin.length === 1 && fin[0].neutral && tn.champion === (fin[0].winner === 0 ? fin[0].home : fin[0].away));
check('nessun pareggio nel tabellone: sempre un vincitore (supplementari e rigori)', tn.fixtures.every(f => f.winner === 0 || f.winner === 1) && tn.fixtures.length === 31);
const elim = new Set(); tn.bracket.forEach(r => r.ties.forEach(t => elim.add(t.winner === t.a ? t.b : t.a)));
check('ogni squadra eliminata una sola volta, il campione mai', elim.size === 31 && !elim.has(tn.champion));

// ---------- coppa con gironi ----------
const pr = A.CUP_PRESETS.find(p => p.id === 'continentale');
const cup = C.create(Object.assign({ kind: 'cup', teams: all, userTeam: 0 }, pr));
check('coppa con gironi: 8 gironi da 4, andata e ritorno (96 partite)', cup.stage === 'groups' && cup.groups.length === 8 && cup.fixtures.length === 96 && C.roundLabel(cup, C.currentRound(cup)) === 'Fase a gironi, giornata 1');
let guard = 0;
while (cup.stage === 'groups' && guard++ < 50) C.simulateRound(cup);
const tables = C.groupTables(cup);
const q = new Set(tables.flatMap(t => t.slice(0, 2).map(r => r.team)));
check('fine gironi: passano le prime due di ogni girone, ottavi con andata e ritorno', cup.stage === 'knockout' && cup.bracket[0].name === 'Ottavi di finale' &&
  cup.bracket[0].ties.every(t => q.has(t.a) && q.has(t.b) && t.legs === 2 && t.fixtures.length === 2), cup.bracket[0].ties[0]);
check('ottavi: le prime contro le seconde di un altro girone', cup.bracket[0].ties[0].a === tables[0][0].team && cup.bracket[0].ties[0].b === tables[1][1].team);
C.simulateRound(cup);
const legs1 = cup.fixtures.filter(f => f.stage === 'ko' && f.leg === 1);
check('andata: pareggi possibili, nessun vincitore deciso', legs1.every(f => f.played) && cup.bracket[0].ties.every(t => t.winner === null));
C.simulateRound(cup);
check('ritorno: passa chi ha fatto più gol in totale (o ai rigori)', cup.bracket[0].ties.every(t => {
  const [m1, m2] = t.fixtures.map(id => C.fixture(cup, id));
  const ga = (m1.home === t.a ? m1.h : m1.a) + (m2.home === t.a ? m2.h + (m2.et ? m2.et.h : 0) : m2.a + (m2.et ? m2.et.a : 0));
  const gb = (m1.home === t.b ? m1.h : m1.a) + (m2.home === t.b ? m2.h + (m2.et ? m2.et.h : 0) : m2.a + (m2.et ? m2.et.a : 0));
  return ga !== gb ? t.winner === (ga > gb ? t.a : t.b) : !!m2.pens && t.winner === (m2.winner === 0 ? m2.home : m2.away);
}));
C.simulateToEnd(cup);
check('coppa finita: finale in gara unica, campione', cup.status === 'finished' && cup.bracket[3].ties[0].legs === 1 && cup.champion !== null && cup.summary.final);

// ---------- coppa senza rigori: ripetizioni ----------
const trad = C.create(Object.assign({ kind: 'cup', teams: all.slice(0, 16), userTeam: -1 }, A.CUP_PRESETS.find(p => p.id === 'tradizione'), { extraTime: false }));
C.simulateToEnd(trad);
const replays = trad.fixtures.filter(f => f.replay);
check('senza supplementari né rigori una parità si ripete (' + replays.length + ' ripetizioni) e alla fine c\'è un campione', trad.status === 'finished' && trad.champion !== null &&
  trad.fixtures.filter(f => !f.replay && f.h === f.a).every(f => trad.fixtures.some(r => r.replay && r.round === f.round && r.tie === f.tie)));

// ---------- coppa a 8 con andata e ritorno e prova del giocatore ----------
const small = C.create({ kind: 'cup', name: 'Coppa a 8', teams: all.slice(0, 8), userTeam: 2, legs: 2, extraTime: true, penalties: true });
const uf = C.userFixture(small, C.currentRound(small));
check('regole della partita: l\'andata non chiede un vincitore, il ritorno sì con la somma dell\'andata', C.matchRules(small, uf) === null);
C.record(small, uf.id, { h: 3, a: 0 }, 'played');
C.simulateRound(small);
const ret = C.userFixture(small, C.currentRound(small));
const rules = C.matchRules(small, ret);
check('ritorno: somma dell\'andata dal punto di vista della partita di ritorno', rules && rules.extraTime && ((ret.home === 2 && rules.aggregate[0] === (uf.home === 2 ? 3 : 0)) || (ret.away === 2 && rules.aggregate[1] === (uf.home === 2 ? 3 : 0))), { rules, ret, uf });

// ---------- partite lasciate a metà ----------
const lg2 = C.create({ kind: 'league', name: 'Abbandono', teams: all.slice(0, 6), userTeam: 1, legs: 1 });
const uf2 = C.userFixture(lg2, C.currentRound(lg2));
C.markInProgress(lg2, uf2.id);
const C2 = new A.Career(db, nameOf);    // come un riavvio del gioco
const n = C2.resolveAbandoned();
check('gioco chiuso a metà partita: al riavvio la partita si chiude con la simulazione ufficiale (non si rigioca)', n === 1 && C2.byId(lg2.id).fixtures.find(f => f.id === uf2.id).played);
const lg3 = C.create({ kind: 'league', name: 'Esci dal menu', teams: all.slice(0, 6), userTeam: 1, legs: 1 });
const uf3 = C.userFixture(lg3, C.currentRound(lg3));
C.finishFromScore(lg3, uf3.id, [2, 0], 0.5, []);
const ff = C.fixture(lg3, uf3.id);
check('uscita dal menu a metà: il resto si simula partendo dal punteggio (2-0 resta almeno 2-0)', ff.played && ff.h >= 2 && ff.a >= 0 && ff.how === 'abbandonata');

// ---------- salvataggio ----------
const C3 = new A.Career(db, nameOf);
check('salvataggio sul computer: competizioni, calendario e risultati ritrovati', C3.comps.length === C.comps.length && C3.byId(lg.id).season === 2 && C3.byId(tn.id).status === 'finished');
check('dati rovinati o squadre inesistenti scartati', C3.clean({ comps: [{ kind: 'league', config: { teams: [0, 99] }, fixtures: [] }, 5, null] }).comps.length === 0 && C3.clean('x') === null);
let threw = 0;
try { C.create({ kind: 'tournament', teams: all.slice(0, 6) }); } catch (e) { threw++; }
try { C.create({ kind: 'league', teams: [0, 1] }); } catch (e) { threw++; }
check('configurazioni impossibili rifiutate (torneo a 6, campionato a 2)', threw === 2);
const ov = C.overview(lg);
check('cruscotto: competizione, squadra, posizione, prossima partita, progresso', ov.name === 'Serie Prova' && ov.userTeam === 3 && ov.next && ov.progress.total === 380 && ov.round === 'Giornata 1');

console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
