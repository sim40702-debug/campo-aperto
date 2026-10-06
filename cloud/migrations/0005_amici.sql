-- 0.9.0: amici e competizioni tra amici.
-- Amicizia: una riga per coppia (user_a < user_b). PENDING finché l'altro non accetta.
CREATE TABLE friendships (
  user_a INTEGER NOT NULL REFERENCES users(id),
  user_b INTEGER NOT NULL REFERENCES users(id),
  requested_by INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED')),
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX friendships_b ON friendships (user_b);

-- Competizione tra amici (campionato, torneo, coppa). Regole e avanzamento: CompLogic (le stesse del gioco).
-- OPEN: si invitano gli amici e si scelgono le squadre; ACTIVE: si gioca; FINISHED: stagione conclusa.
-- state: JSON della competizione (calendario, risultati, tabellone); rev: versione per le modifiche concorrenti.
CREATE TABLE friend_comps (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('league', 'tournament', 'cup')),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACTIVE', 'FINISHED', 'CANCELLED')),
  config TEXT NOT NULL,
  state TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX friend_comps_owner ON friend_comps (owner_id, status);

-- Partecipanti: ognuno guida una squadra della competizione (le altre le guida l'IA).
CREATE TABLE friend_comp_members (
  comp_id INTEGER NOT NULL REFERENCES friend_comps(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  team INTEGER,
  status TEXT NOT NULL CHECK (status IN ('INVITED', 'ACCEPTED', 'DECLINED', 'LEFT', 'EXPIRED')),
  invited_at INTEGER NOT NULL,
  answered_at INTEGER,
  PRIMARY KEY (comp_id, user_id)
);
CREATE INDEX friend_comp_members_user ON friend_comp_members (user_id, status);

-- Risultati dichiarati dai giocatori per una partita del turno in corso (si cancellano quando il risultato è
-- registrato). result: JSON {kind: 'score'|'sim'|'kickoff', h, a, scorers}
CREATE TABLE friend_comp_reports (
  comp_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  fixture TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comp_id, season, fixture, user_id)
);

-- Stanza online creata da uno dei due giocatori per giocare la loro partita (codice del relay).
CREATE TABLE friend_comp_rooms (
  comp_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  fixture TEXT NOT NULL,
  room TEXT NOT NULL,
  host_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comp_id, season, fixture)
);
