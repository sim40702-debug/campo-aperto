// ============================================================
// AVVIO — schermata di caricamento con il controllo dei server
// All'avvio il gioco prova a raggiungere il server dell'economia (/api/status). Se risponde si entra nel menu;
// se non risponde compare "Server non raggiungibile" con Gioca offline e Riprova: offline funzionano partita rapida,
// allenamento, competizioni, carriera e le tue squadre; account, shop, scommesse e online no.
// Nella home resta il pulsante "Offline · Riprova" per ricollegarsi più tardi.
// Senza un server configurato (versione solo locale) non si controlla niente.
// ============================================================
const STARTUP_TIMEOUT_MS = 6000;

// prova il server: true se risponde entro il tempo
Game.prototype.pingServer = async function () {
  const api = this.eco && this.eco.api;
  if (!api || !api.configured()) return true;
  const wait = new Promise(ok => setTimeout(() => ok('timeout'), STARTUP_TIMEOUT_MS));
  try {
    const r = await Promise.race([api.get('/api/status'), wait]);
    return r !== 'timeout' && !!r;
  } catch (e) { return false; }
};

Game.prototype.startupCheck = async function () {
  // nei test automatici il controllo si fa solo se chiesto (test.html?startup=1)
  const skip = BUILD_TARGET === 'test' && !/[?&]startup=1/.test(location.search);
  if (skip || !this.eco || !this.eco.api.configured()) { this.hideLoading(); return; }
  $('ld-offline').hidden = true; $('ld-sweep').hidden = false;
  $('ld-text').textContent = tr('Collegamento ai server…');
  const ok = await this.pingServer();
  if (ok) { this.setOffline(false); $('ld-text').textContent = tr('Connesso'); this.hideLoading(); return; }
  // niente server: si sceglie se giocare offline o riprovare
  $('ld-sweep').hidden = true;
  $('ld-text').textContent = '';
  $('ld-offline').hidden = false;
  $('ld-play-offline').onclick = () => { this.setOffline(true); this.hideLoading(); };
  $('ld-retry').onclick = () => this.startupCheck();
  setTimeout(() => $('ld-play-offline').focus({ preventScroll: true }), 30);
};

Game.prototype.hideLoading = function () {
  const el = $('loading');
  el.classList.add('out');
  setTimeout(() => { el.hidden = true; }, 650);
};

// modalità offline: pulsante nella home per riprovare
Game.prototype.setOffline = function (v) {
  this.offline = !!v;
  const pill = $('offline-pill');
  pill.hidden = !this.offline;
  pill.onclick = async () => {
    pill.disabled = true;
    const ok = await this.pingServer();
    pill.disabled = false;
    if (ok) { this.setOffline(false); this.toast(tr('Di nuovo collegato ai server')); if (this.eco.onShow) this.eco.onShow(this.screen); }
    else this.toast(tr('I server non rispondono ancora: continua a giocare offline'), true);
  };
};
