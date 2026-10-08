// Test del relay delle partite online nel Worker (wrangler dev: Worker + Durable Object "Relay" in workerd),
// con il codice di rete vero del gioco (NetLink, HostSession, ClientSession di src/client/12_net.js) e WebSocket veri.
// Tutti allo stesso indirizzo /relay: 5 giocatori nella stessa partita e un'altra partita in contemporanea.
// node test/relay_test.js
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// i file del gioco sono nelle sottocartelle di src/: li trova scripts/sorgenti.js
const { gameFiles } = createRequire(import.meta.url)('../../scripts/sorgenti.js');
const PORT = 8796, BASE = 'http://127.0.0.1:' + PORT, URL_RELAY = 'ws://127.0.0.1:' + PORT + '/relay';
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

// codice di rete e simulazione del gioco, come in tests/net_test.js
const files = gameFiles(/^(0[1-8]|12)_/);
let code = 'var GAME_VERSION = "test";\n' + files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
code += '\n;globalThis.__api = { Match, buildDatabase, setSeed, NET, NetLink, HostSession, ClientSession };';
vm.runInThisContext(code);
const A = globalThis.__api;

let ok = 0, fail = 0;
const check = (n, c, x) => { if (c) { ok++; console.log('OK  ', n); } else { fail++; console.log('FAIL', n, x === undefined ? '' : x); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (fn()) return true; await wait(20); } return false; }

let server;
async function start() {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-relay-'));
  if (!fs.existsSync(path.join(ROOT, '.dev.vars'))) fs.copyFileSync(path.join(ROOT, '.dev.vars.example'), path.join(ROOT, '.dev.vars'));
  execFileSync('node', ['../build.js', 'engine'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'campo-aperto', '--local', '--persist-to', persist], { cwd: ROOT, stdio: 'ignore' });
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist], { cwd: ROOT, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + '/api/status')).ok) return; } catch (e) { /* */ } await wait(500); }
  throw new Error('server non partito');
}
function stop() { try { process.kill(-server.pid, 'SIGTERM'); } catch (e) { /* */ } }

function loops(host, clients) {
  let last = performance.now();
  return setInterval(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    if (host.match) host.update(dt, { mx: 0, mz: 0, sprint: false, shoot: false, pressed: { pass: !!host.match.setPieceReady } });
    for (const c of clients) if (c.match) { c.update(dt); if (c.inputFn) c.sendInput(c.inputFn()); }
  }, 16);
}

async function main() {
  await start();
  A.setSeed(5);
  const db = A.buildDatabase(2026);

  const info = await fetch(BASE + '/relay').then(r => r.json());
  check('GET /relay: relay presente (protocollo 1)', info.relay === true && info.protocol === 1);
  const probe = await new A.NetLink(URL_RELAY).open(4000, 'op=probe').then(ws => { ws.close(); return true; }, () => false);
  check('prova del collegamento (op=probe) senza creare stanze', probe);

  // --- partita 1: l'host crea, riceve un codice (mai con la L delle partite in rete locale)
  const hostLink = new A.NetLink(URL_RELAY);
  const created = await hostLink.create('Simone');
  check('crea partita sul Worker: codice ' + created.code, A.NET.CODE_RE.test(created.code) && created.code[0] !== 'L');
  const host = new A.HostSession(hostLink, db, 'Simone');

  // --- partita 2 in contemporanea, stesso indirizzo
  const host2Link = new A.NetLink(URL_RELAY);
  const created2 = await host2Link.create('Altro');
  const host2 = new A.HostSession(host2Link, db, 'Altro');
  check('seconda partita allo stesso indirizzo: codice diverso ' + created2.code, created2.code !== created.code && A.NET.CODE_RE.test(created2.code));

  // --- errori
  let err = null;
  try { await new A.NetLink(URL_RELAY).join('ZZZZZZ', 'X'); } catch (e) { err = e; }
  check('codice inesistente -> NOT_FOUND', err && err.code === 'NOT_FOUND', err && err.code);
  err = null;
  try { await new A.NetLink(URL_RELAY).join('abc', 'X'); } catch (e) { err = e; }
  check('codice malformato -> rifiutato dal gioco', err && err.code === 'BAD_CODE');
  const raw = await new A.NetLink(URL_RELAY).open(4000, 'code=' + created.code);
  const vr = await new Promise(r => { raw.onmessage = e => r(JSON.parse(e.data)); raw.send(JSON.stringify({ t: 'join', v: 999, code: created.code })); });
  check('protocollo diverso -> VERSION', vr.t === 'error' && vr.code === 'VERSION');
  const vr2 = await new Promise(r => { raw.onmessage = e => r(JSON.parse(e.data)); raw.send(JSON.stringify({ t: 'join', v: 1, code: created2.code, name: 'furbo' })); });
  check('socket aperto per una stanza non entra in un\'altra cambiando codice', vr2.t === 'error' && vr2.code === 'NOT_FOUND');
  const vr3 = await new Promise(r => { raw.onmessage = e => r(JSON.parse(e.data)); raw.send(JSON.stringify({ t: 'create', v: 1, name: 'furbo' })); });
  check('create con un codice di join -> rifiutato', vr3.t === 'error');
  raw.close();

  // --- 4 amici entrano nella partita 1 (5 persone in tutto), uno entra nella partita 2
  const names = ['Luca', 'Marta', 'Gio', 'Ale'];
  const links = names.map(() => new A.NetLink(URL_RELAY));
  await Promise.all(links.map((l, i) => l.join(i === 0 ? created.code.toLowerCase() : created.code, names[i])));
  const clients = links.map((l, i) => { const c = new A.ClientSession(l, db, names[i]); c.hello(); return c; });
  const o2Link = new A.NetLink(URL_RELAY);
  await o2Link.join(created2.code, 'Ospite');
  const o2 = new A.ClientSession(o2Link, db, 'Ospite'); o2.hello();
  await until(() => clients.every(c => c.lobby && c.lobby.members.length === 5) && o2.lobby && o2.lobby.members.length === 2);
  check('partita 1: tutti e 5 vedono 5 giocatori', clients.every(c => c.lobby && c.lobby.members.length === 5), clients.map(c => c.lobby && c.lobby.members.length).join());
  check('partita 2: separata (2 giocatori, nessuno della partita 1)', o2.lobby && o2.lobby.members.length === 2 && !o2.lobby.members.some(m => names.includes(m.name)));
  // squadre: Simone e Marta in casa, Luca, Gio e Ale ospiti
  const sides = [1, 0, 1, 1];
  clients.forEach((c, i) => c.requestSide(sides[i]));
  const sideOf = id => clients[0].lobby.members.find(m => m.id === id).side;
  await until(() => links.every((l, i) => sideOf(l.id) === sides[i]));
  check('squadre scelte dai client e applicate dall\'host (2 contro 3)', links.every((l, i) => sideOf(l.id) === sides[i]));

  // --- avvio delle due partite
  host.setSettings({ home: 1, away: 5, halfSeconds: 120, difficulty: 1 });
  host.start();
  o2.requestSide(1);
  await wait(300);
  host2.start();
  await until(() => clients.every(c => c.match) && o2.match);
  check('partita 1 avviata per tutti e 5 (5 umani in campo)', clients.every(c => c.match) && host.match.humans.length === 5, host.match && host.match.humans.length);
  check('partita 2 avviata separatamente', !!o2.match && host2.match.humans.length === 2);
  const L1 = loops(host, clients), L2 = loops(host2, [o2]);
  clients[0].inputFn = () => ({ mx: 1, mz: 0, sprint: true, shoot: false, pressed: {} });
  clients[3].inputFn = () => ({ mx: 0, mz: 1, sprint: false, shoot: false, pressed: {} });
  await until(() => host.match.state === 'PLAY', 8000);
  await wait(1500);
  const hL = host.match.humanById(links[0].id), hA = host.match.humanById(links[3].id);
  check('comandi di due client diversi arrivano all\'host', hL.input && hL.input.mx === 1 && hA.input && hA.input.mz === 1);
  await wait(300);
  const sync = c => Math.hypot(host.match.ball.x - c.match.ball.x, host.match.ball.z - c.match.ball.z);
  const ds = clients.map(sync);
  check('stato della partita sincronizzato su tutti e 4 i client (palla < 3 m)', ds.every(d => d < 3), ds.map(d => d.toFixed(2)).join(' '));
  check('la partita 2 riceve il suo stato, non quello della partita 1', Math.hypot(host2.match.ball.x - o2.match.ball.x, host2.match.ball.z - o2.match.ball.z) < 3 && o2.match.teams[0].data.name === host2.match.teams[0].data.name);

  // --- caduta di rete di un client e rientro automatico nello stesso posto
  const peerLog = [];
  hostLink.on('peer', e => peerLog.push(e.ev + ':' + e.id));
  links[1].on('reconnected', () => peerLog.push('client-reconnected'));
  links[1].ws.close();
  await until(() => !host.match.humanById(links[1].id), 3000);
  await until(() => peerLog.includes('client-reconnected'), 10000);
  check('client caduto: rientra da solo nella stessa partita', peerLog.includes('client-reconnected') && links[1].state === 'online', JSON.stringify(peerLog));
  await until(() => !!host.match.humanById(links[1].id), 3000);
  check('dopo il rientro controlla di nuovo un calciatore', !!host.match.humanById(links[1].id), JSON.stringify({ peerLog, id: links[1].id, member: host.members.get(links[1].id), slots: host.slots }));

  // --- l'host della partita 1 esce: i suoi giocatori vengono avvisati, la partita 2 continua
  let closed = 0;
  links.forEach(l => l.on('closed', () => { closed++; }));
  hostLink.leave();
  await until(() => closed === 4, 4000);
  check('host esce: tutti e 4 i client avvisati', closed === 4, closed);
  const b0 = o2.match.ball.x;
  await wait(800);
  check('la partita 2 continua dopo la chiusura della partita 1', o2Link.state === 'online' && host2.match && (o2.snaps.length > 0));
  let gone = null;
  try { await new A.NetLink(URL_RELAY).join(created.code, 'Tardi'); } catch (e) { gone = e; }
  check('codice della partita chiusa: non esiste più', gone && gone.code === 'NOT_FOUND');
  clearInterval(L1); clearInterval(L2);
  host2Link.leave(); o2Link.leave();
  void b0;
}

main().catch(e => { console.error(e); fail++; }).finally(() => {
  stop();
  console.log('\n' + ok + ' PASS, ' + fail + ' FAIL');
  setTimeout(() => process.exit(fail ? 1 : 0), 300);
});
