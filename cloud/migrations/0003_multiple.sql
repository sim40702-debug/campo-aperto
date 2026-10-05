-- Multiple vere: più selezioni della stessa partita (se compatibili), quota collegata, bonus multipla.
-- Preferenze dell'utente (comandi personalizzati) salvate sull'account.
-- Le scommesse già giocate restano valide: senza eff_odds si usa la quota della selezione, senza bonus 0.

ALTER TABLE bets ADD COLUMN base_odds REAL;                       -- quota prima del bonus multipla
ALTER TABLE bets ADD COLUMN bonus_pct REAL NOT NULL DEFAULT 0;    -- bonus concesso alla giocata (0,05 = +5%)
ALTER TABLE bet_items ADD COLUMN eff_odds REAL;                   -- quota effettiva (selezioni collegate della stessa partita)
ALTER TABLE bet_items ADD COLUMN bonus_flag INTEGER NOT NULL DEFAULT 0;   -- 1 se la selezione contava per il bonus
ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '';      -- JSON delle preferenze (comandi), massimo 8 KB
