// Ponte minima tra il gioco (pagina isolata) e il processo principale: solo rete locale
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('campoLan', {
  hostStart: () => ipcRenderer.invoke('lan:host-start'),
  hostStop: () => ipcRenderer.invoke('lan:host-stop'),
  find: code => ipcRenderer.invoke('lan:find', String(code)),
});
