// ============================================================
// RESOCONTO DI FINE PARTITA — numeri dei giocatori, voto, migliore in campo
// I numeri vengono dal motore (p.stats: gol, tiri, passaggi, contrasti, parate, dribbling). Chi è uscito con un
// cambio resta nel conto (team.subbedStats). Online il client non simula: riceve i numeri dall'host (match.netPlayers).
// ============================================================

// tutti i giocatori che hanno giocato: { name, number, team, isGK, stats, cards }
function matchPlayers(m) {
  if (m.netPlayers) return m.netPlayers;
  const out = [];
  for (const t of m.teams) {
    for (const p of t.roster || t.players) {
      out.push({ name: p.data.name, number: p.data.number, team: t.index, isGK: p.data.role === 'GK', stats: p.stats, cards: p.cards || {} });
    }
    for (const s of t.subbedStats || []) {
      out.push({ name: s.data.name, number: s.data.number, team: t.index, isGK: s.data.role === 'GK', stats: s.stats, cards: s.cards || {} });
    }
  }
  return out;
}

// somme di squadra dai numeri dei giocatori
function teamTotals(m) {
  const tot = [{ saves: 0, tackles: 0, dribbles: 0 }, { saves: 0, tackles: 0, dribbles: 0 }];
  for (const p of matchPlayers(m)) {
    const t = tot[p.team];
    if (!t) continue;
    t.saves += p.stats.saves || 0; t.tackles += p.stats.tackles || 0; t.dribbles += p.stats.dribbles || 0;
  }
  return tot;
}

// voto da 4 a 10: si parte da 6, i gol e le parate pesano di più, i passaggi sbagliati e i cartellini tolgono
function playerRating(p, m) {
  const s = p.stats, own = m.teams[p.team], opp = m.teams[1 - p.team];
  let r = 6;
  r += (s.goals || 0) * 1.1 + (s.shots || 0) * 0.12 + (s.passesOk || 0) * 0.03 - Math.max(0, (s.passes || 0) - (s.passesOk || 0)) * 0.05;
  r += (s.tackles || 0) * 0.22 + (s.dribbles || 0) * 0.15 + (s.saves || 0) * 0.45;
  if (p.isGK) r -= opp.score * 0.3;
  r += own.score > opp.score ? 0.3 : own.score < opp.score ? -0.2 : 0;
  if (p.cards.yellow) r -= 0.3;
  if (p.cards.red) r -= 1.5;
  return Math.round(clamp(r, 4, 10) * 10) / 10;
}

// cosa ha fatto in breve: "Gol: 2 · Parate: 5 · Passaggi: 31/36"
function playerLine(p) {
  const s = p.stats, parts = [];
  if (s.goals) parts.push(trf('Gol: {0}', s.goals));
  if (s.saves) parts.push(trf('Parate: {0}', s.saves));
  if (s.tackles) parts.push(trf('Contrasti: {0}', s.tackles));
  if (s.dribbles) parts.push(trf('Dribbling: {0}', s.dribbles));
  if (s.passes) parts.push(trf('Passaggi: {0}/{1}', s.passesOk || 0, s.passes));
  return parts.join(' · ');
}

Game.prototype.renderMatchReport = function (m) {
  const list = matchPlayers(m).map(p => Object.assign({}, p, { rating: playerRating(p, m) }))
    // solo chi ha fatto qualcosa (chi è entrato all'ultimo minuto senza toccare palla non conta)
    .filter(p => (p.stats.passes || 0) + (p.stats.shots || 0) + (p.stats.tackles || 0) + (p.stats.saves || 0) + (p.stats.goals || 0) > 0)
    .sort((a, b) => b.rating - a.rating || (b.stats.goals || 0) - (a.stats.goals || 0));
  const mvp = list[0];
  const box = $('ft-mvp');
  box.hidden = !mvp;
  if (mvp) {
    box.innerHTML = '<span class="rt">' + mvp.rating.toLocaleString(uiLocale(), { minimumFractionDigits: 1 }) + '</span><small>' + esc(tr('Migliore in campo')) + '</small>' +
      '<b translate="no">' + esc(mvp.name) + '</b><p><span translate="no">' + esc(m.teams[mvp.team].data.short) + ' · ' + mvp.number + '</span> · ' + esc(playerLine(mvp)) + '</p>';
  }
  // i migliori tre di ogni squadra
  $('ft-top').innerHTML = m.teams.map(t => {
    const best = list.filter(p => p.team === t.index).slice(0, 3);
    if (!best.length) return '';
    return '<h4 translate="no">' + esc(t.data.short) + '</h4>' + best.map(p =>
      '<div><span><span translate="no">' + esc(p.name) + '</span><br><small>' + esc(playerLine(p)) + '</small></span><span class="rt">' +
      p.rating.toLocaleString(uiLocale(), { minimumFractionDigits: 1 }) + '</span></div>').join('');
  }).join('');
  this.renderHighlightsButton();   // azioni migliori (27_highlights.js)
};
