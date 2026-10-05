// ============================================================
// RETE LOCALE — server integrato (host) e ricerca della partita (client)
// Modulo Node puro: niente 'electron', così si prova anche dai test.
// Chi ospita avvia il relay sul proprio PC e risponde a UDP sulla porta di ricerca;
// chi entra manda in broadcast il codice e scopre da solo l'indirizzo dell'host.
// ============================================================
'use strict';
const dgram = require('dgram');
const net = require('net');
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

// interfacce IPv4 con quella della rotta predefinita per prima: adattatori virtuali (VPN, macchine virtuali) vengono dopo
async function orderedInterfaces() {
  const list = localAddresses();
  try {
    const d = await defaultRouteAddress();
    if (d) return list.filter(i => i.address === d).concat(list.filter(i => i.address !== d));
  } catch (e) { /* tengo l'ordine di sistema */ }
  return list;
}

// indirizzi locali senza duplicati, con quello della rotta predefinita per primo
async function orderedAddresses() {
  return [...new Set((await orderedInterfaces()).map(i => i.address))];
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

// stats: richieste di ricerca ricevute (valide), con il codice di questa partita, ultimo mittente
function openResponder(relay, discoveryPort, stats) {
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
        stats.queries++; stats.lastFrom = rinfo.address; stats.lastAt = Date.now();
        let hit = null;
        for (const code of relay.rooms.keys()) { if (sameHex(m.h, hmac(code, m.n))) { hit = code; break; } }
        if (!hit) return;
        stats.answered++;
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
  const stats = { queries: 0, answered: 0, lastFrom: '', lastAt: 0 };
  const discoveryPort = opts.discoveryPort === undefined ? DISCOVERY_PORT : opts.discoveryPort;
  const sock = await openResponder(relay, discoveryPort, stats);
  host = { relay, sock, stats, discoveryPort, port: relay.port, addresses: await orderedAddresses() };
  return { port: host.port, addresses: host.addresses.slice(), discovery: !!sock };
}

// stato per la diagnostica: indirizzi locali sempre, dati del server solo se questo computer ospita
async function status() {
  const addresses = host ? host.addresses.slice() : await orderedAddresses();
  if (!host) return { hosting: false, addresses, discoveryPort: DISCOVERY_PORT };
  return Object.assign({ hosting: true, addresses, port: host.port, discovery: !!host.sock, discoveryPort: host.discoveryPort, conns: host.relay.conns() }, host.stats);
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

const MAX_TARGETS = 1024, SWEEP_CHUNK = 64, SWEEP_STEP = 15, MIN_PREFIX = 22;
const isV4 = a => typeof a === 'string' && /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(a) && a.split('.').every(x => +x <= 255 && (x.length === 1 || x[0] !== '0'));
// indirizzi di rete locale: privati, loopback, link-local e CGNAT (hotspot); gli altri non vengono contattati dal gioco
const isPrivateV4 = a => {
  if (!isV4(a)) return false;
  const [p, q] = a.split('.').map(Number);
  return p === 10 || p === 127 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 169 && q === 254) || (p === 100 && q >= 64 && q <= 127);
};
const ipToInt = a => a.split('.').reduce((n, x) => n * 256 + +x, 0);
const intToIp = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.');
const prefixOf = m => (isV4(m) ? ipToInt(m).toString(2).replace(/0/g, '').length : -1);

// indirizzi dei dispositivi di ogni sottorete (prefisso da /22 a /30: reti di casa, hotspot, Wi-Fi mesh), senza il proprio,
// la rete e il broadcast; niente 169.254.x.x (link-local) né sottoreti più grandi. Totale limitato a "max", nell'ordine delle interfacce.
function sweepTargets(ifaces, max) {
  const out = [], seen = new Set();
  if (max === undefined) max = MAX_TARGETS;
  for (const i of ifaces || []) {
    try {
      if (!i || !isV4(i.address) || !isV4(i.netmask) || i.address.startsWith('169.254.')) continue;
      const p = prefixOf(i.netmask);
      if (p < MIN_PREFIX || p > 30) continue;
      const mask = (0xFFFFFFFF << (32 - p)) >>> 0, net = (ipToInt(i.address) & mask) >>> 0, bc = (net | ~mask) >>> 0;
      for (let n = net + 1; n < bc; n++) {
        const ip = intToIp(n);
        if (ip === i.address || seen.has(ip)) continue;
        if (out.length >= max) return out;
        seen.add(ip); out.push(ip);
      }
    } catch (e) { /* interfaccia anomala: ignorata */ }
  }
  return out;
}

// cerca l'host con questo codice: { url } oppure { url: null, why, detail }
//   why: 'no-network' (nessuna rete), 'blocked' (tutti gli invii falliti, detail = errno più frequente), 'no-reply' (nessuno risponde)
// opts: timeout, discoveryPort, hosts (indirizzi IPv4 extra a cui scrivere direttamente),
//       noBroadcast (solo prove: niente broadcast né scansione della sottorete)
async function findGame(code, opts) {
  opts = opts || {};
  const timeout = opts.timeout || 2000;
  const dport = opts.discoveryPort === undefined ? DISCOVERY_PORT : opts.discoveryPort;
  const ifs = opts.noBroadcast ? [] : await orderedInterfaces();
  return new Promise(resolve => {
    if (typeof code !== 'string' || !CODE_RE.test(code)) return resolve({ url: null, why: 'bad-code', detail: '' });
    const extra = Array.isArray(opts.hosts) ? [...new Set(opts.hosts.filter(isV4))].slice(0, 16) : [];
    let sock, done = false, sent = 0, failed = 0;
    const errs = {}, timers = [], groupSocks = [];
    const nonce = crypto.randomBytes(16).toString('hex');
    const noteErr = e => { const c = (e && e.code) || 'ERR'; errs[c] = (errs[c] || 0) + 1; };
    const finish = r => {
      if (done) return; done = true;
      timers.forEach(clearTimeout);
      for (const s of [sock, ...groupSocks]) { try { s.close(); } catch (e) { /* già chiuso */ } }
      resolve(r);
    };
    const verdict = () => {
      const top = Object.keys(errs).sort((a, b) => errs[b] - errs[a])[0] || '';
      if (!opts.noBroadcast && !ifs.length && !extra.length) return { url: null, why: 'no-network', detail: top };
      if (sent > 0 && failed >= sent) return { url: null, why: 'blocked', detail: top };
      return { url: null, why: 'no-reply', detail: '' }; // un errno sporadico della scansione non va mostrato
    };
    try { sock = dgram.createSocket('udp4'); } catch (e) { return resolve({ url: null, why: 'blocked', detail: (e && e.code) || 'ERR' }); }
    sock.on('error', e => { noteErr(e); sent++; failed++; finish(verdict()); });
    const onReply = (buf, rinfo) => {
      try {
        if (buf.length > MAX_DGRAM) return;
        const m = JSON.parse(buf.toString('utf8'));
        if (!m || m.a !== APP_ID || m.v !== PROTOCOL || m.d !== DISC_VER) return;
        if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) return;
        if (typeof m.h2 !== 'string' || !HMAC_RE.test(m.h2) || !sameHex(m.h2, hmac(code, nonce + ':' + m.port))) return;
        finish({ url: 'ws://' + rinfo.address + ':' + m.port });
      } catch (e) { /* datagramma non valido */ }
    };
    sock.on('message', onReply);
    // ogni gruppo della scansione ha il suo socket: un datagramma verso un indirizzo senza dispositivo aspetta l'ARP
    // (fino a 3 s) occupando il buffer di invio del socket; con un socket solo, dopo circa 250 indirizzi vuoti
    // gli invii successivi (magari proprio quello per l'host) restano fermi fino alla fine della ricerca
    const groupSocket = k => {
      if (groupSocks[k]) return groupSocks[k];
      try {
        const s = dgram.createSocket('udp4');
        s.on('error', noteErr); s.on('message', onReply);
        s.bind(0, '0.0.0.0');
        return (groupSocks[k] = s);
      } catch (e) { noteErr(e); return sock; }
    };
    sock.bind(0, '0.0.0.0', () => {
      try { sock.setBroadcast(true); } catch (e) { noteErr(e); return finish({ url: null, why: 'blocked', detail: (e && e.code) || 'ERR' }); }
      const msg = Buffer.from(JSON.stringify({ q: APP_ID, v: PROTOCOL, d: DISC_VER, n: nonce, h: hmac(code, nonce) }));
      // l'invio a 127.0.0.1 (se non richiesto) non conta nella diagnosi: riesce sempre e non dice nulla sulla rete
      const send = (ip, count, via) => {
        if (count) sent++;
        try { (via || sock).send(msg, dport, ip, err => { if (count && err && !done) { failed++; noteErr(err); } }); }
        catch (e) { if (count) { failed++; noteErr(e); } }
      };
      const direct = new Set(extra), bcast = new Set(), sweep = [];
      if (!opts.noBroadcast) {
        bcast.add('255.255.255.255');
        for (const i of ifs) { const b = broadcastOf(i); if (b) bcast.add(b); }
        for (const ip of sweepTargets(ifs, MAX_TARGETS)) if (!direct.has(ip)) sweep.push(ip);
      }
      // broadcast e indirizzi dati a ogni giro (sul Wi-Fi i broadcast non vengono ritrasmessi se si perdono);
      // la scansione unicast solo al primo e all'ultimo giro: i pacchetti unicast il Wi-Fi li ritrasmette da sé
      const round = withSweep => {
        if (!direct.has('127.0.0.1')) send('127.0.0.1', false);
        for (const t of direct) send(t, true);
        for (const t of bcast) send(t, true);
        // la scansione unicast va a gruppi, per non sparare centinaia di datagrammi insieme
        for (let k = 0; withSweep && k * SWEEP_CHUNK < sweep.length; k++) {
          const part = sweep.slice(k * SWEEP_CHUNK, (k + 1) * SWEEP_CHUNK);
          timers.push(setTimeout(() => { if (!done) { const via = groupSocket(k); for (const t of part) send(t, true, via); } }, k * SWEEP_STEP));
        }
      };
      for (const [ms, withSweep] of [[0, true], [300, false], [700, true]]) timers.push(setTimeout(() => round(withSweep), ms));
      timers.push(setTimeout(() => finish(verdict()), timeout));
    });
  });
}

// prova la connessione TCP diretta all'host: { ok: true, ms } oppure { ok: false, code }
function checkHost(ip, port, timeoutMs) {
  return new Promise(resolve => {
    if (!isV4(ip) || !Number.isInteger(port) || port < 1 || port > 65535) return resolve({ ok: false, code: 'EINVAL' });
    let s, done = false, t;
    const t0 = Date.now();
    const end = r => { if (done) return; done = true; clearTimeout(t); try { s.destroy(); } catch (e) { /* già chiuso */ } resolve(r); };
    try {
      s = net.connect({ host: ip, port });
      s.on('connect', () => end({ ok: true, ms: Date.now() - t0 }));
      s.on('error', e => end({ ok: false, code: (e && e.code) || 'ERR' }));
      t = setTimeout(() => end({ ok: false, code: 'ETIMEDOUT' }), timeoutMs > 0 ? timeoutMs : 3000);
    } catch (e) { end({ ok: false, code: (e && e.code) || 'ERR' }); }
  });
}

module.exports = { startHost, stopHost, status, findGame, checkHost, sweepTargets, broadcastOf, localAddresses, isV4, isPrivateV4, defaultRouteAddress, CODE_RE, WS_PORT, DISCOVERY_PORT, DISC_VER, APP_ID, hmac };
