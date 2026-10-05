// Utilità comuni del server: risposte, errori, orologio, codici casuali, movimenti di monete.

// il gioco può girare da file:// (app desktop) o da una pagina web: l'autenticazione usa l'header Authorization
// (niente cookie), quindi accettare qualunque origine non espone a CSRF
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export const fail = (status, code, message, extra) => { throw new HttpError(status, code, message, extra); };

export function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, CORS, headers || {}) });
}

export async function readJson(request, maxBytes) {
  const text = await request.text();
  if (text.length > (maxBytes || 8192)) fail(413, 'TOO_LARGE', 'Richiesta troppo grande');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch (e) { fail(400, 'BAD_JSON', 'Richiesta non valida'); }
}

// orologio del server; in modalità test (TEST_MODE=1, solo in locale) si può spostare in avanti
export async function now(env) {
  if (env.TEST_MODE !== '1') return Date.now();
  const r = await env.DB.prepare("SELECT value FROM meta WHERE key = 'clock_offset'").first();
  return Date.now() + (r ? Number(r.value) || 0 : 0);
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const x of b) s += ALPHA[x % ALPHA.length];
  return s;
}
export function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomInt31() { return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1; }
export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export const dayKey = ms => new Date(ms).toISOString().slice(0, 10);

// movimento di monete come istruzioni di un batch D1 (una transazione SQL):
// il saldo ha CHECK >= 0 e (type, reference_id) è unico, quindi un addebito oltre il saldo o un accredito ripetuto
// fanno fallire tutto il batch e nulla viene scritto
export function moveCoins(db, userId, amount, type, ref, t) {
  return [
    db.prepare('UPDATE wallets SET balance = balance + ?1, updated_at = ?3 WHERE user_id = ?2').bind(amount, userId, t),
    db.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference_id, created_at) ' +
      'SELECT ?1, ?2, ?3, balance - ?3, balance, ?4, ?5 FROM wallets WHERE user_id = ?1').bind(userId, type, amount, ref, t),
  ];
}

// errori di vincolo del database tradotti in risposte chiare
export function constraintKind(e) {
  const m = String(e && (e.message || e));
  if (/CHECK constraint failed/i.test(m)) return 'CHECK';
  if (/UNIQUE constraint failed|PRIMARY KEY/i.test(m)) return 'UNIQUE';
  return null;
}

export function clampInt(v, lo, hi, def) {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : def;
}
