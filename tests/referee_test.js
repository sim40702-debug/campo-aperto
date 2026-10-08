// Test dell'arbitro e della fisica: contrasti costruiti a mano con la simulazione vera.
// I casi con una parte casuale (il piede arriva o no sul pallone) si ripetono con molti semi diversi:
// la regola deve valere sempre, non per fortuna.
const fs = require('fs'), path = require('path');
const files = require('../scripts/sorgenti.js').gameFiles(/^0[1-8]_/);
let code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, CONFIG, evaluateChallenge, analyzeChallenge, doGroundPass, doLobPass, doShot, simulateFlight, stepBallPhysics, Ball, REF };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let ok = 0, fail = 0;
function check(name, cond, extra) { if (cond) { ok++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : extra); } }
const db = A.buildDatabase(9);

// partita in gioco con tutti lontani dall'azione; vittima della squadra 1 (attacca verso x negativo)
function scene(o) {
  A.setSeed(o.seed || 1);
  const m = new A.Match(db[0], db[1], { halfSeconds: 180, humanTeam: -1 });
  m.setState('PLAY');
  m.allPlayers().forEach((p, i) => { p.x = (i % 11) * 4 - 20; p.z = i < 11 ? -30 : 30; p.vx = p.vz = 0; p.stunned = 0; p.kickCooldown = 0; });
  const v = m.teams[1].players[9], t = m.teams[0].players[o.tacklerIdx || 4];
  v.x = o.vx0 !== undefined ? o.vx0 : 0; v.z = 0; v.facing = o.facing !== undefined ? o.facing : Math.PI;
  const vs = o.vSpeed || 0; v.vx = Math.cos(v.facing) * vs; v.vz = Math.sin(v.facing) * vs;
  const off = o.ballOff !== undefined ? o.ballOff : 0.6;
  m.ball.owner = v; m.ball.x = v.x + Math.cos(v.facing) * off; m.ball.z = v.z + Math.sin(v.facing) * off; m.ball.y = A.CONFIG.BALL_R;
  t.x = v.x + o.tx; t.z = v.z + o.tz; t.vx = o.tvx || 0; t.vz = o.tvz || 0; t.facing = Math.atan2(v.z - t.z, v.x - t.x);
  if (o.tacklerDefense !== undefined) t.data.attr.defense = o.tacklerDefense;
  return { m, t, v };
}
// ripete un contrasto con molti semi: conta falli, contatti, palloni presi, cartellini
function trials(o, n, kind) {
  const r = { n: n || 200, foul: 0, contact: 0, played: 0, yellow: 0, red: 0, legalAfterBall: 0, reasons: {} };
  for (let i = 0; i < r.n; i++) {
    const s = scene(Object.assign({}, o, { seed: 1000 + i }));
    const d = s.m.resolveTackle(s.t, s.v, kind === 'slide');
    const c = s.m.lastChallenge.challenge;
    if (d.foul) { r.foul++; r.reasons[d.reason] = (r.reasons[d.reason] || 0) + 1; }
    if (c.contact) r.contact++;
    if (c.ballPlayed) r.played++;
    if (c.ballPlayed && c.contact && !d.foul) r.legalAfterBall++;
    if (d.yellow_card) r.yellow++;
    if (d.red_card) r.red++;
  }
  return r;
}
const base = { kind: 'stand', ballReachable: true, ballPlayed: false, ballFirst: false, contact: false, contactPoint: 'none', fromBehind: false, fromSide: false, relSpeed: 2, victimHasBall: true, inPenaltyArea: false, dogso: false, promising: false };
const ev = (o) => A.evaluateChallenge(Object.assign({}, base, o), 0.5);

// ---------- ARBITRO ----------
// TEST 1: entra sul pallone senza colpire l'avversario (pallone lontano dal corpo, intervento di fronte)
let r = trials({ facing: Math.PI, ballOff: 1.1, tx: -2.0, tz: 0.3 });
check('TEST 1 entra sul pallone senza toccare l\'avversario -> nessun fallo (200 prove)', r.foul === 0 && r.contact === 0, JSON.stringify(r));
check('TEST 1b intervento di fronte: il pallone viene preso in buona parte dei casi', r.played > 60, r.played);
check('TEST 1c decisione pura: nessun contatto = nessun fallo, anche a vuoto', !ev({ contact: false, ballPlayed: false }).foul && !ev({ contact: false, ballPlayed: true }).foul);

// TEST 1d: lo stesso con i comandi veri di un giocatore umano (tasto del contrasto), di fronte e da dietro
{
  const human = (front, n) => {
    let fouls = 0, won = 0;
    for (let i = 0; i < n; i++) {
      A.setSeed(3000 + i);
      const m = new A.Match(db[0], db[1], { halfSeconds: 180, humanTeam: 0 });
      m.setState('PLAY');
      m.allPlayers().forEach((p, k) => { p.x = (k % 11) * 4 - 20; p.z = k < 11 ? -30 : 30; p.vx = p.vz = 0; });
      const v = m.teams[1].players[9], h = m.humans[0], t = m.teams[0].players[6];
      h.player = t;
      v.x = 0; v.z = 0; v.facing = Math.PI;
      m.ball.owner = v; m.ball.x = -0.6; m.ball.z = 0;
      t.x = front ? -1.6 : 1.1; t.z = 0.15; t.facing = front ? 0 : Math.PI;
      m.update(1 / 60, { mx: 0, mz: 0, sprint: false, shoot: false, pressed: { pass: true } });
      if (m.timeline.some(e => e.type === 'FOUL')) fouls++;
      if (m.ball.owner === t || (m.ball.lastTouch === t)) won++;
    }
    return { fouls, won };
  };
  const f = human(true, 100), b2 = human(false, 100);
  check('TEST 1d contrasto umano di fronte con il tasto: mai fallo (100 prove)', f.fouls === 0 && f.won > 30, JSON.stringify(f));
  check('TEST 1e contrasto umano alle spalle attraverso le gambe: fallo', b2.fouls === 100, JSON.stringify(b2));
}

// TEST 2: prende chiaramente il pallone, poi piccolo contatto (pallone al piede, intervento di fronte)
r = trials({ facing: Math.PI, ballOff: 0.6, tx: -1.5, tz: 0.2 });
check('TEST 2 prende il pallone e poi c\'è un piccolo contatto -> nessun fallo', r.foul === 0 && r.legalAfterBall > 30, JSON.stringify(r));
const d2 = ev({ contact: true, ballPlayed: true, ballFirst: true, contactPoint: 'feet', relSpeed: 3 });
check('TEST 2b decisione pura: pallone prima, contatto lieve -> regolare', d2.legal && !d2.foul, JSON.stringify(d2));
const d2c = ev({ kind: 'slide', contact: true, ballPlayed: true, ballFirst: true, contactPoint: 'feet', relSpeed: 9, fromBehind: true });
check('TEST 2c pallone prima ma travolge a tutta velocità da dietro -> fallo (forza eccessiva)', d2c.foul && (d2c.yellow_card || d2c.red_card), JSON.stringify(d2c));

// TEST 3: colpisce le gambe senza prendere il pallone (intervento alle spalle: il corpo copre il pallone)
r = trials({ facing: Math.PI, ballOff: 0.6, tx: 1.2, tz: 0.1, tvx: -1 });
check('TEST 3 colpisce le gambe senza prendere il pallone -> sempre fallo', r.foul === r.n && r.played === 0, JSON.stringify(r));
const d3 = ev({ contact: true, contactPoint: 'legs', relSpeed: 3 });
check('TEST 3b decisione pura: contatto sulle gambe senza pallone -> fallo, senza cartellino se non è imprudente', d3.foul && !d3.yellow_card && !d3.red_card, JSON.stringify(d3));

// TEST 4: scivolata molto veloce e pericolosa
const d4a = ev({ kind: 'slide', contact: true, contactPoint: 'legs', relSpeed: 9, fromBehind: true });
const d4b = ev({ kind: 'slide', contact: true, contactPoint: 'legs', relSpeed: 4.5, fromSide: true });
check('TEST 4 scivolata da dietro a 9 m/s -> fallo e rosso (grave fallo di gioco)', d4a.foul && d4a.red_card && d4a.severity >= A.REF.EXCESSIVE, JSON.stringify(d4a));
check('TEST 4b scivolata di lato a 4.5 m/s -> fallo e giallo (imprudente)', d4b.foul && d4b.yellow_card && !d4b.red_card, JSON.stringify(d4b));
r = trials({ facing: Math.PI, vSpeed: 3, ballOff: 0.6, tx: 2.2, tz: 0.3, tvx: -8 }, 100, 'slide');
check('TEST 4c scivolata vera da dietro a 8 m/s -> sempre fallo, sempre con cartellino', r.foul === r.n && r.yellow + r.red === r.n, JSON.stringify(r));

// TEST 5: fallo tattico che interrompe un'azione promettente
const d5 = ev({ contact: true, contactPoint: 'legs', relSpeed: 2, promising: true });
check('TEST 5 fallo tattico -> fallo e giallo', d5.foul && d5.yellow_card && /tattico/.test(d5.reason), JSON.stringify(d5));
{
  const s = scene({ facing: Math.PI, vx0: -18, vSpeed: 5, ballOff: 0.6, tx: 1.2, tz: 0.2, tvx: -5 });
  const d = s.m.resolveTackle(s.t, s.v, false);
  check('TEST 5b contropiede nella metà campo avversaria fermato da dietro -> fallo con giallo', d.foul && d.yellow_card, JSON.stringify(d));
  check('TEST 5c il cartellino si mostra al fischio: ammonito registrato', s.t.cards.yellow === 1 && s.m.timeline.some(e => e.type === 'YELLOW_CARD' && e.player.num === s.t.data.number), s.t.cards.yellow);
}

// TEST 6: secondo giallo = rosso ed espulsione
{
  const s = scene({ facing: Math.PI, tx: 3, tz: 3 });
  const m = s.m, p = s.t;
  m.issueCard(p, 'yellow', 'prova');
  check('TEST 6 primo giallo: resta in campo', p.cards.yellow === 1 && !p.sentOff && m.teams[0].players.includes(p));
  m.ball.owner = null;
  m.issueCard(p, 'yellow', 'prova');
  check('TEST 6b secondo giallo -> rosso ed espulso', p.sentOff && p.cards.red && !m.teams[0].players.includes(p) && m.teams[0].players.length === 10, m.teams[0].players.length);
  check('TEST 6c eventi SECOND_YELLOW e RED_CARD registrati', m.timeline.some(e => e.type === 'SECOND_YELLOW') && m.timeline.some(e => e.type === 'RED_CARD' && e.reason === 'Doppia ammonizione'));
  check('TEST 6d l\'espulso resta nella rosa (ordine fisso per la rete) ma non tra chi gioca', m.allSlots().length === 22 && m.allPlayers().length === 21 && m.allSlots().includes(p));
  m.issueCard(p, 'yellow', 'prova');
  check('TEST 6e un espulso non riceve altri cartellini', p.cards.yellow === 2 && m.teams[0].stats.red === 1);
  m.ball.owner = null; m.ball.x = p.x + 0.3; m.ball.z = p.z; m.ball.vx = m.ball.vz = 0;
  for (let i = 0; i < 30 && !m.ball.owner; i++) m.update(1 / 60, null);
  check('TEST 6f l\'espulso non può più toccare il pallone', m.ball.owner !== p);
  for (let i = 0; i < 60 * 25; i++) m.update(1 / 60, null);
  check('TEST 6g l\'espulso esce dal campo', p.gone === true && Math.abs(p.z) > A.CONFIG.HALF_W, p.z.toFixed(1));
  // portiere espulso: in porta va un difensore
  const s2 = scene({ facing: Math.PI, tx: 3, tz: 3 }), gk = s2.m.teams[0].gk;
  s2.m.issueCard(gk, 'red', 'prova');
  check('TEST 6h portiere espulso: un difensore va in porta', s2.m.teams[0].gk !== gk && s2.m.teams[0].gk.isGK && s2.m.teams[0].gk.slot.role === 'GK');
}

// TEST 7: fallo in area = rigore solo se è davvero fallo
{
  // squadra 1 attacca verso x negativo: la sua area d'attacco è attorno a x = -45
  r = trials({ facing: Math.PI, vx0: -44, ballOff: 0.6, tx: -1.5, tz: 0.2 }, 100);
  check('TEST 7 intervento pulito in area -> nessun rigore', r.foul === 0, JSON.stringify(r));
  const s = scene({ facing: Math.PI, vx0: -44, ballOff: 0.6, tx: 1.2, tz: 0.1, tvx: -1, seed: 7 });
  const d = s.m.resolveTackle(s.t, s.v, false);
  const sp = s.m.pendingSetPiece;
  check('TEST 7b fallo da dietro in area -> rigore sul dischetto', d.foul && sp && sp.type === 'PENALTY' && Math.abs(sp.x - (-52.5 + 11)) < 0.01 && sp.z === 0, sp && sp.type);
  check('TEST 7c il rigore va alla squadra che ha subito il fallo', sp.team === s.v.team);
}

// TEST 8: contatto casuale durante la corsa (spalla a spalla)
{
  let fouls = 0, n = 100;
  for (let i = 0; i < n; i++) {
    const s = scene({ facing: Math.PI, vSpeed: 6.5, ballOff: 0.6, tx: 0.3, tz: 0.8, tvx: -6.5, tvz: -2.5, seed: 2000 + i });
    s.m.separate();
    if (s.m.state !== 'PLAY' || s.m.timeline.some(e => e.type === 'FOUL')) fouls++;
  }
  check('TEST 8 spalla a spalla durante la corsa -> nessun fallo (100 prove)', fouls === 0, fouls);
  const d8 = ev({ kind: 'charge', contact: true, contactPoint: 'body', relSpeed: 3.5, fromSide: true });
  check('TEST 8b decisione pura: urto di fianco -> regolare', !d8.foul, JSON.stringify(d8));
  const d8c = ev({ kind: 'charge', contact: true, contactPoint: 'body', relSpeed: 6, fromBehind: true });
  check('TEST 8c carica da dietro a 6 m/s sul portatore -> fallo', d8c.foul, JSON.stringify(d8c));
  // urti tra giocatori senza pallone non vengono valutati come falli
  const s = scene({ facing: Math.PI, tx: 3, tz: 3 });
  const a = s.m.teams[0].players[2], c = s.m.teams[1].players[2];
  a.x = 10; a.z = 10; c.x = 10.5; c.z = 10; a.vx = 6; c.vx = -6;
  s.m.separate();
  check('TEST 8d scontro tra due giocatori lontani dal pallone: nessun fallo, nessuna compenetrazione', !s.m.timeline.some(e => e.type === 'FOUL') && Math.hypot(a.x - c.x, a.z - c.z) >= A.CONFIG.PLAYER_RADIUS * 2 - 1e-6);
}

// TEST 9: vantaggio
{
  const setup = () => {
    // fallo nella metà campo d'attacco della squadra 1, con un compagno libero vicino al pallone
    const s = scene({ facing: Math.PI, vx0: -15, vSpeed: 5, ballOff: 0.6, tx: 1.2, tz: 0.1, tvx: -5, seed: 11 });
    const mate = s.m.teams[1].players[8];
    mate.x = s.v.x - 2.2; mate.z = 1.2; mate.vx = -4;
    return { s, mate };
  };
  let { s, mate } = setup();
  const d = s.m.resolveTackle(s.t, s.v, false);
  check('TEST 9 fallo con chiaro vantaggio -> si gioca il vantaggio', d.foul && d.advantage && s.m.state === 'PLAY' && s.m.advantage && s.m.banner && s.m.banner.kind === 'advantage', JSON.stringify({ d: d.reason, st: s.m.state }));
  check('TEST 9b evento ADVANTAGE registrato, FOUL con conseguenza ADVANTAGE', s.m.timeline.some(e => e.type === 'ADVANTAGE') && s.m.timeline.some(e => e.type === 'FOUL' && e.consequence === 'ADVANTAGE'));
  // il compagno tiene il pallone: dopo il tempo del vantaggio si continua e il giallo arriva alla prossima interruzione
  s.m.ball.owner = mate; s.m.ball.lastTouch = mate;
  for (let i = 0; i < 60 * 3; i++) { s.m.realTime += 1 / 60; s.m.updateAdvantage(); }
  check('TEST 9c vantaggio concretizzato -> nessun fischio', s.m.state === 'PLAY' && !s.m.advantage && !s.m.timeline.some(e => e.type === 'FREE_KICK'));
  check('TEST 9d il cartellino resta in sospeso fino alla prossima interruzione', s.m.pendingCards.length === (d.yellow_card ? 1 : 0) && s.t.cards.yellow === 0);
  s.m.whistle('THROW_IN', s.m.teams[1], 0, 33.9);
  check('TEST 9e alla prima interruzione il cartellino viene mostrato', !d.yellow_card || s.t.cards.yellow === 1);
  // vantaggio non concretizzato: l'avversario recupera subito il pallone -> si torna al punto del fallo
  ({ s, mate } = setup());
  s.m.resolveTackle(s.t, s.v, false);
  const opp = s.m.teams[0].players[6];
  s.m.ball.owner = null; s.m.ball.x = opp.x; s.m.ball.z = opp.z;
  const stop = s.m.onTouch(opp);
  const sp = s.m.pendingSetPiece;
  check('TEST 9f vantaggio non concretizzato -> punizione dal punto del fallo', stop === false && s.m.state === 'DEAD' && sp.type === 'FREE_KICK' && sp.team === s.v.team && Math.abs(sp.x - s.v.x) < 0.6, sp && sp.type);
  // niente vantaggio nella propria metà campo (meglio la punizione)
  const s3 = scene({ facing: Math.PI, vx0: 20, vSpeed: 5, ballOff: 0.6, tx: 1.2, tz: 0.1, tvx: -5, seed: 12 });
  s3.m.teams[1].players[8].x = 17.8; s3.m.teams[1].players[8].z = 1;
  const d3b = s3.m.resolveTackle(s3.t, s3.v, false);
  check('TEST 9g fallo nella propria metà campo -> fischio, nessun vantaggio', d3b.foul && !d3b.advantage && s3.m.state === 'DEAD');
}

// fuorigioco: valutato al momento del passaggio e anche sulle ribattute dei tiri
{
  const s = scene({ facing: Math.PI, tx: 3, tz: 3 });
  const m = s.m, team = m.teams[0], atk = team.players[9], shooter = team.players[10];
  m.ball.owner = null;
  for (const p of team.opponent().players) if (!p.isGK) { p.x = 30; p.z = -30 + p.slotIndex * 4; }
  atk.x = 45; atk.z = 5; shooter.x = 25; shooter.z = 0;
  m.ball.owner = shooter; m.ball.x = 25.6; m.ball.z = 0;
  A.doShot(shooter, 2, 0.6);
  check('fuorigioco registrato anche al momento del tiro', m.offside && m.offside.players.has(atk));
  m.onTouch(team.opponent().gk, true);
  check('una parata del portiere non annulla il fuorigioco', m.offside && m.offside.players.has(atk));
  const stop = m.onTouch(atk);
  check('ribattuta toccata da chi era in fuorigioco al tiro -> fuorigioco', stop === false && m.timeline.some(e => e.type === 'OFFSIDE'));
}

// eventi di partita: campi richiesti
{
  const s = scene({ facing: Math.PI, ballOff: 0.6, tx: 1.2, tz: 0.1, tvx: -1, seed: 31 });
  s.m.resolveTackle(s.t, s.v, false);
  const f = s.m.timeline.find(e => e.type === 'FOUL');
  check('evento FOUL con tempo, giocatore, squadra, posizione, vittima, motivo, gravità, conseguenza',
    f && Number.isFinite(f.minute) && f.player && f.player.num === s.t.data.number && f.team === 0 && Number.isFinite(f.x) && Number.isFinite(f.z) &&
    f.victim && f.victim.num === s.v.data.number && f.reason && Number.isFinite(f.severity) && f.consequence === 'FREE_KICK', JSON.stringify(f));
  const types = new Set(s.m.timeline.map(e => e.type));
  check('KICK_OFF e FREE_KICK registrati', types.has('KICK_OFF') && types.has('FREE_KICK'));
}

// ---------- FISICA ----------
{
  const s = scene({ facing: Math.PI, tx: 3, tz: 3 }), m = s.m, p = m.teams[0].players[6];
  m.ball.owner = null; m.ball.x = p.x + 0.5; m.ball.z = p.z;
  A.doGroundPass(p, p.x + 15, p.z, null);
  const pass = { v: m.ball.speed(), y: m.ball.vy };
  m.ball.x = p.x + 0.5; m.ball.z = p.z; m.ball.y = A.CONFIG.BALL_R;
  p.kickCooldown = 0; A.doShot(p, 0, 1);
  const shot = { v: m.ball.speed(), vy: m.ball.vy };
  check('passaggio corto lento e rasoterra, tiro potente veloce e alzato', pass.v < 14 && pass.y === 0 && shot.v > 25 && shot.vy > 0, JSON.stringify({ pass, shot }));
  // la resistenza dell'aria pesa molto di più sul tiro
  // in volo, lontano da terra: solo aria
  const b = { x: 0, y: 50, z: 0, vx: 30, vy: 0, vz: 0, spin: 0, topspin: 0 };
  for (let i = 0; i < 60; i++) A.stepBallPhysics(b, 1 / 60);
  const b2 = { x: 0, y: 50, z: 0, vx: 10, vy: 0, vz: 0, spin: 0, topspin: 0 };
  for (let i = 0; i < 60; i++) A.stepBallPhysics(b2, 1 / 60);
  check('resistenza dell\'aria quadratica: in 1 s il tiro a 30 m/s perde più del 20%, il pallone a 10 m/s circa un decimo', b.vx < 24 && b2.vx > 8.6, b.vx.toFixed(1) + ' / ' + b2.vx.toFixed(1));
  // effetto: il tiro a giro curva
  const c0 = A.simulateFlight(25, 3, 0, 0, 0, 25), c1 = A.simulateFlight(25, 3, 50, 0, 0, 25);
  check('tiro a giro: con 50 rad/s di effetto devia di oltre 1.5 m in 25 m', Math.abs(c1.side) > 1.5 && Math.abs(c0.side) < 0.01, c1.side.toFixed(2));
  const t0 = A.simulateFlight(25, 6, 0, 0, 0.2), t1 = A.simulateFlight(25, 6, 0, 25, 0.2);
  check('topspin: il pallone scende prima (tiro che "cade")', t1.range < t0.range - 1, t0.range.toFixed(1) + ' / ' + t1.range.toFixed(1));
  // il lancio con il calcolo del volo arriva dove deve, anche con aria ed effetto
  let errSum = 0;
  p.data.attr.pass = 100;
  for (let i = 0; i < 20; i++) {
    m.ball.x = p.x; m.ball.z = p.z; m.ball.y = A.CONFIG.BALL_R; p.kickCooldown = 0;
    A.setSeed(500 + i);
    A.doLobPass(p, p.x + 35, p.z + 10, null, 'lob');
    const bb = { x: m.ball.x, y: m.ball.y, z: m.ball.z, vx: m.ball.vx, vy: m.ball.vy, vz: m.ball.vz, spin: m.ball.spin, topspin: m.ball.topspin };
    for (let k = 0; k < 600 && !(k > 10 && bb.vy < 0 && bb.y <= 0.5); k++) A.stepBallPhysics(bb, 1 / 120);
    errSum += Math.hypot(bb.x - (p.x + 35), bb.z - (p.z + 10));
  }
  check('lancio lungo di 36 m: atterra in media a meno di 2 m dal punto voluto', errSum / 20 < 2, (errSum / 20).toFixed(2));
  // rimbalzo
  const r1 = { x: 0, y: 0.2, z: 0, vx: 5, vy: -3, vz: 0, spin: 0, topspin: 0 }, r2 = { x: 0, y: 0.2, z: 0, vx: 5, vy: -12, vz: 0, spin: 0, topspin: 0 };
  for (let i = 0; i < 6; i++) { A.stepBallPhysics(r1, 1 / 60); A.stepBallPhysics(r2, 1 / 60); }
  check('rimbalzo: un impatto forte restituisce meno energia di uno debole', r2.vy / 12 < r1.vy / 3, (r1.vy / 3).toFixed(2) + ' / ' + (r2.vy / 12).toFixed(2));
}
{
  // movimento: accelerazione progressiva, frenata più rapida, sprint meno agile nelle curve
  const s = scene({ facing: Math.PI, tx: 3, tz: 3 }), p = s.m.teams[0].players[7];
  p.vx = p.vz = 0; p.energy = 100;
  const top = p.maxSpeed(true);
  let t = 0, t50 = 0;
  while (p.speed() < top * 0.9 && t < 6) { p.moveDir(1, 0, true, 1 / 60); t += 1 / 60; if (!t50 && p.speed() > top * 0.5) t50 = t; }
  // con accelerazione costante il 50% arriverebbe al 55.5% del tempo per il 90%: qui molto prima (curva progressiva)
  check('accelerazione progressiva: metà velocità rapida, l\'ultimo tratto più lento', t50 < t * 0.45 && t > 1 && t < 4, t50.toFixed(2) + ' / ' + t.toFixed(2));
  let tb = 0;
  while (p.speed() > 0.5 && tb < 6) { p.moveDir(0, 0, false, 1 / 60); tb += 1 / 60; }
  check('frenare è più rapido che accelerare', tb < t * 0.6, tb.toFixed(2) + ' / ' + t.toFixed(2));
  const turn = sprint => {
    p.vx = (sprint ? top : top * 0.6); p.vz = 0; p.sprinting = sprint;
    let tt = 0; while (Math.atan2(p.vz, p.vx) < Math.PI / 2 * 0.9 && tt < 5) { p.moveDir(0, 1, sprint, 1 / 60); tt += 1 / 60; }
    return tt;
  };
  const tj = turn(false), ts = turn(true);
  check('cambio di direzione di 90 gradi: in sprint serve più tempo che in corsa', ts > tj, tj.toFixed(2) + ' / ' + ts.toFixed(2));
  // urti: chi pesa di più sposta di più
  const m = s.m, a = m.teams[0].players[2], c = m.teams[1].players[2];
  a.x = 0; a.z = 20; c.x = 0.5; c.z = 20; a.vx = c.vx = 0; a.vz = c.vz = 0;
  a.data.attr.physical = 95; c.data.attr.physical = 40; a.data.look.height = 1.92; c.data.look.height = 1.70;
  m.separate();
  check('urto: nessuna compenetrazione e il più pesante si sposta meno', Math.abs(a.x - 0) < Math.abs(c.x - 0.5), (a.x).toFixed(3) + ' / ' + (c.x - 0.5).toFixed(3));
  // pallone contro un giocatore che non lo può giocare: rimbalza
  const st = m.teams[1].players[3];
  st.x = 5; st.z = -10; st.vx = st.vz = 0; st.stunned = 1;
  m.ball.owner = null; m.ball.x = 3.5; m.ball.z = -10; m.ball.y = 0.5; m.ball.vx = 15; m.ball.vz = 0; m.ball.vy = 0; m.ball.lastTouch = null;
  for (let i = 0; i < 12; i++) { m.stepBallFree(1 / 60); m.ballBodyBlock(); }
  check('pallone contro il corpo di un giocatore a terra: rimbalza invece di attraversarlo', m.ball.vx < 0 && m.ball.x < 5, m.ball.vx.toFixed(1));
}

console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
process.exit(fail ? 1 : 0);
