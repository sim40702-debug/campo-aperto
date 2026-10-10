// Classifica online (punti e livelli) e amici online, contro il server vero in locale (wrangler dev), database nuovo.
// node test/online_test.js   (prima: npm run engine)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8794, BASE = 'http://127.0.0.1:' + PORT;
const PERSIST = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-online-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

let pass = 0, failN = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log('PASS', name); } else { failN++; console.log('FAIL', name, info === undefined ? '' : JSON.stringify(info).slice(0, 500)); }
}

let server = null;
async function startServer() {
  if (!fs.existsSync(path.join(ROOT, '.dev.vars'))) fs.copyFileSync(path.join(ROOT, '.dev.vars.example'), path.join(ROOT, '.dev.vars'));
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', PERSIST], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + '/api/status'); if (r.ok) return; } catch (e) { /* non ancora */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('il server non parte:\n' + log);
}
async function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (e) { /* già chiuso */ }
  await new Promise(r => setTimeout(r, 1500));
  server = null;
}
async function api(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: r.status, body: data };
}
const GET = (p, tok) => api('GET', p, undefined, tok);
const POST = (p, b, tok) => api('POST', p, b === undefined ? {} : b, tok);

// chiavi che non devono mai arrivare a un altro giocatore
const FORBIDDEN = ['id', 'user_id', 'userId', 'owner_id', 'host_id', 'email', 'password', 'pass_hash', 'pass_salt', 'token', 'token_hash', 'ip', 'balance', 'username_lc'];
function forbiddenKeys(obj, allow) {
  const bad = [];
  (function walk(o, p, inComp) {
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, p + '[' + i + ']', inComp));
    if (o && typeof o === 'object') for (const k of Object.keys(o)) {
      // nello stato della competizione "id" è il codice della partita (f1, f2…) o della sfida del tabellone
      if (FORBIDDEN.includes(k) && !(k === 'id' && inComp) && !(allow || []).includes(k)) bad.push(p + '.' + k);
      walk(o[k], p + '.' + k, inComp || k === 'comp');
    }
  })(obj, '', false);
  return bad;
}

async function main() {
  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'campo-aperto', '--local', '--persist-to', PERSIST], { cwd: ROOT, stdio: 'ignore' });
  await startServer();
  const sfx = Date.now().toString(36).slice(-4);
  const names = { A: 'anna_' + sfx, B: 'bruno_' + sfx, C: 'carla_' + sfx };
  const tok = {};
  for (const k of Object.keys(names)) tok[k] = (await POST('/api/auth/register', { username: names[k], password: 'password-' + names[k] })).body.token;
  const { A, B, C } = tok;
  const mid = n => 'ABC234:m' + sfx + n;

  check('risultato solo con l\'accesso (401 senza)', (await POST('/api/online/report', { match: mid(1), side: 0, score: [2, 1] })).status === 401);
  check('codice della partita non valido: 400', (await POST('/api/online/report', { match: 'x', side: 0, score: [2, 1] }, A)).status === 400);
  check('risultato non valido: 400', (await POST('/api/online/report', { match: mid(1), side: 0, score: [2, -1] }, A)).status === 400);
  let r = await POST('/api/online/report', { match: mid(1), side: 0, score: [2, 1] }, A);
  check('solo una squadra: in attesa, niente punti', r.status === 200 && r.body.status === 'waiting' && r.body.points === 0, r.body);
  r = await POST('/api/online/report', { match: mid(1), side: 1, score: [2, 1] }, B);
  check('anche l\'altra squadra con lo stesso risultato: confermata, 5 punti a chi perde', r.body.status === 'counted' && r.body.points === 5, r.body);
  r = await POST('/api/online/report', { match: mid(1), side: 0, score: [2, 1] }, A);
  check('chi ha vinto ha 30 punti (secondo invio: niente di doppio)', r.body.status === 'counted' && r.body.points === 30, r.body);
  let me = (await GET('/api/me/online', A)).body;
  check('i miei numeri: 30 punti, livello 2, 1 vinta, gol 2-1, primo', me.points === 30 && me.level === 2 && me.won === 1 && me.goalsFor === 2 && me.goalsAgainst === 1 && me.rank === 1, me);
  // risultati diversi: niente punti
  await POST('/api/online/report', { match: mid(2), side: 0, score: [3, 0] }, A);
  r = await POST('/api/online/report', { match: mid(2), side: 1, score: [0, 3] }, B);
  check('risultati diversi: la partita non vale', r.body.status === 'mismatch' && r.body.points === 0, r.body);
  // pareggio con un compagno di squadra in più (C con A)
  await POST('/api/online/report', { match: mid(3), side: 0, score: [1, 1] }, A);
  await POST('/api/online/report', { match: mid(3), side: 0, score: [1, 1] }, C);
  r = await POST('/api/online/report', { match: mid(3), side: 1, score: [1, 1] }, B);
  check('pareggio: 12 punti', r.body.status === 'counted' && r.body.points === 12, r.body);
  check('il compagno di squadra prende i punti anche lui', (await GET('/api/me/online', C)).body.points === 12);
  // limite contro lo stesso avversario: dalla quarta partita del giorno niente punti
  for (const n of [4, 5]) { await POST('/api/online/report', { match: mid(n), side: 0, score: [1, 0] }, A); await POST('/api/online/report', { match: mid(n), side: 1, score: [1, 0] }, B); }
  await POST('/api/online/report', { match: mid(6), side: 0, score: [1, 0] }, A);
  r = await POST('/api/online/report', { match: mid(6), side: 1, score: [1, 0] }, B);
  check('stesso avversario più di 3 volte al giorno: confermata ma senza punti', r.body.status === 'limit' && r.body.points === 0, r.body);
  me = (await GET('/api/me/online', A)).body;
  check('A: 30+12+30 punti (la quarta contro B non conta), 3 partite contate', me.points === 72 && me.played === 3 && me.level === 2, me);
  const lb = (await GET('/api/online/leaderboard')).body;
  check('classifica pubblica: in ordine di punti, con livelli', lb.top.length === 3 && lb.top[0].username === names.A && lb.top[0].rank === 1 && lb.top[0].level === 2 && lb.top[1].points >= lb.top[2].points, lb.top);
  check('classifica: nessun dato privato', forbiddenKeys(lb).length === 0, forbiddenKeys(lb));
  check('regole nella risposta (punti per vittoria, limiti)', lb.rules.win === 30 && lb.rules.perOpponent === 3);
  // amici online e livelli
  await POST('/api/friends/request', { username: names.B }, A);
  await POST('/api/friends/accept', { username: names.A }, B);
  await POST('/api/presence', { status: 'match' }, B);
  let fr = (await GET('/api/friends', A)).body;
  const fb = fr.friends.find(x => x.username === names.B);
  check('amico in partita: stato "match" e livello', fb && fb.status === 'match' && fb.level >= 1, fr.friends);
  check('lista amici: nessun dato privato', forbiddenKeys(fr).length === 0, forbiddenKeys(fr));
  fr = (await GET('/api/friends', B)).body;
  check('chi ha appena aperto la lista è online', fr.friends.find(x => x.username === names.A).status === 'online', fr.friends);
  await POST('/api/_test/clock', { offsetMs: 10 * 60 * 1000 });
  fr = (await GET('/api/friends', B)).body;
  check('dopo 10 minuti senza notizie: non più online, con l\'ultima volta', fr.friends.find(x => x.username === names.A).status === null && fr.friends.find(x => x.username === names.A).lastSeen > 0, fr.friends);
  // dati vecchi intatti: la migrazione non tocca gli account
  check('l\'account esiste ancora e accede', (await POST('/api/auth/login', { username: names.C, password: 'password-' + names.C })).status === 200);

  console.log('\nRisultato: ' + pass + ' superati, ' + failN + ' falliti');
}

main().catch(e => { console.error(e); failN++; }).finally(async () => { await stopServer(); fs.rmSync(PERSIST, { recursive: true, force: true }); process.exit(failN ? 1 : 0); });
