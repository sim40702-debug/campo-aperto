// ============================================================
// TROFEI — obiettivi da sbloccare giocando (Home → Trofei)
// Si sbloccano da soli: gol, vittorie, partite speciali (rimonta, goleada, porta inviolata, rigori), competizioni,
// carriere, allenamento, tutorial, partite online. Quando se ne sblocca uno compare un avviso in alto.
// Stanno su questo computer (localStorage), come le carriere; non danno monete (quelle le decide solo il server).
// ============================================================
const TROPHY_KEY = 'campoAperto.trophies.v1';
// count: contatore e numero da raggiungere (per la barra di avanzamento)
const TROPHIES = [
  { id: 'tutorial', name: 'Primi passi', text: 'Finisci il tutorial' },
  { id: 'first_goal', name: 'Primo gol', text: 'Segna un gol in una partita', count: ['goals', 1] },
  { id: 'goals_25', name: 'Bomber', text: 'Segna 25 gol', count: ['goals', 25] },
  { id: 'goals_100', name: 'Leggenda del gol', text: 'Segna 100 gol', count: ['goals', 100] },
  { id: 'first_win', name: 'Prima vittoria', text: 'Vinci una partita', count: ['wins', 1] },
  { id: 'wins_10', name: 'Dieci vittorie', text: 'Vinci 10 partite', count: ['wins', 10] },
  { id: 'wins_50', name: 'Cinquanta vittorie', text: 'Vinci 50 partite', count: ['wins', 50] },
  { id: 'clean_sheet', name: 'Porta inviolata', text: 'Vinci senza subire gol' },
  { id: 'thrash', name: 'Goleada', text: 'Vinci con almeno 4 gol di scarto' },
  { id: 'comeback', name: 'Rimonta', text: 'Vinci una partita in cui eri sotto di due gol' },
  { id: 'pens', name: 'Dal dischetto', text: 'Vinci ai calci di rigore' },
  { id: 'hard', name: 'Contro i migliori', text: 'Vinci con la difficoltà Difficile' },
  { id: 'fair', name: 'Fair play', text: 'Vinci senza prendere cartellini' },
  { id: 'long_shot', name: 'Da fuori area', text: 'Segna da più di 20 metri' },
  { id: 'posts_10', name: 'Che sfortuna', text: 'Colpisci 10 pali o traverse', count: ['posts', 10] },
  { id: 'champion', name: 'Campione', text: 'Vinci un campionato, un torneo o una coppa' },
  { id: 'training_all', name: 'Allenamento completo', text: 'Supera tutti gli esercizi dell\'allenamento' },
  { id: 'manager_title', name: 'Allenatore vincente', text: 'Vinci il campionato nella carriera da allenatore' },
  { id: 'pro_lv10', name: 'Fuoriclasse', text: 'Arriva al livello 10 nella carriera da giocatore' },
  { id: 'pro_goals_20', name: 'Il tuo bomber', text: 'Segna 20 gol con il tuo calciatore', count: ['proGoals', 20] },
  { id: 'online_win', name: 'Vittoria online', text: 'Vinci una partita online' },
  { id: 'quick_match', name: 'Avversario trovato', text: 'Gioca una partita veloce online con «Cerca avversario»' },
  { id: 'online_10', name: 'Giocatore online', text: 'Gioca 10 partite online', count: ['online', 10] },
];

class Trophies {
  constructor(game) {
    this.g = game;
    this.data = this.load();
    this.queue = []; this.showing = false;
    this.cur = null;   // partita in corso: { team, minDiff }
  }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(TROPHY_KEY) || 'null');
      if (d && typeof d === 'object' && d.unlocked && typeof d.unlocked === 'object') {
        d.counters = d.counters && typeof d.counters === 'object' ? d.counters : {};
        return d;
      }
    } catch (e) { /* dati rovinati: si riparte */ }
    return { v: 1, unlocked: {}, counters: {} };
  }
  save() { try { localStorage.setItem(TROPHY_KEY, JSON.stringify(this.data)); } catch (e) { /* niente spazio */ } }
  has(id) { return !!this.data.unlocked[id]; }
  count(k) { return Number(this.data.counters[k]) || 0; }
  total() { return TROPHIES.length; }
  done() { return TROPHIES.filter(t => this.has(t.id)).length; }

  unlock(id) {
    const t = TROPHIES.find(x => x.id === id);
    if (!t || this.has(id)) return false;
    this.data.unlocked[id] = Date.now();
    this.save();
    this.queue.push(t);
    this.showNext();
    return true;
  }
  add(k, n) {
    this.data.counters[k] = this.count(k) + (n === undefined ? 1 : n);
    this.save();
    this.checkCounters();
  }
  setMax(k, v) { if (v > this.count(k)) { this.data.counters[k] = v; this.save(); this.checkCounters(); } }
  checkCounters() { for (const t of TROPHIES) if (t.count && this.count(t.count[0]) >= t.count[1]) this.unlock(t.id); }

  // avviso in alto: uno alla volta
  showNext() {
    if (this.showing || !this.queue.length) return;
    const t = this.queue.shift();
    this.showing = true;
    const el = $('trophy-pop');
    $('trophy-name').textContent = tr(t.name);
    el.hidden = false;
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    setTimeout(() => { el.hidden = true; this.showing = false; this.showNext(); }, 3600);
  }

  // ---- durante la partita ----
  startMatch(m, localId) {
    const h = m && m.humanById && m.humanById(localId);
    this.cur = h && !m.training ? { team: h.team, minDiff: 0, m: m } : null;
  }
  onEvent(e, m) {
    const c = this.cur;
    if (!c || c.m !== m) return;
    if (e.type === 'goal') {
      const mine = m.teams[c.team], diff = mine.score - mine.opponent().score;
      c.minDiff = Math.min(c.minDiff, diff);
      // gol da lontano: chi ha tirato era a più di 20 metri dalla porta (si sa solo sul computer che simula)
      const k = m.lastKick;
      if (e.team === c.team && k && k.kind === 'shot' && k.player && k.player.team === mine && !m.so) {
        const d = Math.hypot(k.player.x - mine.oppGoalX(), k.player.z);
        if (d > 21) this.unlock('long_shot');
      }
    }
    if (e.type === 'post') {
      const k = m.lastKick;
      if (!k || (k.player && k.player.team.index === c.team)) this.add('posts');
    }
  }
  // fine partita (una volta sola): vittorie, gol e partite speciali
  endMatch(m, online) {
    const c = this.cur;
    if (!c || c.m !== m || c.ended) return;
    c.ended = true;
    const mine = m.teams[c.team], opp = mine.opponent();
    const pens = m.so && m.so.phase === 'done';
    const win = pens ? m.decided === c.team : mine.score > opp.score;
    if (mine.score > 0) this.add('goals', mine.score);
    if (online) { this.add('online'); if (win) this.unlock('online_win'); }
    if (!win) return;
    this.add('wins');
    if (opp.score === 0) this.unlock('clean_sheet');
    if (mine.score - opp.score >= 4) this.unlock('thrash');
    if (c.minDiff <= -2) this.unlock('comeback');
    if (pens) this.unlock('pens');
    if (m.difficulty === 2 && !online) this.unlock('hard');
    if (!(mine.stats.yellow || 0) && !(mine.stats.red || 0)) this.unlock('fair');
  }
  // competizione finita: hai vinto tu?
  checkComp(c) {
    if (!c || c.status !== 'finished' || c.champion !== c.config.userTeam || c.config.userTeam < 0) return;
    this.unlock('champion');
    if (c.manager) this.unlock('manager_title');
  }
  // controlli che si possono fare sempre (all'avvio e dopo carriere e allenamento)
  checkAll() {
    if (tutorialDone()) this.unlock('tutorial');
    const rec = loadTrainingRecords();
    if (DRILLS.every(d => Number.isFinite(rec[d.id]) && rec[d.id] >= d.target)) this.unlock('training_all');
    const pro = this.g.pro && this.g.pro.data;
    if (pro) { if (pro.level >= 10) this.unlock('pro_lv10'); this.setMax('proGoals', pro.total.goals); }
    const mg = this.g.manager && this.g.manager.data;
    if (mg && mg.history.some(h => h.champion === mg.team)) this.unlock('manager_title');
  }

  // ---- schermata ----
  open() { this.g.showScreen('trophies'); this.render(); }
  render() {
    $('tp-count').textContent = trf('{0} di {1}', this.done(), this.total());
    $('tp-list').innerHTML = TROPHIES.map(t => {
      const got = this.has(t.id);
      let prog = '';
      if (!got && t.count) {
        const n = Math.min(this.count(t.count[0]), t.count[1]);
        prog = '<div class="bar"><div style="width:' + Math.round(n / t.count[1] * 100) + '%"></div></div><small>' + n + ' / ' + t.count[1] + '</small>';
      }
      const when = got ? '<small>' + esc(new Date(this.data.unlocked[t.id]).toLocaleDateString(uiLocale())) + '</small>' : '';
      return '<div class="tp-card' + (got ? ' got' : '') + '"><span class="tp-ico" aria-hidden="true">' + (got ? '🏆' : '🔒') + '</span><div><b>' + esc(tr(t.name)) + '</b>' +
        '<p>' + esc(tr(t.text)) + '</p>' + when + prog + '</div></div>';
    }).join('');
  }
}
