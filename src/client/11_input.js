// ============================================================
// INPUT — tastiera, mouse e controller (gamepad), tutto rimappabile
// Ogni azione ha due tasti della tastiera (principale e alternativo) e un pulsante del controller.
// Si usa e.code (posizione fisica del tasto): WASD funziona anche con tastiere non QWERTY.
// Il controller si legge con la Gamepad API (mappatura "standard": Xbox, PlayStation, Switch Pro...).
// ============================================================
const ACTIONS = [
  { id: 'up', label: 'Su' }, { id: 'down', label: 'Giù' }, { id: 'left', label: 'Sinistra' }, { id: 'right', label: 'Destra' },
  { id: 'sprint', label: 'Scatto' }, { id: 'pass', label: 'Passaggio / contrasto' }, { id: 'long', label: 'Lancio / cross' },
  { id: 'through', label: 'Filtrante' }, { id: 'shoot', label: 'Tiro (tieni premuto) / scivolata' }, { id: 'switch', label: 'Cambio giocatore' },
  { id: 'press', label: 'Pressing (tieni premuto)' }, { id: 'dribble', label: 'Finta / dribbling' },
  { id: 'pause', label: 'Pausa' }, { id: 'camera', label: 'Telecamera' }, { id: 'mute', label: 'Audio sì/no' },
  { id: 'help', label: 'Schermata comandi' },
];
const DEFAULT_KEYS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], pass: ['KeyJ', null], long: ['KeyL', null], through: ['KeyI', null],
  shoot: ['KeyK', null], switch: ['KeyQ', 'Tab'], press: ['KeyE', null], dribble: ['KeyU', null], pause: ['Escape', 'KeyP'], camera: ['KeyC', null], mute: ['KeyM', null],
  help: ['F1', 'KeyH'],
};
// pulsanti del controller (numeri della mappatura standard):
// 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View/Select, 9 Menu/Start, 10 L3, 11 R3, 12-15 croce direzionale
const DEFAULT_PAD = {
  up: 12, down: 13, left: 14, right: 15,
  sprint: 7, pass: 0, long: 2, through: 3, shoot: 1, switch: 4, press: 5, dribble: 10,
  pause: 9, camera: 8, mute: null, help: null,
};
const PAD_NAMES = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'Croce ↑', 'Croce ↓', 'Croce ←', 'Croce →', 'Guide'],
  ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'Croce ↑', 'Croce ↓', 'Croce ←', 'Croce →', 'PS'],
};
// azioni di gioco: con queste, nei campi di testo e nei menu la tastiera resta libera
const GAME_ACTIONS = ['up', 'down', 'left', 'right', 'sprint', 'pass', 'long', 'through', 'shoot', 'switch', 'press', 'dribble'];

// nome leggibile di un tasto
function keyName(code) {
  if (!code) return '—';
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'Shift dx',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl dx', AltLeft: 'Alt', AltRight: 'Alt Gr', Space: 'Spazio', Escape: 'Esc', Enter: 'Invio',
    Tab: 'Tab', Backspace: '⌫', MetaLeft: 'Cmd', MetaRight: 'Cmd dx', Mouse0: 'Clic sx', Mouse2: 'Clic dx', Mouse1: 'Clic centrale' };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
// nome leggibile di un pulsante del controller
function padName(btn, layout) {
  if (btn === null || btn === undefined || btn < 0) return '—';
  const names = PAD_NAMES[layout] || PAD_NAMES.xbox;
  return names[btn] || ('Pulsante ' + btn);
}

// zona morta radiale: sotto "dz" lo stick è fermo, sopra il valore riparte da 0 (niente scatti)
function applyDeadzone(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

class Input {
  constructor(keys, padKeys) {
    this.down = {};            // tasti tenuti premuti (per codice)
    this.justPressed = {};     // tasti premuti in questo fotogramma
    this.keys = {};
    this.pad = {};             // azione -> pulsante del controller
    this.setKeys(keys || DEFAULT_KEYS);
    this.setPadKeys(padKeys || DEFAULT_PAD);
    this.mouseEnabled = true;
    this.capture = null;       // rimappatura tastiera in corso: funzione che riceve il prossimo tasto
    this.padCapture = null;    // rimappatura controller in corso
    this.gameKeysActive = false; // in partita i tasti di gioco non fanno scorrere la pagina
    this.onAction = null;      // feedback visivo (HUD)
    this.onUiKey = null;       // tasti dei menu (frecce, Esc) quando non si gioca
    this.onDevice = null;      // cambio di dispositivo (tastiera <-> controller)
    this.onPadConnect = null;  // controller collegato o scollegato
    // controller
    this.padEnabled = true;
    this.deadzone = 0.22;
    this.padIndex = -1;        // controller usato per ultimo
    this.padId = '';
    this.padRaw = [];          // stato dei pulsanti alla lettura precedente
    this.padDown = [];         // pulsanti premuti (dopo il blocco)
    this.padJust = [];         // pulsanti premuti in questo fotogramma
    this.padBlock = new Set(); // pulsanti da ignorare finché non vengono rilasciati
    this.stick = [0, 0]; this.rstick = [0, 0];
    this.rFlickArmed = true;   // levetta destra: un "colpetto" per volta
    this.flick = null;
    this.navHold = { dir: null, t: 0 }; // ripetizione della navigazione nei menu
    this.lastDevice = 'kb';
    window.addEventListener('keydown', e => this.onKeyDown(e));
    window.addEventListener('keyup', e => { this.down[e.code] = false; });
    // finestra non più attiva: nessun tasto deve restare "bloccato"
    window.addEventListener('blur', () => this.lostFocus());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.lostFocus(); });
    window.addEventListener('mousedown', e => this.onMouse(e, true));
    window.addEventListener('mouseup', e => this.onMouse(e, false));
    // in partita il clic destro è il tiro: niente menu contestuale del browser
    window.addEventListener('contextmenu', e => { if (this.gameKeysActive) e.preventDefault(); });
    window.addEventListener('gamepadconnected', e => { if (this.onPadConnect) this.onPadConnect(true, e.gamepad); });
    window.addEventListener('gamepaddisconnected', e => {
      if (e.gamepad.index === this.padIndex) { this.padIndex = -1; this.padRaw = []; this.padDown = []; this.stick = [0, 0]; this.rstick = [0, 0]; }
      if (this.onPadConnect) this.onPadConnect(false, e.gamepad);
    });
  }

  setKeys(keys) {
    this.keys = {};
    for (const a of ACTIONS) this.keys[a.id] = (keys[a.id] || DEFAULT_KEYS[a.id]).slice(0, 2);
    // tasto -> azioni (per trovare in fretta cosa fa un tasto)
    this.codeToAction = {};
    for (const a in this.keys) for (const c of this.keys[a]) if (c) this.codeToAction[c] = a;
  }
  setPadKeys(pad) {
    this.pad = {};
    for (const a of ACTIONS) {
      const v = pad[a.id];
      this.pad[a.id] = typeof v === 'number' && v >= 0 && v < 32 ? v : (v === null ? null : DEFAULT_PAD[a.id]);
    }
  }

  // assegna un tasto a un'azione; se era usato altrove viene tolto da lì
  bind(action, slot, code) {
    for (const a in this.keys) this.keys[a] = this.keys[a].map(c => (c === code ? null : c));
    this.keys[action][slot] = code;
    this.setKeys(this.keys);
  }
  // stessa cosa per il controller
  bindPad(action, btn) {
    for (const a in this.pad) if (this.pad[a] === btn) this.pad[a] = null;
    this.pad[action] = btn;
  }

  releaseAll() {
    this.down = {};
    this.justPressed = {};
    this.padJust = [];
    // i pulsanti del controller ancora premuti vengono ignorati finché non si rilasciano
    for (let i = 0; i < this.padRaw.length; i++) if (this.padRaw[i]) this.padBlock.add(i);
    this.padDown = [];
    this.flick = null;
  }
  lostFocus() {
    this.releaseAll();
    if (this.onBlur) this.onBlur();
  }

  setDevice(d) {
    if (this.lastDevice === d) return;
    this.lastDevice = d;
    if (this.onDevice) this.onDevice(d);
  }

  onKeyDown(e) {
    if (this.capture) {
      e.preventDefault();
      const fn = this.capture; this.capture = null;
      fn(e.code === 'Escape' ? null : e.code);
      return;
    }
    if (this.padCapture && e.code === 'Escape') { e.preventDefault(); const fn = this.padCapture; this.padCapture = null; fn(null); return; }
    const k = e.code;
    this.setDevice('kb');
    // nei campi di testo (nome, codice partita) la tastiera serve per scrivere
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range'));
    if (typing) {
      if (k === 'Escape' && t.blur) t.blur();
      return;
    }
    if (!this.gameKeysActive && this.onUiKey && !e.repeat) {
      if (this.onUiKey(k, e) === true) { e.preventDefault(); }
    }
    if (this.gameKeysActive && (this.codeToAction[k] || k === 'Space' || k === 'Tab' || k === 'F1')) e.preventDefault();
    if (!e.repeat && !this.down[k]) {
      this.justPressed[k] = true;
      const a = this.codeToAction[k];
      if (a && this.onAction) this.onAction(a);
    }
    this.down[k] = true;
  }

  onMouse(e, isDown) {
    if (!this.mouseEnabled || !this.gameKeysActive) return;
    if (e.target && e.target.closest && e.target.closest('button, input, select, a, .panel')) return;
    const code = 'Mouse' + e.button;
    this.setDevice('kb');
    if (isDown) {
      if (!this.down[code]) { this.justPressed[code] = true; const a = this.codeToAction[code]; if (a && this.onAction) this.onAction(a); }
      this.down[code] = true;
    } else this.down[code] = false;
  }

  // ---------- CONTROLLER ----------
  // da chiamare una volta per fotogramma, prima di leggere i comandi
  pollPads(dt) {
    this.padJust = [];
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
    if (!this.padEnabled || !pads) { this.padDown = []; this.stick = [0, 0]; this.rstick = [0, 0]; return; }
    // si usa il controller che è stato toccato per ultimo
    let gp = this.padIndex >= 0 ? pads[this.padIndex] : null;
    for (const p of pads) {
      if (!p || !p.connected || p === gp) continue;
      const active = p.buttons.some(b => b && (b.pressed || b.value > 0.5)) || (p.axes || []).some(a => Math.abs(a) > 0.5);
      if (active || !gp) { gp = p; this.padIndex = p.index; this.padId = p.id; this.padRaw = []; this.padBlock.clear(); if (active) break; }
    }
    if (!gp || !gp.connected) { this.padDown = []; this.stick = [0, 0]; this.rstick = [0, 0]; return; }
    let used = false;
    const n = gp.buttons.length;
    for (let i = 0; i < n; i++) {
      const b = gp.buttons[i];
      // i grilletti analogici contano come premuti oltre metà corsa
      const on = !!b && (i === 6 || i === 7 ? b.value > 0.35 : (b.pressed || b.value > 0.5));
      const was = !!this.padRaw[i];
      this.padRaw[i] = on;
      if (!on) { this.padBlock.delete(i); this.padDown[i] = false; continue; }
      used = true;
      if (this.padBlock.has(i)) { this.padDown[i] = false; continue; }
      this.padDown[i] = true;
      if (!was) {
        this.padJust[i] = true;
        if (this.padCapture) { const fn = this.padCapture; this.padCapture = null; this.padBlock.add(i); this.padDown[i] = false; this.padJust[i] = false; fn(i); continue; }
        const a = this.actionOfPad(i);
        if (a && this.onAction && this.gameKeysActive) this.onAction(a);
      }
    }
    const ax = gp.axes || [];
    this.stick = applyDeadzone(ax[0] || 0, ax[1] || 0, this.deadzone);
    this.rstick = applyDeadzone(ax[2] || 0, ax[3] || 0, Math.max(this.deadzone, 0.3));
    if (this.stick[0] || this.stick[1] || this.rstick[0] || this.rstick[1]) used = true;
    // colpetto della levetta destra: cambio giocatore nella direzione indicata
    const rm = Math.hypot(this.rstick[0], this.rstick[1]);
    if (rm > 0.75 && this.rFlickArmed) { this.rFlickArmed = false; this.flick = [this.rstick[0] / rm, this.rstick[1] / rm]; }
    else if (rm < 0.35) this.rFlickArmed = true;
    if (used) this.setDevice('pad');
    this.padDt = dt;
  }
  actionOfPad(btn) { for (const a in this.pad) if (this.pad[a] === btn) return a; return null; }
  padConnected() {
    try { const ps = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of ps) if (p && p.connected) return true; } catch (e) { /* */ }
    return false;
  }
  // vibrazione (se il controller la supporta)
  rumble(ms, strong, weak) {
    if (this.padIndex < 0 || !this.vibration) return;
    try {
      const gp = navigator.getGamepads()[this.padIndex];
      const va = gp && gp.vibrationActuator;
      if (va && va.playEffect) va.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak === undefined ? strong : weak }).catch(() => {});
    } catch (e) { /* controller senza vibrazione */ }
  }

  // ---------- NAVIGAZIONE NEI MENU (controller) ----------
  // restituisce un comando: 'up','down','left','right','accept','back','prev','next' oppure null
  navCommand(dt) {
    const J = this.padJust;
    if (J[0]) return 'accept';
    if (J[1]) return 'back';
    if (J[4]) return 'prev';
    if (J[5]) return 'next';
    if (J[9]) return 'start';
    // direzione: croce o levetta sinistra, con ripetizione se si tiene premuto
    let dir = null;
    const D = this.padDown, s = this.stick;
    if (D[12] || s[1] < -0.6) dir = 'up';
    else if (D[13] || s[1] > 0.6) dir = 'down';
    else if (D[14] || s[0] < -0.6) dir = 'left';
    else if (D[15] || s[0] > 0.6) dir = 'right';
    const h = this.navHold;
    if (!dir) { h.dir = null; return null; }
    if (dir !== h.dir) { h.dir = dir; h.t = 0.42; return dir; }
    h.t -= dt;
    if (h.t <= 0) { h.t = 0.12; return dir; }
    return null;
  }

  heldPad(action) { const b = this.pad[action]; return b !== null && b !== undefined && !!this.padDown[b]; }
  held(action) { const ks = this.keys[action]; return !!((ks[0] && this.down[ks[0]]) || (ks[1] && this.down[ks[1]])) || this.heldPad(action); }
  pressed(action) {
    const ks = this.keys[action], b = this.pad[action];
    return !!((ks[0] && this.justPressed[ks[0]]) || (ks[1] && this.justPressed[ks[1]])) || (b !== null && b !== undefined && !!this.padJust[b]);
  }
  // consuma una pressione (per pausa, telecamera...) così non viene letta due volte
  consumeAction(action) {
    const ks = this.keys[action];
    let v = false;
    for (const c of ks) if (c && this.justPressed[c]) { v = true; this.justPressed[c] = false; }
    const b = this.pad[action];
    if (b !== null && b !== undefined && this.padJust[b]) { v = true; this.padJust[b] = false; }
    return v;
  }
  consume(code) { const v = !!this.justPressed[code]; this.justPressed[code] = false; return v; }

  // stato da passare alla partita: direzione (rispetto allo schermo) e azioni
  read() {
    let mx = 0, mz = 0;
    if (this.held('left')) mx -= 1;
    if (this.held('right')) mx += 1;
    if (this.held('up')) mz -= 1;
    if (this.held('down')) mz += 1;
    const l = Math.hypot(mx, mz);
    if (l > 0) { mx /= l; mz /= l; }
    else if (this.stick[0] || this.stick[1]) {
      // levetta analogica: la distanza dal centro decide la velocità (camminata / corsa)
      mx = this.stick[0]; mz = this.stick[1];
    }
    // mouse: clic sinistro passaggio, clic destro tiro (se non assegnati diversamente)
    const mPass = this.mouseEnabled && !this.codeToAction.Mouse0 && this.justPressed.Mouse0;
    const mShootHeld = this.mouseEnabled && !this.codeToAction.Mouse2 && this.down.Mouse2;
    const mShootDown = this.mouseEnabled && !this.codeToAction.Mouse2 && this.justPressed.Mouse2;
    const flick = this.flick; this.flick = null;
    return {
      mx: mx, mz: mz,
      sprint: this.held('sprint'),
      shoot: this.held('shoot') || !!mShootHeld,
      press: this.held('press'),
      switchDir: flick,
      pressed: {
        pass: this.pressed('pass') || !!mPass, long: this.pressed('long'), through: this.pressed('through'),
        switch: this.pressed('switch'), shootDown: this.pressed('shoot') || !!mShootDown, dribble: this.pressed('dribble'),
      },
    };
  }
  endFrame() { this.justPressed = {}; this.padJust = []; }
}
