// Account: registrazione, accesso, sessioni.
// La password non viene mai salvata: solo PBKDF2-SHA256 con sale casuale (calcolato nel Durable Object, perché
// richiede più CPU dei 10 ms di una richiesta Worker gratuita). La sessione è un token casuale di 256 bit:
// nel database c'è solo il suo SHA-256.
import { fail, randomToken, sha256hex, constraintKind } from './util.js';

export const SESSION_DAYS = 90;
const MAX_FAILS = 8, LOCK_MS = 15 * 60 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function checkCredentials(body) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!USERNAME_RE.test(username)) fail(400, 'BAD_USERNAME', 'Nome utente: da 3 a 16 caratteri, lettere, numeri o _');
  if (password.length < 8 || password.length > 128) fail(400, 'BAD_PASSWORD', 'La password deve avere da 8 a 128 caratteri');
  return { username, password };
}

const engine = env => env.ENGINE.get(env.ENGINE.idFromName('auth'));

export async function register(env, body, t) {
  const { username, password } = checkCredentials(body);
  const lc = username.toLowerCase();
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username_lc = ?').bind(lc).first()) fail(409, 'USERNAME_TAKEN', 'Questo nome utente è già usato');
  const pw = await engine(env).hashPassword(password);
  const token = randomToken(), th = await sha256hex(token);
  const start = Number(env.START_BALANCE || 1000);
  try {
    // tutto insieme: account, portafoglio con il bonus iniziale, transazione e sessione
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (username, username_lc, pass_hash, pass_salt, pass_iter, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(username, lc, pw.hash, pw.salt, pw.iter, t),
      env.DB.prepare('INSERT INTO wallets (user_id, balance, updated_at) SELECT id, ?2, ?3 FROM users WHERE username_lc = ?1').bind(lc, start, t),
      env.DB.prepare('INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference_id, created_at) ' +
        'SELECT id, \'INITIAL_BONUS\', ?2, 0, ?2, \'user:\' || id, ?3 FROM users WHERE username_lc = ?1').bind(lc, start, t),
      env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) SELECT ?2, id, ?3, ?4 FROM users WHERE username_lc = ?1')
        .bind(lc, th, t, t + SESSION_DAYS * 86400000),
    ]);
  } catch (e) {
    if (constraintKind(e) === 'UNIQUE') fail(409, 'USERNAME_TAKEN', 'Questo nome utente è già usato');
    throw e;
  }
  return { token, username };
}

export async function login(env, body, t) {
  const { username, password } = checkCredentials(body);
  const u = await env.DB.prepare('SELECT id, username, pass_hash, pass_salt, pass_iter, failed_logins, locked_until FROM users WHERE username_lc = ?')
    .bind(username.toLowerCase()).first();
  // stesso messaggio per utente inesistente e password sbagliata: non si scopre quali nomi esistono
  if (!u) { await engine(env).hashPassword(password); fail(401, 'BAD_LOGIN', 'Nome utente o password sbagliati'); }
  if (u.locked_until > t) fail(429, 'LOCKED', 'Troppi tentativi sbagliati: riprova tra qualche minuto');
  const ok = await engine(env).verifyPassword(password, u.pass_salt, u.pass_iter, u.pass_hash);
  if (!ok) {
    const fails = u.failed_logins + 1;
    await env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? t + LOCK_MS : 0, u.id).run();
    fail(401, 'BAD_LOGIN', 'Nome utente o password sbagliati');
  }
  const token = randomToken(), th = await sha256hex(token);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').bind(u.id),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(th, u.id, t, t + SESSION_DAYS * 86400000),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(u.id, t),
  ]);
  return { token, username: u.username };
}

// utente della richiesta (dal token), oppure null. L'identità viene solo da qui: mai da un id mandato dal client
export async function authenticate(env, request, t) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(h);
  if (!m) return null;
  const th = await sha256hex(m[1]);
  const u = await env.DB.prepare('SELECT u.id, u.username, u.public_bets FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(th, t).first();
  return u ? { id: u.id, username: u.username, publicBets: !!u.public_bets, tokenHash: th } : null;
}

export async function requireUser(env, request, t) {
  const u = await authenticate(env, request, t);
  if (!u) fail(401, 'AUTH', 'Accedi per continuare');
  return u;
}

export async function logout(env, user) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run();
  return { ok: true };
}
