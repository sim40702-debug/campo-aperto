// ============================================================
// RETE LOCALE — server integrato (host) e ricerca della partita (client)
// Modulo Node puro: niente 'electron', così si prova anche dai test.
// Chi ospita avvia il relay sul proprio PC e risponde a UDP sulla porta di ricerca;
// chi entra manda in broadcast il codice e scopre da solo l'indirizzo dell'host.
// ============================================================
'use strict';
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const { createRelay, PROTOCOL } = require('../server/relay.js');

const APP_ID = 'campo-aperto';
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const WS_PORT = 8787, DISCOVERY_PORT = 8788;
const DISC_VER = 2;    // versione del protocollo di ricerca: messaggi di altre versioni vengono ignorati
const MAX_DGRAM = 256; // oltre questa misura il datagramma viene ignorato
const RATE_MAX = 10, RATE_WINDOW = 1000, RATE_TRACK = 256; // richieste al secondo per indirizzo, e indirizzi tracciati
const NONCE_RE = /^[0-9a-f]{32}$/, HMAC_RE = /^[0-9a-f]{64}$/;

// Il codice non viaggia mai in chiaro: la query porta un nonce casuale e HMAC(codice, nonce), la risposta
// HMAC(codice, nonce:porta). Attenzione: un codice di 6 caratteri si può ricavare per tentativi da una
// query intercettata (attacco offline), quindi questo impedisce solo di leggere il codice a colpo d'occhio
// e di rispondere con host finti da parte di chi non lo conosce, non protegge da un attaccante deciso nella rete.
const hmac = (code, data) => crypto.createHmac('sha256', code).update(data).digest('hex');
const sameHex = (a, b) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };

let host = null;      // { relay, sock, port, addresses } quando attivo
let chain = Promise.resolve(); // avvii e arresti vanno in fila: mai due operazioni insieme
const enqueue = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

function localAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const i of ifs[name] || []) {
    if (i.family === 'IPv4' && !i.internal) out.push(i);
  }
  return out;
}

// indirizzo con cui il PC raggiunge la rete (rotta predefinita): connect() su UDP non invia pacchetti. null se offline
function defaultRouteAddress() {
  return new Promise(resolve => {
    let s, t;
    const end = v => { clearTimeout(t); try { s.close(); } catch (e) { /* già chiuso */ } resolve(v); };
    try {
      s = dgram.createSocket('udp4');
      s.on('error', () => end(null));
      t = setTimeout(() => end(null), 500);
      s.connect(53, '8.8.8.8', () => { try { const a = s.address().address; end(/^\d+\.\d+\.\d+\.\d+$/.test(a) ? a : null); } catch (e) { end(null); } });
    } catch (e) { resolve(null); }
  });
}

// indirizzi locali senza duplicati, con quello della rotta predefinita per primo
async function orderedAddresses() {
  const list = [...new Set(localAddresses().map(i => i.address))];
  try {
    const d = await defaultRouteAddress();
    if (d && list.includes(d)) return [d, ...list.filter(a => a !== d)];
  } catch (e) { /* tengo l'ordine di sistema */ }
  return list;
}

// indirizzo di broadcast diretto: indirizzo OR maschera invertita
function broadcastOf(i) {
  try {
    const a = i.address.split('.').map(Number), m = i.netmask.split('.').map(Number);
    if (a.length !== 4 || m.length !== 4) return null;
    const b = a.map((x, k) => (x | (~m[k] & 255)) & 255).join('.');
    return /^\d+\.\d+\.\d+\.\d+$/.test(b) ? b : null;
  } catch (e) { return null; }
}

// legge una query non fidata: restituisce { n, h } oppure null
function parseQuery(buf) {
  if (!buf || buf.length > MAX_DGRAM) return null;
  let m;
  try { m = JSON.parse(buf.toString('utf8')); } catch (e) { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  if (m.q !== APP_ID || m.v !== PROTOCOL || m.d !== DISC_VER) return null;
  if (typeof m.n !== 'string' || !NONCE_RE.test(m.n) || typeof m.h !== 'string' || !HMAC_RE.test(m.h)) return null;
  return m;
}

function openResponder(relay, discoveryPort) {
  const rate = new Map(); // indirizzo -> { n, t }, limitato e ripulito
  const limited = addr => {
    const now = Date.now();
    if (rate.size > RATE_TRACK) for (const [k, v] of rate) if (now - v.t > RATE_WINDOW) rate.delete(k);
    if (rate.size > RATE_TRACK) rate.clear();
    const r = rate.get(addr);
    if (!r || now - r.t > RATE_WINDOW) { rate.set(addr, { n: 1, t: now }); return false; }
    return ++r.n > RATE_MAX;
  };
  return new Promise(resolve => {
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { return resolve(null); }
    sock.on('error', () => { try { sock.close(); } catch (e) { /* già chiuso */ } resolve(null); });
    sock.on('message', (buf, rinfo) => {
      try {
        if (limited(rinfo.address)) return;
        const m = parseQuery(buf);
        if (!m) return;
        let hit = null;
        for (const code of relay.rooms.keys()) { if (sameHex(m.h, hmac(code, m.n))) { hit = code; break; } }
        if (!hit) return;
        const reply = Buffer.from(JSON.stringify({ a: APP_ID, v: PROTOCOL, d: DISC_VER, port: relay.port, h2: hmac(hit, m.n + ':' + relay.port) }));
        sock.send(reply, rinfo.port, rinfo.address, () => {});
      } catch (e) { /* ignora */ }
    });
    sock.bind(discoveryPort, '0.0.0.0', () => {
      // dopo l'avvio un errore del socket non deve far cadere il processo
      sock.removeAllListeners('error'); sock.on('error', () => {});
      resolve(sock);
    });
  });
}

// codici 'L...', solo chi ospita crea, pochi socket, niente socket inattivi
const LAN_RELAY = { lanCodes: true, createLocalOnly: true, maxConns: 32, unattachedMs: 10000 };

async function doStart(opts) {
  const wsPort = opts.port === undefined ? WS_PORT : opts.port;
  const bindHost = opts.bindHost || '0.0.0.0';
  let relay;
  try { relay = await createRelay(Object.assign({ host: bindHost, port: wsPort, maxRooms: 1, quiet: true }, LAN_RELAY, opts.relayOpts)); }
  catch (e) {
    if (wsPort === 0) throw e;
    relay = await createRelay(Object.assign({ host: bindHost, port: 0, maxRooms: 1, quiet: true }, LAN_RELAY, opts.relayOpts)); // porta occupata: una libera
  }
  const sock = await openResponder(relay, opts.discoveryPort === undefined ? DISCOVERY_PORT : opts.discoveryPort);
  host = { relay, sock, port: relay.port, addresses: await orderedAddresses() };
  return { port: host.port, addresses: host.addresses.slice(), discovery: !!sock };
}

function startHost(opts) {
  opts = opts || {};
  return enqueue(async () => {
    if (host) return { port: host.port, addresses: host.addresses.slice(), discovery: !!host.sock };
    return doStart(opts);
  });
}

function stopHost() {
  return enqueue(async () => {
    const h = host; host = null;
    if (!h) return;
    if (h.sock) await new Promise(r => { try { h.sock.close(r); } catch (e) { r(); } });
    try { await h.relay.close(); } catch (e) { /* ignora */ }
  });
}

// cerca l'host con questo codice: { url } oppure null
function findGame(code, opts) {
  opts = opts || {};
  const timeout = opts.timeout || 1500;
  const dport = opts.discoveryPort === undefined ? DISCOVERY_PORT : opts.discoveryPort;
  return new Promise(resolve => {
    if (typeof code !== 'string' || !CODE_RE.test(code)) return resolve(null);
    let sock, done = false;
    const timers = [];
    const nonce = crypto.randomBytes(16).toString('hex');
    const finish = r => {
      if (done) return; done = true;
      timers.forEach(clearTimeout);
      try { sock.close(); } catch (e) { /* già chiuso */ }
      resolve(r);
    };
    try { sock = dgram.createSocket('udp4'); } catch (e) { return resolve(null); }
    sock.on('error', () => finish(null));
    sock.on('message', (buf, rinfo) => {
      try {
        if (buf.length > MAX_DGRAM) return;
        const m = JSON.parse(buf.toString('utf8'));
        if (!m || m.a !== APP_ID || m.v !== PROTOCOL || m.d !== DISC_VER) return;
        if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) return;
        if (typeof m.h2 !== 'string' || !HMAC_RE.test(m.h2) || !sameHex(m.h2, hmac(code, nonce + ':' + m.port))) return;
        finish({ url: 'ws://' + rinfo.address + ':' + m.port });
      } catch (e) { /* datagramma non valido */ }
    });
    sock.bind(0, '0.0.0.0', () => {
      try { sock.setBroadcast(true); } catch (e) { return finish(null); }
      const targets = new Set(['255.255.255.255', '127.0.0.1']);
      for (const i of localAddresses()) { const b = broadcastOf(i); if (b) targets.add(b); }
      const msg = Buffer.from(JSON.stringify({ q: APP_ID, v: PROTOCOL, d: DISC_VER, n: nonce, h: hmac(code, nonce) }));
      const burst = () => { for (const t of targets) { try { sock.send(msg, dport, t, () => {}); } catch (e) { /* ignora */ } } };
      for (const ms of [0, 300, 700]) timers.push(setTimeout(burst, ms));
      timers.push(setTimeout(() => finish(null), timeout));
    });
  });
}

module.exports = { startHost, stopHost, findGame, defaultRouteAddress, CODE_RE };
