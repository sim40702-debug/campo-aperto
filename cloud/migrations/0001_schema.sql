-- Campo Aperto: schema iniziale (account, monete, partite, scommesse, social, negozio, ricompense).
-- Le migrazioni si applicano una sola volta e in ordine (wrangler d1 migrations apply): mai modificare un file
-- già applicato, per ogni cambiamento si aggiunge una nuova migrazione 0003_..., 0004_...
-- Tempi in millisecondi dall'epoca (UTC). Monete sempre intere.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,                       -- nome pubblico (l'unico dato dell'account che vedono gli altri)
  username_lc TEXT NOT NULL UNIQUE,             -- per l'unicità senza maiuscole
  pass_hash TEXT NOT NULL,                      -- PBKDF2-SHA256, mai la password in chiaro
  pass_salt TEXT NOT NULL,
  pass_iter INTEGER NOT NULL,
  public_bets INTEGER NOT NULL DEFAULT 1,       -- 1: le mie scommesse sono visibili agli altri
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,            -- scommesse vinte di fila (calcolate dal server)
  best_streak INTEGER NOT NULL DEFAULT 0,
  shirt_number INTEGER NOT NULL DEFAULT 10 CHECK (shirt_number BETWEEN 1 AND 99),
  shirt_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,                  -- SHA-256 del token: il token vero esiste solo sul dispositivo
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL CHECK (balance >= 0),
  updated_at INTEGER NOT NULL
);

-- ogni movimento di monete; (type, reference_id) unico = nessun accredito o addebito doppio
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,                           -- INITIAL_BONUS, BET_PLACED, BET_WON, BET_REFUND, SHOP_PURCHASE, DAILY_REWARD, MATCH_REWARD, ACHIEVEMENT, SEASON_PRIZE
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (type, reference_id)
);
CREATE INDEX transactions_user ON transactions(user_id, id DESC);

-- partite del server: calcolate con il motore del gioco; seme e risultato restano segreti fino al momento giusto
CREATE TABLE fixtures (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                    -- identificativo pubblico
  home INTEGER NOT NULL,                        -- indice della squadra nel database del gioco (buildDatabase(2026))
  away INTEGER NOT NULL,
  home_name TEXT NOT NULL,
  away_name TEXT NOT NULL,
  kickoff_at INTEGER NOT NULL,
  half_seconds INTEGER NOT NULL,
  seed INTEGER NOT NULL,                        -- rivelato al calcio d'inizio (quando le scommesse sono chiuse)
  engine TEXT NOT NULL,                         -- versione del motore che l'ha calcolata
  status TEXT NOT NULL,                         -- READY (calcolata), SETTLED (liquidata), VOID (annullata)
  duration_ms INTEGER NOT NULL,
  facts TEXT NOT NULL,                          -- JSON del risultato: rivelato solo a fine partita
  markets TEXT NOT NULL,                        -- JSON delle quote base, congelate alla creazione
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE UNIQUE INDEX fixtures_kickoff ON fixtures(kickoff_at);   -- una partita per orario anche se il cron parte due volte
CREATE INDEX fixtures_status ON fixtures(status, kickoff_at);

CREATE TABLE match_events (
  fixture_id INTEGER NOT NULL REFERENCES fixtures(id),
  seq INTEGER NOT NULL,
  t_ms INTEGER NOT NULL,                        -- millisecondi dal calcio d'inizio: l'evento si rivela solo dopo
  type TEXT NOT NULL,
  minute INTEGER NOT NULL,
  half INTEGER NOT NULL,
  team INTEGER NOT NULL,
  player TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (fixture_id, seq)
);
CREATE INDEX match_events_time ON match_events(fixture_id, t_ms);

CREATE TABLE bets (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                    -- BET-XXXXX: l'unico identificativo che vedono gli altri
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_key TEXT NOT NULL,                     -- chiave della richiesta: un invio ripetuto non crea un'altra scommessa
  stake INTEGER NOT NULL CHECK (stake > 0),
  odds REAL NOT NULL CHECK (odds >= 1),
  potential_payout INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',          -- OPEN, WON, LOST, VOID
  payout INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  shared INTEGER NOT NULL DEFAULT 0,            -- 1: visibile a chi ha il codice anche se privata
  copied_from TEXT,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  UNIQUE (user_id, client_key)
);
CREATE INDEX bets_user ON bets(user_id, id DESC);
CREATE INDEX bets_settled ON bets(status, settled_at);
CREATE INDEX bets_created ON bets(created_at);
CREATE INDEX bets_copied ON bets(copied_from);

CREATE TABLE bet_items (
  id INTEGER PRIMARY KEY,
  bet_id INTEGER NOT NULL REFERENCES bets(id),
  fixture_id INTEGER NOT NULL REFERENCES fixtures(id),
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  market_label TEXT NOT NULL,                   -- etichette scritte dal server al momento della giocata
  selection_label TEXT NOT NULL,
  odds REAL NOT NULL,                           -- quota accettata: non cambia più
  status TEXT NOT NULL DEFAULT 'OPEN'           -- OPEN, WON, LOST, VOID
);
CREATE INDEX bet_items_bet ON bet_items(bet_id);
CREATE INDEX bet_items_fixture ON bet_items(fixture_id, bet_id DESC);
CREATE INDEX bet_items_market ON bet_items(fixture_id, market, selection);

CREATE TABLE bet_reactions (
  bet_id INTEGER NOT NULL REFERENCES bets(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bet_id, user_id, emoji)
);

CREATE TABLE shop_items (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,                       -- maglia, pantaloncini, calzettoni, scarpe, guanti, capelli, accessori
  name TEXT NOT NULL,
  rarity TEXT NOT NULL,                         -- comune, raro, epico, leggendario
  price INTEGER NOT NULL CHECK (price >= 0),    -- prezzi: si cambiano qui (nuova migrazione), mai nel client
  data TEXT NOT NULL,                           -- JSON per la grafica (colori, motivo)
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE inventory (
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL REFERENCES shop_items(id),
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE equipped (
  user_id INTEGER NOT NULL REFERENCES users(id),
  slot TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES shop_items(id),
  PRIMARY KEY (user_id, slot)
);

CREATE TABLE daily_claims (
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,                            -- AAAA-MM-GG (UTC)
  streak INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  reward INTEGER NOT NULL
);

CREATE TABLE user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id),
  achievement_id TEXT NOT NULL REFERENCES achievements(id),
  earned_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

-- limite di registrazioni per rete al giorno (contro la creazione di account in serie per le monete iniziali).
-- Si salva solo l'hash dell'indirizzo con un sale del server, mai l'indirizzo
CREATE TABLE signup_limits (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day)
);

-- impostazioni interne del server (es. orologio di prova, solo in modalità test)
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
