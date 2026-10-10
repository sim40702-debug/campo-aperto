// ============================================================
// CLASSIFICA ONLINE — punti e livelli dalle partite online tra persone (server: cloud/src/online.js)
// A fine partita online ognuno (con l'account) manda il risultato. Vale quando lo manda uguale anche qualcuno
// dell'altra squadra: vittoria 30 punti, pareggio 12, sconfitta 5. Contro l'IA non si prendono punti.
// Il livello viene dai punti (25 punti per il 2, 100 per il 3, 225 per il 4...).
// Qui: invio del risultato, la schermata della classifica e l'avviso degli inviti degli amici in tutti i menu.
// ============================================================
const RANK_RULES = 'Vittoria 30 punti, pareggio 12, sconfitta 5. Valgono le partite online contro altre persone con l\'account: il risultato conta quando lo manda uguale anche chi era nell\'altra squadra. Al massimo 15 partite con punti al giorno, 3 contro lo stesso avversario.';

// livello e avanzamento dai punti (stessa formula del server)
function rankLevel(points) {
  const level = Math.floor(Math.sqrt(Math.max(0, points) / 25)) + 1;
  const from = (level - 1) * (level - 1) * 25, to = level * level * 25;
  return { level: level, from: from, to: to, pct: Math.round((points - from) / (to - from) * 100) };
}

// risultato della partita online appena finita (una volta per partita); il testo va sotto al risultato
Game.prototype.reportOnlineResult = function (m) {
  const net = this.net, api = this.eco && this.eco.api, note = $('ft-online-note');
  note.hidden = true;
  if (!net || !net.link || !api || !api.configured() || !api.loggedIn()) return;
  const mid = net.host ? net.host.mid : net.client ? net.client.mid : null;
  const code = net.link.code;
  const h = m.humanById(this.renderer.localId);
  if (!mid || !code || !h) return;               // chi guarda soltanto non manda niente
  const key = code + ':' + mid;
  if (net.reportedKey === key) { note.hidden = !note.textContent; return; }
  net.reportedKey = key;
  const body = { match: key, side: h.team, score: [m.teams[0].score, m.teams[1].score] };
  const show = t => { note.textContent = t; note.hidden = !t; };
  const send = tries => api.post('/api/online/report', body).then(r => {
    if (this.net !== net) return;
    if (r.status === 'counted') show(trf('Classifica online: +{0} punti', r.points));
    else if (r.status === 'limit') show(tr('Classifica online: oggi questa partita non dà punti (limite del giorno)'));
    else if (r.status === 'mismatch') show(tr('Classifica online: i risultati mandati non coincidono, la partita non vale'));
    else {
      show(tr('Classifica online: aspetto il risultato di un avversario con l\'account…'));
      // l'avversario lo manda tra poco: si richiede ancora un paio di volte
      if (tries < 3) setTimeout(() => { if (this.net === net) send(tries + 1); }, 6000 * (tries + 1));
      else show(tr('Classifica online: nessun avversario con l\'account ha mandato il risultato, niente punti'));
    }
  }).catch(e => { if (e.status === 404) show(''); else show(tr('Classifica online: risultato non mandato') + ' (' + e.message + ')'); });
  send(0);
};

class OnlineRanking {
  constructor(game) {
    this.g = game; this.api = game.eco.api;
    this.board = null; this.me = null; this.err = '';
    $('rk-back').onclick = () => this.g.showScreen(this.back || 'menu');
    $('rk-refresh').onclick = () => this.load();
  }
  open(back) { this.back = back || 'menu'; this.g.showScreen('ranking'); this.render(); this.load(); }
  load() {
    if (!this.api.configured()) { this.err = tr('Per la classifica serve il server online: impostalo in Impostazioni → Online.'); this.render(); return; }
    const reqs = [this.api.get('/api/online/leaderboard'), this.api.loggedIn() ? this.api.get('/api/me/online').catch(() => null) : Promise.resolve(null)];
    Promise.all(reqs).then(([b, me]) => { this.board = b; this.me = me; this.err = ''; })
      .catch(e => { this.err = e.status === 404 ? tr('Il server non ha ancora la classifica: va aggiornato alla 0.15 (nella cartella cloud: npm run deploy).') : e.message; })
      .then(() => this.render());
  }
  render() {
    const box = $('rk-body');
    let h = '<p class="small">' + tr(RANK_RULES) + '</p>';
    if (this.err) { box.innerHTML = h + '<p class="status err">' + esc(this.err) + '</p>'; return; }
    if (!this.board) { box.innerHTML = h + '<p class="empty">' + tr('Caricamento…') + '</p>'; return; }
    const me = this.me;
    if (me) {
      const lv = rankLevel(me.points);
      h += '<div class="rk-me"><div class="pr-badge"><b>' + lv.level + '</b><span>' + tr('livello') + '</span></div><div>' +
        '<p><b translate="no">' + esc(me.username) + '</b> · ' + trf('{0} punti', me.points) + (me.rank ? ' · ' + trf('{0}º posto', me.rank) : '') + '</p>' +
        '<p class="small">' + trf('{0} partite: {1} vinte, {2} pari, {3} perse', me.played, me.won, me.drawn, me.lost) + ' · ' + trf('mancano {0} punti al livello {1}', lv.to - me.points, lv.level + 1) + '</p>' +
        '<div class="cc-prog big"><i style="width:' + lv.pct + '%"></i></div></div></div>';
    } else if (!this.api.loggedIn()) h += '<p class="small">' + tr('Accedi con l\'account per entrare in classifica.') + '</p>';
    const rows = this.board.top;
    if (!rows.length) { box.innerHTML = h + '<p class="empty">' + tr('Ancora nessuno in classifica: gioca una partita online contro un amico.') + '</p>'; return; }
    h += '<table class="rk-table"><tr><th>#</th><th>' + tr('Giocatore') + '</th><th>' + tr('Livello') + '</th><th>' + tr('Punti') + '</th><th>' + trf('PG') + '</th><th>' + trf('V') + '</th><th>' + trf('N') + '</th><th>' + trf('P') + '</th></tr>' +
      rows.map(r => '<tr' + (me && r.username === me.username ? ' class="mine"' : '') + '><td>' + r.rank + '</td><td translate="no">' + esc(r.username) + '</td><td><span class="lv">' + r.level + '</span></td><td><b>' + r.points + '</b></td>' +
        '<td>' + r.played + '</td><td>' + r.won + '</td><td>' + r.drawn + '</td><td>' + r.lost + '</td></tr>').join('') + '</table>';
    if (this.board.total > rows.length) h += '<p class="small">' + trf('{0} giocatori in classifica, qui i primi {1}.', this.board.total, rows.length) + '</p>';
    box.innerHTML = h;
  }
}
