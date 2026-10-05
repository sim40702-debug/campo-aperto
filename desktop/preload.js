// Ponte minimo tra il gioco (pagina isolata) e il processo principale: rete locale e dimensione della finestra
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
