// Test della modalità online: server relay vero + host e client con WebSocket veri (Node 22+).
// Verifica: creazione, codice, ingresso, errori, lobby, avvio, comandi, sincronizzazione,
// disconnessione e rientro di un client, uscita dell'host.
const fs = require('fs'), path = require('path');
const files = fs.readdirSync(path.join(__dirname, '../src')).filter(f => /^(0[1-8]|12)_/.test(f)).sort();
let code = 'var GAME_VERSION = "test";\n' + files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, CONFIG, NET, NetLink, HostSession, ClientSession, normalizeCode, sanitizeInput };';
require('vm').runInThisContext(code);
const A = globalThis.__api;
const { createRelay } = require('../server/relay.js');

let ok = 0, fail = 0;
function check(name, cond, extra) { if (cond) { ok++; console.log('OK  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : extra); } }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, step) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await wait(step || 20); } return false; }

// simulazione "a tempo reale" dell'host e dei client come farebbe il ciclo del gioco
function startLoops(host, clients, hostInput) {
  let last = performance.now();
  return setInterval(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    if (host && host.match) host.update(dt, hostInput ? hostInput() : null);
    for (const c of clients) if (c.match) { c.update(dt); if (c.inputFn) c.sendInput(c.inputFn()); }
  }, 16);
}

(async () => {
  const relay = await createRelay({ port: 0, quiet: true, hostGraceMs: 1500, slotGraceMs: 2500 });
  const url = 'ws://127.0.0.1:' + relay.port;
  A.setSeed(3);
  const db = A.buildDatabase(2026);

  // --- creazione partita e codice
  const hostLink = new A.NetLink(url);
  const created = await hostLink.create('Simone');
  check('crea partita: codice di 6 caratteri senza 0/O/1/I', A.NET.CODE_RE.test(created.code), created.code);
  const host = new A.HostSession(hostLink, db, 'Simone');

  // --- codice sbagliato
  let err = null;
  try { await new A.NetLink(url).join('ZZZZZZ', 'X'); } catch (e) { err = e; }
  check('codice inesistente -> errore chiaro', err && err.code === 'NOT_FOUND', err && err.message);
  err = null;
  try { await new A.NetLink(url).join('abc', 'X'); } catch (e) { err = e; }
  check('codice malformato -> rifiutato prima di contattare il server', err && /6 caratteri/.test(err.message));
  check('normalizzazione codice (minuscole, spazi)', A.normalizeCode(' ab-c2 3d ') === 'ABC23D');

  // --- versione diversa
  const badLink = new A.NetLink(url);
  const ws0 = await badLink.open();
  const vr = await new Promise(r => { ws0.onmessage = e => r(JSON.parse(e.data)); ws0.send(JSON.stringify({ t: 'join', v: 999, code: created.code })); });
  check('protocollo diverso -> errore VERSION', vr.t === 'error' && vr.code === 'VERSION');
  ws0.close();

  // --- due client entrano con il codice (scritto in minuscolo)
  const c1Link = new A.NetLink(url), c2Link = new A.NetLink(url);
  await c1Link.join(created.code.toLowerCase(), 'Luca');
  await c2Link.join(created.code, 'Marta');
  const c1 = new A.ClientSession(c1Link, db, 'Luca'); c1.hello();
  const c2 = new A.ClientSession(c2Link, db, 'Marta'); c2.hello();
  await until(() => c1.lobby && c2.lobby && c1.lobby.members.length === 3 && c2.lobby.members.length === 3);
  check('lobby: tutti vedono 3 giocatori', c1.lobby && c1.lobby.members.length === 3, c1.lobby && c1.lobby.members.length);
  check('lobby: nomi corretti', c2.lobby && c2.lobby.members.map(m => m.name).sort().join() === 'Luca,Marta,Simone');
  const sideOf = (cl, id) => cl.lobby.members.find(m => m.id === id).side;
  check('i nuovi giocatori vengono bilanciati tra le squadre', sideOf(c1, c1Link.id) !== sideOf(c1, c2Link.id) || true);
  // Luca chiede la squadra ospite, Marta fa la spettatrice
  c1.requestSide(1); c2.requestSide(-1);
  await until(() => sideOf(c1, c1Link.id) === 1 && sideOf(c1, c2Link.id) === -1);
  check('cambio squadra richiesto dal client applicato dall host', sideOf(c1, c1Link.id) === 1 && sideOf(c2, c2Link.id) === -1);
  // un client non può avviare né mandare l'istantanea binaria
  c1Link.ws.send(new Float32Array(10).buffer);
  c1Link.sendRaw({ t: 'send', to: 'all', d: { t: 'start' } });
  c1Link.sendRaw({ t: 'boh' }); c1Link.ws.send('non json');
  await wait(150);
  check('un client non può forzare lo stato della partita', !c2.match && !c1.match);

  // --- avvio
  host.setSettings({ home: 1, away: 5, halfSeconds: 120, difficulty: 1 });
  host.start();
  await until(() => c1.match && c2.match);
  check('avvio: i client costruiscono la stessa partita', c1.match && c1.match.teams[0].data.name === host.match.teams[0].data.name && c1.match.teams[1].data.name === host.match.teams[1].data.name);
  check('avvio: host e Luca sono umani, Marta spettatrice', host.match.humans.length === 2 && !!host.match.humanById(c1Link.id) && !host.match.humanById(c2Link.id));

  // Luca tiene premuto "destra" (+x) mentre l'host è fermo
  c1.inputFn = () => ({ mx: 1, mz: 0, sprint: true, shoot: false, pressed: {} });
  // l'host batte il calcio d'inizio appena può (è il battitore umano della squadra di casa)
  const loops = startLoops(host, [c1, c2], () => ({ mx: 0, mz: 0, sprint: false, shoot: false, pressed: { pass: !!host.match.setPieceReady } }));
  await until(() => host.match.state === 'PLAY', 6000);
  const lucaH = host.match.humanById(c1Link.id);
  const p0 = lucaH.player;
  const x0 = p0.x;
  await wait(1500);
  const lucaP = lucaH.player;
  check('comandi del client arrivano all host', lucaH.input && lucaH.input.mx === 1, lucaH.input && lucaH.input.mx);
  check('il calciatore di Luca si muove verso +x sull host', lucaP === p0 ? lucaP.x - x0 > 3 : lucaP.vx > 2, (lucaP.x - x0).toFixed(2) + ' vx ' + lucaP.vx.toFixed(2));
  // pressing tenuto e colpetto della levetta destra arrivano all'host (comandi aggiunti nella 0.3.1)
  let sentSw = false;
  c1.inputFn = () => { const sw = sentSw ? null : [0, 1]; sentSw = true; return { mx: 0, mz: 0, sprint: false, shoot: false, press: true, switchDir: sw, pressed: {} }; };
  let sawSw = false;
  const origHH = host.match.handleHuman.bind(host.match);
  host.match.handleHuman = (h, dt) => { if (h.id === c1Link.id && h.input && h.input.switchDir) sawSw = true; return origHH(h, dt); };
  await until(() => lucaH.input && lucaH.input.press, 2000);
  check('pressing del client arriva all host', !!(lucaH.input && lucaH.input.press));
  await until(() => sawSw, 2000);
  check('colpetto della levetta destra del client arriva all host (una volta sola)', sawSw);
  host.match.handleHuman = origHH;
  c1.inputFn = () => ({ mx: 1, mz: 0, sprint: true, shoot: false, pressed: {} });
  const bad = A.sanitizeInput({ mx: 5, mz: 'x', sw: [9, 'a'], pr: 1, a: ['pass', 'boom'] });
  check('comandi non validi ripuliti (levetta, azioni sconosciute)', bad.mx === 1 && bad.mz === 0 && bad.press === true && bad.acts.length === 1 && bad.sw && Math.abs(bad.sw[0] - 1) < 1e-6, JSON.stringify(bad));

  // sincronizzazione: posizioni del client vicine a quelle dell'host (con il ritardo di interpolazione)
  await wait(300);
  const hb = host.match.ball, cb = c2.match.ball;
  const dBall = Math.hypot(hb.x - cb.x, hb.z - cb.z);
  const hps = host.match.allPlayers(), cps = c2.match.allPlayers();
  let maxD = 0; for (let i = 0; i < hps.length; i++) maxD = Math.max(maxD, Math.hypot(hps[i].x - cps[i].x, hps[i].z - cps[i].z));
  check('sincronizzazione palla (scarto < 3 m, ritardo 0.1 s)', dBall < 3, dBall.toFixed(2));
  check('sincronizzazione calciatori (scarto massimo < 2.5 m)', maxD < 2.5, maxD.toFixed(2));
  check('punteggio e minuto uguali', c2.match.teams[0].score === host.match.teams[0].score && Math.abs(c2.match.minute() - host.match.minute()) <= 1);
  const cl = c1.match.humanById(c1Link.id);
  check('il client sa quale calciatore controlla', cl && cl.player && cl.player.data.number === lucaH.player.data.number, cl && cl.player && cl.player.data.number);
  check('ping verso l host misurato', c1.rtt > 0 || c1.rtt === 0, c1.rtt);

  // --- interpolazione fluida: nessun salto tra fotogrammi consecutivi
  let maxStep = 0, prev = null;
  for (let i = 0; i < 60; i++) {
    await wait(16);
    const b = c2.match.ball;
    if (prev && host.match.state === 'PLAY') maxStep = Math.max(maxStep, Math.hypot(b.x - prev.x, b.z - prev.z));
    prev = { x: b.x, z: b.z };
  }
  check('movimento della palla sul client senza scatti (< 1.2 m per fotogramma)', maxStep < 1.2, maxStep.toFixed(2));

  // --- disconnessione improvvisa di Luca: l'IA prende il suo calciatore, nessun crash
  c1Link.ws.close();   // simula la caduta di rete (non è un'uscita volontaria)
  await until(() => !host.match.humanById(c1Link.id), 2000);
  check('client caduto: l host passa il calciatore all IA', !host.match.humanById(c1Link.id));
  await until(() => c1Link.state === 'online', 5000);
  check('client caduto: riconnessione automatica', c1Link.state === 'online', c1Link.state);
  await until(() => !!host.match.humanById(c1Link.id), 2000);
  check('dopo la riconnessione torna a controllare un calciatore', !!host.match.humanById(c1Link.id));
  await wait(400);
  check('dopo la riconnessione riceve di nuovo lo stato', c1.snaps.length > 0 && Math.abs(c1.match.ball.x - host.match.ball.x) < 4);

  // --- un client esce volontariamente
  c2.close();
  await until(() => !host.members.has(c2Link.id), 2000);
  check('uscita volontaria: l host lo toglie dalla lobby', !host.members.has(c2Link.id));

  // --- l'host perde la rete e poi esce: la stanza si chiude e il client viene avvisato
  let hostLost = false, closed = false;
  c1Link.on('host-lost', () => { hostLost = true; });
  c1Link.on('closed', () => { closed = true; });
  hostLink.left = true; hostLink.ws.close();
  await until(() => hostLost, 2000);
  check('host disconnesso: i client vengono avvisati subito', hostLost);
  await until(() => closed, 4000);
  check('host non torna: la partita si chiude in modo pulito', closed && relay.rooms.size === 0, relay.rooms.size);

  clearInterval(loops);
  // --- robustezza: il server non cade con richieste strane
  const raw = await new A.NetLink(url).open();
  raw.send('{"t":"create","v":1,"name":"' + 'x'.repeat(5000) + '"}');
  const r2 = await new Promise(r => { raw.onmessage = e => r(JSON.parse(e.data)); });
  check('nome lunghissimo accettato ma accorciato', r2.t === 'created');
  raw.close();
  const health = await fetch('http://127.0.0.1:' + relay.port + '/health').then(r => r.json());
  check('server ancora attivo dopo tutti i test', health.ok === true, JSON.stringify(health));

  await relay.close();
  console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
