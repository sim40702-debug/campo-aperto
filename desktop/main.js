// ============================================================
// APP DESKTOP — apre il gioco in una finestra (Electron)
// ============================================================
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

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
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
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
