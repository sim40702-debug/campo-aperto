// ============================================================
// RETE — partite online con host autorevole
//
// Architettura:
//   client  <->  server relay (server/relay.js)  <->  host
// L'host simula la partita (Match) ed è l'unico a deciderne lo stato.
// I client mandano solo i comandi (movimento e azioni) e ricevono 30 volte
// al secondo un'istantanea binaria che interpolano per un movimento fluido.
// Nessun file di questo modulo usa DOM o Three.js: si testa anche in Node.
// ============================================================
const NET = {
  PROTOCOL: 1,            // deve coincidere con PROTOCOL in server/relay.js
  SNAP_EVERY: 2,          // un'istantanea ogni 2 passi di simulazione = 30 al secondo
  INPUT_HZ: 30,
  INTERP: 0.1,            // ritardo di interpolazione dei client (secondi)
  MAX_SLOTS: 8,           // umani per partita
  MAX_PER_TEAM: 4,
  CODE_RE: /^[A-HJ-NP-Z2-9]{6}$/,
  ACTIONS: ['pass', 'long', 'through', 'switch', 'shootDown'],
  STATES: ['KICKOFF', 'PLAY', 'DEAD', 'SETPIECE', 'GOAL', 'HALFTIME', 'FULLTIME'],
  SP_TYPES: ['KICKOFF', 'THROW_IN', 'CORNER', 'GOAL_KICK', 'FREE_KICK', 'PENALTY'],
  HEADER: 34,             // valori fissi in testa all'istantanea
  PSTRIDE: 14,            // valori per ogni calciatore (posizione, animazioni, energia, cartellini, caduta)
  BANNER_KINDS: ['goal', 'foul', 'yellow', 'red', 'advantage', 'offside', 'penalty', 'info'],
  REF_TYPES: ['GOAL', 'FOUL', 'YELLOW_CARD', 'RED_CARD', 'SECOND_YELLOW', 'PENALTY', 'FREE_KICK', 'CORNER', 'OFFSIDE',
    'THROW_IN', 'GOAL_KICK', 'ADVANTAGE', 'KICK_OFF', 'HALF_TIME', 'FULL_TIME', 'SHOT', 'SHOT_ON_TARGET'],
  EV_TYPES: ['kick', 'whistle', 'post', 'save', 'goal', 'tackle', 'switch', 'ref'],
};
const netNow = () => performance.now() / 1000;

// pulizia del codice inserito dall'utente: maiuscole, solo caratteri ammessi
function normalizeCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }

// indirizzo dell'host scritto a mano: IP, IP:porta o ws://IP:porta (porta predefinita 8787). null se non valido
function parseHostAddress(s) {
  const m = /^(?:ws:\/\/)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?\/?$/.exec(String(s || '').trim());
  if (!m) return null;
  const o = m.slice(1, 5);
  if (o.some(x => +x > 255 || (x.length > 1 && x[0] === '0'))) return null;
  const port = m[5] === undefined ? 8787 : +m[5];
  if (port < 1 || port > 65535) return null;
  const ip = o.join('.');
  return { ip, port, url: 'ws://' + ip + ':' + port, text: ip + (port === 8787 ? '' : ':' + port) };
}

// ---------- COLLEGAMENTO AL SERVER ----------
// errore con un codice: quelli del server (NOT_FOUND, FULL, VERSION...) oppure quelli del collegamento:
//   TIMEOUT (il server non apre il socket in tempo), UNREACHABLE (connessione rifiutata o rete assente),
//   NO_REPLY (socket aperto ma nessuna risposta), BAD_CODE, BAD_REPLY
function netError(code, msg) { const e = new Error(msg); e.code = code; return e; }

class NetLink {
  constructor(url, openMs) {
    this.url = url;
    this.openMs = openMs || 0;  // tempo massimo per aprire il socket in join (0 = predefinito)
    this.ws = null;
    this.handlers = {};
    this.state = 'idle';        // idle, connecting, online, reconnecting, closed
    this.code = null; this.id = null; this.token = null; this.isHost = false; this.hostId = null;
    this.rtt = 0;               // tempo di andata e ritorno verso il server (ms)
    this.left = false;
  }
  on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); return this; }
  emit(type, data) { for (const fn of this.handlers[type] || []) { try { fn(data); } catch (e) { console.error(e); } } }

  // indirizzo con la stanza: il relay del Worker (un indirizzo per tutti) sceglie la stanza dal codice già
  // all'apertura; i relay Node (rete locale, server/relay.js) ignorano questi parametri
  roomUrl(query) { return query ? this.url + (this.url.indexOf('?') >= 0 ? '&' : '?') + query : this.url; }

  // apre il socket; rifiuta se il server non risponde entro "ms"
  open(ms, query) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.roomUrl(query)); } catch (e) { reject(netError('UNREACHABLE', 'Indirizzo del server non valido')); return; }
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { try { ws.close(); } catch (e) { /* */ } reject(netError('TIMEOUT', 'Connessione scaduta: il server non risponde')); }, ms || 6000);
      ws.onopen = () => { clearTimeout(timer); resolve(ws); };
      ws.onerror = () => { clearTimeout(timer); reject(netError('UNREACHABLE', 'Impossibile collegarsi al server')); };
    });
  }

  attach(ws) {
    this.ws = ws;
    let missed = 0;               // ping partiti senza ricevere più nulla
    ws.onmessage = ev => {
      missed = 0;
      if (typeof ev.data !== 'string') { this.emit('binary', ev.data); return; }
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === 'pong') { this.rtt = Math.round(performance.now() - msg.n); return; }
      if (msg.t === 'closed') { this.state = 'closed'; this.left = true; }
      this.emit(msg.t, msg);
    };
    ws.onclose = () => this.socketLost(ws);
    clearInterval(this.pingTimer);
    // un collegamento può morire senza chiudersi (Wi-Fi caduto, PC dell'altro spento): dopo 4 ping
    // senza risposta (circa 8 secondi) il socket si considera perso e parte il rientro automatico
    this.pingTimer = setInterval(() => {
      if (this.ws !== ws) return;
      if (++missed > 4) { ws.onclose = null; try { ws.close(); } catch (e) { /* */ } this.socketLost(ws); return; }
      this.sendRaw({ t: 'ping', n: performance.now() });
    }, 2000);
  }

  socketLost(ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    clearInterval(this.pingTimer);
    if (this.left || this.state === 'closed') { this.state = 'closed'; this.emit('close', {}); return; }
    if (this.code && this.token) this.reconnect();
    else { this.state = 'closed'; this.emit('close', {}); }
  }

  // invia una richiesta e aspetta una delle risposte indicate (o un errore)
  request(msg, okTypes) {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      const timer = setTimeout(() => { cleanup(); reject(netError('NO_REPLY', 'Il server non ha risposto')); }, 8000);
      const prev = ws.onmessage;
      const cleanup = () => { clearTimeout(timer); ws.onmessage = prev; };
      ws.onmessage = ev => {
        if (typeof ev.data !== 'string') return;
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'error') { cleanup(); reject(netError(m.code, m.msg || 'Errore del server')); return; }
        if (okTypes.indexOf(m.t) >= 0) { cleanup(); resolve(m); }
      };
      ws.send(JSON.stringify(msg));
    });
  }

  async create(name) {
    this.state = 'connecting';
    const ws = await this.open(undefined, 'op=create');
    this.ws = ws;
    try {
      const r = await this.request({ t: 'create', v: NET.PROTOCOL, name: name }, ['created']);
      if (typeof r.code !== 'string' || !NET.CODE_RE.test(r.code) || typeof r.id !== 'string' || typeof r.token !== 'string') throw netError('BAD_REPLY', 'Risposta del server non valida');
      this.code = r.code; this.id = r.id; this.token = r.token; this.isHost = true; this.hostId = r.id;
      this.state = 'online'; this.attach(ws);
      return r;
    } catch (e) { this.state = 'closed'; ws.close(); throw e; }
  }

  async join(code, name) {
    code = normalizeCode(code);
    if (!NET.CODE_RE.test(code)) throw netError('BAD_CODE', 'Codice partita non valido: sono 6 caratteri, lettere e numeri');
    this.state = 'connecting';
    const ws = await this.open(this.openMs || undefined, 'code=' + code);
    this.ws = ws;
    try {
      const r = await this.request({ t: 'join', v: NET.PROTOCOL, code: code, name: name }, ['joined']);
      if (r.code !== code || typeof r.id !== 'string' || typeof r.token !== 'string' || typeof r.hostId !== 'string') throw netError('BAD_REPLY', 'Risposta del server non valida');
      this.code = r.code; this.id = r.id; this.token = r.token; this.isHost = false; this.hostId = r.hostId;
      this.state = 'online'; this.attach(ws);
      return r;
    } catch (e) { this.state = 'closed'; ws.close(); throw e; }
  }

  // rientro automatico nello stesso posto dopo una caduta di rete
  async reconnect() {
    this.state = 'reconnecting';
    this.emit('reconnecting', {});
    const waits = [500, 1000, 2000, 3000, 4000, 5000, 5000, 5000];
    for (const w of waits) {
      await new Promise(r => setTimeout(r, w));
      if (this.left) return;
      try {
        const ws = await this.open(4000, 'code=' + this.code);
        this.ws = ws;
        const r = await this.request({ t: 'resume', v: NET.PROTOCOL, code: this.code, token: this.token }, ['resumed']);
        this.hostId = r.hostId;
        this.state = 'online'; this.attach(ws);
        this.emit('reconnected', {});
        return;
      } catch (e) {
        if (this.ws) { try { this.ws.close(); } catch (er) { /* */ } this.ws = null; }
        if (e.code === 'NOT_FOUND') break;   // la stanza non esiste più: inutile insistere
      }
    }
    this.state = 'closed';
    this.emit('lost', {});
  }

  sendRaw(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  toHost(d) { this.sendRaw({ t: 'send', to: 'host', d: d }); }
  toAll(d) { this.sendRaw({ t: 'send', to: 'all', d: d }); }
  to(id, d) { this.sendRaw({ t: 'send', to: id, d: d }); }
  sendBinary(buf) { if (this.ws && this.ws.readyState === 1 && this.ws.bufferedAmount < 256 * 1024) this.ws.send(buf); }
  kick(id) { this.sendRaw({ t: 'kick', id: id }); }
  leave() {
    this.left = true;
    clearInterval(this.pingTimer);
    this.sendRaw({ t: 'leave' });
    const ws = this.ws; this.ws = null; this.state = 'closed';
    if (ws) setTimeout(() => { try { ws.close(); } catch (e) { /* */ } }, 50);
  }
}

// ---------- ISTANTANEA BINARIA ----------
// i calciatori viaggiano sempre tutti e 22 nello stesso ordine (allSlots), espulsi compresi:
// per ognuno i cartellini e lo stato (in campo, espulso, uscito) stanno nei "flag"
function encodeSnapshot(m, seq, simTime, slots) {
  const ps = m.allSlots();
  const f = new Float32Array(NET.HEADER + ps.length * NET.PSTRIDE);
  const b = m.ball;
  f[0] = seq; f[1] = simTime; f[2] = NET.STATES.indexOf(m.state); f[3] = m.stateTime;
  f[4] = m.clock; f[5] = m.half; f[6] = m.teams[0].score; f[7] = m.teams[1].score; f[8] = m.teams[0].dir;
  f[9] = b.x; f[10] = b.y; f[11] = b.z; f[12] = b.vx; f[13] = b.vz;
  const sp = m.setPiece;
  f[14] = sp && (m.state === 'SETPIECE' || m.state === 'KICKOFF') ? NET.SP_TYPES.indexOf(sp.type) : -1;
  f[15] = sp && sp.taker ? ps.indexOf(sp.taker) : -1;
  f[16] = m.setPieceReady ? 1 : 0;
  f[17] = m.advantage ? 1 : 0;
  for (let s = 0; s < NET.MAX_SLOTS; s++) {
    const h = slots[s] ? m.humanById(slots[s]) : null;
    f[18 + s * 2] = h && h.player ? ps.indexOf(h.player) : -1;
    f[19 + s * 2] = h ? h.shootCharge : 0;
  }
  let k = NET.HEADER;
  for (const p of ps) {
    f[k] = p.x; f[k + 1] = p.z; f[k + 2] = p.vx; f[k + 3] = p.vz; f[k + 4] = p.facing; f[k + 5] = p.anim.phase;
    f[k + 6] = p.anim.kick; f[k + 7] = p.anim.dive; f[k + 8] = p.anim.diveDir; f[k + 9] = p.anim.tackle;
    f[k + 10] = p.anim.header; f[k + 11] = p.energy;
    f[k + 12] = Math.min(3, p.cards.yellow) + (p.sentOff ? 4 : 0) + (p.gone ? 8 : 0);
    f[k + 13] = p.anim.fall;
    k += NET.PSTRIDE;
  }
  return f;
}

// controlla e ripulisce i comandi ricevuti da un client
function sanitizeInput(d) {
  const num = v => (typeof v === 'number' && isFinite(v) ? clamp(v, -1, 1) : 0);
  let mx = num(d.mx), mz = num(d.mz);
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  const acts = Array.isArray(d.a) ? d.a.filter(a => NET.ACTIONS.indexOf(a) >= 0).slice(0, 5) : [];
  // colpetto della levetta destra (cambio giocatore in una direzione): vettore unitario o niente
  let sw = null;
  if (Array.isArray(d.sw) && d.sw.length === 2) {
    const x = num(d.sw[0]), z = num(d.sw[1]), m = Math.hypot(x, z);
    if (m > 0.5) sw = [x / m, z / m];
  }
  return { mx: mx, mz: mz, sprint: !!d.sp, shoot: !!d.sh, press: !!d.pr, acts: acts, sw: sw };
}

// ---------- EVENTI IN RETE ----------
// evento della simulazione -> formato compatto per audio, grafica e rete (uguale in locale e sui client)
function matchEventForNet(m, e) {
  const ev = { type: e.type, x: m.ball.x, z: m.ball.z };
  if (e.type === 'kick') ev.power = e.data.power;
  if (e.type === 'whistle') ev.kind = e.data.type;
  if (e.type === 'goal') { ev.team = e.data.team; ev.y = m.ball.netHit ? m.ball.netHit.y : m.ball.y; if (m.ball.netHit) { ev.z = m.ball.netHit.z; ev.power = m.ball.netHit.v; } }
  if (e.type === 'switch') ev.id = e.data.id;
  if (e.type === 'tackle') { ev.sev = e.data && e.data.sev || 0; ev.slide = !!(e.data && e.data.slide); }
  if (e.type === 'ref') ev.r = e.data;
  return ev;
}

// evento ricevuto dall'host: solo tipi conosciuti, numeri finiti, testi corti
// nomi personalizzati delle squadre: testo semplice (mai HTML), al massimo 24 caratteri. Vuoto = nome originale.
const TEAM_NAME_MAX = 24;
function cleanTeamName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, TEAM_NAME_MAX);
}
// sigla del tabellone (3 caratteri) presa dal nome: solo lettere e cifre
function teamShortOf(name) {
  const l = name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (l + 'XXX').slice(0, 3);
}
// copia della squadra con il nome scelto (la squadra del database non cambia)
function namedTeam(t, name) {
  const n = cleanTeamName(name);
  if (!n || n === t.name) return t;
  return Object.assign({}, t, { name: n, short: teamShortOf(n) });
}
function cleanTeamNames(v) { return Array.isArray(v) ? [cleanTeamName(v[0]), cleanTeamName(v[1])] : ['', '']; }

function cleanNetEvent(e) {
  if (!e || typeof e !== 'object' || NET.EV_TYPES.indexOf(e.type) < 0) return null;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const c = { type: e.type, x: clamp(num(e.x, 0), -70, 70), z: clamp(num(e.z, 0), -50, 50), T: num(e.T, 0) };
  if (e.power !== undefined) c.power = clamp(num(e.power, 0), 0, 60);
  if (e.y !== undefined) c.y = clamp(num(e.y, 0), 0, 10);
  if (e.sev !== undefined) c.sev = clamp(num(e.sev, 0), 0, 1);
  if (e.slide !== undefined) c.slide = e.slide === true;
  if (typeof e.kind === 'string') c.kind = e.kind.slice(0, 16);
  if (e.team === 0 || e.team === 1) c.team = e.team;
  if (typeof e.id === 'string') c.id = e.id.slice(0, 16);
  if (e.type === 'ref') {
    const r = e.r;
    if (!r || typeof r !== 'object' || NET.REF_TYPES.indexOf(r.type) < 0) return null;
    const who = q => q && typeof q === 'object' ? { id: num(q.id, -1) | 0, num: num(q.num, 0) | 0, name: typeof q.name === 'string' ? q.name.slice(0, 40) : '', team: q.team === 1 ? 1 : 0 } : null;
    c.r = { type: r.type, minute: num(r.minute, 0) | 0, half: r.half === 2 ? 2 : 1, clock: num(r.clock, 0), team: r.team === 0 || r.team === 1 ? r.team : -1,
      player: who(r.player), victim: who(r.victim), x: clamp(num(r.x, 0), -70, 70), z: clamp(num(r.z, 0), -50, 50),
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 80) : '', severity: clamp(num(r.severity, 0), 0, 1),
      consequence: typeof r.consequence === 'string' ? r.consequence.slice(0, 16) : '', t: num(r.t, 0) };
  }
  return c;
}

// cartellini della partita per il riepilogo (dal registro degli eventi)
function cardList(timeline) {
  return timeline.filter(e => e.type === 'YELLOW_CARD' || e.type === 'RED_CARD').slice(-40)
    .map(e => ({ type: e.type === 'RED_CARD' ? 'red' : 'yellow', minute: e.minute, team: e.player ? e.player.team : e.team, name: e.player ? e.player.name : '' }));
}

// ---------- HOST ----------
class HostSession {
  constructor(link, db, myName) {
    this.link = link; this.db = db;
    this.members = new Map();     // id -> { id, name, side, connected, ping, gv }
    this.members.set(link.id, { id: link.id, name: myName, side: 0, connected: true, ping: 0, isHost: true });
    this.settings = { home: 0, away: 4, halfSeconds: 180, difficulty: 1, names: ['', ''] };
    this.match = null; this.phase = 'lobby';
    this.lockSides = null;        // sfida tra amici: nome -> lato (ognuno con la sua squadra, gli altri guardano)
    this.inputs = new Map();      // id -> ultimo comando ricevuto
    this.slots = [];              // slot -> id
    this.acc = 0; this.steps = 0; this.simTime = 0; this.seq = 0;
    this.pendingEv = []; this.metaTimer = 0; this.lastMetaKey = '';
    this.onChange = null;         // la UI aggiorna la lobby
    link.on('peer', e => this.onPeer(e));
    link.on('msg', e => this.onMsg(e.from, e.d || {}));
    link.on('reconnected', () => this.broadcastLobby());
  }
  changed() { if (this.onChange) this.onChange(); }

  onPeer(e) {
    if (e.ev === 'join') {
      // nuovo giocatore: va nella squadra con meno umani
      const count = side => [...this.members.values()].filter(m => m.side === side).length;
      let side = count(0) <= count(1) ? 0 : 1;
      if (count(side) >= NET.MAX_PER_TEAM) side = side === 0 ? 1 : 0;
      if (count(side) >= NET.MAX_PER_TEAM || this.phase !== 'lobby') side = -1;
      if (this.lockSides) side = e.name in this.lockSides && this.phase === 'lobby' && count(this.lockSides[e.name]) < NET.MAX_PER_TEAM ? this.lockSides[e.name] : -1;
      this.members.set(e.id, { id: e.id, name: e.name, side: side, connected: true, ping: 0 });
    } else if (e.ev === 'leave') {
      this.members.delete(e.id);
      this.inputs.delete(e.id);
      if (this.match) this.match.removeHuman(e.id);
    } else if (e.ev === 'drop') {
      const m = this.members.get(e.id); if (m) m.connected = false;
      this.inputs.delete(e.id);
      if (this.match) this.match.removeHuman(e.id);       // l'IA prende il suo calciatore
    } else if (e.ev === 'back') {
      const m = this.members.get(e.id);
      if (m) {
        m.connected = true;
        if (this.match && m.side >= 0 && this.slots.indexOf(m.id) >= 0) this.match.addHuman(m.id, m.side);
        if (this.match) this.link.to(m.id, this.startPayload());
      }
    }
    this.broadcastLobby();
  }

  onMsg(from, d) {
    const m = this.members.get(from);
    if (!m) return;
    switch (d.t) {
      case 'hello':
        m.gv = String(d.gv || '');
        if (m.gv !== String(GAME_VERSION)) { this.link.to(from, { t: 'reject', reason: 'Versione del gioco diversa (host ' + GAME_VERSION + ', tu ' + m.gv + ')' }); this.link.kick(from); return; }
        if (this.match) this.link.to(from, this.startPayload());
        this.broadcastLobby();
        break;
      case 'side':
        if (this.phase !== 'lobby') return;
        this.setSide(from, d.side);
        break;
      case 'in':
        if (this.phase !== 'playing') return;
        { const prev = this.inputs.get(from); const inp = sanitizeInput(d);
          if (prev && prev.acts.length) inp.acts = prev.acts.concat(inp.acts).slice(0, 8);
          if (prev && prev.sw && !inp.sw) inp.sw = prev.sw;
          this.inputs.set(from, inp); }
        break;
      case 'ping':
        m.ping = Math.max(0, Math.min(9999, Number(d.rtt) || 0));
        this.link.to(from, { t: 'pong', n: d.n });
        break;
    }
  }

  setSide(id, side) {
    side = side === 0 || side === 1 ? side : -1;
    const m = this.members.get(id);
    if (!m) return false;
    if (this.lockSides) return false;   // sfida tra amici: i lati non si cambiano
    if (side >= 0 && [...this.members.values()].filter(x => x.side === side && x !== m).length >= NET.MAX_PER_TEAM) return false;
    m.side = side;
    this.broadcastLobby();
    return true;
  }
  setSettings(s) { Object.assign(this.settings, s); this.settings.names = cleanTeamNames(this.settings.names); this.broadcastLobby(); }

  lobbyState() {
    return {
      t: 'lobby', code: this.link.code, hostId: this.link.id, phase: this.phase, settings: this.settings,
      members: [...this.members.values()].map(m => ({ id: m.id, name: m.name, side: m.side, connected: m.connected, ping: m.ping, isHost: !!m.isHost })),
    };
  }
  broadcastLobby() { this.link.toAll(this.lobbyState()); this.changed(); }

  canStart() {
    const ok = [...this.members.values()].filter(m => m.connected);
    // sfida tra amici: servono i due giocatori della partita
    if (this.lockSides) return this.phase === 'lobby' && Object.keys(this.lockSides).every(n => ok.some(m => m.name === n && m.side === this.lockSides[n]));
    return this.phase === 'lobby' && ok.length >= 1;
  }

  startPayload() {
    return { t: 'start', mid: this.mid, setup: this.settings,
      humans: this.slots.map((id, s) => { const m = this.members.get(id); return { id: id, slot: s, team: m ? m.side : 0, name: m ? m.name : '?' }; }) };
  }

  start() {
    if (!this.canStart()) return null;
    const s = this.settings;
    this.slots = [...this.members.values()].filter(m => m.side >= 0 && m.connected).slice(0, NET.MAX_SLOTS).map(m => m.id);
    const humans = this.slots.map(id => ({ id: id, team: this.members.get(id).side }));
    this.mid = Math.random().toString(36).slice(2, 10);
    const nm = cleanTeamNames(s.names);
    this.match = new Match(namedTeam(this.db[s.home], nm[0]), namedTeam(this.db[s.away], nm[1]), { humans: humans, difficulty: s.difficulty, halfSeconds: s.halfSeconds });
    this.phase = 'playing';
    this.acc = 0; this.steps = 0; this.simTime = 0; this.seq = 0; this.inputs.clear();
    this.link.toAll(this.startPayload());
    this.broadcastLobby();
    return this.match;
  }

  backToLobby() {
    this.match = null; this.phase = 'lobby';
    this.link.toAll({ t: 'lobby-return' });
    this.broadcastLobby();
  }

  // avanza la simulazione del tempo reale trascorso; restituisce gli eventi per audio/effetti locali
  update(frameDt, localInput) {
    const m = this.match;
    if (!m) return [];
    const out = [];
    this.acc += Math.min(frameDt, 0.25);
    let first = true;
    this.localUsed = false;       // true se i tasti locali sono stati letti da almeno un passo
    while (this.acc >= CONFIG.DT) {
      // comandi: il primo passo del fotogramma riceve i tasti appena premuti
      for (const h of m.humans) {
        if (h.id === this.link.id) {
          const li = localInput || { mx: 0, mz: 0, sprint: false, shoot: false, pressed: {} };
          h.input = first ? li : Object.assign({}, li, { pressed: {}, switchDir: null });
          if (first) this.localUsed = true;
        } else {
          const r = this.inputs.get(h.id);
          if (!r) { h.input = { mx: 0, mz: 0, sprint: false, shoot: false, pressed: {} }; continue; }
          const pressed = {};
          for (const a of r.acts) pressed[a] = true;
          r.acts = [];
          h.input = { mx: r.mx, mz: r.mz, sprint: r.sprint, shoot: r.shoot, press: r.press, switchDir: r.sw, pressed: pressed };
          r.sw = null;
        }
      }
      first = false;
      m.update(CONFIG.DT, null);
      this.acc -= CONFIG.DT;
      this.simTime += CONFIG.DT;
      for (const e of m.events) {
        out.push(e);
        const ev = matchEventForNet(m, e);
        ev.T = this.simTime;
        if (NET.EV_TYPES.indexOf(e.type) >= 0) this.pendingEv.push(ev);
      }
      m.events.length = 0;
      if (++this.steps % NET.SNAP_EVERY === 0) this.sendSnapshot();
    }
    this.metaTimer -= frameDt;
    if (this.metaTimer <= 0) { this.metaTimer = 0.5; this.sendMeta(false); }
    return out;
  }

  sendSnapshot() {
    const m = this.match;
    this.link.sendBinary(encodeSnapshot(m, this.seq++, this.simTime, this.slots).buffer);
    if (this.pendingEv.length) { this.link.toAll({ t: 'ev', l: this.pendingEv }); this.pendingEv = []; }
    // cambi importanti (gol, cartello) vanno subito, il resto due volte al secondo
    const key = (m.banner ? m.banner.text : '') + '|' + m.log.length + '|' + m.state + '|' + m.timeline.length;
    if (key !== this.lastMetaKey) this.sendMeta(true);
  }

  sendMeta() {
    const m = this.match;
    if (!m) return;
    this.lastMetaKey = (m.banner ? m.banner.text : '') + '|' + m.log.length + '|' + m.state + '|' + m.timeline.length;
    const lg = m.lastGoal;
    this.link.toAll({
      t: 'meta', T: this.simTime,
      banner: m.banner ? { text: m.banner.text, t: m.banner.t, kind: m.banner.kind } : null,
      cards: cardList(m.timeline),
      lastGoal: lg ? { minute: lg.minute, scorer: lg.scorer, own: !!lg.own, team: lg.team.index } : null,
      log: m.log.map(g => ({ minute: g.minute, scorer: g.scorer, own: !!g.own, team: g.team.index })),
      stats: m.teams.map(t => t.stats),
      online: this.slots.map(id => { const x = this.members.get(id); return x ? { id: id, connected: x.connected, ping: x.ping } : { id: id, connected: false, ping: 0 }; }),
    });
  }

  close() { this.link.leave(); }
}

// ---------- CLIENT ----------
// ---------- predizione del proprio calciatore sul client ----------
// Il client mostra la partita un po' nel passato (interpolazione tra le istantanee dell'host). Il proprio calciatore
// invece si muove subito con i propri comandi, con la stessa fisica del motore; ogni istantanea nuova confronta la
// posizione dell'host con quella prevista allo stesso istante e corregge l'errore un po' alla volta (tutto se è grande).
// L'host resta l'arbitro: la predizione cambia solo cosa si vede su questo computer.
class NetPredictor extends Player {
  constructor(src) { super(src.data, src.team, src.slotIndex); this.slot = src.slot; this.dribble = false; }
  hasBall() { return this.dribble; }
}

class ClientSession {
  constructor(link, db, myName) {
    this.link = link; this.db = db; this.myName = myName;
    this.lobby = null; this.match = null; this.mid = null; this.slots = [];
    this.snaps = [];              // istantanee ricevute: { T, f }
    this.delay = undefined;       // ritardo stimato tra simulazione host e orologio locale
    this.events = [];             // eventi in attesa di essere "mostrati" al momento giusto
    this.meta = null;
    this.rtt = 0;                 // ping verso l'host (ms)
    this.lastSend = 0; this.lastInputKey = ''; this.pendingActs = [];
    this.pr = null; this.lastInput = null; this.kickFx = 0; this.prevShoot = false;
    this.replayAcc = 0;
    this.onLobby = null; this.onStart = null; this.onLobbyReturn = null; this.onReject = null;
    link.on('msg', e => this.onMsg(e.d || {}));
    link.on('binary', buf => this.onSnapshot(buf));
    link.on('reconnected', () => this.hello());
    this.pingTimer = setInterval(() => this.link.toHost({ t: 'ping', n: performance.now(), rtt: this.rtt }), 1000);
  }
  hello() { this.link.toHost({ t: 'hello', gv: String(GAME_VERSION), name: this.myName }); }

  onMsg(d) {
    switch (d.t) {
      case 'lobby': { const L = this.cleanLobby(d); if (L) { this.lobby = L; if (this.onLobby) this.onLobby(L); } break; }
      case 'start': this.buildMatch(d); break;
      case 'meta': this.meta = d; this.applyMeta(); break;
      case 'ev':
        if (!Array.isArray(d.l)) break;
        for (const e of d.l.slice(0, 64)) {
          const c = cleanNetEvent(e);
          if (!c) continue;
          this.events.push(c);
          // il registro degli eventi del client è quello dell'host: arriva già deciso
          if (c.type === 'ref' && this.match) { this.match.timeline.push(c.r); if (this.match.timeline.length > 300) this.match.timeline.shift(); }
        }
        break;
      case 'pong': this.rtt = Math.round(performance.now() - d.n); break;
      case 'lobby-return': this.match = null; this.mid = null; this.snaps = []; if (this.onLobbyReturn) this.onLobbyReturn(); break;
      case 'reject': if (this.onReject) this.onReject(d.reason); break;
    }
  }

  // db è un array di squadre: indici interi nell'intervallo; durata e difficoltà devono essere numeri
  validSetup(s) {
    if (!s || typeof s !== 'object') return false;
    const okTeam = i => Number.isInteger(i) && i >= 0 && i < this.db.length;
    return okTeam(s.home) && okTeam(s.away) && Number.isFinite(s.halfSeconds) && Number.isFinite(s.difficulty);
  }

  // il messaggio della lobby arriva dall'host (non fidato): la UI vede solo dati ripuliti, oppure niente
  cleanLobby(d) {
    if (!d || typeof d !== 'object' || !this.validSetup(d.settings) || !Array.isArray(d.members)) return null;
    const str = v => typeof v === 'string' ? v : '';
    const members = d.members.slice(0, 8).filter(m => m && typeof m === 'object').map(m => ({
      id: str(m.id), name: str(m.name).slice(0, 16),
      side: m.side === 0 || m.side === 1 ? m.side : -1,
      connected: m.connected === true,
      ping: Number.isFinite(m.ping) ? Math.min(9999, Math.max(0, Math.round(m.ping))) : 0,
      isHost: m.isHost === true,
    }));
    return {
      t: 'lobby', code: typeof d.code === 'string' && NET.CODE_RE.test(d.code) ? d.code : '', hostId: str(d.hostId), phase: str(d.phase),
      settings: { home: d.settings.home, away: d.settings.away, halfSeconds: d.settings.halfSeconds, difficulty: d.settings.difficulty, names: cleanTeamNames(d.settings.names) },
      members: members,
    };
  }

  buildMatch(d) {
    if (this.match && this.mid === d.mid) return;   // stessa partita (es. dopo una riconnessione)
    const s = d.setup;
    if (!this.validSetup(s)) return;
    const hs = (d.humans || []).slice().sort((a, b) => a.slot - b.slot);
    this.slots = hs.map(h => h.id);
    this.names = {}; hs.forEach(h => { this.names[h.id] = h.name; });
    // la partita del client è un "manichino": non viene simulata, riceve solo le posizioni
    const nm = cleanTeamNames(s.names);
    this.match = new Match(namedTeam(this.db[s.home], nm[0]), namedTeam(this.db[s.away], nm[1]), { humans: hs.map(h => ({ id: h.id, team: h.team })), difficulty: s.difficulty, halfSeconds: s.halfSeconds });
    this.match.events.length = 0;
    this.match.timeline.length = 0;   // il registro degli eventi arriva solo dall'host
    this.mid = d.mid; this.snaps = []; this.delay = undefined; this.events = []; this.replayAcc = 0;
    if (this.onStart) this.onStart(this.match);
  }

  onSnapshot(buf) {
    if (!this.match) return;
    const f = new Float32Array(buf);
    if (f.length !== NET.HEADER + this.match.allSlots().length * NET.PSTRIDE) return;
    const T = f[1], now = netNow();
    const d = now - T;
    // il ritardo minimo osservato segue gli sbalzi di rete; sale piano se l'orologio deriva
    if (this.delay === undefined || d < this.delay) this.delay = d; else this.delay += (d - this.delay) * 0.002;
    const last = this.snaps[this.snaps.length - 1];
    if (last && T <= last.T) return;              // fuori ordine o duplicata
    this.snaps.push({ T: T, f: f });
    while (this.snaps.length > 2 && this.snaps[0].T < T - 1.5) this.snaps.shift();
  }

  applyMeta() {
    const m = this.match, d = this.meta;
    if (!m || !d) return;
    const bn = d.banner;
    m.banner = bn && typeof bn.text === 'string' ? { text: bn.text.slice(0, 80), t: Number(bn.t) || 1, kind: NET.BANNER_KINDS.indexOf(bn.kind) >= 0 ? bn.kind : 'info' } : null;
    if (Array.isArray(d.cards)) m.cardLog = d.cards.slice(0, 40).filter(c => c && typeof c === 'object').map(c => ({
      type: c.type === 'red' ? 'red' : 'yellow', minute: Number.isFinite(c.minute) ? c.minute : 0, team: c.team === 1 ? 1 : 0, name: typeof c.name === 'string' ? c.name.slice(0, 40) : '' }));
    m.lastGoal = d.lastGoal ? Object.assign({}, d.lastGoal, { team: m.teams[d.lastGoal.team] }) : null;
    m.log = (d.log || []).map(g => Object.assign({}, g, { team: m.teams[g.team] }));
    // statistiche: solo le voci conosciute e solo numeri
    (Array.isArray(d.stats) ? d.stats.slice(0, 2) : []).forEach((st, i) => {
      if (!st || typeof st !== 'object') return;
      for (const k in m.teams[i].stats) if (Number.isFinite(st[k])) m.teams[i].stats[k] = st[k];
    });
  }

  // ricostruisce lo stato da mostrare all'istante (tempo locale - ritardo - interpolazione)
  update(frameDt) {
    const m = this.match;
    if (!m || !this.snaps.length) return [];
    if (m.banner) { m.banner.t -= frameDt; if (m.banner.t <= 0) m.banner = null; }
    const rt = netNow() - this.delay - NET.INTERP;
    let a = this.snaps[0], b = a;
    for (let i = 0; i < this.snaps.length - 1; i++) {
      if (this.snaps[i + 1].T >= rt) { a = this.snaps[i]; b = this.snaps[i + 1]; break; }
      a = b = this.snaps[i + 1];
    }
    const t = b.T > a.T ? clamp((rt - a.T) / (b.T - a.T), 0, 1) : 1;
    this.apply(a.f, b.f, t);
    this.predict(frameDt);
    this.renderT = rt;
    // replay: un fotogramma ogni 1/60 s come sull'host
    this.replayAcc += frameDt;
    while (this.replayAcc >= CONFIG.DT) { this.replayAcc -= CONFIG.DT; m.recordReplay(); }
    // eventi da mostrare adesso
    const out = [];
    while (this.events.length && this.events[0].T <= rt + 0.02) out.push(this.events.shift());
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    return out;
  }

  apply(A, B, t) {
    const m = this.match, L = (i) => A[i] + (B[i] - A[i]) * t;
    m.state = NET.STATES[B[2]] || 'PLAY'; m.stateTime = B[3];
    m.clock = B[4] >= A[4] ? L(4) : B[4]; m.half = B[5];
    m.teams[0].score = B[6]; m.teams[1].score = B[7];
    m.teams[0].dir = B[8]; m.teams[1].dir = -B[8];
    const bl = m.ball;
    const jump = Math.hypot(B[9] - A[9], B[11] - A[11]) > 8;   // teletrasporto (rimessa, calcio d'inizio)
    if (jump) { bl.x = B[9]; bl.y = B[10]; bl.z = B[11]; } else { bl.x = L(9); bl.y = L(10); bl.z = L(11); }
    bl.vx = L(12); bl.vz = L(13);
    const ps = m.allSlots();
    m.advantage = B[17] > 0 ? {} : null;
    let k = NET.HEADER;
    for (const p of ps) {
      const pj = Math.hypot(B[k] - A[k], B[k + 1] - A[k + 1]) > 6;
      p.x = pj ? B[k] : L(k); p.z = pj ? B[k + 1] : L(k + 1);
      p.vx = L(k + 2); p.vz = L(k + 3);
      p.facing = A[k + 4] + angleDiff(A[k + 4], B[k + 4]) * t;
      p.anim.phase = Math.abs(B[k + 5] - A[k + 5]) > 3 ? B[k + 5] : L(k + 5);
      p.anim.kick = B[k + 6]; p.anim.dive = B[k + 7]; p.anim.diveDir = B[k + 8];
      p.anim.tackle = B[k + 9]; p.anim.header = B[k + 10]; p.energy = B[k + 11];
      // cartellini e stato decisi dall'host: un espulso esce anche dalla squadra del client
      const fl = B[k + 12] | 0;
      p.cards.yellow = fl & 3; p.sentOff = !!(fl & 4); p.cards.red = p.sentOff; p.gone = !!(fl & 8);
      if (p.sentOff && p.team.players.indexOf(p) >= 0) p.team.players = p.team.players.filter(q => q !== p);
      p.anim.fall = B[k + 13];
      k += NET.PSTRIDE;
    }
    const spType = NET.SP_TYPES[B[14]];
    if (spType) {
      const taker = ps[B[15]] || null;
      m.setPiece = { type: spType, taker: taker, team: taker ? taker.team : m.teams[0] };
    }
    m.setPieceReady = B[16] > 0;
    for (let s = 0; s < this.slots.length; s++) {
      const h = m.humanById(this.slots[s]);
      if (!h) continue;
      h.player = ps[B[18 + s * 2]] || null;
      h.shootCharge = B[19 + s * 2];
    }
  }

  predict(dt) {
    const m = this.match, h = m.humanById(this.link.id), P = h && h.player, inp = this.lastInput;
    // niente predizione quando il movimento non dipende dai comandi (piazzati, pressing assistito, a terra)
    const can = P && inp && m.state === 'PLAY' && !inp.press && !(P.anim.fall > 0) && !(P.anim.tackle > 0.05) && !(P.anim.dive > 0) && this.snaps.length;
    if (!can) { this.pr = null; this.kickFx = 0; return; }
    const last = this.snaps[this.snaps.length - 1], idx = m.allSlots().indexOf(P), k = NET.HEADER + idx * NET.PSTRIDE;
    const A = { x: last.f[k], z: last.f[k + 1], vx: last.f[k + 2], vz: last.f[k + 3] };
    const now = netNow();
    if (!this.pr || this.pr.src !== P) {
      const q = new NetPredictor(P);
      q.x = A.x; q.z = A.z; q.vx = A.vx; q.vz = A.vz; q.facing = P.facing;
      this.pr = { q: q, src: P, hist: [], lastT: last.T, acc: 0 };
    }
    const pr = this.pr, q = pr.q;
    if (last.T !== pr.lastT) {
      pr.lastT = last.T;
      // istante locale in cui l'host aveva già i nostri comandi fino a questa istantanea
      const tq = last.T + this.delay - this.rtt / 1000;
      const s = this.predAt(tq);
      if (s) {
        const ex = A.x - s.x, ez = A.z - s.z;
        if (Math.hypot(ex, ez) > 2.5) { q.x = A.x; q.z = A.z; q.vx = A.vx; q.vz = A.vz; pr.hist = []; }
        else { q.x += ex * 0.3; q.z += ez * 0.3; q.vx += (A.vx - s.vx) * 0.2; q.vz += (A.vz - s.vz) * 0.2; for (const e of pr.hist) { e.x += ex * 0.3; e.z += ez * 0.3; } }
      }
    }
    // conduzione: il pallone (mostrato nel passato) è ai piedi del calciatore
    q.dribble = dist2(m.ball.x, m.ball.z, P.x, P.z) < 1.3 && m.ball.y < 0.6;
    q.energy = P.energy; q.stunned = 0;
    pr.acc = Math.min(pr.acc + dt, 0.1);
    while (pr.acc >= CONFIG.DT) { pr.acc -= CONFIG.DT; q.moveDir(inp.mx, inp.mz, inp.sprint, CONFIG.DT); q.update(CONFIG.DT); }
    pr.hist.push({ t: now, x: q.x, z: q.z, vx: q.vx, vz: q.vz });
    while (pr.hist.length && pr.hist[0].t < now - 1.5) pr.hist.shift();
    if (q.dribble) { m.ball.x += q.x - P.x; m.ball.z += q.z - P.z; }
    P.x = q.x; P.z = q.z; P.vx = q.vx; P.vz = q.vz; P.facing = q.facing; P.anim.phase = q.anim.phase;
    // gesto del calcio subito, senza aspettare l'host
    if (this.kickFx > 0) { this.kickFx -= dt; P.anim.kick = Math.max(P.anim.kick, this.kickFx); }
  }
  // posizione prevista all'istante t (interpolata nella storia recente)
  predAt(t) {
    const H = this.pr.hist;
    if (!H.length || t < H[0].t) return null;
    for (let i = H.length - 1; i > 0; i--) {
      if (H[i - 1].t <= t) {
        const a = H[i - 1], b = H[i], u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
        return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, vx: a.vx + (b.vx - a.vx) * u, vz: a.vz + (b.vz - a.vz) * u };
      }
    }
    return H[H.length - 1];
  }

  // invia i comandi: subito se c'è un'azione, altrimenti al massimo 30 volte al secondo
  sendInput(input) {
    if (!this.match) return;
    this.lastInput = input;
    // calcio del proprio calciatore che ha la palla: il gesto parte subito sullo schermo
    const released = this.prevShoot && !input.shoot;
    this.prevShoot = !!input.shoot;
    if (this.pr && this.pr.q.dribble && (input.pressed.pass || input.pressed.long || input.pressed.through || released)) this.kickFx = 0.3;
    for (const a of NET.ACTIONS) if (input.pressed[a]) this.pendingActs.push(a);
    if (input.switchDir) this.pendingSw = input.switchDir;
    const urgent = this.pendingActs.length || this.pendingSw;
    const key = input.mx.toFixed(2) + input.mz.toFixed(2) + (input.sprint ? 1 : 0) + (input.shoot ? 1 : 0) + (input.press ? 1 : 0);
    const now = performance.now();
    if (!urgent && key === this.lastInputKey && now - this.lastSend < 250) return;
    if (!urgent && now - this.lastSend < 1000 / NET.INPUT_HZ) return;
    const msg = { t: 'in', mx: input.mx, mz: input.mz, sp: input.sprint ? 1 : 0, sh: input.shoot ? 1 : 0, pr: input.press ? 1 : 0, a: this.pendingActs };
    if (this.pendingSw) msg.sw = this.pendingSw;
    this.link.toHost(msg);
    this.pendingActs = []; this.pendingSw = null; this.lastInputKey = key; this.lastSend = now;
  }

  requestSide(side) { this.link.toHost({ t: 'side', side: side }); }
  close() { clearInterval(this.pingTimer); this.link.leave(); }
}
