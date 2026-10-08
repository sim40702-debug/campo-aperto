// ============================================================
// CAMBI NEL MENU DI PAUSA — scegli chi esce e chi entra (src/08_match_subs.js fa il cambio alla prossima palla ferma)
// Solo nelle partite sul tuo computer (partita rapida e competizioni contro l'IA).
// ============================================================
Game.prototype.renderPauseSubs = function () {
  const m = this.match, box = $('pause-subs');
  const h = m && m.humanById(this.renderer.localId);
  if (!m || !h || this.mode !== 'offline' || !m.subsOn) { box.hidden = true; return; }
  box.hidden = false;
  const team = m.teams[h.team];
  const sel = this.subSel = this.subSel || { out: null, bench: null };
  if (sel.out && (!team.players.includes(sel.out) || sel.out.sentOff)) sel.out = null;
  if (sel.bench && !team.bench.includes(sel.bench)) sel.bench = null;
  const pending = team.pendingSubs || [];
  const left = m.subsLeft(team);
  $('ps-left').textContent = trf('{0} cambi rimasti', left);
  const roleShort = r => trf({ GK: 'POR', DF: 'DIF', MF: 'CEN', FW: 'ATT' }[r] || r);
  const energy = p => Math.round(Math.min(p.energy, p.energyCap === undefined ? 100 : p.energyCap));
  const row = (attrs, on, num, name, role, extra) => '<button class="ps-row' + (on ? ' on' : '') + '" ' + attrs + '><b>' + num + '</b><span translate="no">' + esc(name) + '</span><small>' + esc(role) + '</small>' + (extra || '') + '</button>';
  $('ps-out').innerHTML = team.players.filter(p => !p.sentOff).map((p, i) => {
    const e = energy(p), busy = pending.some(s => s.out === p);
    return row('data-ps-out="' + team.players.indexOf(p) + '"' + (busy ? ' disabled' : ''), sel.out === p, p.data.number, p.data.name, roleShort(p.slot.role),
      '<i class="ps-bar"><i style="width:' + e + '%;background:' + (e < 50 ? 'var(--red, #e2412e)' : e < 75 ? 'var(--flood)' : '#4cc36b') + '"></i></i>');
  }).join('');
  $('ps-in').innerHTML = team.bench.length ? team.bench.map((d, i) => {
    const busy = pending.some(s => s.bench === d);
    return row('data-ps-in="' + i + '"' + (busy ? ' disabled' : ''), sel.bench === d, d.number, d.name, roleShort(d.role), '<small>' + d.overall + '</small>');
  }).join('') : '<p class="small">' + tr('Panchina vuota') + '</p>';
  $('ps-pending').innerHTML = pending.map((s, i) => '<span class="ps-pend"><span translate="no">' + esc(s.bench.name) + ' ↔ ' + esc(s.out.data.name) + '</span> <button class="ghost" data-ps-cancel="' + i + '">' + tr('Annulla') + '</button></span>').join('');
  let note = '';
  if (sel.out && sel.bench && sel.out.isGK !== (sel.bench.role === 'GK')) note = tr('Un portiere si cambia solo con un portiere');
  else if (pending.length) note = tr('Il cambio avviene alla prossima palla ferma.');
  $('ps-note').textContent = note;
  $('ps-do').disabled = !(sel.out && sel.bench && left > 0 && sel.out.isGK === (sel.bench.role === 'GK'));
  box.querySelectorAll('[data-ps-out]').forEach(b => b.onclick = () => { const p = team.players[Number(b.dataset.psOut)]; sel.out = sel.out === p ? null : p; this.renderPauseSubs(); });
  box.querySelectorAll('[data-ps-in]').forEach(b => b.onclick = () => { const d = team.bench[Number(b.dataset.psIn)]; sel.bench = sel.bench === d ? null : d; this.renderPauseSubs(); });
  box.querySelectorAll('[data-ps-cancel]').forEach(b => b.onclick = () => { const s = pending[Number(b.dataset.psCancel)]; if (s) m.cancelSub(team, s.out); this.renderPauseSubs(); });
  $('ps-do').onclick = () => {
    if (m.requestSub(team, sel.out, team.bench.indexOf(sel.bench))) { this.subSel = { out: null, bench: null }; this.renderPauseSubs(); }
  };
};
