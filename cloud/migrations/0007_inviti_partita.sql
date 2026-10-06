-- 0.9.2: inviti alle partite online tra amici. Chi apre una stanza (codice del relay) invita un amico: l'invito
-- compare nel suo pannello Amici con "Entra". Valido 15 minuti; un solo invito in attesa per coppia e verso.
CREATE TABLE game_invites (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id),
  to_id INTEGER NOT NULL REFERENCES users(id),
  room TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at INTEGER NOT NULL
);
CREATE INDEX game_invites_to ON game_invites (to_id, status, created_at);
CREATE INDEX game_invites_from ON game_invites (from_id, status);
