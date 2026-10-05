// Salvataggio della carriera del giocatore (competizioni giocate nel gioco) sull'account.
// Sono dati del gioco del giocatore, senza monete né effetti sul server: si controllano forma e dimensione e vince
// la copia modificata per ultima (un salvataggio più vecchio di quello sul server viene rifiutato).
import { fail } from './util.js';

export const CAREER_MAX_BYTES = 400000;
const KINDS = new Set(['league', 'tournament', 'cup']);

function check(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.comps)) fail(400, 'BAD_CAREER', 'Salvataggio non valido');
  if (data.comps.length > 12) fail(400, 'BAD_CAREER', 'Troppe competizioni');
  for (const c of data.comps) {
    if (!c || typeof c !== 'object' || !KINDS.has(c.kind) || !Array.isArray(c.fixtures) || c.fixtures.length > 1200 || !c.config || !Array.isArray(c.config.teams))
      fail(400, 'BAD_CAREER', 'Competizione non valida');
    if (c.config.teams.length > 64 || c.config.teams.some(t => !Number.isInteger(t) || t < 0 || t > 255)) fail(400, 'BAD_CAREER', 'Squadre non valide');
  }
  return { v: 1, comps: data.comps, updatedAt: Number(data.updatedAt) || 0 };
}

export async function getCareer(env, user) {
  const r = await env.DB.prepare('SELECT data, updated_at FROM career_saves WHERE user_id = ?').bind(user.id).first();
  return r ? { data: JSON.parse(r.data), updatedAt: r.updated_at } : { data: null, updatedAt: 0 };
}

export async function putCareer(env, user, body, t) {
  const data = check(body.data);
  const updatedAt = Number(body.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > t + 5 * 60000) fail(400, 'BAD_CAREER', 'Data del salvataggio non valida');
  const text = JSON.stringify(data);
  if (text.length > CAREER_MAX_BYTES) fail(413, 'TOO_LARGE', 'Carriera troppo grande da salvare');
  const cur = await env.DB.prepare('SELECT updated_at FROM career_saves WHERE user_id = ?').bind(user.id).first();
  if (cur && cur.updated_at > updatedAt) fail(409, 'STALE', 'Sul server c\'è un salvataggio più recente', { updatedAt: cur.updated_at });
  await env.DB.prepare('INSERT INTO career_saves (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(user.id, text, updatedAt).run();
  return { ok: true, updatedAt: updatedAt, bytes: text.length };
}
