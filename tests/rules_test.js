const fs = require('fs'), path = require('path');
const files = fs.readdirSync(path.join(__dirname, '../src')).filter(f => /^0[1-8]_/.test(f)).sort();
let code = files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, CONFIG, offsideLineU, doGroundPass, doShot };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
let ok = 0, fail = 0;
function check(name, cond, extra) { if (cond) { ok++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra || ''); } }
function fresh(human) {
  A.setSeed(5);
  const db = A.buildDatabase(9);
  const m = new A.Match(db[0], db[1], { halfSeconds: 180, humanTeam: human === undefined ? -1 : human });
  m.setState('PLAY'); m.predTimer = 0;
  return m;
}
const noInput = { mx: 0, mz: 0, sprint: false, shoot: false, pressed: {} };
function run(m, secs, input) { for (let i = 0; i < secs * 60; i++) m.update(1 / 60, input || noInput); }
function freeze(m) { for (const p of m.allPlayers()) { p.stunned = 99; p.kickCooldown = 99; } }

// rimessa laterale
let m = fresh(); freeze(m); const t0 = m.teams[0];
m.ball.x = 10; m.ball.z = 33; m.ball.vz = 6; m.ball.lastTouch = t0.players[5];
run(m, 0.5);
check('palla oltre la linea laterale -> rimessa avversaria', m.pendingSetPiece && m.pendingSetPiece.type === 'THROW_IN' && m.pendingSetPiece.team === m.teams[1]);
run(m, 1.5);
check('dopo il fischio parte il piazzato', m.state === 'SETPIECE', m.state);
for (const p of m.allPlayers()) { p.stunned = 0; p.kickCooldown = 0; }
run(m, 6);
check('la rimessa viene battuta e si torna a giocare', m.state !== 'SETPIECE' && m.state !== 'DEAD', m.state);

// rinvio dal fondo: attaccante (squadra 0 attacca +x) tocca per ultimo
m = fresh(); freeze(m);
m.ball.x = 51; m.ball.z = 12; m.ball.vx = 8; m.ball.lastTouch = m.teams[0].players[9];
run(m, 0.5);
check('fondo toccato dall attaccante -> rinvio dal fondo', m.pendingSetPiece && m.pendingSetPiece.type === 'GOAL_KICK' && m.pendingSetPiece.team === m.teams[1]);
// corner
m = fresh(); freeze(m);
m.ball.x = 51; m.ball.z = -12; m.ball.vx = 8; m.ball.lastTouch = m.teams[1].players[2];
run(m, 0.5);
check('fondo toccato dal difensore -> calcio d angolo', m.pendingSetPiece && m.pendingSetPiece.type === 'CORNER' && m.pendingSetPiece.team === m.teams[0]);
// gol
m = fresh(); freeze(m);
m.ball.x = 50; m.ball.z = 1; m.ball.y = 0.5; m.ball.vx = 15; m.ball.lastTouch = m.teams[0].players[9];
run(m, 0.5);
check('palla in porta -> gol della squadra 0', m.state === 'GOAL' && m.teams[0].score === 1, m.state + ' ' + m.teams[0].score);
run(m, 4);
check('dopo il gol, calcio d inizio della squadra che ha subito', m.setPiece && m.setPiece.type === 'KICKOFF' && m.setPiece.team === m.teams[1]);
// palo
m = fresh(); freeze(m);
m.ball.x = 50; m.ball.z = 3.66; m.ball.y = 0.8; m.ball.vx = 20; m.ball.vy = 0; m.ball.lastTouch = m.teams[0].players[9];
let post = false; for (let i = 0; i < 30; i++) { m.update(1 / 60, noInput); if (m.events.some(e => e.type === 'post')) post = true; m.events.length = 0; }
check('la palla colpisce il palo e rimbalza', post, JSON.stringify({ x: m.ball.x, vx: m.ball.vx }));

// fuorigioco: attaccante oltre la linea riceve un passaggio
m = fresh();
for (const p of m.allPlayers()) { p.vx = 0; p.vz = 0; }
const passer = m.teams[0].players[6], fw = m.teams[0].players[9];
passer.x = 10; passer.z = 0; fw.x = 45; fw.z = 0;
m.teams[1].players.forEach((p, i) => { p.x = i === 0 ? 52 : 30 - i; p.z = (i - 5) * 5; p.stunned = 99; });
m.ball.owner = passer; m.ball.x = 10.5;
check('linea del fuorigioco calcolata', Math.abs(A.offsideLineU(m.teams[0]) - (52.5 + 29)) < 0.01, A.offsideLineU(m.teams[0]));
A.doGroundPass(passer, fw.x, fw.z, fw);
check('fuorigioco registrato al momento del passaggio', m.offside && m.offside.players.has(fw));
m.ball.x = fw.x - 0.3; m.ball.z = fw.z; m.ball.vx = 1; m.ball.vz = 0;
m.checkBallContact();
check('ricezione in fuorigioco -> punizione avversaria', m.pendingSetPiece && m.pendingSetPiece.type === 'FREE_KICK' && m.pendingSetPiece.team === m.teams[1]);

// fallo in area -> rigore
m = fresh();
const att = m.teams[0].players[9], def = m.teams[1].players[2];
att.x = 45; att.z = 2; def.x = 44; def.z = 2;
m.foul(def, att);
check('fallo in area -> rigore', m.pendingSetPiece && m.pendingSetPiece.type === 'PENALTY' && Math.abs(m.pendingSetPiece.x - 41.5) < 0.01);
run(m, 1.5);
for (const p of m.allPlayers()) { p.stunned = 0; }
let shotFired = false; for (let i = 0; i < 60 * 6; i++) { m.update(1 / 60, noInput); if (m.events.some(e => e.type === 'kick' && e.data.kind === 'shot')) shotFired = true; m.events.length = 0; }
check('il rigore viene calciato', shotFired);

// comandi umani: passaggio
m = fresh(0);
const me = m.teams[0].players[6];
me.x = 0; me.z = 0; me.facing = 0; me.stunned = 0; me.kickCooldown = 0;
m.ball.owner = me; m.controlled = me; m.possessionTeam = m.teams[0];
const mate = m.teams[0].players[9]; mate.x = 15; mate.z = 0;
m.update(1 / 60, { mx: 1, mz: 0, sprint: false, shoot: false, pressed: { pass: true } });
check('tasto passaggio: la palla parte verso il compagno', !m.ball.owner && m.ball.vx > 5, JSON.stringify({ vx: m.ball.vx, owner: !!m.ball.owner }));
// tiro caricato
m = fresh(0);
const sh = m.teams[0].players[9]; sh.x = 35; sh.z = 0; sh.facing = 0; sh.kickCooldown = 0;
m.ball.owner = sh; m.controlled = sh; m.possessionTeam = m.teams[0];
for (let i = 0; i < 30; i++) m.update(1 / 60, { mx: 0, mz: 0, sprint: false, shoot: true, pressed: {} });
m.update(1 / 60, { mx: 0, mz: 0, sprint: false, shoot: false, pressed: {} });
check('tiro caricato: la palla va verso la porta', !m.ball.owner && m.ball.vx > 15, m.ball.vx);
// cambio giocatore
m = fresh(0);
const before = m.controlled;
m.ball.owner = m.teams[1].players[9]; m.ball.x = m.ball.owner.x; m.ball.z = m.ball.owner.z;
m.update(1 / 60, { mx: 0, mz: 0, sprint: false, shoot: false, pressed: { switch: true } });
check('cambio giocatore', m.controlled && m.controlled !== before && !m.controlled.isGK);
// intervallo e cambio campo
m = fresh(); m.clock = 2699.9; const dir0 = m.teams[0].dir;
run(m, 0.2); check('fine primo tempo', m.state === 'HALFTIME', m.state);
run(m, 3.5); check('secondo tempo: squadre invertite', m.half === 2 && m.teams[0].dir === -dir0);

// ---------- 0.3.1: controlli e regole nuove ----------
const idle = (extra) => Object.assign({ mx: 0, mz: 0, sprint: false, shoot: false, press: false, pressed: {} }, extra || {});
// gol dopo una parata non riuscita: il gol è dell'attaccante, non un autogol del portiere
m = fresh(); freeze(m);
const shooter = m.teams[0].players[9];
shooter.x = 40; shooter.z = 0; m.ball.owner = shooter;
A.doShot(shooter, 1.5, 0.8);
m.ball.lastTouch = m.teams[1].gk;           // il portiere la sfiora ma non la ferma
m.ball.x = 52; m.ball.z = 1; m.ball.y = 0.8; m.ball.vx = 15; m.ball.vy = 0; m.ball.vz = 0;
run(m, 0.3);
check('parata non riuscita: gol del tiratore, non autogol', m.lastGoal && !m.lastGoal.own && m.lastGoal.scorer === shooter.data.name, JSON.stringify(m.lastGoal && { own: m.lastGoal.own, s: m.lastGoal.scorer }));
// vero autogol: un difensore calcia nella propria porta
m = fresh(); freeze(m);
const dfd = m.teams[1].players[3];
dfd.x = 48; dfd.z = 0; m.ball.owner = dfd;
A.doGroundPass(dfd, 60, 0, null);
m.ball.x = 52; m.ball.z = 0.5; m.ball.y = 0.3; m.ball.vx = 12;
run(m, 0.3);
check('rinvio nella propria porta: autogol', m.lastGoal && m.lastGoal.own === true);

// calcio d'inizio: passaggio senza direzione -> a un compagno, mai nel vuoto
m = fresh(0);
m.startKickoff(m.teams[0]);
let tries = 0;
while (!m.setPieceReady && tries++ < 600) m.update(1 / 60, idle());
m.update(1 / 60, idle({ pressed: { pass: true } }));
check('calcio d inizio senza direzione: passaggio a un compagno', m.state === 'PLAY' && m.pendingPass && m.pendingPass.to && m.pendingPass.to.team === m.teams[0], m.state);

// levetta analogica: poco inclinata = più lento
function speedWith(mag) {
  const mm = fresh(0); const p = mm.teams[0].players[6];
  p.x = 0; p.z = 0; p.vx = 0; p.vz = 0; mm.controlled = p; mm.ball.owner = mm.teams[1].players[9];
  for (let i = 0; i < 90; i++) mm.update(1 / 60, idle({ mx: 0, mz: mag }));
  return p.speed();
}
const vHalf = speedWith(0.35), vFull = speedWith(1);
check('levetta analogica: inclinazione parziale più lenta', vHalf < vFull * 0.75 && vHalf > 0.5, vHalf.toFixed(2) + ' / ' + vFull.toFixed(2));

// contrasto premuto da lontano: nessuna penalità (niente stordimento)
m = fresh(0);
let me2 = m.teams[0].players[5], carrier = m.teams[1].players[9];
me2.x = 0; me2.z = 0; carrier.x = 6; carrier.z = 0; m.controlled = me2; m.ball.owner = carrier; m.possessionTeam = m.teams[1];
m.update(1 / 60, idle({ pressed: { pass: true } }));
check('contrasto da lontano: niente penalità', me2.stunned <= 0 && m.ball.owner === carrier, me2.stunned);

// pressing assistito: tenendo premuto il calciatore va verso il portatore
m = fresh(0);
me2 = m.teams[0].players[5]; carrier = m.teams[1].players[9];
me2.x = 0; me2.z = 0; me2.vx = 0; me2.vz = 0; carrier.x = 12; carrier.z = 6; carrier.stunned = 99;
m.controlled = me2; m.ball.owner = carrier; m.possessionTeam = m.teams[1];
const d0 = Math.hypot(carrier.x - me2.x, carrier.z - me2.z);
for (let i = 0; i < 60; i++) m.update(1 / 60, idle({ press: true }));
const d1 = Math.hypot(carrier.x - me2.x, carrier.z - me2.z);
check('pressing: il calciatore si avvicina da solo al portatore', d1 < d0 - 3, d0.toFixed(1) + ' -> ' + d1.toFixed(1));

// cambio giocatore mentre un passaggio è in viaggio: va a chi lo deve ricevere
m = fresh(0);
const passer2 = m.teams[0].players[6], recv = m.teams[0].players[10];
passer2.x = -10; passer2.z = 0; recv.x = 15; recv.z = -15; m.controlled = passer2; m.ball.owner = passer2; m.possessionTeam = m.teams[0];
m.ball.x = passer2.x + 0.6; m.ball.z = passer2.z;
A.doGroundPass(passer2, recv.x, recv.z, recv);
m.update(1 / 60, idle({ pressed: { switch: true } }));
check('cambio durante il passaggio: controlli chi riceve', m.controlled === recv);
// aiuto ricezione: senza direzione chi riceve va verso la palla
const r0 = Math.hypot(m.ball.x - recv.x, m.ball.z - recv.z);
for (let i = 0; i < 20; i++) m.update(1 / 60, idle());
check('aiuto ricezione: chi riceve si muove incontro alla palla', recv.speed() > 1, recv.speed().toFixed(2));

// levetta destra: cambio verso la direzione indicata
m = fresh(0);
const cur = m.teams[0].players[6]; cur.x = 0; cur.z = 0;
m.teams[0].players.forEach((p, i) => { if (i && p !== cur) { p.x = -30 + i; p.z = 20; } });
const target = m.teams[0].players[3]; target.x = 0; target.z = -12;
m.controlled = cur; m.ball.owner = m.teams[1].players[9];
m.update(1 / 60, idle({ switchDir: [0, -1] }));
check('levetta destra: cambio sul compagno in quella direzione', m.controlled === target);

// tiro: direzione verso la porta = angolo lontano dal portiere; su/giù scelgono il palo
m = fresh(0);
const sh2 = m.teams[0].players[9];
const aimFwd = m.humanShotAim(sh2, { mx: 1, mz: 0 }), aimUp = m.humanShotAim(sh2, { mx: 0.7, mz: -0.7 });
check('mira: avanti sceglie un angolo, su sceglie il palo in alto', Math.abs(aimFwd) > 2 && aimUp < -2.5, aimFwd.toFixed(2) + ' ' + aimUp.toFixed(2));

// tocco rapidissimo del tiro (premuto e rilasciato nello stesso passo): parte comunque un tiro
m = fresh(0);
const sh3 = m.teams[0].players[9]; sh3.x = 35; sh3.z = 0; sh3.facing = 0; sh3.kickCooldown = 0;
m.ball.owner = sh3; m.controlled = sh3; m.possessionTeam = m.teams[0];
m.update(1 / 60, idle({ pressed: { shootDown: true } }));
m.update(1 / 60, idle());
check('tocco rapido del tiro: parte un tiro debole', !m.ball.owner && m.ball.vx > 8, m.ball.vx.toFixed(1));

// portiere umano con la palla: dopo qualche secondo rinvia da solo
m = fresh(0);
const gk0 = m.teams[0].gk; gk0.x = -50; gk0.z = 0;
m.ball.owner = gk0; m.controlled = gk0; m.possessionTeam = m.teams[0];
for (let i = 0; i < 60 * 7; i++) { m.update(1 / 60, idle()); if (m.ball.owner !== gk0) break; }
check('portiere umano: rinvio automatico se non si preme nulla', m.ball.owner !== gk0);

// rigore contro: la direzione tenuta sceglie il tuffo del portiere
m = fresh(0);
const kicker = m.teams[1].players[9];
kicker.x = -45; kicker.z = 2;
m.foul(m.teams[0].players[3], kicker);
const spx = m.pendingSetPiece.x;
for (let i = 0; i < 90; i++) m.update(1 / 60, idle({ mz: -1 }));
for (const p of m.allPlayers()) p.stunned = 0;
let dove = null;
for (let i = 0; i < 60 * 8 && dove === null; i++) { m.update(1 / 60, idle({ mz: -1 })); if (m.teams[0].gk.anim.dive > 0) dove = m.teams[0].gk.vz; }
check('rigore contro: il portiere si tuffa dal lato scelto (su = z negativo)', dove !== null && dove < 0, dove);

console.log('\nRisultato:', ok, 'superati,', fail, 'falliti');
process.exit(fail ? 1 : 0);
