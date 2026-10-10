// ============================================================
// DATI SALVATI — passaggio da una versione all'altra
// Impostazioni, carriere, squadre e allenamento stanno nel localStorage del computer (chiavi "campoAperto.…").
// Chi aggiorna dopo tanto tempo (per esempio dalla 0.15 alla 0.20) ha dati salvati da una versione vecchia:
// - ogni modulo legge i suoi dati controllandoli (un dato sbagliato o mancante diventa quello predefinito);
// - qui si ricorda con che versione sono stati salvati (campoAperto.dataVersion) e, se un giorno una versione
//   cambierà la forma di un dato, si aggiunge una "migrazione" in DATA_MIGRATIONS: parte una volta sola, per chi
//   arriva da una versione precedente, anche saltando tante versioni (si fanno tutte in ordine);
// - se il gioco non riesce a partire, invece di uno schermo nero compare "Ripristina i dati e riavvia": prima si
//   salva una copia di tutto (campoAperto.backup), poi si riparte puliti (l'accesso all'account resta).
// ============================================================
const DATA_VERSION_KEY = 'campoAperto.dataVersion';
const DATA_BACKUP_KEY = 'campoAperto.backup';
const DATA_KEEP = [DATA_BACKUP_KEY, 'campoAperto.session.v1'];   // non si cancellano con il ripristino

// { version: '0.16.0', run: () => { ... } }: cosa cambiare nei dati salvati per arrivare a quella versione.
// Per ora nessuna: le versioni fino a questa leggono tutte gli stessi dati.
const DATA_MIGRATIONS = [];

// -1 se a è più vecchia di b, 0 se uguali, 1 se più nuova (0.9.0 < 0.10.0)
function dataVersionCompare(a, b) {
  const pa = String(a).split('.'), pb = String(b).split('.');
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0, y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// all'avvio, prima di tutto il resto: migrazioni che mancano e versione dei dati aggiornata
function migrateSavedData() {
  let prev = null;
  try { prev = localStorage.getItem(DATA_VERSION_KEY); } catch (e) { return { from: null, done: [] }; }
  const cur = String(GAME_VERSION);
  // dati salvati da una versione più nuova (si è tornati indietro a mano): non si toccano
  if (prev && dataVersionCompare(prev, cur) > 0) return { from: prev, done: [], newer: true };
  const done = [];
  const todo = DATA_MIGRATIONS.slice().sort((a, b) => dataVersionCompare(a.version, b.version));
  for (const m of todo) {
    if (prev && dataVersionCompare(prev, m.version) >= 0) continue;   // già fatta
    if (dataVersionCompare(m.version, cur) > 0) continue;              // è di una versione futura
    try { m.run(); done.push(m.version); } catch (e) { console.warn('migrazione ' + m.version + ' non riuscita', e); }
  }
  try { localStorage.setItem(DATA_VERSION_KEY, cur); } catch (e) { /* spazio pieno: si riprova al prossimo avvio */ }
  return { from: prev, done: done };
}

// tutte le chiavi del gioco (tranne la copia)
function savedDataKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('campoAperto.') === 0 && k !== DATA_BACKUP_KEY) out.push(k);
    }
  } catch (e) { /* localStorage non disponibile */ }
  return out;
}
// copia di tutti i dati in una chiave sola (si può rimettere a mano)
function backupSavedData() {
  const data = {};
  for (const k of savedDataKeys()) { try { data[k] = localStorage.getItem(k); } catch (e) { /* salta */ } }
  try { localStorage.setItem(DATA_BACKUP_KEY, JSON.stringify({ at: Date.now(), version: String(GAME_VERSION), data: data })); return true; }
  catch (e) { return false; }
}
// ripristino: copia, poi via tutto tranne la copia e l'accesso all'account
function resetSavedData() {
  backupSavedData();
  for (const k of savedDataKeys()) if (DATA_KEEP.indexOf(k) < 0) { try { localStorage.removeItem(k); } catch (e) { /* salta */ } }
}
// rimette i dati della copia (per chi vuole tornare indietro)
function restoreSavedDataBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(DATA_BACKUP_KEY) || 'null');
    if (!b || !b.data) return false;
    for (const k in b.data) if (k.indexOf('campoAperto.') === 0 && typeof b.data[k] === 'string') localStorage.setItem(k, b.data[k]);
    return true;
  } catch (e) { return false; }
}

// il gioco non è partito: se WebGL c'è, il problema è probabilmente nei dati salvati
function showStartupProblem(err) {
  let gl = null;
  try { const c = document.createElement('canvas'); gl = c.getContext('webgl') || c.getContext('experimental-webgl'); } catch (e) { gl = null; }
  document.getElementById('loading').hidden = true;
  if (!gl) {
    const e = document.getElementById('fatal');
    e.hidden = false;
    e.textContent = tr('Il gioco non è partito: serve un browser o un computer con la grafica 3D (WebGL) attiva.');
    return;
  }
  document.getElementById('data-rescue').hidden = false;
  document.getElementById('dr-error').textContent = String(err && err.message || err).slice(0, 300);
  document.getElementById('dr-reset').onclick = () => { resetSavedData(); location.reload(); };
  document.getElementById('dr-retry').onclick = () => location.reload();
}
