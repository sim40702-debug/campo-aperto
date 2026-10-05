// Durable Object "Engine": il lavoro che richiede più CPU dei 10 ms di una richiesta Worker gratuita
// (hash delle password, calcolo delle partite). Un Durable Object ha fino a 30 s di CPU per richiesta.
// Due istanze: "auth" per le password, "tick" per il lavoro periodico (così un login non aspetta una partita).
import { DurableObject } from 'cloudflare:workers';
import { runTick } from './tick.js';
import { now } from './util.js';

export const PBKDF2_ITER = 100000;   // il massimo accettato da Workers

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, key, 256);
}

export class Engine extends DurableObject {
  async hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2(password, salt, PBKDF2_ITER);
    return { hash: b64(hash), salt: b64(salt), iter: PBKDF2_ITER };
  }

  async verifyPassword(password, salt, iter, hash) {
    const got = new Uint8Array(await pbkdf2(password, unb64(salt), iter));
    const want = unb64(hash);
    if (got.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];   // confronto a tempo costante
    return diff === 0;
  }

  // un giro alla volta: se il cron e una richiesta di prova arrivano insieme, il secondo aspetta il primo
  async tick() {
    return this.ctx.blockConcurrencyWhile(async () => runTick(this.env, await now(this.env)));
  }
}
