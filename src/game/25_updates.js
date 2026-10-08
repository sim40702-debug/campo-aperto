// ============================================================
// AGGIORNAMENTI — nell'app desktop: avviso nella home, schermata "Aggiornamento" e riga nelle impostazioni
// Il lavoro vero (controllo su GitHub Releases, download, verifica, installazione e riavvio) lo fa
// desktop/aggiornamenti.js; qui si mostra solo lo stato che arriva da window.campoUpdate (preload.js).
// Nel browser window.campoUpdate non c'è e non si vede niente.
// ============================================================
Game.prototype.initUpdates = function () {
  this.upd = null;
  if (!window.campoUpdate) return;
  const u = window.campoUpdate;
  const set = s => { if (s) { this.upd = s; this.onUpdateState(); } };
  u.onCambio(set);
  u.stato().then(set, () => {});
  $('upd-pill').onclick = () => this.showScreen('update');
  $('upd-back').onclick = () => this.showScreen('menu');
  $('upd-go').onclick = () => { u.aggiorna().catch(() => {}); };
  $('upd-cancel').onclick = () => { u.annulla().catch(() => {}); };
  $('upd-page').onclick = () => { u.apriPagina().catch(() => {}); };
};

// arriva uno stato nuovo dal processo principale
Game.prototype.onUpdateState = function () {
  const s = this.upd;
  // dopo il riavvio: l'aggiornamento è andato a buon fine?
  if (!this.updToastShown && (s.appenaAggiornato || s.nonRiuscito)) {
    this.updToastShown = true;
    if (s.appenaAggiornato) this.toast(trf('Aggiornato alla versione {0}', s.appenaAggiornato));
    else this.toast(trf('L\'aggiornamento alla versione {0} non è stato completato: il gioco usa ancora la versione {1}.', s.nonRiuscito, s.attuale), true);
    window.campoUpdate.visto().catch(() => {});
  }
  // avviso discreto nella home, solo se c'è davvero qualcosa
  const show = s.fase === 'disponibile' || s.fase === 'scarico' || s.fase === 'installo' || (s.fase === 'errore' && !!s.nuova);
  $('upd-pill').hidden = !show;
  $('upd-pill-text').textContent = s.fase === 'scarico' ? trf('Scarico l\'aggiornamento… {0}%', Math.floor(s.percentuale || 0))
    : s.fase === 'installo' ? tr('Installazione dell\'aggiornamento…')
    : tr('Nuovo aggiornamento disponibile');
  if (this.screen === 'update') this.renderUpdate();
  if (this.screen === 'settings') this.renderUpdateOpt();
};

// frase chiara per ogni errore (mai il messaggio tecnico)
function updateErrorText(code) {
  return {
    rete: 'GitHub non è raggiungibile. Controlla la connessione a internet e riprova: il gioco continua a funzionare con la versione attuale.',
    verifica: 'Il file scaricato non è integro, quindi non è stato installato. Riprova: la versione attuale resta com\'è.',
    cartella: 'Il gioco non può sostituirsi da solo in questa cartella. Sul Mac deve stare nella cartella Applicazioni (non dentro il disco .dmg); su Windows la versione portable deve stare in una cartella dove puoi scrivere. Puoi anche scaricare la versione nuova dalla sua pagina.',
    'nessun-file': 'Per il tuo sistema questa versione non ha il file per l\'aggiornamento automatico. Puoi scaricarla dalla sua pagina.',
  }[code] || 'L\'aggiornamento non è riuscito. Il gioco continua a funzionare con la versione attuale: riprova più tardi.';
}

// note della release (testo del CHANGELOG in markdown): titoli, elenchi, grassetto e codice, tutto il resto è testo
function updateNotesHtml(md) {
  const inline = t => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  let html = '', inList = false, item = null;
  const closeItem = () => { if (item !== null) { html += '<li>' + inline(item) + '</li>'; item = null; } };
  const closeList = () => { closeItem(); if (inList) { html += '</ul>'; inList = false; } };
  for (const line of String(md || '').split(/\r?\n/)) {
    if (/^\s*$/.test(line)) { closeList(); continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) { closeList(); html += '<h4>' + inline(h[1]) + '</h4>'; }
    else if (li) { closeItem(); if (!inList) { html += '<ul>'; inList = true; } item = li[1]; }
    else if (item !== null) item += ' ' + line.trim();   // la riga continua la voce di prima
    else { closeList(); html += '<p>' + inline(line.trim()) + '</p>'; }
  }
  closeList();
  return html;
}

// schermata "Aggiornamento"
Game.prototype.renderUpdate = function () {
  const s = this.upd || { fase: 'nessuno', attuale: GAME_VERSION };
  const mb = n => (n / 1048576).toLocaleString(uiLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  $('upd-cur').textContent = s.attuale || GAME_VERSION;
  $('upd-new').textContent = s.nuova || '—';
  // barra del download
  const busy = s.fase === 'scarico' || s.fase === 'installo';
  $('upd-progress').hidden = !busy;
  if (busy) {
    const pct = s.fase === 'installo' ? 100 : Math.max(0, Math.min(100, s.percentuale || 0));
    $('upd-bar').style.width = pct + '%';
    $('upd-progress-text').textContent = s.fase === 'installo' ? tr('Download completato e verificato. Il gioco si chiude, installa la versione nuova e si riapre…')
      : s.totale ? trf('{0}% — {1} MB di {2} MB', Math.floor(pct), mb(s.scaricati || 0), mb(s.totale))
      : tr('Download in corso…');
  }
  // messaggio: errore, nessun file per questo sistema, oppure già aggiornato
  const msg = $('upd-msg');
  let text = '', ok = false;
  if (s.fase === 'errore') text = tr(updateErrorText(s.errore));
  else if (s.fase === 'disponibile' && s.automatico === false) text = tr(updateErrorText('nessun-file'));
  else if (s.fase === 'nessuno' || s.fase === 'non-supportato') { text = s.fase === 'nessuno' ? tr('Hai già l\'ultima versione.') : tr('Gli aggiornamenti automatici funzionano solo nell\'app installata.'); ok = true; }
  else if (s.fase === 'controllo') { text = tr('Controllo…'); ok = true; }
  msg.hidden = !text; msg.textContent = text; msg.className = 'upd-msg' + (ok ? ' ok' : '');
  // pulsanti
  const manual = s.automatico === false || s.errore === 'nessun-file' || s.errore === 'cartella';
  const go = $('upd-go');
  go.hidden = !s.nuova || manual || !(s.fase === 'disponibile' || s.fase === 'errore');
  go.textContent = s.fase === 'errore' ? tr('Riprova') : tr('Aggiorna ora');
  $('upd-cancel').hidden = s.fase !== 'scarico';
  $('upd-page').hidden = !(s.nuova && manual);
  $('upd-back').disabled = s.fase === 'installo';
  // novità della versione nuova
  $('upd-notes-title').hidden = $('upd-notes').hidden = !s.note;
  if (s.note && this.updNotesFor !== s.nuova) { this.updNotesFor = s.nuova; $('upd-notes').innerHTML = updateNotesHtml(s.note); }
};

// impostazioni → Generale → Aggiornamenti
Game.prototype.renderUpdateOpt = function () {
  const on = !!window.campoUpdate;
  $('st-updlbl').hidden = $('st-updrow').hidden = !on;
  if (!on) return;
  const s = this.upd || { fase: 'nessuno', attuale: GAME_VERSION };
  const btn = $('st-upd'), info = $('st-updinfo');
  const available = s.nuova && (s.fase === 'disponibile' || s.fase === 'scarico' || s.fase === 'installo' || s.fase === 'errore');
  btn.disabled = s.fase === 'controllo' || s.fase === 'non-supportato';
  btn.textContent = available ? tr('Vedi l\'aggiornamento') : tr('Controlla ora');
  btn.onclick = () => {
    if (available) { this.showScreen('update'); return; }
    window.campoUpdate.controlla().then(r => {
      if (r && r.fase === 'disponibile') this.showScreen('update');
      else if (r && r.fase === 'errore') this.toast(tr(updateErrorText(r.errore)), true);
    }, () => {});
  };
  info.textContent = s.fase === 'controllo' ? tr('Controllo…')
    : s.fase === 'non-supportato' ? tr('Gli aggiornamenti automatici funzionano solo nell\'app installata.')
    : available ? trf('Versione {0} disponibile', s.nuova)
    : s.controllato ? trf('Hai l\'ultima versione ({0})', s.attuale)
    : trf('Versione installata: {0}', s.attuale || GAME_VERSION);
};
