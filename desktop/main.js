// ============================================================
// APP DESKTOP — apre il gioco in una finestra (Electron)
// ============================================================
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const lan = require('./lan.js');

const INDEX = path.join(__dirname, 'app', 'index.html');
const norm = p => { p = path.normalize(p); return process.platform === 'win32' ? p.toLowerCase() : p; };
const INDEX_NORM = norm(INDEX);

// rete locale: solo la pagina principale del gioco può usare questi comandi
function fidato(e) {
  try { return e.senderFrame === e.sender.mainFrame && norm(fileURLToPath(e.senderFrame.url.split(/[?#]/)[0])) === INDEX_NORM; } catch (err) { return false; }
}
ipcMain.handle('lan:host-start', async e => {
  if (!fidato(e)) return { error: 'Richiesta non consentita' };
  try { const r = await lan.startHost(); return { port: r.port, addresses: r.addresses, discovery: r.discovery }; }
  catch (err) { return { error: 'Non riesco ad avviare il server in rete locale (porta occupata o rete non disponibile)' }; }
});
ipcMain.handle('lan:host-stop', async e => {
  if (!fidato(e)) return { error: 'Richiesta non consentita' };
  try { await lan.stopHost(); return { ok: true }; } catch (err) { return { error: 'Non riesco a fermare il server in rete locale' }; }
});
ipcMain.handle('lan:find', async (e, code, hosts) => {
  if (!fidato(e)) return { error: 'Richiesta non consentita' };
  if (typeof code !== 'string' || !lan.CODE_RE.test(code)) return { error: 'Codice non valido' };
  const extra = Array.isArray(hosts) ? hosts.filter(lan.isV4).slice(0, 4) : [];
  try { return await lan.findGame(code, { hosts: extra }); } catch (err) { return { url: null, why: 'no-reply', detail: '' }; }
});
ipcMain.handle('lan:status', async e => {
  if (!fidato(e)) return { error: 'Richiesta non consentita' };
  try { return await lan.status(); } catch (err) { return { hosting: false, addresses: [] }; }
});
ipcMain.handle('lan:check', async (e, ip, port) => {
  if (!fidato(e)) return { error: 'Richiesta non consentita' };
  if (!lan.isPrivateV4(ip) || !Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, code: 'EINVAL' };
  try { return await lan.checkHost(ip, port, 3000); } catch (err) { return { ok: false, code: 'ERR' }; }
});

// l'audio del pubblico può partire senza aspettare un clic
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// usa la scheda grafica anche con driver "in lista nera" e, se manca del tutto,
// ripiega sul rendering software (il contenuto è solo locale, quindi è sicuro)
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

// --profilo=NOME: cartella dati separata (impostazioni, nome), utile per aprire
// una seconda finestra sullo stesso computer e provare l'online
const profilo = process.argv.map(a => /^--profilo=([A-Za-z0-9_-]{1,20})$/.exec(a)).find(Boolean);
if (profilo) app.setPath('userData', app.getPath('userData') + '-' + profilo[1]);

function creaFinestra() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 960,
    minHeight: 560,
    backgroundColor: '#0c1a2b', // stesso blu notte del gioco, niente lampo bianco all'avvio
    title: 'Campo Aperto',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  win.loadFile(INDEX);
  // chiudendo la finestra si ferma anche il server in rete locale
  win.on('closed', () => { lan.stopHost().catch(() => {}); });
  // anche ricaricando/navigando la pagina o se il processo di pagina muore
  win.webContents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => { if (isMainFrame) lan.stopHost().catch(() => {}); });
  win.webContents.on('render-process-gone', () => { lan.stopHost().catch(() => {}); });
  // mostro la finestra solo quando è pronta
  win.once('ready-to-show', () => win.show());

  // F11 = schermo intero, F12 = strumenti sviluppatore (per il debug)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); event.preventDefault(); }
  });

  // eventuali link esterni si aprono nel browser, non dentro il gioco
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // su Windows e Linux niente barra dei menu; su Mac serve il menu standard (Cmd+Q ecc.)
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  creaFinestra();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) creaFinestra();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { lan.stopHost().catch(() => {}); });
