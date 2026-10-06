// Amici e competizioni tra amici contro il server vero in locale (wrangler dev: Worker + D1), database nuovo.
// node test/friends_test.js   (prima: npm run engine)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8792, BASE = 'http://127.0.0.1:' + PORT;
const PERSIST = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-amici-'));
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
  const names = { A: 'anna_' + sfx, B: 'bruno_' + sfx, C: 'carla_' + sfx, D: 'dario_' + sfx };
  const tok = {};
  for (const k of Object.keys(names)) {
    const r = await POST('/api/auth/register', { username: names[k], password: 'password-' + names[k] });
    tok[k] = r.body.token;
  }
  const { A, B, C, D } = tok;

  // ===== giocatori e amici =====
  check('elenco dei giocatori solo con l\'accesso (401 senza)', (await GET('/api/users')).status === 401);
  const us = await GET('/api/users', A);
  check('elenco dei giocatori: tutti gli iscritti, con "sei tu" e nessuna relazione all\'inizio',
    us.status === 200 && us.body.total === 4 && us.body.users.length === 4 && us.body.users.find(u => u.username === names.A).me === true && us.body.users.every(u => u.relation === null), us.body);
  check('elenco dei giocatori: solo nome e data di iscrizione (niente id, email, saldo)', forbiddenKeys(us.body).length === 0 && Object.keys(us.body.users[0]).sort().join() === 'me,relation,since,username', us.body.users[0]);
  const sr = await GET('/api/users?q=' + 'BRU', A);
  check('ricerca per nome (senza maiuscole)', sr.body.users.length === 1 && sr.body.users[0].username === names.B, sr.body);

  check('aggiungere sé stessi: no', (await POST('/api/friends/request', { username: names.A }, A)).status === 400);
  check('giocatore inesistente: 404', (await POST('/api/friends/request', { username: 'nessuno_qui' }, A)).status === 404);
  const rq = await POST('/api/friends/request', { username: names.B }, A);
  check('richiesta di amicizia A → B: in attesa', rq.status === 200 && rq.body.relation === 'sent', rq.body);
  check('di nuovo: resta una sola richiesta', (await POST('/api/friends/request', { username: names.B }, A)).body.relation === 'sent');
  let fb = await GET('/api/friends', B);
  check('B vede la richiesta ricevuta da A', fb.body.incoming.length === 1 && fb.body.incoming[0].username === names.A && fb.body.friends.length === 0, fb.body);
  check('B nell\'elenco dei giocatori: A ha "richiesta ricevuta"', (await GET('/api/users', B)).body.users.find(u => u.username === names.A).relation === 'received');
  check('A non può accettare la propria richiesta', (await POST('/api/friends/accept', { username: names.B }, A)).status === 404);
  const ac = await POST('/api/friends/accept', { username: names.A }, B);
  fb = await GET('/api/friends', B);
  const fa = await GET('/api/friends', A);
  check('B accetta: amici da entrambe le parti', ac.body.relation === 'friend' && fb.body.friends.some(f => f.username === names.A) && fa.body.friends.some(f => f.username === names.B), [fb.body, fa.body]);
  await POST('/api/friends/request', { username: names.A }, C);
  const cross = await POST('/api/friends/request', { username: names.C }, A);
  check('richieste incrociate (C → A, poi A → C): amicizia subito', cross.body.relation === 'friend', cross.body);
  await POST('/api/friends/request', { username: names.A }, D);
  await POST('/api/friends/remove', { username: names.D }, A);
  check('richiesta rifiutata: nessuna relazione', (await GET('/api/friends', D)).body.outgoing.length === 0 && (await GET('/api/users', A)).body.users.find(u => u.username === names.D).relation === null);
  check('risposte degli amici senza dati privati', forbiddenKeys(fa.body).length === 0, forbiddenKeys(fa.body));

  // ===== competizione tra amici: creazione e inviti =====
  const base = { kind: 'league', name: 'Lega <b>Amici</b>', teams: [0, 1, 2, 3], team: 0, legs: 2, halfSeconds: 120 };
  check('invitare chi non è amico: rifiutato', (await POST('/api/friendcomps', Object.assign({}, base, { invite: [names.D] }), A)).status === 403);
  check('configurazione impossibile (campionato a 3): rifiutata', (await POST('/api/friendcomps', Object.assign({}, base, { teams: [0, 1, 2] }), A)).status === 400);
  check('la propria squadra deve essere tra quelle della competizione', (await POST('/api/friendcomps', Object.assign({}, base, { team: 9 }), A)).status === 400);
  const cr = await POST('/api/friendcomps', Object.assign({}, base, { invite: [names.B, names.C] }), A);
  const code = cr.body.code;
  check('creata: in attesa di iscrizioni, A con la squadra 0, B e C invitati, nome ripulito',
    cr.status === 201 && /^SF-/.test(code) && cr.body.status === 'OPEN' && cr.body.isOwner && cr.body.myTeam === 0 && cr.body.name === 'Lega bAmici/b' &&
    cr.body.members.filter(m => m.status === 'INVITED').length === 2, cr.body);
  check('vista della competizione senza dati privati', forbiddenKeys(cr.body).length === 0, forbiddenKeys(cr.body));
  check('chi non è invitato non la vede', (await GET('/api/friendcomps/' + code, D)).status === 404);
  const lb = await GET('/api/friendcomps', B);
  check('B vede l\'invito (da chi, che competizione)', lb.body.comps.length === 1 && lb.body.comps[0].invited && lb.body.comps[0].owner === names.A && lb.body.comps[0].code === code, lb.body);
  check('B non può prendere la squadra di A', (await POST('/api/friendcomps/' + code + '/team', { team: 0 }, B)).status === 409);
  check('né una squadra che non è nella competizione', (await POST('/api/friendcomps/' + code + '/team', { team: 7 }, B)).status === 400);
  const jb = await POST('/api/friendcomps/' + code + '/team', { team: 1 }, B);
  check('B accetta con la squadra 1', jb.status === 200 && jb.body.myTeam === 1 && jb.body.members.find(m => m.username === names.B).status === 'ACCEPTED', jb.body);
  check('C non può scegliere la squadra di B', (await POST('/api/friendcomps/' + code + '/team', { team: 1 }, C)).body.error === 'TEAM_TAKEN');
  await POST('/api/friendcomps/' + code + '/decline', {}, C);
  check('C rifiuta: non la vede più', (await GET('/api/friendcomps', C)).body.comps.length === 0);
  check('solo chi l\'ha creata la può avviare', (await POST('/api/friendcomps/' + code + '/start', {}, B)).status === 403);
  const st = await POST('/api/friendcomps/' + code + '/start', {}, A);
  let v = (await GET('/api/friendcomps/' + code, A)).body;
  check('avviata: calendario all\'italiana di 6 giornate (andata e ritorno)', st.status === 200 && v.status === 'ACTIVE' && v.comp.fixtures.length === 12 && v.comp.season === 1, [st.body, v.status]);
  check('inviti chiusi dopo l\'avvio', (await POST('/api/friendcomps/' + code + '/invite', { username: names.C }, A)).status === 409);

  // ===== partite: IA, giocatore contro IA, amico contro amico =====
  const cur = v => v.comp.fixtures.filter(f => v.pending.some(p => p.fixture === f.id));
  const humans = new Set([0, 1]);
  check('le partite senza giocatori del turno in corso sono già simulate dal server',
    v.comp.fixtures.filter(f => !humans.has(f.home) && !humans.has(f.away) && f.round === v.comp.fixtures.find(x => x.id === v.pending[0].fixture).round).every(f => f.played && f.how === 'sim'), v.comp.fixtures.slice(0, 2));
  const future = v.comp.fixtures.find(f => !f.played && !v.pending.some(p => p.fixture === f.id) && (f.home === 0 || f.away === 0));
  check('una partita di una giornata futura non si può giocare', (await POST('/api/friendcomps/' + code + '/report', { fixture: future.id, kind: 'sim' }, A)).body.error === 'NOT_CURRENT');
  let sawH2H = false, sawConflict = false, sawRoom = false, sawKickoff = false, sawAbandon = false, sawBad = false, sawParallel = false, rounds = 0;
  while (v.status === 'ACTIVE' && rounds++ < 20) {
    for (const p of v.pending) {
      const f = v.comp.fixtures.find(x => x.id === p.fixture);
      const R = (body, t) => POST('/api/friendcomps/' + code + '/report', Object.assign({ fixture: f.id }, body), t);
      if (p.homeUser && p.awayUser) {
        // A contro B: stanza online, poi risultati concordati
        if (!sawRoom) {
          check('stanza: codice non valido rifiutato', (await POST('/api/friendcomps/' + code + '/room', { fixture: f.id, room: 'abc' }, A)).status === 400);
          await POST('/api/friendcomps/' + code + '/room', { fixture: f.id, room: 'QWERTY' }, A);
          const vb = (await GET('/api/friendcomps/' + code, B)).body;
          const pb = vb.pending.find(x => x.fixture === f.id);
          check('B vede la stanza creata da A per la loro partita', pb.room && pb.room.code === 'QWERTY' && pb.room.host === names.A, pb);
          sawRoom = true;
        }
        const r1 = await R({ kind: 'score', result: { h: 2, a: 1, scorers: [{ team: 0, name: 'Uno', minute: 5 }, { team: 0, name: 'Due', minute: 50 }, { team: 1, name: 'Tre', minute: 70 }] } }, A);
        check('A manda il risultato: in attesa di B', r1.body.status === 'waiting', r1.body);
        if (!sawConflict) {
          const r2 = await R({ kind: 'score', result: { h: 1, a: 1 } }, B);
          check('B manda un risultato diverso: conflitto, niente registrato', r2.body.status === 'conflict' && !(await GET('/api/friendcomps/' + code, A)).body.comp.fixtures.find(x => x.id === f.id).played, r2.body);
          sawConflict = true;
        }
        const r3 = await R({ kind: 'score', result: { h: 2, a: 1 } }, B);
        const fx = (await GET('/api/friendcomps/' + code, A)).body.comp.fixtures.find(x => x.id === f.id);
        check('risultati uguali: registrato (partita online, marcatori dall\'elenco più completo)', r3.body.status === 'recorded' && fx.played && fx.h === 2 && fx.a === 1 && fx.how === 'played' && fx.scorers.length === 3, [r3.body, fx]);
        sawH2H = true;
      } else {
        const owner = p.homeUser === names.A || p.awayUser === names.A ? A : B, other = owner === A ? B : A;
        if (!sawBad) {
          check('non si gioca la partita di un altro', (await R({ kind: 'sim' }, other)).body.error === 'NOT_YOUR_MATCH');
          check('supplementari in campionato: risultato rifiutato', (await R({ kind: 'score', result: { h: 1, a: 1, et: { h: 1, a: 0 } } }, owner)).status === 400);
          check('punteggio assurdo rifiutato', (await R({ kind: 'score', result: { h: 99, a: -1 } }, owner)).status === 400);
          sawBad = true;
          const r = await R({ kind: 'score', result: { h: 3, a: 0, scorers: [{ team: 0, name: 'Bomber', minute: 12 }] } }, owner);
          check('partita contro l\'IA giocata: risultato del motore registrato subito', r.body.status === 'recorded' && r.body.fixture.h === 3 && r.body.fixture.how === 'played', r.body);
        } else if (!sawKickoff) {
          const k1 = await R({ kind: 'kickoff' }, owner);
          const k2 = await R({ kind: 'kickoff' }, owner);
          check('partita iniziata e riavviata: non si rigioca, decide la simulazione ufficiale', k1.body.status === 'started' && k2.body.status === 'abandoned' && k2.body.fixture.how === 'abbandonata', [k1.body, k2.body]);
          sawKickoff = true;
        } else if (!sawAbandon) {
          const r = await R({ kind: 'abandon', h: 2, a: 0, fraction: 0.5 }, owner);
          check('uscita a metà sul 2-0: il resto simulato dal punteggio (almeno 2-0)', r.body.status === 'recorded' && r.body.fixture.h >= 2 && r.body.fixture.how === 'abbandonata', r.body);
          sawAbandon = true;
        } else if (!sawParallel) {
          const rs = await Promise.all([1, 2, 3, 4, 5].map(() => R({ kind: 'sim' }, owner)));
          const ok = rs.filter(r => r.body.status === 'recorded').length;
          check('cinque richieste insieme: il risultato si registra una volta sola', ok === 1 && rs.filter(r => r.status === 409).length === 4, rs.map(r => r.body.status || r.body.error));
          sawParallel = true;
        } else await R({ kind: 'sim' }, owner);
      }
    }
    v = (await GET('/api/friendcomps/' + code, A)).body;
  }
  const finished = v.comp;
  check('stagione finita: tutte le 12 partite giocate, campione e riepilogo', v.status === 'FINISHED' && finished.fixtures.every(f => f.played) && finished.champion !== null && finished.summary && finished.history.length === 1, [v.status, finished.champion]);
  check('si sono viste le partite tra amici, i conflitti, la stanza e le partite contro l\'IA', sawH2H && sawConflict && sawRoom && sawKickoff && sawAbandon && sawBad && sawParallel, { sawH2H, sawConflict, sawRoom, sawKickoff, sawAbandon, sawBad, sawParallel });
  check('nuova stagione: solo chi l\'ha creata', (await POST('/api/friendcomps/' + code + '/newseason', {}, B)).status === 403);
  const ns = await POST('/api/friendcomps/' + code + '/newseason', {}, A);
  v = (await GET('/api/friendcomps/' + code, B)).body;
  check('stagione 2: nuovo calendario, storico conservato', ns.body.season === 2 && v.status === 'ACTIVE' && v.comp.season === 2 && v.comp.history.length === 1 && v.comp.fixtures.length === 12, ns.body);

  // B lascia: la sua squadra passa all'IA
  await POST('/api/friendcomps/' + code + '/leave', {}, B);
  v = (await GET('/api/friendcomps/' + code, A)).body;
  check('B lascia: la sua squadra la guida l\'IA, nel turno restano solo le partite di A', v.pending.every(p => p.homeUser === names.A || p.awayUser === names.A) && v.members.find(m => m.username === names.B).status === 'LEFT', v.pending);

  // ===== torneo: eliminazione diretta tra amici, supplementari e rigori =====
  const tr = await POST('/api/friendcomps', { kind: 'tournament', name: 'Coppa tra noi', teams: [0, 1, 2, 3], team: 2, invite: [names.B], extraTime: true, penalties: true }, A);
  const tc = tr.body.code;
  await POST('/api/friendcomps/' + tc + '/team', { team: 3 }, B);
  await POST('/api/friendcomps/' + tc + '/start', {}, A);
  let tv = (await GET('/api/friendcomps/' + tc, A)).body;
  let sawKoAi = false, sawKoH2H = false;
  for (let guard = 0; tv.status === 'ACTIVE' && guard < 10; guard++) {
    for (const p of tv.pending) {
      const f = tv.comp.fixtures.find(x => x.id === p.fixture);
      const R = (body, t) => POST('/api/friendcomps/' + tc + '/report', Object.assign({ fixture: f.id }, body), t);
      if (p.homeUser && p.awayUser) {
        await R({ kind: 'score', result: { h: 1, a: 1 } }, A);
        const r = await R({ kind: 'score', result: { h: 1, a: 1 } }, B);
        check('amici in parità a eliminazione diretta: supplementari e rigori dalla simulazione, c\'è un vincitore',
          r.body.status === 'recorded' && r.body.fixture.h === 1 && r.body.fixture.et && (r.body.fixture.winner === 0 || r.body.fixture.winner === 1), r.body);
        sawKoH2H = true;
      } else {
        const owner = p.homeUser === names.A || p.awayUser === names.A ? A : B;
        if (!sawKoAi) {
          check('parità a eliminazione diretta senza supplementari: rifiutato', (await R({ kind: 'score', result: { h: 0, a: 0 } }, owner)).status === 400);
          check('rigori senza vincitore: rifiutato', (await R({ kind: 'score', result: { h: 0, a: 0, et: { h: 0, a: 0 }, pens: { h: 4, a: 4 } } }, owner)).status === 400);
          const r = await R({ kind: 'score', result: { h: 0, a: 0, et: { h: 0, a: 0 }, pens: { h: 5, a: 4 } } }, owner);
          check('partita del motore con supplementari e rigori: registrata con il vincitore', r.body.status === 'recorded' && r.body.fixture.pens.h === 5 && r.body.fixture.winner === 0, r.body);
          sawKoAi = true;
        } else await R({ kind: 'sim' }, owner);
      }
    }
    tv = (await GET('/api/friendcomps/' + tc, A)).body;
  }
  check('torneo concluso con un vincitore (tabellone)', tv.status === 'FINISHED' && tv.comp.champion !== null && tv.comp.bracket.length === 2 && sawKoAi, [tv.status, tv.comp.champion]);
  // finale secca tra i due amici: sempre uno contro l'altro
  if (!sawKoH2H) {
    const fr = await POST('/api/friendcomps', { kind: 'tournament', name: 'Finale', teams: [4, 5], team: 4, invite: [names.B] }, A);
    await POST('/api/friendcomps/' + fr.body.code + '/team', { team: 5 }, B);
    await POST('/api/friendcomps/' + fr.body.code + '/start', {}, A);
    const fv = (await GET('/api/friendcomps/' + fr.body.code, A)).body;
    const fid = fv.pending[0].fixture;
    await POST('/api/friendcomps/' + fr.body.code + '/report', { fixture: fid, kind: 'score', result: { h: 1, a: 1 } }, A);
    const r = await POST('/api/friendcomps/' + fr.body.code + '/report', { fixture: fid, kind: 'score', result: { h: 1, a: 1 } }, B);
    check('amici in parità in finale: supplementari e rigori dalla simulazione, c\'è un vincitore',
      r.body.status === 'recorded' && r.body.fixture.h === 1 && r.body.fixture.et && (r.body.fixture.winner === 0 || r.body.fixture.winner === 1) && r.body.finished, r.body);
    await POST('/api/friendcomps/' + fr.body.code + '/cancel', {}, A);
  }

  // ===== elenco ed eliminazione =====
  const la = await GET('/api/friendcomps', A);
  check('elenco di A: le due competizioni, con turno e progresso', la.body.comps.length === 2 && la.body.comps.every(c => c.progress && c.season >= 1), la.body.comps);
  check('elenco senza dati privati', forbiddenKeys(la.body).length === 0, forbiddenKeys(la.body));
  check('eliminare: solo chi l\'ha creata', (await POST('/api/friendcomps/' + tc + '/cancel', {}, B)).status === 403);
  await POST('/api/friendcomps/' + tc + '/cancel', {}, A);
  check('eliminata: non si vede più', (await GET('/api/friendcomps/' + tc, A)).status === 404 && (await GET('/api/friendcomps', A)).body.comps.length === 1);

  await stopServer();
  console.log('\n' + pass + ' PASS, ' + failN + ' FAIL');
}

main().catch(async e => { console.error(e); await stopServer(); process.exit(2); }).then(() => process.exit(failN ? 1 : 0));
