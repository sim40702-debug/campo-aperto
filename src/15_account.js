// ============================================================
// ACCOUNT — collegamento al server dell'economia (saldo, scommesse, negozio)
// Il server è l'autorità: qui non si calcola né si salva nessun saldo. Sul computer resta solo il token della
// sessione (per non dover rifare l'accesso); saldo, scommesse e oggetti si leggono sempre dal server.
// ============================================================
const SESSION_KEY = 'campoAperto.session.v1';
const API_TIMEOUT_MS = 12000;

class ApiError extends Error {
  constructor(status, code, message, data) { super(message); this.status = status; this.code = code; this.data = data || {}; }
}

class CampoApi {
  constructor(getUrl) {
    this.getUrl = getUrl;
    this.token = null; this.username = null;
    this.me = null;              // ultimo profilo letto dal server (saldo compreso)
    this.listeners = [];
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (s && typeof s.token === 'string' && typeof s.username === 'string') { this.token = s.token; this.username = s.username; }
    } catch (e) { /* archivio non disponibile: si accede di nuovo */ }
  }
  base() { return String(this.getUrl() || '').trim().replace(/\/+$/, ''); }
  configured() { return /^https?:\/\/[^\s/]+/i.test(this.base()); }
  loggedIn() { return !!this.token; }
  onChange(fn) { this.listeners.push(fn); }
  changed() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } }

  saveSession() {
    try {
      if (this.token) localStorage.setItem(SESSION_KEY, JSON.stringify({ token: this.token, username: this.username }));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* resta valida per questa sessione */ }
  }
  dropSession() { this.token = null; this.username = null; this.me = null; this.saveSession(); this.changed(); }

  async call(method, path, body) {
    if (!this.configured()) throw new ApiError(0, 'NO_SERVER', 'Server dell\'economia non impostato (Impostazioni, Online)');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.token) headers.authorization = 'Bearer ' + this.token;
    let res, data = null;
    try {
      res = await fetch(this.base() + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
      const text = await res.text();
      try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
    } catch (e) {
      throw new ApiError(0, 'OFFLINE', e.name === 'AbortError' ? 'Il server non risponde' : 'Server non raggiungibile: controlla la connessione');
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      if (res.status === 401 && data.error === 'AUTH' && this.token) this.dropSession();
      throw new ApiError(res.status, data.error || 'HTTP_' + res.status, data.message || 'Errore del server (' + res.status + ')', data);
    }
    return data;
  }
  get(path) { return this.call('GET', path); }
  post(path, body) { return this.call('POST', path, body || {}); }

  async login(username, password) {
    const r = await this.post('/api/auth/login', { username: username, password: password });
    this.token = r.token; this.username = r.username; this.saveSession();
    await this.refresh();
    return r;
  }
  async register(username, password) {
    const r = await this.post('/api/auth/register', { username: username, password: password });
    this.token = r.token; this.username = r.username; this.saveSession();
    await this.refresh();
    return r;
  }
  async logout() {
    try { if (this.token) await this.post('/api/auth/logout'); } catch (e) { /* il token viene comunque dimenticato */ }
    this.dropSession();
  }
  // profilo e saldo dal server
  async refresh() {
    if (!this.token) { this.me = null; this.changed(); return null; }
    this.me = await this.get('/api/me');
    this.username = this.me.username;
    this.changed();
    return this.me;
  }
  // dopo una giocata o un acquisto: solo il saldo (più leggero del profilo intero)
  async refreshBalance() {
    if (!this.token) return null;
    const r = await this.get('/api/me/balance');
    if (this.me) this.me.balance = r.balance;
    this.changed();
    return r.balance;
  }
}

// importi: 1.250 (separatore delle migliaia all'italiana)
function fmtCoins(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Math.round(n).toLocaleString(uiLocale());
}
function fmtOdds(o) { return o ? Number(o).toFixed(2) : '—'; }
// testo sicuro per innerHTML
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function newClientKey() {
  const b = new Uint8Array(12);
  (window.crypto || window.msCrypto).getRandomValues(b);
  return 'c' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
