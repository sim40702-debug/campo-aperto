// ============================================================
// EDITOR DI SQUADRE — le tue squadre (nome, sigla, colori, forza, formazione, giocatori)
// Si salvano su questo computer (localStorage) e si usano nella partita rapida contro l'IA.
// Non vanno online né nelle competizioni: lì tutti devono avere le stesse squadre del database.
// Una squadra salvata è una "ricetta": dal seme e dalla forza si rigenerano sempre gli stessi attributi,
// poi si applicano i nomi, i numeri, le caratteristiche e il piede scelti nell'editor.
// ============================================================
const MY_TEAMS_KEY = 'campoAperto.myteams.v1';
const MY_TEAMS_MAX = 8;
const PLAYERS_PER_TEAM = 18;   // 11 titolari + 7 in panchina, come le squadre del database

function cleanText(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function cleanColor(v, d) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d; }

// ricetta controllata: tutto quello che arriva dal localStorage passa da qui
function cleanTeamDef(d) {
  if (!d || typeof d !== 'object') return null;
  const name = cleanText(d.name, TEAM_NAME_MAX);
  if (!name) return null;
  const kit = (k, def) => [0, 1, 2].map(i => cleanColor(Array.isArray(k) ? k[i] : null, def[i]));
  const out = {
    id: typeof d.id === 'string' && /^[a-z0-9]{4,16}$/.test(d.id) ? d.id : newTeamId(),
    seed: Number.isInteger(d.seed) && d.seed > 0 && d.seed < 1e9 ? d.seed : Math.floor(Math.random() * 1e8) + 1,
    name: name,
    short: (cleanText(d.short, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || teamShortOf(name)).padEnd(3, 'X').slice(0, 3),
    rating: Math.round(clamp(Number(d.rating) || 72, 50, 92)),
    formation: FORMATIONS[d.formation] ? d.formation : '4-4-2',
    coach: cleanText(d.coach, 24) || 'Allenatore',
    home: kit(d.home, ['#c8202f', '#ffffff', '#c8202f']),
    away: kit(d.away, ['#ffffff', '#c8202f', '#ffffff']),
    players: [],
  };
  const ps = Array.isArray(d.players) ? d.players.slice(0, PLAYERS_PER_TEAM) : [];
  for (const p of ps) {
    out.players.push({
      name: cleanText(p && p.name, 24),
      number: Number.isInteger(p && p.number) && p.number >= 1 && p.number <= 99 ? p.number : 0,
      ability: p && SPECIAL_ABILITIES[p.ability] ? p.ability : null,
      foot: p && p.foot === 'Sinistro' ? 'Sinistro' : 'Destro',
    });
  }
  return out;
}
function newTeamId() { return Math.random().toString(36).slice(2, 10).padEnd(6, '0'); }

function loadMyTeams() {
  try {
    const raw = JSON.parse(localStorage.getItem(MY_TEAMS_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(cleanTeamDef).filter(Boolean).slice(0, MY_TEAMS_MAX) : [];
  } catch (e) { return []; }
}
function saveMyTeams(list) {
  try { localStorage.setItem(MY_TEAMS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}

// dalla ricetta alla squadra vera (stessa forma di quelle del database)
function buildCustomTeam(def) {
  const saved = rand;           // il generatore del gioco non deve cambiare
  setSeed(def.seed);
  const t = generateTeam({ name: def.name, short: def.short, rating: def.rating, home: def.home, away: def.away }, def.formation);
  rand = saved;
  t.coach = def.coach;
  t.custom = def.id;
  t.players.forEach((p, i) => {
    const o = def.players[i];
    if (!o) return;
    if (o.name) p.name = o.name;
    if (o.number) p.number = o.number;
    p.ability = o.ability;
    p.foot = o.foot;
  });
  return t;
}

// una ricetta nuova: giocatori generati, così l'editor parte con una squadra già completa
function newTeamDef() {
  const def = cleanTeamDef({ name: 'Ticino FC', short: 'TIC', rating: 74, coach: 'Simone', home: ['#c8202f', '#1e56c8', '#c8202f'], away: ['#ffffff', '#c8202f', '#ffffff'] });
  const t = buildCustomTeam(def);
  def.players = t.players.map(p => ({ name: p.name, number: p.number, ability: p.ability, foot: p.foot }));
  return def;
}

const ROLE_NAMES = { GK: 'Portiere', DF: 'Difensore', MF: 'Centrocampista', FW: 'Attaccante' };

class TeamEditor {
  constructor(game) {
    this.g = game;
    this.list = loadMyTeams();
    this.edit = null;        // ricetta in modifica (copia)
    this.back = 'setup';
  }
  teams() { return this.list.map(buildCustomTeam); }

  open(back) {
    this.back = back || 'setup';
    this.edit = null;
    this.g.showScreen('teams');
    this.render();
  }
  close() {
    this.edit = null;
    this.g.refreshMyTeams();
    this.g.showScreen(this.back);
  }
  status(text, err) { const s = $('te-status'); s.className = 'status' + (err ? ' err' : ' ok'); s.textContent = text; }

  render() {
    const listEl = $('te-list'), form = $('te-form');
    $('te-status').textContent = '';
    if (!this.edit) {
      form.hidden = true; listEl.hidden = false;
      listEl.innerHTML = (this.list.length ? this.list.map((d, i) =>
        '<div class="te-card"><span class="kit">' + d.home.map(c => '<span style="background:' + c + '"></span>').join('') + '</span>' +
        '<b translate="no">' + esc(d.name) + '</b><span class="small">' + esc(d.short) + ' · ' + trf('Forza {0}', d.rating) + ' · ' + d.formation + '</span>' +
        '<button class="ghost" data-te-edit="' + i + '">' + tr('Modifica') + '</button></div>').join('')
        : '<p class="small">' + tr('Non hai ancora squadre tue: creane una, poi la trovi nella partita rapida tra le altre squadre.') + '</p>') +
        '<div class="actions"><button class="primary" id="te-new"' + (this.list.length >= MY_TEAMS_MAX ? ' disabled' : '') + '>' + tr('Nuova squadra') + '</button>' +
        '<button class="ghost" id="te-back">' + tr('Indietro') + '</button></div>' +
        (this.list.length >= MY_TEAMS_MAX ? '<p class="small">' + trf('Al massimo {0} squadre: eliminane una per crearne un\'altra.', MY_TEAMS_MAX) + '</p>' : '');
      listEl.querySelectorAll('[data-te-edit]').forEach(b => b.onclick = () => { this.edit = JSON.parse(JSON.stringify(this.list[Number(b.dataset.teEdit)])); this.editIndex = Number(b.dataset.teEdit); this.render(); });
      $('te-new').onclick = () => { if (this.list.length >= MY_TEAMS_MAX) return; this.edit = newTeamDef(); this.editIndex = -1; this.render(); };
      $('te-back').onclick = () => this.close();
      return;
    }
    listEl.hidden = true; form.hidden = false;
    const d = this.edit;
    $('te-name').value = d.name; $('te-short').value = d.short; $('te-coach').value = d.coach;
    $('te-rating').value = d.rating; $('te-rating-out').textContent = d.rating;
    ['home', 'away'].forEach(k => d[k].forEach((c, i) => { $('te-' + k + i).value = c; }));
    this.g.segmented('te-form-opt', Object.keys(FORMATIONS).map(f => ({ label: f, value: f })), d.formation, v => { this.readForm(); d.formation = v; this.render(); });
    this.renderPlayers();
    $('te-delete').hidden = this.editIndex < 0;
    this.drawPreview();
  }
  renderPlayers() {
    const d = this.edit, t = buildCustomTeam(d);
    const abil = ['<option value="">—</option>'].concat(Object.keys(SPECIAL_ABILITIES).map(a => '<option value="' + esc(a) + '">' + esc(tr(a)) + '</option>'));
    $('te-players').innerHTML = t.players.map((p, i) => {
      const o = d.players[i] || {};
      return (i === 11 ? '<div class="te-bench">' + tr('Panchina') + '</div>' : '') +
        '<div class="te-row"><input type="number" min="1" max="99" class="te-num" data-i="' + i + '" value="' + (o.number || p.number) + '" aria-label="' + esc(tr('Numero')) + '">' +
        '<input type="text" maxlength="24" class="te-pname" data-i="' + i + '" value="' + esc(o.name || p.name) + '" spellcheck="false" aria-label="' + esc(tr('Nome')) + '">' +
        '<span class="small te-role">' + esc(p.pos) + ' · ' + esc(tr(ROLE_NAMES[p.role])) + ' · ' + p.overall + '</span>' +
        '<select class="te-abil" data-i="' + i + '" aria-label="' + esc(tr('Caratteristica')) + '">' + abil.join('').replace('value="' + esc(o.ability || '') + '"', 'value="' + esc(o.ability || '') + '" selected') + '</select>' +
        '<select class="te-foot" data-i="' + i + '" aria-label="' + esc(tr('Piede')) + '"><option value="Destro">' + tr('Destro') + '</option><option value="Sinistro"' + (o.foot === 'Sinistro' ? ' selected' : '') + '>' + tr('Sinistro') + '</option></select></div>';
    }).join('');
  }
  // legge i campi nella ricetta in modifica
  readForm() {
    const d = this.edit;
    d.name = $('te-name').value; d.short = $('te-short').value; d.coach = $('te-coach').value;
    d.rating = Number($('te-rating').value);
    ['home', 'away'].forEach(k => { d[k] = [0, 1, 2].map(i => $('te-' + k + i).value); });
    const ps = d.players;
    document.querySelectorAll('#te-players .te-row').forEach((row, i) => {
      ps[i] = ps[i] || {};
      ps[i].number = Math.round(Number(row.querySelector('.te-num').value)) || 0;
      ps[i].name = row.querySelector('.te-pname').value;
      ps[i].ability = row.querySelector('.te-abil').value || null;
      ps[i].foot = row.querySelector('.te-foot').value;
    });
  }
  // problemi che impediscono di salvare (il resto si sistema da solo)
  problems() {
    const d = this.edit;
    if (!cleanText(d.name, TEAM_NAME_MAX)) return tr('Scrivi il nome della squadra');
    const nums = d.players.map(p => p.number);
    if (nums.some(n => !(n >= 1 && n <= 99))) return tr('I numeri di maglia vanno da 1 a 99');
    const dup = nums.find((n, i) => nums.indexOf(n) !== i);
    if (dup) return trf('Il numero {0} è usato due volte', dup);
    if (d.players.some(p => !cleanText(p.name, 24))) return tr('Ogni giocatore ha bisogno di un nome');
    return null;
  }
  save() {
    this.readForm();
    const bad = this.problems();
    if (bad) { this.status(bad, true); return; }
    const def = cleanTeamDef(this.edit);
    if (this.editIndex >= 0) this.list[this.editIndex] = def; else { this.list.push(def); this.editIndex = this.list.length - 1; }
    if (!saveMyTeams(this.list)) { this.status(tr('Non riesco a salvare su questo computer'), true); return; }
    this.edit = JSON.parse(JSON.stringify(def));
    this.render();
    this.status(trf('{0} salvata: la trovi nella partita rapida', def.name));
  }
  remove() {
    if (this.editIndex < 0) return;
    this.list.splice(this.editIndex, 1);
    saveMyTeams(this.list);
    this.edit = null;
    this.render();
  }
  // nomi nuovi a caso per tutta la rosa
  randomNames() {
    this.readForm();
    this.edit.players.forEach(p => { p.name = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)] + ' ' + LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; });
    this.renderPlayers();
  }
  // piccola anteprima delle due divise
  drawPreview() {
    const cv = $('te-preview'), g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    ['home', 'away'].forEach((k, i) => {
      const c = this.edit[k], x = 20 + i * 110;
      g.fillStyle = c[0]; g.beginPath();
      g.moveTo(x + 20, 10); g.lineTo(x + 60, 10); g.lineTo(x + 80, 26); g.lineTo(x + 70, 40); g.lineTo(x + 62, 34); g.lineTo(x + 62, 80);
      g.lineTo(x + 18, 80); g.lineTo(x + 18, 34); g.lineTo(x + 10, 40); g.lineTo(x, 26); g.closePath(); g.fill();
      g.fillStyle = c[1]; g.fillRect(x + 18, 80, 44, 22);
      g.fillStyle = c[2]; g.fillRect(x + 20, 102, 14, 18); g.fillRect(x + 46, 102, 14, 18);
      // numero del colore più diverso dalla maglia
      const lum = h => { const v = parseInt(h.slice(1), 16); return ((v >> 16) * 299 + ((v >> 8) & 255) * 587 + (v & 255) * 114) / 1000; };
      g.fillStyle = Math.abs(lum(c[1]) - lum(c[0])) > 60 ? c[1] : (lum(c[0]) > 128 ? '#111111' : '#ffffff');
      g.font = '800 26px "Saira Condensed", Arial, sans-serif'; g.textAlign = 'center';
      const n = (this.edit.players[9] && this.edit.players[9].number) || 9;
      g.fillText(String(n), x + 40, 62);
    });
  }
  bind() {
    $('te-save').onclick = () => this.save();
    $('te-cancel').onclick = () => { this.edit = null; this.render(); };
    $('te-delete').onclick = () => this.g.confirmClick($('te-delete'), tr('Sicuro? Elimina'), () => this.remove());
    $('te-random').onclick = () => this.randomNames();
    $('te-rating').oninput = () => { $('te-rating-out').textContent = $('te-rating').value; };
    $('te-rating').onchange = () => { this.readForm(); this.renderPlayers(); };
    $('te-name').oninput = () => { if (!$('te-short').dataset.touched) $('te-short').value = teamShortOf(cleanText($('te-name').value, TEAM_NAME_MAX) || 'XXX'); };
    $('te-short').oninput = () => { $('te-short').dataset.touched = '1'; };
    ['home', 'away'].forEach(k => [0, 1, 2].forEach(i => { $('te-' + k + i).oninput = () => { this.readForm(); this.drawPreview(); }; }));
  }
}
