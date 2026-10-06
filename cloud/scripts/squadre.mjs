// Squadre delle competizioni per il server (node scripts/squadre.mjs, dentro "npm run engine"): le 32 squadre del
// gioco (8 del server + 24 in più) con nome, sigla, colori e profilo per la simulazione, calcolati con lo stesso
// codice del gioco (motore e CompLogic). Il server legge il file invece di rigenerare le rose a ogni richiesta.
import fs from 'node:fs';
import { buildDatabase, buildExtraTeams } from '../src/engine.gen.js';
import { teamProfile } from '../src/complogic.js';
import { TEAM_DB_SEED } from '../src/simulate.js';

const db = buildDatabase(TEAM_DB_SEED).concat(buildExtraTeams());
const out = db.map(t => ({ name: t.name, short: t.short, kit: t.kits.home[0], kit2: t.kits.home[1], rating: t.rating, profile: teamProfile(t) }));
const file = new URL('../src/teams.gen.json', import.meta.url);
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log('squadre -> src/teams.gen.json (' + out.length + ' squadre)');
