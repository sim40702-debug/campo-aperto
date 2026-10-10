// ============================================================
// TELECRONACA A SCRITTE — frasi brevi durante la partita
// Nasce dagli eventi della partita ('ref' con il registro dell'arbitro, più 'save' e 'post'), che arrivano uguali in
// locale e ai client in rete: ognuno scrive la sua telecronaca, nessun messaggio in più sulla rete.
// Le frasi sono in italiano e passano da trf() (traduzioni in src/i18n/*.json, sezione "telecronaca").
// Voce: la sintesi vocale del computer (speechSynthesis) legge la frase nella lingua del gioco. Una frase più
// importante interrompe quella che si sta dicendo; una meno importante, mentre si parla, si salta.
// ============================================================
const COMMENTARY = {
  // più frasi per evento: se ne sceglie una a caso, così non si ripete sempre la stessa
  GOAL: ['GOOOL di {0}!', 'Rete di {0}!', '{0} la mette dentro!', 'Gol! Firma di {0}'],
  OWN_GOAL: ['Autogol di {0}!', 'Sfortunato {0}: autogol'],
  SAVE: ['Gran parata!', 'Il portiere ci arriva!', 'Che riflessi del portiere!'],
  POST: ['Palo! Che sfortuna', 'Colpisce il legno!', 'Sul palo!'],
  SHOT: ['Ci prova {0}…', 'Tiro di {0}…', '{0} calcia…'],
  MISS: ['Fuori di poco!', 'Alto sopra la traversa', 'Niente da fare, fuori'],
  FOUL: ['Fallo di {0}', 'L\'arbitro fischia: fallo di {0}'],
  YELLOW_CARD: ['Giallo per {0}', 'Ammonito {0}'],
  RED_CARD: ['Rosso! {0} va negli spogliatoi', 'Espulso {0}!'],
  PENALTY: ['Calcio di rigore', 'È rigore!'],
  OFFSIDE: ['Fuorigioco di {0}', 'Bandierina alzata: fuorigioco'],
  CORNER: ['Calcio d\'angolo per {0}', 'Corner per {0}'],
  ADVANTAGE: ['L\'arbitro lascia correre: vantaggio'],
  KICK_OFF: ['Si parte!', 'Calcio d\'inizio'],
  HALF_TIME: ['Fine del primo tempo'],
  FULL_TIME: ['Finisce qui!', 'Triplice fischio: fine partita'],
  SHOOTOUT: ['Si va ai calci di rigore!', 'Tutto si decide dal dischetto'],
  PEN_SCORED: ['{0} non sbaglia!', 'Rigore trasformato da {0}!'],
  PEN_MISSED: ['{0} sbaglia!', 'Niente da fare per {0}!'],
  SHOOTOUT_END: ['Finisce ai rigori!', 'La serie dei rigori è finita!'],
};
// importanza: una frase più importante sostituisce subito quella in corso, una meno importante aspetta
const COMMENTARY_RANK = { SHOOTOUT: 8, PEN_SCORED: 9, PEN_MISSED: 9, SHOOTOUT_END: 9, GOAL: 9, OWN_GOAL: 9, RED_CARD: 8, PENALTY: 8, FULL_TIME: 8, HALF_TIME: 7, YELLOW_CARD: 6, SAVE: 6, POST: 6,
  MISS: 5, KICK_OFF: 4, SHOT: 4, OFFSIDE: 3, FOUL: 3, ADVANTAGE: 3, CORNER: 2 };

class Commentary {
  constructor(el) {
    this.el = el;
    this.shown = null;       // { rank, until }
    this.lastShot = null;    // tiro in attesa: se nessuno para e non è gol, è finito fuori
    this.enabled = true;
    this.voice = false;      // leggere le frasi a voce
    this.volume = 1;         // volume della voce (0..1)
    this.speaking = null;    // { rank, until } della frase che si sta dicendo
  }
  reset() { this.shown = null; this.lastShot = null; this.lastPick = {}; if (this.el) this.el.hidden = true; this.stopVoice(); }

  // ---------- voce ----------
  canSpeak() { return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; }
  stopVoice() { if (this.canSpeak()) { try { window.speechSynthesis.cancel(); } catch (e) { /* niente */ } } this.speaking = null; }
  // una voce del computer nella lingua del gioco (se c'è), altrimenti quella predefinita
  pickVoice(locale) {
    const list = window.speechSynthesis.getVoices() || [];
    const lang = locale.slice(0, 2).toLowerCase();
    return list.find(v => v.lang && v.lang.replace('_', '-').toLowerCase() === locale.toLowerCase()) ||
      list.find(v => v.lang && v.lang.toLowerCase().startsWith(lang)) || null;
  }
  speak(text, rank, now) {
    if (!this.voice || !this.canSpeak() || this.volume <= 0) return;
    const synth = window.speechSynthesis;
    if (this.speaking && synth.speaking && now < this.speaking.until) {
      if (rank <= this.speaking.rank) return;   // si sta già dicendo qualcosa di importante: questa si salta
      synth.cancel();
    }
    try {
      const u = new SpeechSynthesisUtterance(text);
      const locale = uiLocale();
      u.lang = locale;
      const v = this.pickVoice(locale);
      if (v) u.voice = v;
      u.rate = rank >= 8 ? 1.15 : 1.08;
      u.pitch = rank >= 8 ? 1.15 : 1;
      u.volume = clamp(this.volume, 0, 1);
      synth.speak(u);
      this.speaking = { rank: rank, until: now + 0.6 + text.length * 0.065 };
    } catch (e) { this.speaking = null; }
  }
  pick(type) {
    const list = COMMENTARY[type];
    if (!list) return null;
    // mai la stessa frase due volte di fila per lo stesso evento
    this.lastPick = this.lastPick || {};
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.lastPick[type]) i = (i + 1) % list.length;
    this.lastPick[type] = i;
    return list[i];
  }
  say(type, name, now) {
    if (!this.enabled || !this.el) return;
    const rank = COMMENTARY_RANK[type] || 1;
    if (this.shown && now < this.shown.until && rank < this.shown.rank) return;
    const phrase = this.pick(type);
    if (!phrase) return;
    const text = trf(phrase, name || '');
    this.el.textContent = text;
    this.el.hidden = false;
    this.speak(text, rank, now);
    // riparte l'animazione di entrata
    this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in');
    this.shown = { rank: rank, until: now + (rank >= 8 ? 4 : 2.8) };
  }
  // evento della partita (formato di rete), now = secondi
  onEvent(e, match, now) {
    if (e.type === 'save') { this.lastShot = null; this.say('SAVE', '', now); return; }
    if (e.type === 'post') { this.lastShot = null; this.say('POST', '', now); return; }
    if (e.type !== 'ref' || !e.r) return;
    const r = e.r, who = r.player && r.player.name ? r.player.name : '';
    const teamName = r.team >= 0 && match && match.teams[r.team] ? match.teams[r.team].name : '';
    switch (r.type) {
      case 'GOAL': this.lastShot = null; this.say(r.reason === 'Autogol' ? 'OWN_GOAL' : 'GOAL', who || teamName, now); break;
      case 'SHOT': this.lastShot = { at: now }; this.say('SHOT', who, now); break;
      case 'SHOT_ON_TARGET': this.lastShot = null; break;
      case 'FOUL': this.say('FOUL', who, now); break;
      case 'YELLOW_CARD': this.say('YELLOW_CARD', who, now); break;
      case 'RED_CARD': this.say('RED_CARD', who, now); break;
      case 'PENALTY': this.say('PENALTY', '', now); break;
      case 'OFFSIDE': this.say('OFFSIDE', who, now); break;
      case 'CORNER': this.lastShot = null; this.say('CORNER', teamName, now); break;
      case 'ADVANTAGE': this.say('ADVANTAGE', '', now); break;
      case 'KICK_OFF': if (r.minute <= 1 || (r.half === 2 && r.minute <= 46)) this.say('KICK_OFF', '', now); break;
      case 'HALF_TIME': this.lastShot = null; this.say('HALF_TIME', '', now); break;
      case 'FULL_TIME':
        this.lastShot = null;
        // si va ai rigori (reason 'Rigori') o la serie è finita (reason 'Rigori 4-3')
        this.say(r.reason === 'Rigori' ? 'SHOOTOUT' : /^Rigori /.test(r.reason) ? 'SHOOTOUT_END' : 'FULL_TIME', '', now);
        break;
      case 'PENALTY_SCORED': this.say('PEN_SCORED', who, now); break;
      case 'PENALTY_MISSED': this.say('PEN_MISSED', who, now); break;
      case 'GOAL_KICK': if (this.lastShot) { this.lastShot = null; this.say('MISS', '', now); } break;
    }
  }
  // ogni fotogramma: nasconde la frase scaduta; un tiro senza seguito dopo 3 s è finito fuori
  update(now) {
    if (!this.el) return;
    if (this.lastShot && now - this.lastShot.at > 3) this.lastShot = null;
    if (this.shown && now >= this.shown.until) { this.el.hidden = true; this.shown = null; }
  }
}
