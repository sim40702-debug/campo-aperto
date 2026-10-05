// Test dell'app desktop vera (Electron, stessa CSP della build desktop) con il server dell'economia in locale:
// la pagina deve poter parlare con il server (connect-src), registrarsi, leggere saldo e partite, giocare una scommessa.
// Prima: node build.js desktop, e in cloud/: npm install. Uso: xvfb-run npx electron tests/electron_economy_smoke.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const ROOT = path.join(__dirname, '..'), CLOUD = path.join(ROOT, 'cloud');
const WRANGLER = path.join(CLOUD, 'node_modules', '.bin', 'wrangler');
const PORT = 8793, API = 'http://127.0.0.1:' + PORT;
const pausa = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, fail = 0;
const check = (n, c, x) => { if (c) ok++; else fail++; console.log((c ? 'OK   ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); };

async function server() {
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-electron-'));
  if (!fs.existsSync(path.join(CLOUD, '.dev.vars'))) fs.copyFileSync(path.join(CLOUD, '.dev.vars.example'), path.join(CLOUD, '.dev.vars'));
  execFileSync('node', ['build.js', 'engine'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'campo-aperto', '--local', '--persist-to', persist], { cwd: CLOUD, stdio: 'ignore' });
  const p = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist], { cwd: CLOUD, detached: true, stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(API + '/api/status')).ok) break; } catch (e) { /* non ancora */ }
    await pausa(500);
  }
  await fetch(API + '/api/_test/tick', { method: 'POST' });
  return p;
}

app.whenReady().then(async () => {
  const srv = await server();
  try {
    const win = new BrowserWindow({ width: 1200, height: 760, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:eco' + Date.now() } });
    const errori = [];
    win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) errori.push(msg); });
    const file = path.join(ROOT, 'desktop', 'app', 'index.html');
    await win.loadFile(file);
    await win.webContents.executeJavaScript('localStorage.setItem("campoAperto.settings.v1", ' + JSON.stringify(JSON.stringify({ quality: 'bassa', dynamicRes: false, apiUrl: API })) + ')');
    await win.loadFile(file);
    const js = s => win.webContents.executeJavaScript(s);
    const attendi = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { if (await js(expr)) return true; await pausa(150); } return false; };
    await attendi('window.game && game.loaded', 30000);
    const csp = await js("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content");
    check('CSP dell\'app: HTTPS verso il server dell\'economia permesso', /connect-src[^;]*https:/.test(csp), csp.match(/connect-src[^;]*/)[0]);
    const nome = 'el_' + Date.now().toString(36).slice(-6);
    await js(`(async () => { await game.eco.api.register(${JSON.stringify(nome)}, 'password-el1'); })()`);
    check('registrazione dall\'app desktop: saldo 1000 dal server', await attendi('game.eco.api.me && game.eco.api.me.balance === 1000'));
    await js("game.eco.open('fixtures')");
    check('partite caricate dal server', await attendi("document.querySelectorAll('.fxrow').length >= 2"));
    const code = await js('game.eco.fixtures.next[0].code');
    await js(`game.eco.openCenter(${JSON.stringify(code)})`);
    check('centro partita con quote', await attendi("document.querySelectorAll('#mc-markets .sel').length > 0"));
    await js(`document.querySelector('#mc-markets [data-m="1X2"][data-s="X"]').click()`);
    await js("document.getElementById('slip-stake').value = '25'; document.getElementById('slip-confirm').click()");
    check('scommessa giocata dall\'app: saldo 1025 (1000 - 25 + 50 obiettivo)', await attendi('game.eco.api.me.balance === 1025'));
    await pausa(800);
    fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'shots', '60_electron_economia.png'), (await win.webContents.capturePage()).toPNG());
    check('nessun errore nella console (CSP compresa)', errori.length === 0, errori.slice(0, 3));
    // riavvio dell'app: finestra nuova sulla stessa partizione. Resta collegato (solo il token sul computer)
    // e il saldo arriva di nuovo dal server
    const part = win.webContents.session;
    win.destroy();
    const win2 = new BrowserWindow({ width: 1200, height: 760, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: part } });
    await win2.loadFile(file);
    const js2 = s => win2.webContents.executeJavaScript(s);
    const t0 = Date.now(); let dopo = false;
    while (Date.now() - t0 < 30000) { if (await js2('!!(window.game && game.loaded && game.eco.api.me && game.eco.api.me.balance === 1025)')) { dopo = true; break; } await pausa(150); }
    check('riavvio: ancora collegato, saldo 1025 dal server', dopo);
    const sess = await js2("JSON.parse(localStorage.getItem('campoAperto.session.v1') || '{}')");
    check('sul computer solo nome e token (niente saldo)', Object.keys(sess).sort().join() === 'token,username', Object.keys(sess));
  } catch (e) {
    console.error(e); fail++;
  } finally {
    try { process.kill(-srv.pid, 'SIGTERM'); } catch (e) { /* già chiuso */ }
  }
  console.log('\nRisultato: ' + ok + ' superati, ' + fail + ' falliti');
  app.exit(fail ? 1 : 0);
});
