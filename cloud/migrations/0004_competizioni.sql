-- 0.8.0: competizioni.
-- Campionato del server: le partite del server (quelle delle scommesse) seguono un calendario all'italiana
-- (andata e ritorno) con giornate, classifica e stagioni. La classifica si calcola dai risultati ufficiali.
CREATE TABLE competitions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'league'
  name TEXT NOT NULL,
  season INTEGER NOT NULL,
  teams TEXT NOT NULL,                -- JSON: indici delle squadre nell'ordine del calendario
  rounds INTEGER NOT NULL,
  per_round INTEGER NOT NULL,
  status TEXT NOT NULL,               -- ACTIVE (si creano partite), SCHEDULED (tutte create), FINISHED (tutte giocate)
  champion INTEGER,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX competitions_status ON competitions (status, id);
ALTER TABLE fixtures ADD COLUMN comp_id INTEGER;
ALTER TABLE fixtures ADD COLUMN comp_round INTEGER;
ALTER TABLE fixtures ADD COLUMN comp_slot INTEGER;
ALTER TABLE fixtures ADD COLUMN comp_label TEXT;
CREATE UNIQUE INDEX fixtures_comp_slot ON fixtures (comp_id, comp_round, comp_slot);

-- Carriera del giocatore (campionati, tornei, coppe giocati nel gioco): salvataggio sull'account, per ritrovarla su
-- un altro computer. Sono dati del gioco del giocatore, senza monete: il server li conserva e ne controlla la forma.
CREATE TABLE career_saves (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
