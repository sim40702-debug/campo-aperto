// ============================================================
// SERVER LOBBY / RELAY di Campo Aperto
//
// Non simula la partita: la partita gira sul computer di chi la crea (l'host).
// Il server fa solo tre cose:
//   1. crea le stanze e genera il codice partita (6 caratteri casuali);
//   2. fa entrare gli altri giocatori con il codice;
//   3. inoltra i messaggi: comandi dei client -> host, stato della partita host -> client.
// Così non serve aprire porte sul computer dell'host: tutti si collegano al server.
//
// Avvio:  node server/relay.js [--port 8787] [--host 127.0.0.1]
//   --host 127.0.0.1  solo questo computer (predefinito, non espone nulla in rete)
//   --host 0.0.0.0    anche gli altri computer della rete locale
// ============================================================
'use strict';
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PROTOCOL = 1;                 // deve coincidere con NET.PROTOCOL nel gioco
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente 0/O e 1/I per evitare confusione
const CODE_LEN = 6;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function createRelay(opts) {
  opts = Object.assign({
    port: 8787,
    host: '127.0.0.1',
    maxRooms: 200,
    maxMembers: 8,
    hostGraceMs: 20000,   // tempo per far rientrare l'host prima di chiudere la stanza
    slotGraceMs: 30000,   // tempo per far rientrare un giocatore nel suo posto
    heartbeatMs: 15000,
    maxMsgPerSec: 300,
    quiet: false,
    lanCodes: false,        // codici che iniziano con 'L' (rete locale); altrimenti mai con 'L'
    createLocalOnly: false, // 'create' accettato solo da questo computer (loopback)
    maxConns: 0,            // massimo di socket contemporanei (0 = nessun limite)
    unattachedMs: 0,        // chiude i socket che non entrano in una stanza entro questo tempo (0 = mai)
  }, opts || {});
  const log = (...a) => { if (!opts.quiet) console.log('[relay]', ...a); };
  const rooms = new Map();            // codice -> stanza
  const failedJoins = new Map();      // ip -> { n, t } per limitare i tentativi di codice

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, protocol: PROTOCOL, rooms: rooms.size }));
      return;
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

  function newCode() {
    for (let tries = 0; tries < 50; tries++) {
      let c = '';
      for (let i = 0; i < CODE_LEN; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
      c = (opts.lanCodes ? 'L' : c[0] === 'L' ? 'M' : c[0]) + c.slice(1);
      if (!rooms.has(c)) return c;
    }
    return null;
  }
  const newToken = () => crypto.randomBytes(16).toString('hex');
  const newId = () => crypto.randomBytes(4).toString('hex');
  const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Giocatore';

  function send(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function hostOf(room) { return room.members.get(room.hostId); }

  function closeRoom(room, reason) {
    if (room.closed) return;
    room.closed = true;
    clearTimeout(room.hostTimer);
    for (const m of room.members.values()) {
      clearTimeout(m.graceTimer);
      if (m.ws) { send(m.ws, { t: 'closed', reason }); m.ws.ctx = null; m.ws.close(1000, 'room closed'); }
    }
    rooms.delete(room.code);
    log('stanza chiusa', room.code, reason, '- stanze attive:', rooms.size);
  }

  // il socket di un membro si è chiuso (rete persa o finestra chiusa)
  function memberDropped(room, m) {
    m.ws = null; m.connected = false;
    if (room.closed) return;
    if (m.id === room.hostId) {
      for (const o of room.members.values()) if (o !== m) send(o.ws, { t: 'host-lost', graceMs: opts.hostGraceMs });
      room.hostTimer = setTimeout(() => closeRoom(room, 'host-left'), opts.hostGraceMs);
    } else {
      send(hostOf(room).ws, { t: 'peer', ev: 'drop', id: m.id, name: m.name });
      m.graceTimer = setTimeout(() => removeMember(room, m, 'timeout'), opts.slotGraceMs);
    }
  }
  function removeMember(room, m, why) {
    clearTimeout(m.graceTimer);
    room.members.delete(m.id);
    if (m.ws) { m.ws.ctx = null; m.ws.close(1000, why); }
    send(hostOf(room) && hostOf(room).ws, { t: 'peer', ev: 'leave', id: m.id, name: m.name, why });
  }

  function attach(ws, room, m) {
    clearTimeout(m.graceTimer);
    if (m.ws && m.ws !== ws) { m.ws.ctx = null; m.ws.close(4000, 'replaced'); }
    clearTimeout(ws.unTimer);
    m.ws = ws; m.connected = true;
    ws.ctx = { room, member: m };
  }

  function tooManyFails(ip) {
    const now = Date.now();
    const f = failedJoins.get(ip);
    if (!f || now - f.t > 60000) return false;
    return f.n >= 30;
  }
  function addFail(ip) {
    const now = Date.now();
    const f = failedJoins.get(ip);
    if (!f || now - f.t > 60000) failedJoins.set(ip, { n: 1, t: now }); else f.n++;
  }

  function handleJson(ws, msg, ip) {
    const ctx = ws.ctx;
    if (!ctx) {
      // prima del collegamento a una stanza: solo create, join, resume
      if (msg.v !== PROTOCOL) return send(ws, { t: 'error', code: 'VERSION', msg: 'Versione del gioco diversa da quella del server' });
      if (msg.t === 'create') {
        if (opts.createLocalOnly && !LOOPBACK.has(ip)) return send(ws, { t: 'error', code: 'LOCAL_ONLY', msg: 'Solo chi ospita può creare la partita' });
        if (rooms.size >= opts.maxRooms) return send(ws, { t: 'error', code: 'FULL_SERVER', msg: 'Il server è pieno, riprova più tardi' });
        const code = newCode();
        if (!code) return send(ws, { t: 'error', code: 'FULL_SERVER', msg: 'Impossibile creare la partita' });
        const host = { id: newId(), name: cleanName(msg.name), token: newToken(), ws: null, connected: true };
        const room = { code, hostId: host.id, members: new Map([[host.id, host]]), closed: false };
        rooms.set(code, room);
        attach(ws, room, host);
        send(ws, { t: 'created', code, id: host.id, token: host.token });
        log('stanza creata', code, '- stanze attive:', rooms.size);
        return;
      }
      if (msg.t === 'join' || msg.t === 'resume') {
        if (tooManyFails(ip)) return send(ws, { t: 'error', code: 'RATE', msg: 'Troppi tentativi, aspetta un minuto' });
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const room = rooms.get(code);
        if (!room || room.closed) { addFail(ip); return send(ws, { t: 'error', code: 'NOT_FOUND', msg: 'Nessuna partita con questo codice' }); }
        if (msg.t === 'resume') {
          const m = [...room.members.values()].find(x => x.token === msg.token);
          if (!m) { addFail(ip); return send(ws, { t: 'error', code: 'NOT_FOUND', msg: 'Posto non più disponibile' }); }
          attach(ws, room, m);
          send(ws, { t: 'resumed', code, id: m.id, token: m.token, hostId: room.hostId, host: m.id === room.hostId });
          if (m.id === room.hostId) {
            clearTimeout(room.hostTimer);
            for (const o of room.members.values()) if (o !== m) send(o.ws, { t: 'host-back' });
          } else send(hostOf(room).ws, { t: 'peer', ev: 'back', id: m.id, name: m.name });
          return;
        }
        if (room.members.size >= opts.maxMembers) return send(ws, { t: 'error', code: 'FULL', msg: 'La partita è al completo' });
        const m = { id: newId(), name: cleanName(msg.name), token: newToken(), ws: null, connected: true };
        room.members.set(m.id, m);
        attach(ws, room, m);
        send(ws, { t: 'joined', code, id: m.id, token: m.token, hostId: room.hostId });
        send(hostOf(room).ws, { t: 'peer', ev: 'join', id: m.id, name: m.name });
        return;
      }
      return send(ws, { t: 'error', code: 'BAD', msg: 'Richiesta non valida' });
    }
    const { room, member } = ctx;
    const isHost = member.id === room.hostId;
    switch (msg.t) {
      case 'send': {
        // un client può parlare solo con l'host; l'host con tutti o con uno
        if (!isHost) return send(hostOf(room).ws, { t: 'msg', from: member.id, d: msg.d });
        if (msg.to === 'all') { for (const o of room.members.values()) if (o !== member) send(o.ws, { t: 'msg', from: member.id, d: msg.d }); }
        else { const o = room.members.get(msg.to); if (o) send(o.ws, { t: 'msg', from: member.id, d: msg.d }); }
        return;
      }
      case 'kick': {
        if (!isHost) return;
        const o = room.members.get(msg.id);
        if (o && o !== member) { send(o.ws, { t: 'closed', reason: 'kicked' }); removeMember(room, o, 'kicked'); }
        return;
      }
      case 'leave':
        if (isHost) closeRoom(room, 'host-left');
        else removeMember(room, member, 'left');
        return;
      case 'ping':
        return send(ws, { t: 'pong', n: msg.n });
      default:
        return send(ws, { t: 'error', code: 'BAD', msg: 'Messaggio sconosciuto' });
    }
  }

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    // relay locale: una pagina web aperta nel browser dell'host non deve poterlo raggiungere (file:// e 'null' vanno bene)
    if (opts.createLocalOnly && /^https?:/i.test(String(req.headers.origin || ''))) { ws.on('error', () => {}); ws.close(1008, 'origin'); return; }
    if (opts.maxConns && wss.clients.size > opts.maxConns) { ws.on('error', () => {}); ws.close(1013, 'full'); return; }
    if (opts.unattachedMs) ws.unTimer = setTimeout(() => { if (!ws.ctx) ws.terminate(); }, opts.unattachedMs);
    ws.isAlive = true;
    ws.rate = { n: 0, t: Date.now() };
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      // limite di messaggi al secondo
      const now = Date.now();
      if (now - ws.rate.t > 1000) { ws.rate.t = now; ws.rate.n = 0; }
      if (++ws.rate.n > opts.maxMsgPerSec) { ws.close(1008, 'rate'); return; }
      if (isBinary) {
        // stato della partita: solo l'host lo manda, va a tutti gli altri
        const ctx = ws.ctx;
        if (!ctx || ctx.member.id !== ctx.room.hostId) return;
        for (const o of ctx.room.members.values()) if (o !== ctx.member && o.ws && o.ws.readyState === 1) o.ws.send(data, { binary: true });
        return;
      }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      try { handleJson(ws, msg, ip); } catch (e) { log('errore messaggio', e.message); }
    });
    ws.on('close', () => {
      clearTimeout(ws.unTimer);
      const ctx = ws.ctx;
      if (ctx && ctx.member.ws === ws) memberDropped(ctx.room, ctx.member);
    });
    ws.on('error', () => {});
  });

  // controllo periodico: chiude i socket che non rispondono più e dimentica i tentativi di codice vecchi
  const beat = setInterval(() => {
    const now = Date.now();
    for (const [ip, f] of failedJoins) if (now - f.t > 60000) failedJoins.delete(ip);
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* ignora */ }
    }
  }, opts.heartbeatMs);

  return new Promise((resolve, reject) => {
    // errori di avvio (es. porta già occupata): il WebSocketServer li ripete, vanno gestiti entrambi
    const onStartError = e => reject(e.code === 'EADDRINUSE' ? new Error('la porta ' + opts.port + ' è già usata da un altro programma (usa --port per sceglierne un\'altra)') : e);
    server.once('error', onStartError);
    wss.on('error', () => {});
    server.listen(opts.port, opts.host, () => {
      const port = server.address().port;
      log('in ascolto su ws://' + opts.host + ':' + port);
      resolve({
        port,
        rooms,
        conns: () => wss.clients.size,
        close: () => new Promise(r => {
          clearInterval(beat);
          for (const room of [...rooms.values()]) closeRoom(room, 'server-stop');
          for (const ws of wss.clients) ws.terminate();
          wss.close(() => server.close(() => r()));
        }),
      });
    });
  });
}

module.exports = { createRelay, PROTOCOL };

// avvio da riga di comando
if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
  createRelay({
    port: Number(arg('port', process.env.PORT || 8787)),
    host: arg('host', process.env.HOST || '127.0.0.1'),
  }).then(r => {
    const stop = () => r.close().then(() => process.exit(0));
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }).catch(e => { console.error('[relay] impossibile avviare:', e.message); process.exit(1); });
}
