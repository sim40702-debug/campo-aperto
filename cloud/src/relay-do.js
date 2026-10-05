// Relay delle partite online nel Worker: tutti si collegano allo stesso indirizzo (wss://…/relay) e il codice
// della partita sceglie la stanza. Ogni stanza è un Durable Object a sé (idFromName(codice)): più partite insieme,
// separate tra loro. Stesso protocollo di server/relay.js (versione 1): il server non simula niente, inoltra
// soltanto i messaggi; la partita la simula il computer di chi la crea (l'host).
import { DurableObject } from 'cloudflare:workers';

export const PROTOCOL = 1;
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // niente 0/O e 1/I
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const MAX_MEMBERS = 8, HOST_GRACE_MS = 20000, SLOT_GRACE_MS = 30000, MAX_MSG_PER_SEC = 300, MAX_PAYLOAD = 256 * 1024;

const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Giocatore';

// codice di una partita sul server: mai con la L iniziale (quelle sono le partite in rete locale)
export function newServerCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  let c = '';
  for (const x of b) c += CODE_CHARS[x % CODE_CHARS.length];
  return (c[0] === 'L' ? 'M' : c[0]) + c.slice(1);
}

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;          // { code, hostId, members: Map, closed }
    this.meta = new Map();     // socket -> { code, op, member, rate }
  }

  // il Worker passa qui la richiesta di upgrade con il codice della stanza e l'operazione (create o join)
  async fetch(request) {
    const code = request.headers.get('x-room-code');
    const op = request.headers.get('x-room-op');
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    ws.accept();
    this.meta.set(ws, { code, op, member: null, rate: { n: 0, t: Date.now() } });
    ws.addEventListener('message', ev => this.onMessage(ws, ev.data));
    // si risponde alla chiusura (workerd non lo fa da solo): senza risposta il gioco dall'altra parte resterebbe
    // in attesa e il rientro automatico partirebbe molto più tardi
    ws.addEventListener('close', () => { this.close(ws, 1000, 'bye'); this.onClose(ws); });
    ws.addEventListener('error', () => this.onClose(ws));
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket chiuso */ } } }
  hostOf() { return this.room && this.room.members.get(this.room.hostId); }
  close(ws, code, why) { try { ws.close(code, why); } catch (e) { /* già chiuso */ } }

  onMessage(ws, data) {
    const meta = this.meta.get(ws);
    const now = Date.now();
    if (now - meta.rate.t > 1000) { meta.rate.t = now; meta.rate.n = 0; }
    if (++meta.rate.n > MAX_MSG_PER_SEC) { this.close(ws, 1008, 'rate'); return; }
    if (typeof data !== 'string') {
      // stato della partita: solo l'host lo manda, va a tutti gli altri
      const m = meta.member, room = this.room;
      if (!m || !room || m.id !== room.hostId || data.byteLength > MAX_PAYLOAD) return;
      for (const o of room.members.values()) if (o !== m && o.ws && o.ws.readyState === 1) { try { o.ws.send(data); } catch (e) { /* */ } }
      return;
    }
    if (data.length > MAX_PAYLOAD) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try { this.handle(ws, msg); } catch (e) { console.error('relay', e && e.message); }
  }

  handle(ws, msg) {
    const meta = this.meta.get(ws);
    if (!meta.member) {
      if (msg.v !== PROTOCOL) return this.send(ws, { t: 'error', code: 'VERSION', msg: 'Versione del gioco diversa da quella del server' });
      if (msg.t === 'create') {
        if (meta.op !== 'create') return this.send(ws, { t: 'error', code: 'BAD', msg: 'Richiesta non valida' });
        if (this.room && !this.room.closed) return this.send(ws, { t: 'error', code: 'FULL_SERVER', msg: 'Riprova: codice già in uso' });
        const host = { id: hex(4), name: cleanName(msg.name), token: hex(16), ws: null, connected: true };
        this.room = { code: meta.code, hostId: host.id, members: new Map([[host.id, host]]), closed: false };
        this.attach(ws, host);
        return this.send(ws, { t: 'created', code: meta.code, id: host.id, token: host.token });
      }
      if (msg.t === 'join' || msg.t === 'resume') {
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const room = this.room;
        if (code !== meta.code || !room || room.closed) return this.send(ws, { t: 'error', code: 'NOT_FOUND', msg: 'Nessuna partita con questo codice' });
        if (msg.t === 'resume') {
          const m = [...room.members.values()].find(x => x.token === msg.token);
          if (!m) return this.send(ws, { t: 'error', code: 'NOT_FOUND', msg: 'Posto non più disponibile' });
          this.attach(ws, m);
          this.send(ws, { t: 'resumed', code, id: m.id, token: m.token, hostId: room.hostId, host: m.id === room.hostId });
          if (m.id === room.hostId) {
            clearTimeout(room.hostTimer);
            for (const o of room.members.values()) if (o !== m) this.send(o.ws, { t: 'host-back' });
          } else this.send(this.hostOf().ws, { t: 'peer', ev: 'back', id: m.id, name: m.name });
          return;
        }
        if (room.members.size >= MAX_MEMBERS) return this.send(ws, { t: 'error', code: 'FULL', msg: 'La partita è al completo' });
        const m = { id: hex(4), name: cleanName(msg.name), token: hex(16), ws: null, connected: true };
        room.members.set(m.id, m);
        this.attach(ws, m);
        this.send(ws, { t: 'joined', code, id: m.id, token: m.token, hostId: room.hostId });
        this.send(this.hostOf().ws, { t: 'peer', ev: 'join', id: m.id, name: m.name });
        return;
      }
      return this.send(ws, { t: 'error', code: 'BAD', msg: 'Richiesta non valida' });
    }
    const room = this.room, member = meta.member;
    if (!room || room.closed) return;
    const isHost = member.id === room.hostId;
    switch (msg.t) {
      case 'send':
        // un client può parlare solo con l'host; l'host con tutti o con uno
        if (!isHost) return this.send(this.hostOf().ws, { t: 'msg', from: member.id, d: msg.d });
        if (msg.to === 'all') { for (const o of room.members.values()) if (o !== member) this.send(o.ws, { t: 'msg', from: member.id, d: msg.d }); }
        else { const o = room.members.get(msg.to); if (o) this.send(o.ws, { t: 'msg', from: member.id, d: msg.d }); }
        return;
      case 'kick': {
        if (!isHost) return;
        const o = room.members.get(msg.id);
        if (o && o !== member) { this.send(o.ws, { t: 'closed', reason: 'kicked' }); this.removeMember(o, 'kicked'); }
        return;
      }
      case 'leave':
        if (isHost) this.closeRoom('host-left'); else this.removeMember(member, 'left');
        return;
      case 'ping':
        return this.send(ws, { t: 'pong', n: msg.n });
      default:
        return this.send(ws, { t: 'error', code: 'BAD', msg: 'Messaggio sconosciuto' });
    }
  }

  attach(ws, m) {
    clearTimeout(m.graceTimer);
    if (m.ws && m.ws !== ws) { const old = this.meta.get(m.ws); if (old) old.member = null; this.close(m.ws, 4000, 'replaced'); }
    m.ws = ws; m.connected = true;
    this.meta.get(ws).member = m;
  }

  // il socket di un membro si è chiuso (rete persa o finestra chiusa)
  onClose(ws) {
    const meta = this.meta.get(ws);
    this.meta.delete(ws);
    const m = meta && meta.member, room = this.room;
    if (!m || !room || m.ws !== ws) return;
    m.ws = null; m.connected = false;
    if (room.closed) return;
    if (m.id === room.hostId) {
      for (const o of room.members.values()) if (o !== m) this.send(o.ws, { t: 'host-lost', graceMs: HOST_GRACE_MS });
      room.hostTimer = setTimeout(() => this.closeRoom('host-left'), HOST_GRACE_MS);
    } else {
      this.send(this.hostOf().ws, { t: 'peer', ev: 'drop', id: m.id, name: m.name });
      m.graceTimer = setTimeout(() => this.removeMember(m, 'timeout'), SLOT_GRACE_MS);
    }
  }

  removeMember(m, why) {
    const room = this.room;
    clearTimeout(m.graceTimer);
    room.members.delete(m.id);
    if (m.ws) { const w = m.ws; m.ws = null; const wm = this.meta.get(w); if (wm) wm.member = null; this.close(w, 1000, why); }
    const h = this.hostOf();
    this.send(h && h.ws, { t: 'peer', ev: 'leave', id: m.id, name: m.name, why });
  }

  closeRoom(reason) {
    const room = this.room;
    if (!room || room.closed) return;
    room.closed = true;
    clearTimeout(room.hostTimer);
    for (const m of room.members.values()) {
      clearTimeout(m.graceTimer);
      if (m.ws) { const w = m.ws; m.ws = null; this.send(w, { t: "closed", reason }); const wm = this.meta.get(w); if (wm) wm.member = null; this.close(w, 1000, "room closed"); }
    }
    this.room = null;   // il codice si libera: lo stesso oggetto può ospitare una nuova partita
  }
}

// instradamento nel Worker: /relay?op=create oppure /relay?code=ABC123
export async function relayFetch(request, env) {
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response(JSON.stringify({ ok: true, protocol: PROTOCOL, relay: true }), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  }
  const url = new URL(request.url);
  let code, op;
  // prova del collegamento (Impostazioni → Online → Prova): si apre e basta, nessuna stanza
  if (url.searchParams.get('op') === 'probe') {
    const [client, ws] = Object.values(new WebSocketPair());
    ws.accept();
    ws.addEventListener('close', () => { try { ws.close(1000, 'bye'); } catch (e) { /* già chiuso */ } });
    return new Response(null, { status: 101, webSocket: client });
  }
  if (url.searchParams.get('op') === 'create') { code = newServerCode(); op = 'create'; }
  else {
    code = String(url.searchParams.get('code') || '').toUpperCase();
    if (!CODE_RE.test(code) || code[0] === 'L') return new Response('codice non valido', { status: 400 });
    op = 'join';
  }
  const stub = env.RELAY.get(env.RELAY.idFromName(code));
  const headers = new Headers(request.headers);
  headers.set('x-room-code', code); headers.set('x-room-op', op);
  return stub.fetch(new Request(request, { headers }));
}
