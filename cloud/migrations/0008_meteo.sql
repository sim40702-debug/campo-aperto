-- 0.14.0: meteo e ora del giorno delle partite del server. Il meteo cambia un poco il pallone (pioggia: scivola,
-- neve: frena), quindi il gioco lo deve sapere per rigiocare la partita uguale. Le partite vecchie restano serene.
ALTER TABLE fixtures ADD COLUMN weather TEXT NOT NULL DEFAULT 'clear';
ALTER TABLE fixtures ADD COLUMN time_of_day TEXT NOT NULL DEFAULT 'night';
