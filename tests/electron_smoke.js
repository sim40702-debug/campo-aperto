// Test dell'app desktop vera (Electron, stessa sicurezza e CSP della build desktop):
// avvio, menu, partita offline con tasti reali, poi partita online con due finestre
// separate (archivi diversi) collegate a un server relay avviato qui.
// uso: npx electron tests/electron_smoke.js   (su Linux senza schermo: xvfb-run)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { createRelay } = require('../server/relay.js');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const out = path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const pausa = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, fail = 0;
const check = (n, c, x) => { if (c) ok++; else fail++; console.log((c ? 'OK   ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };

async function finestra(nome, settings, x) {
  const win = new BrowserWindow({ width: 1100, height: 640, x: x, y: 0, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: 'persist:' + nome } });
  const errori = [];
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) errori.push(msg); });
  const file = path.join(__dirname, '..', 'desktop', 'app', 'index.html');
  await win.loadFile(file);
  await win.webContents.executeJavaScript('localStorage.setItem("campoAperto.settings.v1", ' + JSON.stringify(JSON.stringify(settings)) + ')');
  await win.loadFile(file);
  const js = s => win.webContents.executeJavaScript(s);
  const attendi = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { if (await js(expr)) return true; await pausa(150); } return false; };
  await attendi('window.game && game.loaded', 30000);
  const tasto = async (key, giu) => { win.webContents.focus(); win.webContents.sendInputEvent({ type: giu ? 'keyDown' : 'keyUp', keyCode: key }); };
  return { win, js, attendi, tasto, errori };
}

app.whenReady().then(async () => {
  const relay = await createRelay({ port: 0, quiet: true });
  const server = 'ws://127.0.0.1:' + relay.port;
  try {
    const A = await finestra('host', { quality: 'bassa', dynamicRes: false, name: 'Simone', server }, 0);
    const info = await A.js(`({ fatal: !document.getElementById('fatal').hidden, screen: game.screen, versione: document.getElementById('version').textContent,
      esci: !document.getElementById('li-quit').hidden, font: document.fonts.check('800 40px "Saira Condensed"'), target: BUILD_TARGET,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content })`);
    check('app avviata, menu visibile, nessun errore fatale', !info.fatal && info.screen === 'menu', info.versione);
    check('build desktop: pulsante Esci e font locali', info.esci && info.font && info.target === 'desktop');
    check('CSP desktop: solo WebSocket come connessioni esterne', /connect-src 'self' ws: wss:/.test(info.csp));
    fs.writeFileSync(path.join(out, 'electron_menu.png'), (await A.win.webContents.capturePage()).toPNG());

    // partita offline con tasti veri (eventi di input del sistema)
    await A.js(`document.getElementById('btn-quick').click(); document.getElementById('setup-start').click();`);
    await A.attendi(`game.match && game.match.setPieceReady`, 40000);
    await A.tasto('J', true); await A.tasto('J', false);
    check('tasto J reale: calcio d inizio battuto', await A.attendi(`game.match.state==='PLAY'`, 20000));
    const x0 = await A.js(`(window.__p = game.match.humans[0].player).x`);
    await A.tasto('D', true); await pausa(2500);
    const vx = await A.js(`__p.vx`);
    await A.tasto('D', false);
    const x1 = await A.js(`__p.x`);
    check('tasto D reale: il calciatore va verso destra', x1 - x0 > 0.5 || vx > 1, [x0, x1, vx]);
    check('tasto D rilasciato: nessun tasto bloccato', !(await A.js(`game.input.held('right')`)));
    fs.writeFileSync(path.join(out, 'electron_match.png'), (await A.win.webContents.capturePage()).toPNG());
    // schermo intero della finestra e ritorno
    A.win.setFullScreen(true); await pausa(1500);
    const fsz = await A.js(`({w: innerWidth, h: innerHeight, d: game.renderer.drawingSize()})`);
    A.win.setFullScreen(false); await pausa(1500);
    const wsz = await A.js(`({w: innerWidth, h: innerHeight, d: game.renderer.drawingSize()})`);
    check('schermo intero: il disegno segue la nuova dimensione', fsz.d.w === Math.round(fsz.w * fsz.d.ratio) && wsz.d.w === Math.round(wsz.w * wsz.d.ratio) && (fsz.w !== wsz.w || fsz.h !== wsz.h), [fsz, wsz]);
    await A.js(`game.quitToMenu()`);

    // partita online: due finestre con archivi separati
    const B = await finestra('client', { quality: 'bassa', dynamicRes: false, name: 'Luca', server }, 600);
    await A.js(`document.getElementById('btn-online').click(); document.getElementById('on-create').click();`);
    check('online: partita creata nell app (CSP desktop permette il WebSocket)', await A.attendi(`game.screen==='lobby'`, 15000));
    const code = await A.js(`game.net.link.code`);
    await B.js(`document.getElementById('btn-online').click(); document.getElementById('on-code').value=${JSON.stringify(code.toLowerCase())}; document.getElementById('on-join').click();`);
    check('online: secondo giocatore entrato con il codice ' + code, await B.attendi(`game.screen==='lobby' && game.net.client.lobby && game.net.client.lobby.members.length===2`, 15000));
    await B.js(`document.querySelector('[data-side="1"]').click()`);
    await A.attendi(`[...game.net.host.members.values()].some(m => !m.isHost && m.side === 1)`, 10000);
    fs.writeFileSync(path.join(out, 'electron_lobby.png'), (await A.win.webContents.capturePage()).toPNG());
    await A.js(`document.getElementById('lb-start').click()`);
    check('online: partita avviata su entrambe le finestre', await A.attendi(`game.mode==='host'`, 10000) && await B.attendi(`game.mode==='client' && game.net.client.snaps.length > 5`, 15000));
    await A.attendi(`game.match.setPieceReady`, 40000);
    await A.tasto('J', true); await A.tasto('J', false);
    await A.attendi(`game.match.state==='PLAY'`, 20000);
    const lid = await B.js(`game.net.link.id`);
    const lx0 = await A.js(`(window.__lp = game.match.humanById(${JSON.stringify(lid)}).player).x`);
    await B.tasto('D', true); await pausa(3000);
    const st = await A.js(`({x: __lp.x, vx: __lp.vx, mx: game.match.humanById(${JSON.stringify(lid)}).input.mx})`);
    await B.tasto('D', false);
    check('online: tasto reale nella finestra client muove il calciatore sull host', st.mx === 1 && (st.x - lx0 > 0.5 || st.vx > 1), st);
    const sync = await B.js(`({s: game.match.teams[0].score + '-' + game.match.teams[1].score, net: document.getElementById('net-text').textContent})`);
    check('online: indicatore di connessione attivo nel client', /Online/.test(sync.net), sync);
    fs.writeFileSync(path.join(out, 'electron_online_client.png'), (await B.win.webContents.capturePage()).toPNG());
    // l'host apre le impostazioni dalla pausa: la partita online deve continuare (prima si fermava per tutti)
    await A.js(`game.togglePause(true); document.getElementById('pause-settings').click()`);
    const t0 = await A.js('game.net.host.simTime');
    await pausa(1500);
    const t1 = await A.js(`({t: game.net.host.simTime, screen: game.screen})`);
    check('online: con l host nelle impostazioni la partita continua', t1.screen === 'settings' && t1.t - t0 > 1, { prima: t0, dopo: t1 });
    await A.js(`document.getElementById('st-back').click(); game.togglePause(false)`);
    // il client chiude la finestra: l'host continua senza errori
    B.win.destroy();
    await pausa(3000);
    const dopo = await A.js(`({ok: game.mode==='host' && !!game.match, umani: game.match.humans.length})`);
    check('client chiude la finestra: l host continua, l IA prende il calciatore', dopo.ok && dopo.umani === 1, dopo);
    check('nessun errore in console (host)', A.errori.length === 0, A.errori.slice(0, 3));
    check('nessun errore in console (client)', B.errori.length === 0, B.errori.slice(0, 3));
  } catch (e) { console.log('ERRORE TEST', e); fail++; }
  await relay.close();
  console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
  app.exit(fail ? 1 : 0);
});
