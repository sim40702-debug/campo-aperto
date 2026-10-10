-- 0.15.0: classifica dei giocatori online (punti e livelli) e "online adesso" nella lista degli amici.
-- Solo tabelle e colonne nuove: i dati che ci sono già non cambiano.

-- Punti e risultati di ogni giocatore nelle partite online confermate (vedi src/online.js).
CREATE TABLE online_stats (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  points INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  drawn INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  goals_for INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX online_stats_points ON online_stats (points DESC);

-- Risultato di una partita online mandato da ognuno dei giocatori (con l'account) a fine partita.
-- La partita vale quando arrivano i risultati di tutte e due le squadre e sono uguali.
-- counted: 0 in attesa, 1 punti dati, 2 confermata ma senza punti (limite del giorno)
CREATE TABLE online_reports (
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  side INTEGER NOT NULL CHECK (side IN (0, 1)),
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  counted INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX online_reports_user ON online_reports (user_id, created_at);

-- Ultima volta che il gioco si è fatto vivo e cosa stava facendo ('menu' o 'match'): per gli amici online.
ALTER TABLE users ADD COLUMN last_seen INTEGER;
ALTER TABLE users ADD COLUMN presence TEXT;
