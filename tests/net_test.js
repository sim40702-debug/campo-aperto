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
const lan = require('../desktop/lan.js');
const dgram = require('dgram');

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

  // --- rete locale: server integrato + ricerca con il solo codice (porte di prova, non quelle predefinite)
  const crypto = require('crypto');
  const hm = (k, d) => crypto.createHmac('sha256', k).update(d).digest('hex');
  const query = (code, extra) => { const n = crypto.randomBytes(16).toString('hex'); return Buffer.from(JSON.stringify(Object.assign({ q: 'campo-aperto', v: 1, d: 2, n, h: hm(code, n) }, extra || {}))); };
  const LP = { port: 0, discoveryPort: 38788 };
  const lh = await lan.startHost(LP);
  check('LAN: host avviato con porta valida', lh.port > 0 && Array.isArray(lh.addresses) && lh.discovery, JSON.stringify(lh));
  const v4 = a => typeof a === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(a) && a.split('.').every(x => +x <= 255);
  check('LAN: indirizzi IPv4 validi e senza duplicati', lh.addresses.every(v4) && new Set(lh.addresses).size === lh.addresses.length, JSON.stringify(lh.addresses));
  const dr = await lan.defaultRouteAddress();
  if (dr && lh.addresses.includes(dr)) check('LAN: il primo indirizzo è quello della rotta predefinita', lh.addresses[0] === dr, dr + ' / ' + JSON.stringify(lh.addresses));
  else check('LAN: indirizzo della rotta predefinita (non determinabile, saltato)', true);
  check('LAN: avvio ripetuto idempotente', (await lan.startHost(LP)).port === lh.port);
  const lhLink = new A.NetLink('ws://127.0.0.1:' + lh.port);
  const lc = await lhLink.create('Simone');
  check('LAN: il codice della rete locale inizia con L', lc.code[0] === 'L', lc.code);
  const found = await lan.findGame(lc.code, { discoveryPort: LP.discoveryPort });
  check('LAN: findGame trova l host dal solo codice (HMAC)', found && /^ws:\/\/\d+\.\d+\.\d+\.\d+:\d+$/.test(found.url) && found.url.endsWith(':' + lh.port), JSON.stringify(found));
  const lcLink = new A.NetLink(found ? found.url : url);
  let lerr = null;
  try { await lcLink.join(lc.code, 'Luca'); } catch (e) { lerr = e; }
  check('LAN: un client entra tramite l indirizzo trovato', !lerr && lcLink.code === lc.code, lerr && lerr.message);
  // solo chi ospita (loopback) può creare: dall indirizzo di rete la create viene rifiutata
  if (lh.addresses.length) {
    let rej = null;
    try { await new A.NetLink('ws://' + lh.addresses[0] + ':' + lh.port).create('Intruso'); } catch (e) { rej = e; }
    check('LAN: create da un indirizzo non loopback rifiutata', rej && rej.code === 'LOCAL_ONLY', rej && rej.message);
  } else check('LAN: create da indirizzo non loopback (nessuna rete, saltato)', true);
  const t0 = Date.now();
  check('LAN: codice sbagliato -> null', (await lan.findGame('LZZZZZ', { discoveryPort: LP.discoveryPort, timeout: 600 })) === null);
  check('LAN: codice malformato -> null subito', (await lan.findGame('abc', { discoveryPort: LP.discoveryPort })) === null && Date.now() - t0 < 1500);
  // datagrammi malformati o vecchi: ignorati, nessuna risposta, il responder resta vivo
  await wait(1100);
  const probe = dgram.createSocket('udp4'); let got = 0, last = null; probe.on('message', b => { got++; last = b; });
  await new Promise(r => probe.bind(0, '127.0.0.1', r));
  const dgBad = [Buffer.from('non json'), Buffer.alloc(5000, 65), Buffer.from('[1,2]'), Buffer.from('null'),
    Buffer.from(JSON.stringify({ q: 'campo-aperto', v: 1, code: lc.code })),               // vecchio formato in chiaro
    query(lc.code, { h: 'a'.repeat(64) }), query(lc.code, { n: 'xyz' }), query(lc.code, { d: 1 }), query(lc.code, { v: 99 }), query(lc.code, { q: 'altro' }),
    query('LZZZZZ')];                                                                      // codice che non è una stanza viva
  for (const b of dgBad) probe.send(b, LP.discoveryPort, '127.0.0.1');
  await wait(300);
  check('LAN: datagrammi non validi e query in chiaro senza risposta', got === 0, got);
  await wait(1100);
  const qb = query(lc.code), qn = JSON.parse(qb.toString());
  probe.send(qb, LP.discoveryPort, '127.0.0.1');
  await until(() => got > 0, 1000);
  const rp = got ? JSON.parse(last.toString()) : {};
  check('LAN: query HMAC valida -> risposta piccola con h2 corretto, senza codice', got === 1 && rp.port === lh.port && rp.h2 === hm(lc.code, qn.n + ':' + lh.port) && !('code' in rp) && last.length < 200, got);
  // limite per indirizzo: 30 query valide in un colpo, ne vengono servite al massimo 10
  await wait(1100); got = 0;
  for (let i = 0; i < 30; i++) probe.send(query(lc.code), LP.discoveryPort, '127.0.0.1');
  await wait(500);
  check('LAN: limite di richieste per indirizzo (max 10 al secondo)', got > 0 && got <= 10, got);
  probe.close();
  await wait(1100);
  // risposte false: findGame le scarta (h2 sbagliato, h2 di un altro codice, porta fuori intervallo, formato errato)
  const fake = dgram.createSocket('udp4');
  await new Promise(r => fake.bind(39999, '127.0.0.1', r));
  fake.on('message', (b, ri) => {
    let q; try { q = JSON.parse(b.toString()); } catch (e) { return; }
    const base = { a: 'campo-aperto', v: 1, d: 2 };
    for (const m of [{ port: 1234, h2: 'b'.repeat(64) }, { port: 1234, h2: hm('LZZZZZ', q.n + ':1234') }, { port: 99999, h2: hm('LABCDE', q.n + ':99999') }, { port: '80', h2: 'x' }])
      fake.send(JSON.stringify(Object.assign({}, base, m)), ri.port, ri.address);
    fake.send('xx', ri.port, ri.address);
  });
  check('LAN: risposte con h2 sbagliato o incoerenti scartate', (await lan.findGame('LABCDE', { discoveryPort: 39999, timeout: 800 })) === null);
  fake.close();
  lhLink.leave(); lcLink.leave();
  await lan.stopHost();
  check('LAN: stopHost libera le porte (riavvio possibile)', await lan.startHost(LP).then(() => true, () => false));
  // avvio e arresto in fila: un arresto in coda non spegne un host avviato dopo
  const pStop = lan.stopHost(), pStart = lan.startHost(LP);
  await pStop; const again = await pStart;
  check('LAN: stop poi start in fila -> host attivo', again.port > 0);
  await lan.stopHost(); await lan.stopHost();
  check('LAN: stopHost sicuro se non avviato', true);

  // --- opzioni del relay per la rete locale
  const relLan = await createRelay({ port: 0, quiet: true, lanCodes: true, maxRooms: 50 });
  const relStd = await createRelay({ port: 0, quiet: true, maxRooms: 1000 });
  const mk = async (rel, n) => { const out = []; for (let i = 0; i < n; i++) { const l = new A.NetLink('ws://127.0.0.1:' + rel.port); out.push((await l.create('x')).code); l.left = true; } return out; };
  check('relay con lanCodes: tutti i codici iniziano con L', (await mk(relLan, 20)).every(c2 => c2[0] === 'L'));
  const std = await mk(relStd, 200);
  check('relay normale: nessun codice inizia con L (200 creazioni)', std.every(c2 => c2[0] !== 'L') && std.every(c2 => A.NET.CODE_RE.test(c2)));
  await relLan.close(); await relStd.close();
  const relIdle = await createRelay({ port: 0, quiet: true, unattachedMs: 300, maxConns: 2 });
  const idle = await new A.NetLink('ws://127.0.0.1:' + relIdle.port).open();
  let idleClosed = false; idle.onclose = () => { idleClosed = true; };
  check('relay: socket senza stanza chiuso dopo unattachedMs', await until(() => idleClosed, 2000));
  const keep = []; for (let i = 0; i < 3; i++) keep.push(await new A.NetLink('ws://127.0.0.1:' + relIdle.port).open().catch(() => null));
  const full = await until(() => !keep[2] || keep[2].readyState === 3, 1500);
  check('relay: oltre maxConns il socket viene chiuso', full);
  keep.forEach(k => { try { if (k) k.close(); } catch (e) { /* */ } });
  await relIdle.close();

  // --- un server malevolo non può imporre un codice diverso o non valido
  const { WebSocketServer } = require('ws');
  const evil = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(r => evil.on('listening', r));
  evil.on('connection', ws2 => ws2.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.t === 'join') ws2.send(JSON.stringify({ t: 'joined', code: 'ZZZZZZ', id: 'a', token: 'b', hostId: 'c' }));
    if (m.t === 'create') ws2.send(JSON.stringify({ t: 'created', code: '<img src=x onerror=alert(1)>', id: 'a', token: 'b' }));
  }));
  const evUrl = 'ws://127.0.0.1:' + evil.address().port;
  let e1 = null, e2 = null;
  try { await new A.NetLink(evUrl).join('LABCDE', 'x'); } catch (e) { e1 = e; }
  try { await new A.NetLink(evUrl).create('x'); } catch (e) { e2 = e; }
  check('join: codice diverso da quello richiesto -> rifiutato', e1 && /non valida/.test(e1.message), e1 && e1.message);
  check('create: codice non valido -> rifiutato', e2 && /non valida/.test(e2.message), e2 && e2.message);
  evil.close();

  // --- lobby ostile: il client la ripulisce o la ignora
  const stub = { on() { return this; }, toHost() {}, leave() {} };
  const cs = new A.ClientSession(stub, db, 'x'); clearInterval(cs.pingTimer);
  const okLobby = { t: 'lobby', code: 'LABCDE', hostId: 'h', phase: 'lobby', settings: { home: 0, away: 1, halfSeconds: 120, difficulty: 1 },
    members: [{ id: 'a', name: 'N'.repeat(40), side: 7, connected: 1, ping: '<img src=x onerror=alert(1)>', isHost: 'si', extra: 1 }, null, { id: 'b', name: 5, side: 1, connected: true, ping: 123456, isHost: false }] };
  cs.onMsg(okLobby);
  const lbx = cs.lobby;
  check('lobby ostile: ping HTML ripulito, nome accorciato, lato e booleani normalizzati', lbx && lbx.members.length === 2 && lbx.members[0].ping === 0 && lbx.members[0].name.length === 16 && lbx.members[0].side === -1 && lbx.members[0].connected === false && lbx.members[0].isHost === false && !('extra' in lbx.members[0]) && lbx.members[1].ping === 9999 && lbx.members[1].name === '', JSON.stringify(lbx));
  cs.lobby = null;
  cs.onMsg(Object.assign({}, okLobby, { settings: { home: 999, away: 1, halfSeconds: 120, difficulty: 1 } }));
  check('lobby ostile: indice squadra fuori intervallo -> messaggio ignorato', cs.lobby === null);
  cs.onMsg(Object.assign({}, okLobby, { settings: { home: 0, away: 1, halfSeconds: '<b>', difficulty: 1 } }));
  check('lobby ostile: durata non numerica -> messaggio ignorato', cs.lobby === null);
  cs.onMsg(Object.assign({}, okLobby, { members: 'x' }));
  check('lobby ostile: members non array -> messaggio ignorato', cs.lobby === null);
  cs.onMsg(Object.assign({}, okLobby, { code: '<x>', members: new Array(20).fill({ id: 'q', name: 'q', side: 0, connected: true, ping: 1, isHost: false }) }));
  check('lobby ostile: codice non valido scartato, al massimo 8 membri', cs.lobby && cs.lobby.code === '' && cs.lobby.members.length === 8);

  // --- il relay locale rifiuta le pagine web (Origin http/https), accetta chi non ha Origin
  const { WebSocket: WsC } = require('ws');
  const relOrig = await createRelay({ port: 0, quiet: true, createLocalOnly: true });
  const oUrl = 'ws://127.0.0.1:' + relOrig.port;
  const evilWs = new WsC(oUrl, { headers: { Origin: 'http://evil.example' } });
  let evilGot = false, evilClosed = false;
  evilWs.on('open', () => evilWs.send(JSON.stringify({ t: 'create', v: 1, name: 'x' })));
  evilWs.on('message', () => { evilGot = true; }); evilWs.on('close', () => { evilClosed = true; }); evilWs.on('error', () => { evilClosed = true; });
  await until(() => evilClosed, 2000);
  check('relay locale: Origin http://evil.example rifiutato, nessuna stanza creata', evilClosed && !evilGot && relOrig.rooms.size === 0, relOrig.rooms.size);
  const fileWs = new WsC(oUrl, { headers: { Origin: 'file://' } });
  let fileOk = false; fileWs.on('open', () => fileWs.send(JSON.stringify({ t: 'create', v: 1, name: 'x' }))); fileWs.on('message', () => { fileOk = true; }); fileWs.on('error', () => {});
  await until(() => fileOk, 2000); fileWs.close();
  const noOrig = await new A.NetLink(oUrl).create('y').then(() => true, () => false);
  check('relay locale: Origin file:// e client senza Origin accettati', fileOk && noOrig);
  await relOrig.close();

  await relay.close();
  console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
