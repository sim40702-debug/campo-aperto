// Test dell'API contro il server vero in locale (wrangler dev: Worker + D1 + Durable Object in workerd).
// Database nuovo a ogni esecuzione; TEST_MODE=1 (da .dev.vars) per spostare l'orologio e lanciare i giri.
// node test/api_test.js
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8790, BASE = 'http://127.0.0.1:' + PORT;
const PERSIST = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-d1-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

let pass = 0, failN = 0;
const results = [];
function check(name, cond, info) {
  results.push({ name, ok: !!cond });
  if (cond) { pass++; console.log('PASS', name); } else { failN++; console.log('FAIL', name, info === undefined ? '' : JSON.stringify(info).slice(0, 400)); }
}

// ---------- server ----------
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

async function api(method, p, body, token, extraHeaders) {
  const headers = Object.assign({}, extraHeaders || {});
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: r.status, body: data };
}
const GET = (p, tok) => api('GET', p, undefined, tok);
const POST = (p, b, tok) => api('POST', p, b === undefined ? {} : b, tok);
let keyN = 0;
const newKey = () => 'k' + Date.now().toString(36) + '_' + (keyN++);
const oddsOf = (d, m, s) => d.markets.find(x => x.id === m).sels.find(x => x.id === s).odds;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// chiavi che non devono mai comparire nelle risposte pubbliche
const FORBIDDEN = ['user_id', 'userId', 'email', 'password', 'pass_hash', 'pass_salt', 'token', 'token_hash', 'ip', 'ip_hash', 'client_key', 'clientKey', 'balance', 'seed', 'facts'];
function forbiddenKeys(obj, extra) {
  const bad = [];
  const list = FORBIDDEN.concat(extra || []);
  (function walk(o, p) {
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, p + '[' + i + ']'));
    if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (list.includes(k)) bad.push(p + '.' + k); walk(o[k], p + '.' + k); }
  })(obj, '');
  return bad;
}

async function setClock(t) {
  const cur = await POST('/api/_test/clock', { offsetMs: 0 });
  const real = cur.body.serverTime;
  return POST('/api/_test/clock', { offsetMs: t - real });
}
const tick = () => POST('/api/_test/tick');
async function register(name, password) { return POST('/api/auth/register', { username: name, password: password || 'password-' + name }); }
async function balanceOf(tok) { return (await GET('/api/me/balance', tok)).body.balance; }
async function ledgerOk(tok) {
  // ogni movimento: prima + importo = dopo, e i movimenti sono in fila (il dopo di uno è il prima del successivo)
  let all = [], before;
  for (;;) {
    const r = await GET('/api/me/transactions' + (before ? '?before=' + before : ''), tok);
    all = all.concat(r.body.transactions);
    if (!r.body.next) break;
    before = r.body.next;
  }
  all.reverse();
  let prev = 0;
  for (const x of all) {
    if (x.balanceBefore + x.amount !== x.balanceAfter || x.balanceBefore !== prev) return { ok: false, x };
    prev = x.balanceAfter;
  }
  return { ok: prev === await balanceOf(tok), sum: prev, n: all.length };
}

// ---------- test ----------
async function main() {
  console.log('migrazioni sul database di prova', PERSIST);
  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'campo-aperto', '--local', '--persist-to', PERSIST], { cwd: ROOT, stdio: 'ignore' });
  await startServer();
  const sfx = Date.now().toString(36).slice(-4);
  const NA = 'alfa_' + sfx, NB = 'beta_' + sfx;

  // ===== account =====
  const ra = await register(NA);
  check('registrazione A (201, token, saldo iniziale)', ra.status === 201 && ra.body.token && ra.body.username === NA);
  const rb = await register(NB);
  let A = ra.body.token, B = rb.body.token;
  check('nome già usato (anche con maiuscole diverse) → 409', (await register(NA.toUpperCase())).status === 409);
  check('nome non valido → 400', (await POST('/api/auth/register', { username: 'a b', password: 'password1' })).status === 400);
  check('password corta → 400', (await POST('/api/auth/register', { username: 'gamma_' + sfx, password: 'corta' })).status === 400);
  check('login con password sbagliata → 401', (await POST('/api/auth/login', { username: NA, password: 'sbagliata!' })).status === 401);
  check('login utente inesistente → stesso 401', (await POST('/api/auth/login', { username: 'nessuno_' + sfx, password: 'qualcosa1' })).body.error === 'BAD_LOGIN');
  check('A parte con 1000 monete', await balanceOf(A) === 1000);

  // ===== partite =====
  const tk = await tick();
  check('giro del server: crea partite calcolate con il motore', tk.status === 200 && tk.body.created >= 2, tk.body);
  let list = (await GET('/api/fixtures')).body;
  const [F1, F2] = list.next;
  check('partite future: nessun seme e nessun risultato', list.next.every(f => f.seed === undefined && !f.result && !f.score));
  const d1 = (await GET('/api/fixtures/' + F1.code, B)).body;
  check('dettaglio partita aperta: mercati e quote, niente eventi', d1.bettingOpen && d1.markets.length > 10 && d1.events.length === 0 && d1.seed === undefined);
  check('gruppi dei mercati 1X2/GOL/CORNER/CARTELLINI/ALTRO', ['1X2', 'GOL', 'CORNER', 'CARTELLINI', 'ALTRO'].every(g => d1.markets.some(m => m.group === g)));
  check('nessun dato nascosto nel dettaglio', forbiddenKeys(d1).length === 0, forbiddenKeys(d1));

  // ===== B a 35 monete con transazioni vere: una scommessa privata da 25 (+50 obiettivo prima scommessa)
  // e acquisti nel negozio per 1040 (+50 obiettivo primo acquisto). Prezzi dal server.
  const pb = await POST('/api/bets', { items: [{ fixture: F2.code, market: 'HT', selection: 'X', odds: oddsOf((await GET('/api/fixtures/' + F2.code)).body, 'HT', 'X') }], stake: 25, clientKey: newKey(), visibility: 'private' }, B);
  check('B: scommessa privata da 25', pb.status === 201 && await balanceOf(B) === 1025);
  const shop = (await GET('/api/shop', B)).body.items;
  const target = 1025 + 50 - 35;
  const dp = new Map([[0, []]]);
  for (const it of shop) for (const [s, set] of [...dp.entries()]) { const n = s + it.price; if (n <= target && !dp.has(n)) dp.set(n, set.concat(it.id)); }
  const buyList = dp.get(target);
  check('trovati oggetti del negozio per portare B a 35 (' + target + ' monete)', !!buyList, target);
  for (const id of buyList || []) await POST('/api/shop/buy', { item: id }, B);
  check('A = 1000, B = 35', await balanceOf(A) === 1000 && await balanceOf(B) === 35);

  // ===== persistenza del saldo =====
  check('refresh: ancora 1000 e 35', await balanceOf(A) === 1000 && await balanceOf(B) === 35);
  await POST('/api/auth/logout', {}, A);
  check('dopo il logout il vecchio token non vale più', (await GET('/api/me', A)).status === 401);
  A = (await POST('/api/auth/login', { username: NA, password: 'password-' + NA })).body.token;
  check('logout/login: A ancora 1000', await balanceOf(A) === 1000);
  const B2 = (await POST('/api/auth/login', { username: NB.toUpperCase(), password: 'password-' + NB })).body.token;
  check('altro dispositivo (seconda sessione di B): 35 su entrambe', await balanceOf(B2) === 35 && await balanceOf(B) === 35);
  await stopServer();
  await startServer();
  check('riavvio del server: A = 1000, B = 35 (sessioni valide)', await balanceOf(A) === 1000 && await balanceOf(B) === 35);

  // ===== social 1-8 =====
  const o1 = oddsOf(d1, '1X2', '1');
  const betA = await POST('/api/bets', { items: [{ fixture: F1.code, market: '1X2', selection: '1', odds: o1 }], stake: 100, clientKey: newKey() }, A);
  check('S1 A crea una scommessa pubblica', betA.status === 201 && betA.body.bet.visibility === 'public', betA.body);
  const codeA = betA.body.bet.code;
  check('codice BET-XXXXX', /^BET-[A-Z0-9]{5}$/.test(codeA));
  check('A: 1000 - 100 + 50 (obiettivo prima scommessa) = 950', await balanceOf(A) === 950);
  const open = await GET('/api/fixtures/' + F1.code, B);
  check('S2 B apre la partita', open.status === 200 && open.body.code === F1.code);
  const feedB = (await GET('/api/fixtures/' + F1.code + '/bets', B)).body;
  const seen = feedB.bets.find(b => b.code === codeA);
  check('S3 B vede la scommessa di A', !!seen);
  check('S4 B vede il nome utente giusto', seen && seen.user === NA);
  check('S5 B vede la selezione giusta', seen && seen.items[0].market === '1X2' && seen.items[0].selection === '1' && seen.items[0].selectionLabel === F1.home.name + ' vincente');
  check('S6 B vede l\'importo giusto', seen && seen.stake === 100);
  check('S7 B vede la quota giusta', seen && seen.odds === o1 && seen.items[0].odds === o1);
  check('S8 B non vede dati privati', seen && forbiddenKeys(feedB).length === 0 && seen.visibility === undefined && seen.shared === undefined && seen.mine === false, forbiddenKeys(feedB));

  // ===== social 9-11 =====
  const priv = await POST('/api/bets', { items: [{ fixture: F1.code, market: '1X2', selection: 'X', odds: oddsOf(d1, '1X2', 'X') }], stake: 20, clientKey: newKey(), visibility: 'private' }, A);
  const codeP = priv.body.bet && priv.body.bet.code;
  check('S9 A crea una scommessa privata', priv.status === 201 && priv.body.bet.visibility === 'private');
  const feedB2 = (await GET('/api/fixtures/' + F1.code + '/bets', B)).body;
  check('S10 B non la vede nel feed pubblico', !feedB2.bets.some(b => b.code === codeP) && !(await GET('/api/feed', B)).body.bets.some(b => b.code === codeP));
  check('S10b B non la apre nemmeno con il codice (404 come se non esistesse)', (await GET('/api/bets/' + codeP, B)).status === 404);
  const mineA = (await GET('/api/me/bets', A)).body.bets;
  check('S11 A continua a vedere la propria scommessa privata', mineA.some(b => b.code === codeP) && (await GET('/api/bets/' + codeP, A)).status === 200);

  // ===== quote che cambiano: un altro giocatore punta molto sulla stessa selezione =====
  const ND = 'delta_' + sfx;
  const D = (await register(ND)).body.token;
  const dq = (await POST('/api/slip/quote', { items: [{ fixture: F1.code, market: '1X2', selection: '1' }] }, D)).body;
  await POST('/api/bets', { items: [{ fixture: F1.code, market: '1X2', selection: '1', odds: dq.items[0].odds }], stake: 900, clientKey: newKey() }, D);
  const o1now = oddsOf((await GET('/api/fixtures/' + F1.code)).body, '1X2', '1');
  check('quota ricalcolata dal server dopo molte puntate sulla stessa selezione (' + o1 + ' → ' + o1now + ')', o1now < o1);

  // ===== social 12-14: copia =====
  const src = (await GET('/api/bets/' + codeA, B)).body;
  const betsBefore = (await GET('/api/me/bets', B)).body.bets.length, balBefore = await balanceOf(B);
  const quote = await POST('/api/slip/quote', { items: src.items.map(i => ({ fixture: i.fixture, market: i.market, selection: i.selection, odds: i.odds })) }, B);
  check('S12 B copia: la schedina riceve le stesse selezioni', quote.status === 200 && quote.body.items[0].market === '1X2' && quote.body.items[0].selection === '1');
  check('S13 copiare non scommette: nessuna scommessa e saldo invariato finché B non conferma',
    (await GET('/api/me/bets', B)).body.bets.length === betsBefore && await balanceOf(B) === balBefore);
  check('S14 quota ricontrollata: originale ' + o1 + ', attuale ' + quote.body.items[0].odds + ', "cambiata"', quote.body.items[0].requestedOdds === o1 && quote.body.items[0].odds === o1now && quote.body.items[0].changed === true);
  const oldOdds = await POST('/api/bets', { items: [{ fixture: F1.code, market: '1X2', selection: '1', odds: o1 }], stake: 10, clientKey: newKey(), copiedFrom: codeA }, B);
  check('S14b conferma con la quota vecchia → 409 ODDS_CHANGED, nessun addebito', oldOdds.status === 409 && oldOdds.body.error === 'ODDS_CHANGED' && oldOdds.body.changes[0].new === o1now && await balanceOf(B) === balBefore);
  const copied = await POST('/api/bets', { items: [{ fixture: F1.code, market: '1X2', selection: '1', odds: o1now }], stake: 10, clientKey: newKey(), copiedFrom: codeA }, B);
  check('S13b conferma manuale con la quota nuova → scommessa copiata', copied.status === 201 && copied.body.bet.copiedFrom === codeA && copied.body.bet.odds === o1now);
  check('la scommessa di A conta 1 copia', (await GET('/api/bets/' + codeA, B)).body.copies === 1);

  // ===== social 15-16 =====
  const la = await ledgerOk(A), lb = await ledgerOk(B);
  check('S15 portafogli separati: A = 930 (1000-100-20+50), B = 25 (35-10), registri coerenti', await balanceOf(A) === 930 && await balanceOf(B) === 25 && la.ok && lb.ok, { a: await balanceOf(A), b: await balanceOf(B), la, lb });
  const mod1 = await POST('/api/bets/' + codeA + '/visibility', { visibility: 'private' }, B);
  const mod2 = await POST('/api/bets/' + codeA + '/share', {}, B);
  const mod3 = await POST('/api/bets/' + codeA, { stake: 1, odds: 50 }, B);
  const del = await api('DELETE', '/api/bets/' + codeA, undefined, B);
  const after = (await GET('/api/bets/' + codeA, A)).body;
  check('S16 B non può modificare, condividere o cancellare la scommessa di A', mod1.status === 404 && mod2.status === 404 && mod3.status === 404 && del.status === 404 && after.visibility === 'public' && after.stake === 100 && after.odds === o1);

  // ===== social 18-20: feed, paginazione, nessun doppione, refresh =====
  const d2 = (await GET('/api/fixtures/' + F2.code)).body;
  const players = [];
  for (let i = 0; i < 3; i++) players.push((await register('p' + i + '_' + sfx)).body.token);
  const made = [];
  for (let i = 0; i < 24; i++) {
    const tok = players[i % 3];
    const q = (await POST('/api/slip/quote', { items: [{ fixture: F2.code, market: 'TG', selection: d2.markets.find(m => m.id === 'TG').sels[i % 2].id }] }, tok)).body.items[0];
    const r = await POST('/api/bets', { items: [{ fixture: F2.code, market: q.market, selection: q.selection, odds: q.odds }], stake: 5, clientKey: newKey() }, tok);
    if (r.status === 201) made.push(r.body.bet.code);
  }
  check('24 scommesse pubbliche su un\'altra partita', made.length === 24, made.length);
  const p1 = (await GET('/api/fixtures/' + F2.code + '/bets', B)).body;
  const p2 = (await GET('/api/fixtures/' + F2.code + '/bets?before=' + p1.cursor.oldest, B)).body;
  const codes = p1.bets.concat(p2.bets).map(b => b.code);
  check('paginazione: 20 + 4, "mostra altre" solo se ce ne sono', p1.bets.length === 20 && p1.more === true && p2.bets.length === 4 && p2.more === false);
  check('S18 il feed non genera doppioni (24 codici unici, tutti presenti)', new Set(codes).size === 24 && made.every(c => codes.includes(c)));
  const none = (await GET('/api/fixtures/' + F2.code + '/bets?after=' + p1.cursor.newest, B)).body;
  const extra = await POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: '2', odds: oddsOf(d2, '1X2', '2') }], stake: 5, clientKey: newKey() }, players[0]);
  const fresh = (await GET('/api/fixtures/' + F2.code + '/bets?after=' + p1.cursor.newest, B)).body;
  check('aggiornamento leggero: solo le scommesse nuove', none.bets.length === 0 && fresh.bets.length === 1 && fresh.bets[0].code === extra.body.bet.code);
  const B3 = (await POST('/api/auth/login', { username: NB, password: 'password-' + NB })).body.token;
  const reload = (await GET('/api/fixtures/' + F2.code + '/bets', B3)).body;
  check('S19 il feed funziona dopo un refresh (nuova sessione, stessi dati)', reload.bets.length === 20 && reload.bets[0].code === extra.body.bet.code && reload.bets.slice(1).map(b => b.code).join() === p1.bets.slice(0, 19).map(b => b.code).join());
  const anon = (await GET('/api/fixtures/' + F2.code + '/bets')).body;
  check('S20 il feed non espone informazioni private (con e senza accesso)', forbiddenKeys(p1).length === 0 && forbiddenKeys(anon).length === 0 && !JSON.stringify(anon).includes('@'));

  // profilo privato: le sue scommesse non compaiono mai negli elenchi pubblici
  const NC = 'charlie_' + sfx;
  const C = (await register(NC)).body.token;
  check('privacy: "mostra pubblicamente le mie scommesse" disattivato', (await POST('/api/me/privacy', { publicBets: false }, C)).body.publicBets === false);
  const cb = await POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: '1', odds: oddsOf((await GET('/api/fixtures/' + F2.code)).body, '1X2', '1') }], stake: 5, clientKey: newKey(), visibility: 'public' }, C);
  check('profilo privato: la scommessa di C non compare nel feed né si apre', cb.status === 201 && !(await GET('/api/fixtures/' + F2.code + '/bets', B)).body.bets.some(b => b.code === cb.body.bet.code) && (await GET('/api/bets/' + cb.body.bet.code, B)).status === 404);
  const shared = await POST('/api/bets/' + cb.body.bet.code + '/share', {}, C);
  check('condivisione: con il codice B vede la scommessa condivisa da C', shared.status === 200 && (await GET('/api/bets/' + cb.body.bet.code, B)).status === 200);
  check('privacy altrui: B non può cambiare quella di C', (await POST('/api/me/privacy', { publicBets: true, username: NC }, B)).status === 200 && (await GET('/api/me', C)).body.publicBets === false && (await GET('/api/me', B)).body.publicBets === true);

  // ===== reazioni =====
  const r1 = await POST('/api/bets/' + codeA + '/react', { emoji: '🔥' }, B);
  check('reazione 🔥 di B sulla scommessa di A', r1.status === 200 && r1.body.on && r1.body.reactions['🔥'] === 1);
  const r2 = await POST('/api/bets/' + codeA + '/react', { emoji: '🔥' }, B);
  check('stessa reazione di nuovo = tolta (niente doppioni)', r2.body.on === false && !r2.body.reactions['🔥']);
  await POST('/api/bets/' + codeA + '/react', { emoji: '👀' }, B);
  check('reazioni non valide, sulle proprie o su scommesse private: rifiutate',
    (await POST('/api/bets/' + codeA + '/react', { emoji: '💩' }, B)).status === 400 &&
    (await POST('/api/bets/' + codeA + '/react', { emoji: '👏' }, A)).status === 400 &&
    (await POST('/api/bets/' + codeP + '/react', { emoji: '👏' }, B)).status === 404);

  // ===== popolari e statistiche =====
  const pop = (await GET('/api/fixtures/' + F1.code + '/popular')).body;
  check('PIÙ SCOMMESSE: 1X2 "1" in testa con 3 giocate su 4', pop.top[0].market === '1X2' && pop.top[0].selection === '1' && pop.top[0].bets === 3 && pop.totalBets === 4 && pop.top[0].share === 75, pop);
  const st = (await GET('/api/fixtures/' + F1.code + '/stats')).body;
  check('STATISTICHE SCOMMESSE: conteggi veri (4 giocate, 3 giocatori, 1030 monete, 1X2 75/25/0)', st.bets === 4 && st.players === 3 && st.coins === 1030 && st.split1X2['1'] === 75 && st.split1X2.X === 25 && st.split1X2['2'] === 0, st);
  check('statistiche: la vincita potenziale più alta è solo di profili pubblici', st.biggestPotential && [NA, ND].includes(st.biggestPotential.user));

  // ===== sicurezza =====
  const balA0 = await balanceOf(A);
  const s1 = await POST('/api/me', { balance: 999999 }, A);
  const s1b = await POST('/api/me/balance', { balance: 999999 }, A);
  await POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: '1', odds: oddsOf((await GET('/api/fixtures/' + F2.code)).body, '1X2', '1') }], stake: 1, clientKey: newKey(), balance: 999999, payout: 999999 }, A);
  check('SEC manipolazione saldo: nessuna via per scriverlo, i campi in più sono ignorati', s1.status === 404 && s1b.status === 404 && await balanceOf(A) === balA0 - 1);
  const fake = await POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: '2', odds: 49 }], stake: 10, clientKey: newKey() }, A);
  check('SEC manipolazione quota → 409, niente addebito', fake.status === 409 && fake.body.error === 'ODDS_CHANGED' && await balanceOf(A) === balA0 - 1);
  const bBal = await balanceOf(B);
  const asB = await POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: '2', odds: oddsOf((await GET('/api/fixtures/' + F2.code)).body, '1X2', '2') }], stake: 3, clientKey: newKey(), userId: 2, user_id: 2, username: NB }, A);
  check('SEC manipolazione user_id: la scommessa resta di A (identità solo dal token)', asB.status === 201 && asB.body.bet.user === NA && await balanceOf(B) === bBal);
  const key = newKey();
  const q2 = oddsOf((await GET('/api/fixtures/' + F2.code)).body, 'BTTS', 'SI');
  const balD = await balanceOf(D);
  const dupl = await Promise.all([0, 1, 2, 3, 4].map(() => POST('/api/bets', { items: [{ fixture: F2.code, market: 'BTTS', selection: 'SI', odds: q2 }], stake: 7, clientKey: key }, D)));
  const dcodes = new Set(dupl.map(r => r.body.bet && r.body.bet.code));
  check('SEC richiesta duplicata (5 invii insieme, stessa chiave): una scommessa, un addebito', dcodes.size === 1 && dupl.every(r => r.status === 200 || r.status === 201) && await balanceOf(D) === balD - 7, dupl.map(r => r.status));
  const replay = await POST('/api/bets', { items: [{ fixture: F2.code, market: 'BTTS', selection: 'SI', odds: q2 }], stake: 7, clientKey: key }, D);
  check('SEC replay della stessa richiesta più tardi: restituisce la stessa scommessa, niente addebito', replay.status === 200 && replay.body.duplicate && [...dcodes][0] === replay.body.bet.code && await balanceOf(D) === balD - 7);
  const daily1 = await POST('/api/me/daily', {}, D);
  const daily2 = await POST('/api/me/daily', {}, D);
  check('SEC replay del bonus giornaliero → 409', daily1.status === 200 && daily1.body.amount >= 100 && daily2.status === 409);
  const balAll = await balanceOf(D);
  // quattro mercati diversi (così la quota di uno non cambia per la giocata sull'altro): conta solo il saldo
  const d2r = (await GET('/api/fixtures/' + F2.code)).body;
  const raceSel = ['HT', 'G1', 'TS', 'TOT'].map(m => ({ fixture: F2.code, market: m, selection: d2r.markets.find(x => x.id === m).sels[0].id, odds: d2r.markets.find(x => x.id === m).sels[0].odds }));
  const race = await Promise.all(raceSel.map(it => POST('/api/bets', { items: [it], stake: balAll, clientKey: newKey() }, D)));
  check('SEC 4 scommesse insieme con tutto il saldo: una passa, le altre 402', race.filter(r => r.status === 201).length === 1 && race.filter(r => r.status === 402).length === 3 && await balanceOf(D) >= 0, race.map(r => r.status));
  check('SEC saldo insufficiente → 402 INSUFFICIENT_FUNDS', (await POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: 'X', odds: oddsOf(d2, '1X2', 'X') }], stake: 5000, clientKey: newKey() }, B)).body.error === 'INSUFFICIENT_FUNDS');
  check('SEC puntate non valide (0, negativa, decimale, enorme) → 400', (await Promise.all([0, -5, 2.5, 1e9, 'x'].map(s => POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: 'X', odds: 2 }], stake: s, clientKey: newKey() }, A)))).every(r => r.status === 400));
  check('SEC selezione inesistente → rifiutata', (await POST('/api/bets', { items: [{ fixture: F2.code, market: 'CS', selection: '9-9', odds: 2 }], stake: 1, clientKey: newKey() }, A)).status === 409);
  check('SEC multipla con la stessa partita due volte → 400', (await POST('/api/bets', { items: [{ fixture: F2.code, market: '1X2', selection: 'X', odds: 2 }, { fixture: F2.code, market: 'BTTS', selection: 'SI', odds: 2 }], stake: 1, clientKey: newKey() }, A)).status === 400);
  const bBal2 = await balanceOf(B);
  const expensive = shop.filter(i => i.price > bBal2).sort((x, y) => y.price - x.price)[0];
  const buyNo = await POST('/api/shop/buy', { item: expensive.id, price: 0 }, B);
  check('SEC acquisto senza saldo (prezzo dal server, non dal client) → 402, niente inventario', buyNo.status === 402 && await balanceOf(B) === bBal2 && !(await GET('/api/inventory', B)).body.items.some(i => i.id === expensive.id));
  const notOwned = shop.find(i => !(buyList || []).includes(i.id));
  check('SEC indossare un oggetto non comprato → 403', (await POST('/api/inventory/equip', { item: notOwned.id }, B)).status === 403);
  check('SEC ricomprare un oggetto già posseduto → 409', (await POST('/api/shop/buy', { item: buyList[0] }, B)).status === 409);
  check('SEC impersonificazione: token falso, assente o malformato → 401',
    (await GET('/api/me', 'x'.repeat(43))).status === 401 && (await GET('/api/me')).status === 401 && (await api('GET', '/api/me', undefined, null, { authorization: 'Basic abc' })).status === 401);
  check('SEC risposte di errore senza dettagli tecnici', !JSON.stringify((await POST('/api/bets', '{rotto', A)).body).match(/stack|sql|D1|at /i));
  const NZ = 'zeta_' + sfx;
  await register(NZ);
  let lastLock = null;
  for (let i = 0; i < 8; i++) lastLock = await POST('/api/auth/login', { username: NZ, password: 'sbagliata' + i });
  const locked = await POST('/api/auth/login', { username: NZ, password: 'password-' + NZ });
  check('SEC 8 password sbagliate → account bloccato per qualche minuto (anche con la password giusta)', lastLock.status === 401 && locked.status === 429);
  check('SEC nessuna via per scrivere un risultato o liquidare dal client', (await POST('/api/bets/' + codeA + '/settle', { status: 'WON' }, A)).status === 404 && (await POST('/api/fixtures/' + F1.code + '/result', { goals: [9, 0] }, A)).status === 404);

  // ===== negozio e personaggio =====
  const eq = await POST('/api/inventory/equip', { item: buyList[0] }, B);
  await POST('/api/me/avatar', { number: 7, name: 'Beta' }, B);
  const lo = (await GET('/api/players/' + NB + '/loadout')).body;
  const cat = shop.find(i => i.id === buyList[0]).category;
  check('negozio: oggetto indossato e visibile a tutti nell\'aspetto del giocatore', eq.status === 200 && lo.items[cat] && lo.items[cat].id === buyList[0] && lo.number === 7 && lo.name === 'BETA' && forbiddenKeys(lo).length === 0);
  check('inventario di B: gli oggetti comprati', (await GET('/api/inventory', B)).body.items.length === buyList.length);
  check('numero di maglia fuori limite → 400', (await POST('/api/me/avatar', { number: 100, name: '' }, B)).status === 400);

  // ===== chiusura, partita in corso, fine, liquidazione =====
  await setClock(F1.kickoffAt - 5000);
  const closedQ = (await POST('/api/slip/quote', { items: [{ fixture: F1.code, market: '1X2', selection: '1', odds: o1now }] }, B)).body.items[0];
  const closedP = await POST('/api/bets', { items: [{ fixture: F1.code, market: '1X2', selection: '1', odds: o1now }], stake: 1, clientKey: newKey(), copiedFrom: codeA }, B);
  check('S17 copia di una scommessa con il mercato chiuso: non giocabile (409 BETTING_CLOSED)', closedQ.available === false && closedQ.reason === 'CLOSED' && closedP.status === 409 && closedP.body.error === 'BETTING_CLOSED');
  check('chiusa ma non iniziata: ancora nessun seme', (await GET('/api/fixtures/' + F1.code)).body.seed === undefined);
  await setClock(F1.kickoffAt + 60000);
  const live = (await GET('/api/fixtures/' + F1.code)).body;
  check('in corso: seme rivelato, solo eventi già avvenuti, nessun risultato finale', live.phase === 'LIVE' && typeof live.seed === 'number' && !live.result && live.events.every(e => e.t_ms <= 60000), { phase: live.phase, n: live.events.length });
  check('in corso: la partita non accetta scommesse', (await POST('/api/bets', { items: [{ fixture: F1.code, market: '1X2', selection: 'X', odds: 2 }], stake: 1, clientKey: newKey() }, B)).body.error === 'BETTING_CLOSED');
  const wr = await POST('/api/fixtures/' + F1.code + '/watch-reward', {}, B);
  check('premio spettatore solo nel secondo tempo', wr.status === 409);
  await setClock(F1.kickoffAt + live.durationMs * 0.75);
  const wr2 = await POST('/api/fixtures/' + F1.code + '/watch-reward', {}, B);
  const wr3 = await POST('/api/fixtures/' + F1.code + '/watch-reward', {}, B);
  check('premio spettatore: una volta per partita', wr2.status === 200 && wr2.body.amount === 20 && wr3.status === 409);
  await setClock(F1.kickoffAt + live.durationMs + 1000);
  const balPre = { A: await balanceOf(A), B: await balanceOf(B), D: await balanceOf(D) };
  const t1 = await tick();
  check('giro: liquida la partita finita', t1.body.settled.fixtures >= 1 && t1.body.settled.bets >= 4, t1.body);
  const fin = (await GET('/api/fixtures/' + F1.code)).body;
  const [gh, ga] = fin.result.goals;
  const homeWon = gh > ga;
  const vA = (await GET('/api/bets/' + codeA, B)).body;
  const vP = (await GET('/api/bets/' + codeP, A)).body;
  check('risultato finale rivelato (' + gh + '-' + ga + '), tutti gli eventi', fin.phase === 'FINISHED' && fin.settled && fin.events.length > 0);
  check('liquidazione dalla partita vera: 1X2 "1" ' + (homeWon ? 'VINTA' : 'PERSA'), vA.status === (homeWon ? 'WON' : 'LOST') && vA.items[0].status === vA.status);
  check('liquidazione: 1X2 "X" ' + (gh === ga ? 'VINTA' : 'PERSA'), vP.status === (gh === ga ? 'WON' : 'LOST'));
  const expA = balPre.A + (homeWon ? Math.floor(100 * o1) : 0) + (gh === ga ? Math.floor(20 * oddsOf(d1, '1X2', 'X')) : 0);
  const balA1 = await balanceOf(A);
  // obiettivo "prima vincita": +100 la prima volta che A vince
  check('vincite accreditate a A (' + balPre.A + ' → ' + balA1 + ')', balA1 === expA || balA1 === expA + 100, { expA, balA1 });
  check('feed: esito della scommessa visibile a tutti (✅/❌)', (await GET('/api/fixtures/' + F1.code + '/bets', B)).body.bets.find(b => b.code === codeA).status === vA.status);
  const t2 = await tick();
  check('replay della liquidazione: un secondo giro non paga di nuovo', await balanceOf(A) === balA1 && t2.body.settled.bets === 0);
  check('registri coerenti dopo la liquidazione (A, B, D)', (await ledgerOk(A)).ok && (await ledgerOk(B)).ok && (await ledgerOk(D)).ok);

  // ===== classifiche =====
  const lbd = (await GET('/api/leaderboard?metric=bets&period=day')).body;
  check('classifica: solo profili pubblici, mai il saldo', lbd.rows.length > 0 && !lbd.rows.some(r => r.user === NC) && forbiddenKeys(lbd).length === 0 && lbd.rows.every(r => r.balance === undefined));
  const lbp = (await GET('/api/leaderboard?metric=profit&period=week')).body;
  check('classifica per profitto ordinata', lbp.rows.every((r, i) => i === 0 || lbp.rows[i - 1].profit >= r.profit));
  const today = (await GET('/api/stats/today')).body;
  check('statistiche del giorno dal database', today.bets >= 30 && today.players >= 6);

  // ===== multiple su più partite =====
  const d3 = (await GET('/api/fixtures/' + F2.code)).body;
  const F3 = (await GET('/api/fixtures')).body.next.find(f => f.code !== F2.code && f.phase === 'OPEN');
  const d4 = (await GET('/api/fixtures/' + F3.code)).body;
  const mult = await POST('/api/bets', { items: [
    { fixture: F2.code, market: 'DC', selection: '1X', odds: oddsOf(d3, 'DC', '1X') },
    { fixture: F3.code, market: 'DC', selection: 'X2', odds: oddsOf(d4, 'DC', 'X2') },
  ], stake: 10, clientKey: newKey() }, A);
  check('multipla su due partite: quota = prodotto', mult.status === 201 && mult.body.bet.type === 'MULTIPLA' && Math.abs(mult.body.bet.odds - Math.round(oddsOf(d3, 'DC', '1X') * oddsOf(d4, 'DC', 'X2') * 100) / 100) < 0.011);
  await setClock(F2.kickoffAt + 6 * 60000);   // F2 finita (dura ~3-4 minuti), F3 non ancora iniziata
  const tk3 = await tick();
  const mv = (await GET('/api/bets/' + mult.body.bet.code, A)).body;
  const f2now = (await GET('/api/fixtures/' + F2.code)).body;
  check('multipla dopo la prima partita: ' + mv.items[0].status + ' → ' + (mv.items[0].status === 'LOST' ? 'persa subito' : 'resta aperta finché non finisce la seconda'),
    mv.items[0].status !== 'OPEN' && mv.items[1].status === 'OPEN' && (mv.items[0].status === 'LOST' ? mv.status === 'LOST' : mv.status === 'OPEN'),
    { tick: tk3.status, tickBody: tk3.body, f2: { phase: f2now.phase, settled: f2now.settled, durationMs: f2now.durationMs, kickoffAt: f2now.kickoffAt, serverTime: f2now.serverTime }, f3: F3.code, items: mv.items.map(i => i.fixture + ':' + i.status) });

  // ===== persistenza dopo tutto: riavvio =====
  const snap = { A: await balanceOf(A), B: await balanceOf(B), betA: JSON.stringify((await GET('/api/bets/' + codeA, A)).body) };
  await stopServer();
  await startServer();
  check('riavvio finale: saldi, scommesse e sessioni intatti', await balanceOf(A) === snap.A && await balanceOf(B) === snap.B && JSON.stringify((await GET('/api/bets/' + codeA, A)).body) === snap.betA);

  await stopServer();
  console.log('\n' + pass + ' PASS, ' + failN + ' FAIL');
  fs.writeFileSync(path.join(os.tmpdir(), 'campo-api-results.json'), JSON.stringify(results, null, 1));
}

main().catch(async e => { console.error(e); await stopServer(); process.exit(2); }).then(() => process.exit(failN ? 1 : 0));
