// ============================================================
// AVVIO — schermata di caricamento con il controllo dei server e degli aggiornamenti
// Una barra che si riempie a passi: stadio pronto, collegamento ai server, ricerca degli aggiornamenti (nell'app desktop).
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
    // versione e motore del server: servono a spiegare perché una partita del server non si può guardare in 3D
    if (r && r !== 'timeout') this.serverStatus = r;
    return r !== 'timeout' && !!r;
  } catch (e) { return false; }
};

// un passo del caricamento: la barra arriva a pct (0..100) e sotto c'è la frase del passo
Game.prototype.loadingStep = function (pct, text) {
  $('ld-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  if (text !== undefined) $('ld-text').textContent = text;
};

// caricamento: stadio pronto -> server -> aggiornamenti (solo app desktop) -> menu.
// Dura almeno LOADING_MIN_MS, così si vede (e si legge) anche su un computer veloce.
const LOADING_MIN_MS = 1300;
const LOADING_UPDATE_MS = 3500;   // il controllo degli aggiornamenti non fa mai aspettare di più
Game.prototype.startupCheck = async function () {
  // nei test automatici il controllo si fa solo se chiesto (test.html?startup=1)
  const skip = BUILD_TARGET === 'test' && !/[?&]startup=1/.test(location.search);
  if (skip) { this.hideLoading(); return; }
  const t0 = performance.now();
  $('ld-offline').hidden = true; $('ld-sweep').hidden = false;
  this.loadingStep(45, tr('Stadio pronto'));
  // 1. server
  if (this.eco && this.eco.api.configured()) {
    this.loadingStep(55, tr('Collegamento ai server…'));
    const ok = await this.pingServer();
    if (!ok) {
      // niente server: si sceglie se giocare offline o riprovare
      $('ld-sweep').hidden = true;
      $('ld-text').textContent = '';
      $('ld-offline').hidden = false;
      $('ld-play-offline').onclick = () => { this.setOffline(true); this.finishLoading(t0, true); };
      $('ld-retry').onclick = () => this.startupCheck();
      setTimeout(() => $('ld-play-offline').focus({ preventScroll: true }), 30);
      return;
    }
    this.setOffline(false);
    this.loadingStep(70, tr('Connesso'));
  }
  this.finishLoading(t0, false);
};

// 2. aggiornamenti (app desktop), poi il menu
Game.prototype.finishLoading = async function (t0, offline) {
  $('ld-offline').hidden = true; $('ld-sweep').hidden = false;
  if (window.campoUpdate && !offline) {
    this.loadingStep(82, tr('Cerco aggiornamenti…'));
    const wait = new Promise(ok => setTimeout(() => ok(null), LOADING_UPDATE_MS));
    let st = null;
    try { st = await Promise.race([window.campoUpdate.controlla(true), wait]); } catch (e) { st = null; }
    if (st && st.fase === 'disponibile' && st.nuova) {
      this.loadingStep(95, trf('C\'è la versione {0}: la trovi in alto nella home', st.nuova));
      await new Promise(ok => setTimeout(ok, 900));
    }
  }
  this.loadingStep(100, tr('Pronto'));
  const left = LOADING_MIN_MS - (performance.now() - t0);
  if (left > 0) await new Promise(ok => setTimeout(ok, left));
  this.hideLoading();
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
