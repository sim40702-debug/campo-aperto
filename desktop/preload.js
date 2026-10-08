// Ponte minimo tra il gioco (pagina isolata) e il processo principale: rete locale, dimensione della finestra e aggiornamenti
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('campoLan', {
  hostStart: () => ipcRenderer.invoke('lan:host-start'),
  hostStop: () => ipcRenderer.invoke('lan:host-stop'),
  find: (code, hosts) => ipcRenderer.invoke('lan:find', String(code), Array.isArray(hosts) ? hosts.map(String) : []),
  check: (ip, port) => ipcRenderer.invoke('lan:check', String(ip), Number(port)),
  status: () => ipcRenderer.invoke('lan:status'),
});

contextBridge.exposeInMainWorld('campoWindow', {
  setSize: (w, h) => ipcRenderer.invoke('win:set-size', Number(w), Number(h)),
  info: () => ipcRenderer.invoke('win:info'),
});

// aggiornamenti dell'app (desktop/aggiornamenti.js): la pagina legge lo stato e chiede di controllare o aggiornare
contextBridge.exposeInMainWorld('campoUpdate', {
  stato: () => ipcRenderer.invoke('upd:stato'),
  controlla: () => ipcRenderer.invoke('upd:controlla'),
  aggiorna: () => ipcRenderer.invoke('upd:aggiorna'),
  annulla: () => ipcRenderer.invoke('upd:annulla'),
  apriPagina: () => ipcRenderer.invoke('upd:pagina'),
  visto: () => ipcRenderer.invoke('upd:visto'),
  onCambio: cb => { ipcRenderer.on('upd:cambio', (e, s) => cb(s)); },
});
