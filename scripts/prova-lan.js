// ============================================================
// PROVA RETE LOCALE — diagnostica passo per passo (Node puro, solo la libreria ws)
// Uso: node scripts/prova-lan.js [IP-host[:porta]] [CODICE]
// Dice quale passo della ricerca/ingresso in rete locale non funziona e perché. Non si blocca mai, esce sempre con 0.
// ============================================================
'use strict';
const os = require('os');
const dgram = require('dgram');
const crypto = require('crypto');
const WebSocket = require('ws');
const lan = require('../desktop/lan.js');
const { PROTOCOL } = require('../server/relay.js');

const ok = s => console.log('OK      ' + s);
const err = s => console.log('ERRORE  ' + s);
const info = s => console.log('        ' + s);
const title = s => console.log('\n== ' + s);

// --- argomenti: un indirizzo (IP o IP:porta, anche ws://) e/o un codice
let hostArg = null, code = null, bad = [];
for (const a of process.argv.slice(2)) {
  const m = /^(?:ws:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\/?$/.exec(a);
  if (m && lan.isV4(m[1]) && (m[2] === undefined || (+m[2] >= 1 && +m[2] <= 65535))) hostArg = { ip: m[1], port: m[2] === undefined ? lan.WS_PORT : +m[2] };
  else if (lan.CODE_RE.test(a.toUpperCase())) code = a.toUpperCase();
  else bad.push(a);
}
const DPORT = +process.env.PROVA_LAN_DISCOVERY_PORT || lan.DISCOVERY_PORT; // la variabile serve solo ai test

const state = { udp: {}, reply: null, tcp: null, ws: null, join: null, noNet: false };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// invia un datagramma e dice se l'invio è riuscito (errno altrimenti); attende anche l'eventuale risposta
function probeUdp(label, ip, query, nonce) {
  return new Promise(resolve => {
    let s, finished = false;
    const end = r => { if (finished) return; finished = true; try { s.close(); } catch (e) { /* già chiuso */ } resolve(r); };
    try {
      s = dgram.createSocket('udp4');
      s.on('error', e => end({ ok: false, code: e.code || 'ERR' }));
      s.on('message', (buf, rinfo) => {
        try {
          const m = JSON.parse(buf.toString('utf8'));
          if (code && m && m.a === lan.APP_ID && Number.isInteger(m.port) && m.h2 === lan.hmac(code, nonce + ':' + m.port)) { state.reply = state.reply || { from: rinfo.address, port: m.port, via: label }; }
        } catch (e) { /* ignora */ }
      });
      s.bind(0, '0.0.0.0', () => {
        try { s.setBroadcast(true); } catch (e) { return end({ ok: false, code: e.code || 'ERR' }); }
        let sentOk = null;
        const cb = e => { sentOk = e ? { ok: false, code: e.code || 'ERR' } : { ok: true }; };
        try { s.send(query, DPORT, ip, cb); } catch (e) { return end({ ok: false, code: e.code || 'ERR' }); }
        setTimeout(() => end(sentOk || { ok: true }), 700);
      });
    } catch (e) { end({ ok: false, code: e.code || 'ERR' }); }
  });
}

function wsOpen(url, ms) {
  return new Promise(resolve => {
    let ws, done = false;
    const end = r => { if (done) return; done = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { try { ws.terminate(); } catch (e) { /* ignora */ } end({ ok: false, code: 'ETIMEDOUT' }); }, ms);
    const t0 = Date.now();
    try {
      ws = new WebSocket(url, { handshakeTimeout: ms });
      ws.on('open', () => end({ ok: true, ms: Date.now() - t0, ws }));
      ws.on('error', e => end({ ok: false, code: e.code || e.message }));
    } catch (e) { end({ ok: false, code: e.code || e.message }); }
  });
}

async function main() {
  console.log('Prova rete locale - Campo Aperto');
  if (bad.length) err('Argomenti non riconosciuti: ' + bad.join(' ') + '  (uso: node scripts/prova-lan.js [IP-host[:porta]] [CODICE])');

  title('1. Computer');
  ok('Sistema: ' + os.type() + ' ' + os.release() + ' (' + process.platform + ' ' + process.arch + '), Node ' + process.version);

  title('2. Interfacce di rete (IPv4)');
  const ifs = lan.localAddresses();
  if (!ifs.length) { err('Nessuna interfaccia IPv4 attiva: il computer non è collegato a nessuna rete'); state.noNet = true; }
  for (const i of ifs) {
    const sw = lan.sweepTargets([i], 1024).length;
    ok(i.address + '  maschera ' + i.netmask + '  broadcast ' + (lan.broadcastOf(i) || '?') + (sw ? '  (scansione unicast: ' + sw + ' indirizzi)' : '  (sottorete non scansionata)'));
  }
  const dr = await lan.defaultRouteAddress();
  if (dr) ok('Indirizzo usato per uscire in rete (rotta predefinita): ' + dr); else err('Rotta predefinita non determinabile (nessuna rete o accesso bloccato)');

  title('3. Invio dei messaggi di ricerca (UDP porta ' + DPORT + ')');
  const nonce = crypto.randomBytes(16).toString('hex');
  const q = Buffer.from(JSON.stringify({ q: lan.APP_ID, v: PROTOCOL, d: lan.DISC_VER, n: nonce, h: lan.hmac(code || 'AAAAAA', nonce) }));
  const targets = [['broadcast generale', '255.255.255.255']];
  for (const i of ifs) { const b = lan.broadcastOf(i); if (b) targets.push(['broadcast diretto ' + i.address, b]); }
  const samples = [];
  for (const i of ifs) { const s = lan.sweepTargets([i], 1024).find(a => a !== (hostArg && hostArg.ip)); if (s) samples.push(['unicast di prova a un vicino', s]); }
  targets.push(...samples.slice(0, 1));
  if (hostArg) targets.push(['unicast verso l\'host ' + hostArg.ip, hostArg.ip]);
  for (const [label, ip] of targets) {
    const r = await probeUdp(label, ip, q, nonce);
    state.udp[label] = r;
    if (r.ok) ok(label + ' (' + ip + '): invio riuscito'); else err(label + ' (' + ip + '): invio fallito, ' + r.code);
  }
  const udpAll = Object.values(state.udp);
  const udpFailCodes = udpAll.filter(r => !r.ok).map(r => r.code);

  title('4. Ricerca della partita' + (code ? ' ' + code : ''));
  if (!code) info('Nessun codice dato: salto la ricerca (aggiungi il codice della lobby dell\'host)');
  else {
    const f = await lan.findGame(code, { discoveryPort: DPORT, hosts: hostArg ? [hostArg.ip] : [], timeout: 2500 });
    state.find = f;
    if (f.url) ok('Risposta ricevuta: l\'host è a ' + f.url + (state.reply ? '  (arrivata via ' + state.reply.via + ')' : ''));
    else {
      err('Nessuna risposta alla ricerca (' + f.why + (f.detail ? ', ' + f.detail : '') + ')');
      if (state.reply) info('Nota: una risposta è arrivata nei test del punto 3, da ' + state.reply.from + ':' + state.reply.port + ' (via ' + state.reply.via + ')');
    }
  }

  let wsUrl = null;
  if (hostArg) {
    title('5. Collegamento all\'host ' + hostArg.ip + ':' + hostArg.port);
    const tc = await lan.checkHost(hostArg.ip, hostArg.port, 4000);
    state.tcp = tc;
    if (tc.ok) ok('TCP ' + hostArg.ip + ':' + hostArg.port + ' raggiungibile in ' + tc.ms + ' ms'); else err('TCP ' + hostArg.ip + ':' + hostArg.port + ' non raggiungibile: ' + tc.code);
    if (tc.ok) {
      wsUrl = 'ws://' + hostArg.ip + ':' + hostArg.port;
      const w = await wsOpen(wsUrl, 4000);
      state.ws = w;
      if (!w.ok) err('WebSocket verso ' + wsUrl + ': ' + w.code);
      else {
        ok('WebSocket aperto verso ' + wsUrl + ' in ' + w.ms + ' ms');
        if (code) {
          const ans = await new Promise(resolve => {
            const t = setTimeout(() => resolve({ t: 'timeout' }), 4000);
            w.ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.t === 'joined' || m.t === 'error') { clearTimeout(t); resolve(m); } } catch (e) { /* ignora */ } });
            w.ws.on('close', () => { clearTimeout(t); resolve({ t: 'closed' }); });
            w.ws.send(JSON.stringify({ t: 'join', v: PROTOCOL, code, name: 'Prova' }));
          });
          state.join = ans;
          if (ans.t === 'joined') ok('Richiesta di ingresso accettata dal relay (codice ' + code + ')');
          else if (ans.t === 'error') err('Il relay ha risposto: ' + (ans.code || '') + ' ' + (ans.msg || ''));
          else err('Il relay non ha risposto alla richiesta di ingresso (' + ans.t + ')');
          try { w.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) { /* ignora */ }
        } else info('Nessun codice dato: salto la richiesta di ingresso');
        try { w.ws.close(); } catch (e) { /* ignora */ }
      }
    }
  } else { title('5. Collegamento all\'host'); info('Nessun indirizzo dato: salto la prova TCP/WebSocket (aggiungi l\'indirizzo mostrato sullo schermo dell\'host)'); }

  title('Conclusione');
  console.log(conclusion(udpFailCodes));
}

// un solo paragrafo: il passo che fallisce e la probabile causa
function conclusion(udpFailCodes) {
  const mac = process.platform === 'darwin';
  const permission = udpFailCodes.some(c => c === 'EHOSTUNREACH' || c === 'EPERM') || (state.tcp && !state.tcp.ok && (state.tcp.code === 'EHOSTUNREACH' || state.tcp.code === 'EPERM'));
  if (state.noNet) return 'Il computer non è collegato a nessuna rete: collegati al Wi-Fi o al cavo della stessa rete dell\'host e riprova.';
  if (permission) {
    return mac
      ? 'Passo che fallisce: invio in rete locale (errore di accesso alla rete). Causa probabile: macOS blocca l\'accesso alla rete locale per l\'app che ha avviato questo comando. Apri Impostazioni di Sistema, Privacy e sicurezza, Rete locale e attiva il Terminale (o l\'app con cui avvii il gioco), poi riavvia il Terminale e riprova.'
      : 'Passo che fallisce: invio in rete locale (errore di accesso alla rete). Causa probabile: firewall o antivirus di questo computer, oppure rete non raggiungibile. Consenti Node/Campo Aperto nel firewall e controlla di essere sulla stessa rete dell\'host.';
  }
  if (udpFailCodes.length && udpFailCodes.length === Object.keys(state.udp).length) return 'Passo che fallisce: invio dei messaggi UDP (' + udpFailCodes[0] + '). Causa probabile: firewall o antivirus di questo computer che blocca la rete locale. Consenti il gioco e riprova.';
  if (state.tcp && !state.tcp.ok) {
    if (state.tcp.code === 'ECONNREFUSED') return 'Passo che fallisce: connessione TCP all\'host (rifiutata). Il computer c\'è ma sulla porta ' + hostArg.port + ' non ascolta nessuno: l\'host non sta più ospitando, oppure la porta è diversa da quella mostrata sul suo schermo.';
    return 'Passo che fallisce: connessione TCP all\'host (' + state.tcp.code + '). Causa probabile: il firewall del computer dell\'host blocca il gioco (consenti Campo Aperto per le reti private e pubbliche), oppure l\'indirizzo è sbagliato o siete su reti diverse.';
  }
  if (state.ws && !state.ws.ok) return 'Passo che fallisce: apertura del WebSocket (' + state.ws.code + '). La porta risponde ma il gioco no: controlla che l\'host abbia lo stesso numero di versione del gioco e che l\'indirizzo sia quello giusto.';
  if (state.join) {
    if (state.join.t === 'joined') return 'Tutto funziona: il collegamento verso l\'host e l\'ingresso con il codice riescono' + (state.find && state.find.url ? ', e la ricerca automatica trova l\'host' : '. La ricerca automatica però non ha trovato l\'host: la rete (per esempio l\'hotspot del telefono) probabilmente non inoltra i messaggi in broadcast. Nel gioco scrivi l\'indirizzo ' + hostArg.ip + (hostArg.port === lan.WS_PORT ? '' : ':' + hostArg.port) + ' nel campo "Indirizzo dell\'host": funziona anche senza ricerca.') + '.';
    if (state.join.code === 'NOT_FOUND') return 'Passo che fallisce: richiesta di ingresso. L\'host è raggiungibile ma non ha una partita con questo codice: controlla il codice e che l\'host sia ancora nella lobby.';
    return 'Passo che fallisce: richiesta di ingresso (' + (state.join.code || state.join.t) + '). L\'host è raggiungibile, ma ha rifiutato o non ha risposto: controlla codice, versione del gioco uguale e posti liberi.';
  }
  if (state.find) {
    if (state.find.url) return 'La ricerca trova l\'host a ' + state.find.url + '. Se il gioco non entra, riprova indicando anche l\'indirizzo dell\'host per provare il collegamento diretto.';
    if (state.find.why === 'no-reply') return 'Passo che fallisce: nessuna risposta alla ricerca, anche se i messaggi partono. Cause probabili: la rete (per esempio l\'hotspot del telefono) non inoltra i messaggi in broadcast, il codice è sbagliato o l\'host non è più nella lobby, oppure il firewall dell\'host blocca la porta UDP ' + DPORT + '. Soluzione: scrivi nel gioco l\'indirizzo mostrato sullo schermo dell\'host (campo "Indirizzo dell\'host") oppure rilancia questa prova con l\'indirizzo: node scripts/prova-lan.js IP:8787 ' + code + '.';
  }
  return 'I messaggi partono senza errori. Per provare anche il collegamento rilancia con l\'indirizzo mostrato sullo schermo dell\'host e il codice: node scripts/prova-lan.js IP:8787 CODICE.';
}

// non si blocca mai: dopo 40 secondi chiude comunque
const guard = setTimeout(() => { err('Tempo scaduto: la prova si è fermata'); process.exit(0); }, 40000);
main().catch(e => err('Errore imprevisto: ' + (e && e.message))).then(() => { clearTimeout(guard); process.exit(0); });
