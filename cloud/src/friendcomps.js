// Competizioni tra amici: campionato, torneo o coppa con amici veri. Chi la crea sceglie formato e squadre e invita
// gli amici; ognuno guida una squadra, le altre le guida l'IA. Calendario, tabellone e avanzamento sono quelli di
// CompLogic (le stesse regole delle competizioni nel gioco); lo stato vive solo qui sul server.
// Risultati:
// - partite tra squadre dell'IA: simulazione ufficiale con seme (sempre la stessa), fatta dal server;
// - giocatore contro IA: la partita si gioca nel gioco e il risultato del motore arriva qui (controllato: numeri
//   interi, supplementari e rigori solo se previsti); oppure si chiede la simulazione ufficiale. Una partita iniziata
//   e mai finita non si può rigiocare: al secondo avvio il risultato viene dalla simulazione;
// - giocatore contro giocatore: si gioca online, ognuno dei due manda il risultato e vale solo se coincide (oppure
//   entrambi chiedono la simulazione). Nell'eliminazione diretta, dopo un pareggio supplementari e rigori vengono
//   dalla simulazione ufficiale.
// Nessuno può scrivere un risultato a mano: non esiste una richiesta per farlo.
import { fail, randomCode, randomInt31 } from './util.js';
import * as L from './complogic.js';
import TEAMS from './teams.gen.json';
import { userByName, areFriends } from './friends.js';

export const NTEAMS = TEAMS.length;
const CTX = { profile: t => TEAMS[t].profile, nameOf: t => TEAMS[t].name };
const ROOM_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const CODE_RE = /^SF-[A-Z0-9]{5}$/;
const MAX_LIVE_OWNED = 10;      // competizioni non finite create da una persona
const MAX_MEMBERS = 16;
const ROOM_TTL = 3 * 3600 * 1000;
const LIST_LIMIT = 30;

// ---------- lettura ----------
async function load(env, code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) fail(404, 'NO_COMP', 'Competizione non trovata');
  const c = await env.DB.prepare('SELECT * FROM friend_comps WHERE code = ?').bind(code).first();
  if (!c || c.status === 'CANCELLED') fail(404, 'NO_COMP', 'Competizione non trovata');
  const { results } = await env.DB.prepare('SELECT m.user_id, m.team, m.status, m.invited_at, u.username FROM friend_comp_members m JOIN users u ON u.id = m.user_id WHERE m.comp_id = ? ORDER BY m.invited_at, u.username_lc')
    .bind(c.id).all();
  c.members = results;
  c.cfg = JSON.parse(c.config);
  c.comp = c.state ? JSON.parse(c.state) : null;
  return c;
}
const memberOf = (c, user) => c.members.find(m => m.user_id === user.id) || null;
function requireMember(c, user) {
  const m = memberOf(c, user);
  if (!m || m.status !== 'ACCEPTED') fail(403, 'NOT_MEMBER', 'Non partecipi a questa competizione');
  return m;
}
function requireOwner(c, user) { if (c.owner_id !== user.id) fail(403, 'NOT_OWNER', 'Solo chi ha creato la competizione può farlo'); }
// squadre guidate da giocatori (gli altri sono IA): squadra -> partecipante
const humanTeams = c => new Map(c.members.filter(m => m.status === 'ACCEPTED' && m.team !== null).map(m => [m.team, m]));

// partite senza giocatori: simulate subito, giornata dopo giornata, finché tocca a qualcuno giocare
function autoSim(c, t) {
  const humans = humanTeams(c);
  for (let guard = 0; guard < 2000; guard++) {
    if (!L.simulateCurrentRound(c.comp, CTX, t, f => humans.has(f.home) || humans.has(f.away))) break;
  }
}

// modifica dello stato con controllo della versione: se due richieste arrivano insieme, una si ripete sullo stato
// nuovo (mai un risultato perso o registrato due volte)
async function mutate(env, code, t, fn) {
  for (let i = 0; i < 4; i++) {
    const c = await load(env, code);
    const res = await fn(c);
    if (!res.save) return res.out;
    const status = res.status || (c.comp.status === 'finished' ? 'FINISHED' : 'ACTIVE');
    const u = await env.DB.prepare('UPDATE friend_comps SET state = ?, status = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?')
      .bind(JSON.stringify(c.comp), status, t, c.id, c.rev).run();
    if (u.meta.changes === 1) {
      if (res.after && res.after.length) await env.DB.batch(res.after);
      return res.out;
    }
  }
  fail(409, 'BUSY', 'Troppe modifiche nello stesso momento: riprova');
}

// ---------- vista ----------
async function viewOf(env, c, user, t) {
  const me = memberOf(c, user);
  const owner = c.members.find(m => m.user_id === c.owner_id);
  const out = {
    code: c.code, name: c.name, kind: c.kind, status: c.status, rev: c.rev,
    owner: owner ? owner.username : '', isOwner: c.owner_id === user.id,
    config: c.cfg,
    members: c.members.filter(m => m.status !== 'DECLINED' && m.status !== 'EXPIRED')
      .map(m => ({ username: m.username, team: m.team, status: m.status, owner: m.user_id === c.owner_id, me: m.user_id === user.id })),
    myTeam: me && me.status === 'ACCEPTED' ? me.team : null,
    myStatus: me ? me.status : null,
    comp: c.comp, round: '', pending: [], serverTime: t,
  };
  if (c.comp && c.status === 'ACTIVE') {
    const cr = L.currentRound(c.comp);
    out.round = L.roundLabel(c.comp, cr);
    const humans = humanTeams(c);
    const season = c.comp.season;
    const { results: reps } = await env.DB.prepare('SELECT r.fixture, r.result, r.created_at, u.username FROM friend_comp_reports r JOIN users u ON u.id = r.user_id WHERE r.comp_id = ? AND r.season = ?')
      .bind(c.id, season).all();
    const { results: rooms } = await env.DB.prepare('SELECT r.fixture, r.room, r.created_at, u.username FROM friend_comp_rooms r JOIN users u ON u.id = r.host_id WHERE r.comp_id = ? AND r.season = ? AND r.created_at > ?')
      .bind(c.id, season, t - ROOM_TTL).all();
    out.pending = (cr ? cr.fixtures : []).filter(f => !f.played && (humans.has(f.home) || humans.has(f.away))).map(f => {
      const hu = humans.get(f.home), au = humans.get(f.away), room = rooms.find(r => r.fixture === f.id);
      return {
        fixture: f.id, home: f.home, away: f.away, homeUser: hu ? hu.username : null, awayUser: au ? au.username : null,
        reports: reps.filter(r => r.fixture === f.id).map(r => { const x = JSON.parse(r.result); return { username: r.username, kind: x.kind, h: x.h, a: x.a, at: r.created_at }; }),
        room: room ? { code: room.room, host: room.username, at: room.created_at } : null,
      };
    });
  }
  return out;
}
export async function compView(env, user, code, t) {
  const c = await load(env, code);
  const me = memberOf(c, user);
  if (!me || me.status === 'DECLINED' || me.status === 'EXPIRED') fail(404, 'NO_COMP', 'Competizione non trovata');
  return viewOf(env, c, user, t);
}

// competizioni a cui partecipo e inviti in attesa (per il pannello degli amici e il cruscotto)
export async function listComps(env, user) {
  const { results } = await env.DB.prepare(
    'SELECT c.id, c.code, c.name, c.kind, c.status, c.state, c.config, c.updated_at, m.status AS my_status, m.team AS my_team, o.username AS owner ' +
    'FROM friend_comp_members m JOIN friend_comps c ON c.id = m.comp_id JOIN users o ON o.id = c.owner_id ' +
    "WHERE m.user_id = ? AND c.status <> 'CANCELLED' AND (m.status = 'ACCEPTED' OR (m.status = 'INVITED' AND c.status = 'OPEN')) ORDER BY c.updated_at DESC LIMIT " + LIST_LIMIT)
    .bind(user.id).all();
  const ids = results.map(r => r.id);
  const counts = new Map();
  if (ids.length) {
    const { results: cn } = await env.DB.prepare("SELECT comp_id, COUNT(*) AS n FROM friend_comp_members WHERE status = 'ACCEPTED' AND comp_id IN (" + ids.map(() => '?').join(',') + ') GROUP BY comp_id')
      .bind(...ids).all();
    for (const r of cn) counts.set(r.comp_id, r.n);
  }
  return {
    comps: results.map(r => {
      const comp = r.state ? JSON.parse(r.state) : null, cfg = JSON.parse(r.config);
      const item = { code: r.code, name: r.name, kind: r.kind, status: r.status, owner: r.owner, invited: r.my_status === 'INVITED',
        myTeam: r.my_status === 'ACCEPTED' ? r.my_team : null, members: counts.get(r.id) || 0, teams: cfg.teams.length, updatedAt: r.updated_at };
      if (comp) {
        const cr = L.currentRound(comp);
        item.season = comp.season; item.round = L.roundLabel(comp, cr); item.progress = L.compProgress(comp); item.champion = comp.champion;
        const next = cr && item.myTeam !== null ? cr.fixtures.find(f => f.home === item.myTeam || f.away === item.myTeam) : null;
        item.next = next ? { home: next.home, away: next.away } : null;
      }
      return item;
    }),
  };
}

// ---------- creazione e iscrizioni ----------
// body: { kind, name, teams, legs, groups, extraTime, penalties, halfSeconds, difficulty, team (la mia), invite: [nomi] }
export async function createComp(env, user, body, t) {
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM friend_comps WHERE owner_id = ? AND status IN ('OPEN', 'ACTIVE')").bind(user.id).first();
  if (live.n >= MAX_LIVE_OWNED) fail(429, 'TOO_MANY', 'Hai già ' + MAX_LIVE_OWNED + ' competizioni in corso: finiscine o eliminane una');
  let made;
  try { made = L.makeCompConfig(Object.assign({}, body, { userTeam: body.team }), NTEAMS); } catch (e) { fail(400, 'BAD_CONFIG', e.message); }
  const myTeam = made.config.userTeam;
  if (myTeam < 0) fail(400, 'NO_TEAM', 'Scegli la tua squadra tra quelle della competizione');
  made.config.userTeam = -1;       // sul server nessuna squadra è "del giocatore": lo dicono i partecipanti
  const names = Array.isArray(body.invite) ? [...new Set(body.invite.filter(x => typeof x === 'string'))].slice(0, MAX_MEMBERS - 1) : [];
  const invitees = [];
  for (const name of names) {
    const u = await userByName(env, name);
    if (u.id === user.id) continue;
    if (!(await areFriends(env, user.id, u.id))) fail(403, 'NOT_FRIEND', u.username + ' non è tra i tuoi amici');
    invitees.push(u);
  }
  let row = null;
  for (let i = 0; i < 5 && !row; i++) {
    row = await env.DB.prepare("INSERT INTO friend_comps (code, owner_id, kind, name, status, config, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?) ON CONFLICT (code) DO NOTHING RETURNING id, code")
      .bind('SF-' + randomCode(5), user.id, made.kind, made.name, JSON.stringify(made.config), t, t).first();
  }
  if (!row) fail(500, 'SERVER', 'Errore del server');
  await env.DB.batch([
    env.DB.prepare("INSERT INTO friend_comp_members (comp_id, user_id, team, status, invited_at, answered_at) VALUES (?, ?, ?, 'ACCEPTED', ?, ?)").bind(row.id, user.id, myTeam, t, t),
    ...invitees.map(u => env.DB.prepare("INSERT INTO friend_comp_members (comp_id, user_id, team, status, invited_at) VALUES (?, ?, NULL, 'INVITED', ?)").bind(row.id, u.id, t)),
  ]);
  return compView(env, user, row.code, t);
}

export async function inviteFriend(env, user, code, body, t) {
  const c = await load(env, code);
  requireOwner(c, user);
  if (c.status !== 'OPEN') fail(409, 'STARTED', 'La competizione è già iniziata: gli inviti sono chiusi');
  const u = await userByName(env, body.username);
  if (u.id === user.id) fail(400, 'SELF', 'Partecipi già');
  if (!(await areFriends(env, user.id, u.id))) fail(403, 'NOT_FRIEND', u.username + ' non è tra i tuoi amici');
  const m = c.members.find(x => x.user_id === u.id);
  if (m && (m.status === 'ACCEPTED' || m.status === 'INVITED')) return compView(env, user, code, t);
  if (c.members.filter(x => x.status === 'ACCEPTED' || x.status === 'INVITED').length >= MAX_MEMBERS) fail(409, 'FULL', 'Al massimo ' + MAX_MEMBERS + ' partecipanti');
  await env.DB.prepare("INSERT INTO friend_comp_members (comp_id, user_id, team, status, invited_at) VALUES (?, ?, NULL, 'INVITED', ?) ON CONFLICT (comp_id, user_id) DO UPDATE SET status = 'INVITED', team = NULL, invited_at = excluded.invited_at, answered_at = NULL")
    .bind(c.id, u.id, t).run();
  return compView(env, user, code, t);
}

// accettare un invito (o cambiare squadra prima dell'inizio): la squadra deve essere della competizione e libera
export async function chooseTeam(env, user, code, body, t) {
  const c = await load(env, code);
  const m = memberOf(c, user);
  if (!m || (m.status !== 'INVITED' && m.status !== 'ACCEPTED')) fail(404, 'NO_COMP', 'Competizione non trovata');
  if (c.status !== 'OPEN') fail(409, 'STARTED', 'La competizione è già iniziata');
  const team = body.team;
  if (!Number.isInteger(team) || c.cfg.teams.indexOf(team) < 0) fail(400, 'BAD_TEAM', 'Scegli una squadra della competizione');
  const r = await env.DB.prepare("UPDATE friend_comp_members SET team = ?, status = 'ACCEPTED', answered_at = ? WHERE comp_id = ? AND user_id = ? " +
    "AND NOT EXISTS (SELECT 1 FROM friend_comp_members WHERE comp_id = ? AND team = ? AND status = 'ACCEPTED' AND user_id <> ?)")
    .bind(team, t, c.id, user.id, c.id, team, user.id).run();
  if (!r.meta.changes) fail(409, 'TEAM_TAKEN', 'Questa squadra l\'ha già scelta un altro giocatore');
  return compView(env, user, code, t);
}
export async function declineInvite(env, user, code, t) {
  const c = await load(env, code);
  const m = memberOf(c, user);
  if (!m || m.status !== 'INVITED') fail(404, 'NO_INVITE', 'Nessun invito');
  await env.DB.prepare("UPDATE friend_comp_members SET status = 'DECLINED', answered_at = ? WHERE comp_id = ? AND user_id = ?").bind(t, c.id, user.id).run();
  return { ok: true };
}

export async function startComp(env, user, code, t) {
  return mutate(env, code, t, async c => {
    requireOwner(c, user);
    if (c.status !== 'OPEN') fail(409, 'STARTED', 'La competizione è già iniziata');
    c.comp = { kind: c.kind, name: c.name, season: 1, config: c.cfg, history: [], createdAt: t };
    L.startSeason(c.comp, randomInt31() || 1, CTX);
    // gli inviti senza risposta scadono: le loro squadre le guida l'IA
    c.members = c.members.filter(m => m.status === 'ACCEPTED');
    autoSim(c, t);
    return { save: true, status: c.comp.status === 'finished' ? 'FINISHED' : 'ACTIVE', out: { ok: true },
      after: [env.DB.prepare("UPDATE friend_comp_members SET status = 'EXPIRED' WHERE comp_id = ? AND status = 'INVITED'").bind(c.id)] };
  });
}

export async function leaveComp(env, user, code, t) {
  const c = await load(env, code);
  const m = memberOf(c, user);
  if (!m || (m.status !== 'ACCEPTED' && m.status !== 'INVITED')) fail(404, 'NO_COMP', 'Competizione non trovata');
  if (c.owner_id === user.id) fail(400, 'OWNER', 'Hai creato tu la competizione: puoi eliminarla');
  if (c.status === 'OPEN') {
    await env.DB.prepare('DELETE FROM friend_comp_members WHERE comp_id = ? AND user_id = ?').bind(c.id, user.id).run();
    return { ok: true };
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE friend_comp_members SET status = 'LEFT', answered_at = ? WHERE comp_id = ? AND user_id = ?").bind(t, c.id, user.id),
    env.DB.prepare('DELETE FROM friend_comp_reports WHERE comp_id = ? AND user_id = ?').bind(c.id, user.id),
  ]);
  // la sua squadra ora la guida l'IA: le partite rimaste in sospeso si simulano
  if (c.status === 'ACTIVE') await mutate(env, code, t, async c2 => { autoSim(c2, t); return { save: true, out: null }; });
  return { ok: true };
}

export async function cancelComp(env, user, code, t) {
  const c = await load(env, code);
  requireOwner(c, user);
  await env.DB.prepare("UPDATE friend_comps SET status = 'CANCELLED', updated_at = ? WHERE id = ?").bind(t, c.id).run();
  return { ok: true };
}

export async function newSeason(env, user, code, t) {
  return mutate(env, code, t, async c => {
    requireOwner(c, user);
    if (c.status !== 'FINISHED' || !L.nextSeason(c.comp, CTX)) fail(409, 'NOT_FINISHED', 'La stagione non è ancora finita');
    autoSim(c, t);
    return { save: true, out: { ok: true, season: c.comp.season } };
  });
}

// ---------- partite ----------
// partita della mia squadra nel turno in corso
function myFixture(c, user, fid) {
  if (c.status !== 'ACTIVE') fail(409, 'NOT_ACTIVE', 'La competizione non è in corso');
  const me = requireMember(c, user);
  const cr = L.currentRound(c.comp);
  const f = cr && cr.fixtures.find(x => x.id === fid);
  if (!f || f.played) fail(409, 'NOT_CURRENT', 'Questa partita non è in programma adesso: aggiorna');
  const side = f.home === me.team ? 0 : f.away === me.team ? 1 : -1;
  if (side < 0) fail(403, 'NOT_YOUR_MATCH', 'Non è una partita della tua squadra');
  const opp = humanTeams(c).get(side === 0 ? f.away : f.home) || null;
  return { me, f, side, opp };
}
const cleanScore = body => {
  try { return L.checkResult({ config: {} }, { stage: 'league' }, { h: body.h, a: body.a, scorers: body.scorers }); } catch (e) { fail(400, 'BAD_RESULT', e.message); }
};
const reportStmt = (env, c, f, userId, res, t) => env.DB.prepare('INSERT INTO friend_comp_reports (comp_id, season, fixture, user_id, result, created_at) VALUES (?, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT (comp_id, season, fixture, user_id) DO UPDATE SET result = excluded.result, created_at = excluded.created_at').bind(c.id, c.comp.season, f.id, userId, JSON.stringify(res), t);
const clearStmts = (env, c, f) => [
  env.DB.prepare('DELETE FROM friend_comp_reports WHERE comp_id = ? AND season = ? AND fixture = ?').bind(c.id, c.comp.season, f.id),
  env.DB.prepare('DELETE FROM friend_comp_rooms WHERE comp_id = ? AND season = ? AND fixture = ?').bind(c.id, c.comp.season, f.id),
];
const fixtureOut = f => ({ id: f.id, home: f.home, away: f.away, h: f.h, a: f.a, et: f.et, pens: f.pens, winner: f.winner, how: f.how });

// body: { fixture, kind: 'score' | 'sim' | 'kickoff' | 'abandon', result (score: risultato del motore),
//         h, a, fraction, scorers (abandon: punteggio quando si è usciti) }
export async function reportResult(env, user, code, body, t) {
  const kind = body.kind;
  if (['score', 'sim', 'kickoff', 'abandon'].indexOf(kind) < 0) fail(400, 'BAD_KIND', 'Richiesta non valida');
  return mutate(env, code, t, async c => {
    const { f, opp } = myFixture(c, user, String(body.fixture || ''));
    let r, how;
    if (!opp) {
      // contro l'IA
      if (kind === 'kickoff') {
        const prev = await env.DB.prepare('SELECT result FROM friend_comp_reports WHERE comp_id = ? AND season = ? AND fixture = ? AND user_id = ?').bind(c.id, c.comp.season, f.id, user.id).first();
        if (!prev || JSON.parse(prev.result).kind !== 'kickoff') {
          await reportStmt(env, c, f, user.id, { kind: 'kickoff' }, t).run();
          return { save: false, out: { status: 'started' } };
        }
        // già iniziata e mai finita (gioco chiuso a metà): niente seconda possibilità, decide la simulazione
        r = L.simulateFixture(c.comp, f, CTX, 'abbandonata'); how = 'abbandonata';
      } else if (kind === 'sim') { r = L.simulateFixture(c.comp, f, CTX); how = 'sim'; }
      else if (kind === 'abandon') {
        const s = cleanScore(body);
        const fr = Number(body.fraction);
        r = L.resultFromScore(c.comp, f, [s.h, s.a], Number.isFinite(fr) ? Math.min(1, Math.max(0, fr)) : 0, s.scorers, CTX); how = 'abbandonata';
      } else {
        try { r = L.checkResult(c.comp, f, body.result); } catch (e) { fail(400, 'BAD_RESULT', e.message); }
        how = 'played';
      }
      r.by = user.username;
    } else {
      // contro un amico: vale quando i due risultati coincidono (o entrambi chiedono la simulazione)
      if (kind !== 'score' && kind !== 'sim') fail(400, 'BAD_KIND', 'Contro un amico si gioca online');
      const mine = kind === 'sim' ? { kind: 'sim' } : Object.assign({ kind: 'score' }, cleanScore(body.result || {}));
      await reportStmt(env, c, f, user.id, mine, t).run();
      const o = await env.DB.prepare('SELECT result FROM friend_comp_reports WHERE comp_id = ? AND season = ? AND fixture = ? AND user_id = ?').bind(c.id, c.comp.season, f.id, opp.user_id).first();
      if (!o) return { save: false, out: { status: 'waiting' } };
      const other = JSON.parse(o.result);
      if (mine.kind === 'sim' && other.kind === 'sim') { r = L.simulateFixture(c.comp, f, CTX); how = 'sim'; }
      else if (mine.kind === 'score' && other.kind === 'score' && mine.h === other.h && mine.a === other.a) {
        // i due giochi vedono la stessa partita (la simula l'host): i marcatori dall'elenco più completo
        const src = (mine.scorers || []).length >= (other.scorers || []).length ? mine : other;
        r = L.completeKnockout(c.comp, f, { h: mine.h, a: mine.a, scorers: src.scorers }, CTX); how = 'played';
        r.by = 'online';
      } else return { save: false, out: { status: 'conflict', mine: mine, other: { kind: other.kind, h: other.h, a: other.a } } };
    }
    L.recordResult(c.comp, f.id, r, how, t, CTX);
    autoSim(c, t);
    return { save: true, after: clearStmts(env, c, f), out: { status: how === 'abbandonata' && kind === 'kickoff' ? 'abandoned' : 'recorded', fixture: fixtureOut(f), finished: c.comp.status === 'finished' } };
  });
}

// partita bloccata (un amico non risponde): chi ha creato la competizione può chiedere la simulazione ufficiale
export async function forceSim(env, user, code, body, t) {
  return mutate(env, code, t, async c => {
    requireOwner(c, user);
    if (c.status !== 'ACTIVE') fail(409, 'NOT_ACTIVE', 'La competizione non è in corso');
    const cr = L.currentRound(c.comp);
    const f = cr && cr.fixtures.find(x => x.id === String(body.fixture || ''));
    if (!f || f.played) fail(409, 'NOT_CURRENT', 'Questa partita non è in programma adesso: aggiorna');
    L.recordResult(c.comp, f.id, L.simulateFixture(c.comp, f, CTX), 'sim', t, CTX);
    autoSim(c, t);
    return { save: true, after: clearStmts(env, c, f), out: { status: 'recorded', fixture: fixtureOut(f) } };
  });
}

// stanza online per la partita tra due amici: chi la crea manda il codice, l'altro lo vede e entra
export async function setRoom(env, user, code, body, t) {
  const c = await load(env, code);
  const { f, opp } = myFixture(c, user, String(body.fixture || ''));
  if (!opp) fail(400, 'NOT_FRIEND_MATCH', 'Questa partita è contro l\'IA');
  if (typeof body.room !== 'string' || !ROOM_RE.test(body.room)) fail(400, 'BAD_ROOM', 'Codice della stanza non valido');
  await env.DB.prepare('INSERT INTO friend_comp_rooms (comp_id, season, fixture, room, host_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT (comp_id, season, fixture) DO UPDATE SET room = excluded.room, host_id = excluded.host_id, created_at = excluded.created_at')
    .bind(c.id, c.comp.season, f.id, body.room, user.id, t).run();
  return { ok: true };
}
