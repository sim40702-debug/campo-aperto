-- 0.20.0: stagioni mensili della classifica online (premi e distintivi ai primi tre) e partita veloce online
-- ("Cerca avversario"). Solo tabelle nuove: i dati che ci sono già non cambiano.

-- Punti e risultati di ogni giocatore nella stagione (un mese, chiave 'AAAA-MM'), oltre a quelli di sempre
-- che restano in online_stats.
CREATE TABLE online_season_stats (
  season TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  drawn INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season, user_id)
);
CREATE INDEX online_season_points ON online_season_stats (season, points DESC);

-- Distintivi: chi è arrivato primo, secondo o terzo in una stagione finita.
CREATE TABLE online_badges (
  user_id INTEGER NOT NULL REFERENCES users(id),
  season TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank IN (1, 2, 3)),
  points INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, season)
);

-- Chi sta cercando un avversario adesso. Quando due si trovano: chi aspettava da prima apre la stanza (host)
-- e scrive qui il codice, l'altro (guest) lo legge ed entra.
CREATE TABLE online_queue (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  partner_id INTEGER,
  role TEXT,
  room TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
