// ============================================================
// DATABASE — squadre, giocatori e formazioni (tutto inventato)
// ============================================================
const FIRST_NAMES = ['Luca', 'Dario', 'Nico', 'Teo', 'Ivo', 'Rico', 'Sandro', 'Elio', 'Aldo', 'Tomas',
  'Mirko', 'Kai', 'Leon', 'Jonas', 'Milo', 'Enzo', 'Hugo', 'Samu', 'Aron', 'Emil', 'Dino', 'Timo',
  'Oscar', 'Yann', 'Noel', 'Ilir', 'Sven', 'Omar', 'Paolo', 'Gino', 'Lars', 'Ruben', 'Adil', 'Joel'];
const LAST_NAMES = ['Carvani', 'Doleri', 'Fontresi', 'Gavardi', 'Lunetti', 'Marzolo', 'Pedrasca', 'Solvani',
  'Brenzi', 'Tarvoni', 'Quadrelli', 'Ostini', 'Vallardi', 'Zendri', 'Morvan', 'Kessler', 'Holmqvist',
  'Arnaud', 'Deveaux', 'Balcar', 'Imrik', 'Nortega', 'Salvedo', 'Ruzic', 'Teodor', 'Fermani', 'Lirani',
  'Mazzeri', 'Orvieti', 'Pantano', 'Rigotti', 'Scalvi', 'Trevani', 'Ubaldi', 'Venzo', 'Zorzi', 'Aglietti'];

const SPECIAL_ABILITIES = {
  'Velocista': 'sprint più rapido',
  'Regista': 'passaggi più precisi',
  'Bomber': 'tiri più precisi in area',
  'Muro': 'contrasti più efficaci',
  'Dribblatore': 'controllo palla migliore sotto pressione',
  'Colpo di testa': 'colpi di testa più forti e precisi',
  'Para-rigori': 'più riflessi sui tiri ravvicinati',
  'Instancabile': 'consuma meno energia',
};

// Squadre originali: nome, sigla, colori divisa casa/trasferta, forza media
const TEAM_TEMPLATES = [
  { name: 'Aurora Lacustre', short: 'AUR', rating: 78, home: ['#f2c230', '#1f2a5c', '#f2c230'], away: ['#ffffff', '#1f2a5c', '#ffffff'] },
  { name: 'Falchi di Brera', short: 'FAL', rating: 76, home: ['#c8202f', '#ffffff', '#c8202f'], away: ['#222222', '#c8202f', '#222222'] },
  { name: 'Lupi del Ceresio', short: 'LUP', rating: 74, home: ['#3b3f46', '#3b3f46', '#e0e0e0'], away: ['#9fd3e8', '#ffffff', '#9fd3e8'] },
  { name: 'Stella Alpina', short: 'STA', rating: 72, home: ['#ffffff', '#1d6b3a', '#1d6b3a'], away: ['#1d6b3a', '#ffffff', '#ffffff'] },
  { name: 'Tempesta Blu', short: 'TEM', rating: 80, home: ['#1e56c8', '#ffffff', '#1e56c8'], away: ['#f0e6d2', '#1e56c8', '#f0e6d2'] },
  { name: 'Vulcano Rosso', short: 'VUL', rating: 70, home: ['#e5652a', '#2a1a14', '#e5652a'], away: ['#2a1a14', '#e5652a', '#2a1a14'] },
  { name: 'Orsi di Valle', short: 'ORS', rating: 68, home: ['#6b3fa0', '#ffffff', '#6b3fa0'], away: ['#f7f1a0', '#6b3fa0', '#f7f1a0'] },
  { name: 'Delfini del Golfo', short: 'DEL', rating: 73, home: ['#1fb3b0', '#10405a', '#1fb3b0'], away: ['#10405a', '#1fb3b0', '#10405a'] },
];

// Formazioni: u = distanza dalla propria porta (0..105), z = posizione laterale (-34..34)
// posizioni "neutre" con la palla a centrocampo
const FORMATIONS = {
  '4-4-2': [
    { pos: 'POR', role: 'GK', u: 3, z: 0 },
    { pos: 'TD', role: 'DF', u: 24, z: -24 }, { pos: 'DC', role: 'DF', u: 19, z: -8 },
    { pos: 'DC', role: 'DF', u: 19, z: 8 }, { pos: 'TS', role: 'DF', u: 24, z: 24 },
    { pos: 'ED', role: 'MF', u: 40, z: -23 }, { pos: 'CC', role: 'MF', u: 36, z: -7 },
    { pos: 'CC', role: 'MF', u: 36, z: 7 }, { pos: 'ES', role: 'MF', u: 40, z: 23 },
    { pos: 'ATT', role: 'FW', u: 50, z: -6 }, { pos: 'ATT', role: 'FW', u: 50, z: 6 },
  ],
  '4-3-3': [
    { pos: 'POR', role: 'GK', u: 3, z: 0 },
    { pos: 'TD', role: 'DF', u: 24, z: -24 }, { pos: 'DC', role: 'DF', u: 19, z: -8 },
    { pos: 'DC', role: 'DF', u: 19, z: 8 }, { pos: 'TS', role: 'DF', u: 24, z: 24 },
    { pos: 'MED', role: 'MF', u: 32, z: 0 }, { pos: 'CC', role: 'MF', u: 39, z: -13 },
    { pos: 'CC', role: 'MF', u: 39, z: 13 },
    { pos: 'AD', role: 'FW', u: 48, z: -22 }, { pos: 'ATT', role: 'FW', u: 51, z: 0 }, { pos: 'AS', role: 'FW', u: 48, z: 22 },
  ],
  '4-2-3-1': [
    { pos: 'POR', role: 'GK', u: 3, z: 0 },
    { pos: 'TD', role: 'DF', u: 24, z: -24 }, { pos: 'DC', role: 'DF', u: 19, z: -8 },
    { pos: 'DC', role: 'DF', u: 19, z: 8 }, { pos: 'TS', role: 'DF', u: 24, z: 24 },
    { pos: 'MED', role: 'MF', u: 31, z: -7 }, { pos: 'MED', role: 'MF', u: 31, z: 7 },
    { pos: 'ED', role: 'MF', u: 43, z: -21 }, { pos: 'TRQ', role: 'MF', u: 44, z: 0 }, { pos: 'ES', role: 'MF', u: 43, z: 21 },
    { pos: 'ATT', role: 'FW', u: 51, z: 0 },
  ],
};

const MENTALITIES = ['Difensiva', 'Equilibrata', 'Offensiva'];

const SKIN_TONES = ['#f1d3b8', '#e0b48f', '#c68c62', '#9c6644', '#6e4630', '#4a2f22'];
const HAIR_COLORS = ['#1b1512', '#3a2618', '#6b4526', '#a67b3d', '#d8c07a', '#8a8a8a', '#b5462a'];
const HAIR_STYLES = ['corti', 'rasati', 'medi', 'ricci', 'cresta'];

// Genera un attributo vicino alla base, con peso per il ruolo
function genAttr(base, bonus) {
  return clamp(Math.round(base + bonus + randRange(-7, 7)), 30, 99);
}

function generatePlayer(base, slot, number) {
  const role = slot.role;
  const b = { speed: 0, accel: 0, shot: 0, pass: 0, dribble: 0, defense: 0, physical: 0, stamina: 0, gk: -40 };
  if (role === 'GK') { b.gk = 8; b.speed = -15; b.shot = -30; b.dribble = -25; b.defense = -20; b.pass = -10; }
  if (role === 'DF') { b.defense = 8; b.physical = 5; b.shot = -15; b.dribble = -8; }
  if (role === 'MF') { b.pass = 7; b.stamina = 6; b.dribble = 3; }
  if (role === 'FW') { b.shot = 8; b.speed = 5; b.dribble = 5; b.defense = -20; }
  const attr = {};
  for (const k in b) attr[k] = genAttr(base, b[k]);
  const age = randInt(18, 34);
  const potential = clamp(Math.round(base + (age < 23 ? randRange(5, 15) : randRange(-3, 4))), 40, 99);
  const overall = computeOverall(attr, role);
  let ability = null;
  if (rand() < 0.4) {
    const options = role === 'GK' ? ['Para-rigori'] :
      role === 'DF' ? ['Muro', 'Colpo di testa', 'Instancabile'] :
      role === 'MF' ? ['Regista', 'Dribblatore', 'Instancabile'] : ['Bomber', 'Velocista', 'Dribblatore', 'Colpo di testa'];
    ability = pick(options);
  }
  return {
    name: pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES),
    number: number,
    pos: slot.pos,
    role: role,
    age: age,
    foot: rand() < 0.75 ? 'Destro' : 'Sinistro',
    attr: attr,
    hidden: { composure: genAttr(base, 0), vision: genAttr(base, role === 'MF' ? 6 : 0), aggression: genAttr(55, 0) },
    ability: ability,
    overall: overall,
    potential: potential,
    value: Math.round(Math.pow(overall / 10, 4) * (age < 25 ? 1.4 : age > 30 ? 0.6 : 1)) * 1000,
    morale: randInt(60, 90),
    form: randInt(55, 90),
    look: {
      skin: pick(SKIN_TONES), hair: pick(HAIR_COLORS), hairStyle: pick(HAIR_STYLES),
      beard: rand() < 0.3, height: Math.round(randRange(1.68, 1.95) * 100) / 100,
      build: randRange(0.9, 1.12), boots: pick(['#111111', '#ffffff', '#e8e13a', '#ff5a36', '#3fa9f5']),
    },
  };
}

function computeOverall(a, role) {
  if (role === 'GK') return Math.round(a.gk * 0.8 + a.physical * 0.1 + a.pass * 0.1);
  if (role === 'DF') return Math.round(a.defense * 0.4 + a.physical * 0.2 + a.speed * 0.15 + a.pass * 0.15 + a.accel * 0.1);
  if (role === 'MF') return Math.round(a.pass * 0.35 + a.dribble * 0.2 + a.stamina * 0.15 + a.shot * 0.1 + a.defense * 0.1 + a.speed * 0.1);
  return Math.round(a.shot * 0.35 + a.speed * 0.2 + a.dribble * 0.2 + a.accel * 0.1 + a.physical * 0.15);
}

// Crea una squadra completa: 11 titolari + 7 riserve
function generateTeam(template, formationName) {
  const formation = FORMATIONS[formationName || '4-4-2'];
  const players = [];
  const usedNumbers = {};
  formation.forEach(function (slot, i) {
    let n = i === 0 ? 1 : [0, 2, 4, 5, 3, 7, 8, 6, 11, 9, 10][i];
    usedNumbers[n] = true;
    players.push(generatePlayer(template.rating, slot, n));
  });
  const benchSlots = [FORMATIONS['4-4-2'][0], FORMATIONS['4-4-2'][2], FORMATIONS['4-4-2'][1],
    FORMATIONS['4-4-2'][6], FORMATIONS['4-4-2'][5], FORMATIONS['4-4-2'][9], FORMATIONS['4-4-2'][10]];
  let num = 12;
  benchSlots.forEach(function (slot) {
    while (usedNumbers[num]) num++;
    usedNumbers[num] = true;
    players.push(generatePlayer(template.rating - 4, slot, num));
  });
  return {
    name: template.name, short: template.short, rating: template.rating,
    kits: { home: template.home, away: template.away },
    coach: pick(FIRST_NAMES) + ' ' + pick(LAST_NAMES),
    formation: formationName || '4-4-2',
    tactics: { mentality: 1, pressing: 0.6, width: 1.0, tempo: 0.5 },
    players: players,
  };
}

// Tutte le squadre del database (generate una volta sola)
function buildDatabase(seed) {
  if (seed !== undefined) setSeed(seed);
  return TEAM_TEMPLATES.map(function (t, i) {
    return generateTeam(t, ['4-4-2', '4-3-3', '4-2-3-1'][i % 3]);
  });
}
