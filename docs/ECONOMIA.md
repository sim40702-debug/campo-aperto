# Economia di Campo Aperto: account, monete, scommesse, negozio

Questa guida spiega come funziona il server dell'economia, come metterlo online sul tuo account Cloudflare, come
aggiornarlo, fare i backup e tornare indietro. Il codice è in `cloud/`.

## Cosa fa

- **Account**: nome utente pubblico e password (mai salvata: solo PBKDF2-SHA256 con sale, 100.000 iterazioni).
  La sessione è un token casuale di 256 bit; nel database c'è solo il suo SHA-256. Sul computer del giocatore resta
  solo il token, mai il saldo.
- **Portafoglio**: un saldo per utente nel database, con il vincolo `balance >= 0`. Ogni movimento è una riga di
  `transactions` (tipo, importo, saldo prima e dopo, riferimento, data) e la coppia (tipo, riferimento) è unica:
  niente accrediti o addebiti doppi, nemmeno ripetendo una richiesta.
- **Partite del server**: ogni 10 minuti (per difetto) c'è una partita tra due squadre del gioco. Il server la calcola
  **con il motore del gioco** (gli stessi file `src/01..08`, vedi `node build.js engine`) appena la crea, con un seme
  segreto. Prima del calcio d'inizio si vedono solo squadre e quote; le scommesse chiudono 10 secondi prima; al calcio
  d'inizio il seme diventa pubblico e il gioco rigioca la stessa partita in 3D, allineata all'orologio del server;
  durante la partita il server manda solo gli eventi già avvenuti; alla fine liquida le scommesse.
- **Scommesse**: singole e multiple (fino a 10 partite diverse), 25 mercati: 1X2, doppia chance, risultato primo tempo,
  handicap, risultato esatto, gol totali, entrambe segnano, gol primo e secondo tempo, primo e ultimo gol, porta
  inviolata, corner totali e per squadra, primo corner, cartellini totali, primo cartellino, espulsione, rigore, tiri,
  tiri in porta, possesso. Le quote vengono da una calibrazione Monte Carlo fatta con il motore vero
  (`cloud/scripts/calibra-quote.mjs` → `cloud/src/odds-model.json`), con un margine del 6%, e scendono un po' se una
  selezione è giocata molto più del suo peso. Il client manda la quota che ha visto: se nel frattempo è cambiata la
  giocata non parte (`409 ODDS_CHANGED`) e il giocatore deve confermare di nuovo.
- **Social**: scommesse dei giocatori (solo pubbliche e di profili pubblici), copia (riempie la schedina, non gioca),
  codici BET-XXXXX da condividere, reazioni 🔥👏💀👀, selezioni più giocate, statistiche, classifiche per profitto, ROI,
  percentuale di vittorie, numero di scommesse e serie (mai per saldo), con periodi giorno, settimana, mese, stagione.
- **Negozio e personaggio**: 30 oggetti in 7 categorie (maglia, pantaloncini, calzettoni, scarpe, guanti, capelli,
  accessori), con rarità e prezzi nel database; inventario per utente; oggetti indossati, numero e nome di maglia.
  In partita il tuo attaccante ha il tuo aspetto, e online gli altri lo leggono dal server (non dal tuo computer).
- **Ricompense**: 1.000 monete alla registrazione, bonus giornaliero (100 + 10 per giorno di fila fino a +60, doppio nel
  fine settimana), premio spettatore (20 monete nel secondo tempo di una partita del server, massimo 3 al giorno),
  7 obiettivi, premi di stagione (trimestre) ai primi tre per profitto.

- **Partite online**: lo stesso Worker fa da relay per giocare via internet: tutti a `wss://…workers.dev/relay`,
  un Durable Object per ogni codice partita (più partite insieme). Il server inoltra soltanto i messaggi: la partita la
  simula il computer di chi la crea.

## Architettura

```
gioco (desktop o browser) ──HTTPS/JSON──▶ Worker "campo-aperto-api"  (richieste leggere)
                                              │
                                              ├──▶ D1 "campo-aperto"     database SQL: l'autorità su tutto
                                              │
                                              └──▶ Durable Object Engine  lavoro pesante: hash delle password,
                                                       ▲                  calcolo delle partite, liquidazione
                                   cron ogni minuto ───┘
```

Perché il Durable Object: sul piano gratuito una richiesta Worker ha 10 ms di CPU, mentre l'hash di una password
(100.000 iterazioni) costa decine di millisecondi e il calcolo di una partita circa mezzo secondo. Un Durable Object ha fino a 30 s di CPU per richiesta anche sul piano
gratuito. Due istanze: `auth` (password) e `tick` (partite), così un accesso non aspetta il calcolo di una partita.

Atomicità: ogni operazione che muove monete è un `DB.batch` (una transazione SQL). Se un vincolo fallisce (saldo che
andrebbe sotto zero, riferimento già usato, oggetto già posseduto) non viene scritto niente.

Tabelle (`cloud/migrations/0001_schema.sql`): users, sessions, wallets, transactions, fixtures, match_events, bets,
bet_items, bet_reactions, shop_items, inventory, equipped, daily_claims, achievements, user_achievements,
signup_limits, meta. Le scommesse condivise, la visibilità e le copie sono colonne di `bets`.

## Cosa serve

- Un account Cloudflare (il piano gratuito basta per iniziare): https://dash.cloudflare.com/sign-up
- Node.js 22 o più recente.
- Il resto si installa con `npm install` dentro `cloud/` (c'è `wrangler`, lo strumento di Cloudflare).

## Primo deploy

Dalla cartella del progetto:

```bash
cd cloud
npm install
npx wrangler login                       # si apre il browser: autorizza wrangler sul tuo account
npx wrangler d1 create campo-aperto      # crea il database e stampa il suo database_id
```

Copia il `database_id` stampato in `cloud/wrangler.toml`, al posto di `00000000-0000-0000-0000-000000000000`.
Poi un segreto per le statistiche di registrazione (una stringa casuale qualsiasi, non serve ricordarla):

```bash
npx wrangler secret put SIGNUP_SALT
```

E infine:

```bash
npm run deploy     # = motore del gioco + migrazioni sul database online + pubblicazione del Worker
```

Alla fine wrangler stampa l'indirizzo, del tipo `https://campo-aperto-api.<tuo-sottodominio>.workers.dev`.
Controllo:

```bash
curl https://campo-aperto-api.<tuo-sottodominio>.workers.dev/api/status
# {"api":1,"engine":"b8a13aa6784c","game":"0.6.0","serverTime":...}
```

`engine` è l'impronta del motore: deve essere uguale a quella del gioco (la mostra *Impostazioni → Online → Prova
collegamento*), altrimenti le partite si vedono solo come cronaca e non in 3D.

Il cron parte da solo (ogni minuto): entro un paio di minuti compaiono le prime partite.

## Collegare il gioco al server

Tre modi, dal più comodo:

1. **Nella release**: su GitHub, *Settings → Secrets and variables → Actions → Variables*, crea la variabile
   `CAMPO_API_URL` con l'indirizzo del Worker. Le build della release la includono come server predefinito.
2. **In `package.json`**: `"campoApiUrl": "https://…workers.dev"` (vale per tutte le build locali).
3. **A mano**: nel gioco, *Impostazioni → Online → Server dell'economia*.

Nell'app desktop le richieste HTTPS sono permesse dalla politica di sicurezza della pagina (CSP `connect-src https:`).

## Variabili

| Nome | Dove | Valore predefinito | A cosa serve |
|---|---|---|---|
| `FIXTURE_INTERVAL_MIN` | `wrangler.toml` `[vars]` | `10` | minuti tra una partita del server e la successiva |
| `FIXTURES_AHEAD` | `wrangler.toml` | `6` | quante partite future tenere in programma |
| `START_BALANCE` | `wrangler.toml` | `1000` | monete alla registrazione |
| `SIGNUP_PER_DAY` | `wrangler.toml` | `5` | account al giorno dalla stessa rete (si salva solo un hash dell'indirizzo) |
| `SIGNUP_SALT` | segreto (`wrangler secret put`) | — | sale dell'hash della rete |
| `TEST_MODE` | **solo** `cloud/.dev.vars` (in locale) | — | `1` abilita `/api/_test/clock` e `/api/_test/tick`: mai in produzione |

## Aggiornare

- **Solo codice del server** (`cloud/src/`): `npm run deploy`.
- **Nuove tabelle o colonne, prezzi, oggetti**: una nuova migrazione `cloud/migrations/0003_….sql` (mai modificare un
  file già applicato), poi `npm run deploy` (applica le migrazioni mancanti, in ordine, una volta sola).
  Esempio per cambiare un prezzo: `UPDATE shop_items SET price = 400 WHERE id = 'scarpe_fuoco';`.
- **Motore del gioco** (`src/01..08`): cambia l'impronta. Pubblica prima il server (`npm run deploy`), poi la release del
  gioco. Le partite già create restano valide (sono già calcolate e salvate): si liquidano normalmente, ma il gioco nuovo
  le mostra come cronaca invece che in 3D. Se il motore cambia molto, rifai la calibrazione delle quote:
  `node scripts/calibra-quote.mjs 40` (circa 4 minuti) e pubblica.

## Backup

```bash
npx wrangler d1 export campo-aperto --remote --output backup-$(date +%F).sql
```

Il file contiene schema e dati: con `npx wrangler d1 execute <altro-database> --remote --file backup-….sql` si
ricrea tutto in un database nuovo. In più D1 tiene una storia delle modifiche (*Time Travel*) per tornare a un momento
preciso:

```bash
npx wrangler d1 time-travel info campo-aperto
npx wrangler d1 time-travel restore campo-aperto --timestamp=2026-10-05T12:00:00Z
```

La durata della storia dipende dal piano (controlla la pagina dei limiti di D1).

## Tornare indietro

- **Codice del Worker**: `npx wrangler deployments list` mostra le versioni pubblicate,
  `npx wrangler rollback <id-versione>` torna a una precedente.
- **Database**: le migrazioni non si annullano da sole. Per tornare indietro si scrive una nuova migrazione che
  rimette le cose a posto, oppure si usa Time Travel (sopra) per l'intero database.
- **Una partita sbagliata**: si annulla e si rimborsano tutte le giocate:
  `npx wrangler d1 execute campo-aperto --remote --command "UPDATE fixtures SET status='VOID' WHERE code='PA-XXXXX'"`.
  Al giro successivo (entro un minuto) le sue selezioni diventano nulle: le singole vengono rimborsate, nelle multiple
  quella partita conta quota 1.

## Limiti del piano gratuito

I limiti cambiano nel tempo: controllali su https://developers.cloudflare.com/workers/platform/limits/ e
https://developers.cloudflare.com/d1/platform/limits/. Al momento della scrittura (ottobre 2026) il piano gratuito ha,
tra l'altro: 100.000 richieste al giorno (Worker e Durable Object insieme), 10 ms di CPU per richiesta Worker, 30 s per
richiesta Durable Object, per D1 5 milioni di righe lette e 100.000 scritte al giorno e 5 GB di spazio.

Consumo stimato di questo server:
- cron: 1.440 giri al giorno; ogni partita nuova scrive circa 50-100 righe (la partita e i suoi eventi), cioè
  10.000-15.000 righe al giorno con una partita ogni 10 minuti;
- un giocatore che guarda il centro partita fa una richiesta ogni 6 secondi quando arrivano scommesse nuove e ogni
  20 secondi quando è tutto fermo, più le quote ogni 15 secondi: circa 400-800 richieste all'ora;
- gli eventi delle partite vecchie senza scommesse si cancellano dopo 14 giorni.

- una partita online con 5 persone: l'host manda 30 aggiornamenti al secondo e ogni giocatore fino a 30 comandi al
  secondo; Cloudflare conta i messaggi WebSocket in arrivo a gruppi di 20 come una richiesta, quindi nel caso peggiore
  circa 27.000 richieste per ora di gioco (da verificare sulla pagina dei prezzi dei Durable Objects).

Con un gruppo di amici si sta nei limiti; se giocate online molte ore al giorno, controllate il riquadro "Utilizzo"
della dashboard. Se il gioco cresce, il piano Workers a pagamento alza tutti i limiti.

## Sicurezza: cosa controlla il server

| Tentativo | Cosa succede |
|---|---|
| cambiare il saldo | non esiste nessun indirizzo che lo scriva; i campi in più nelle richieste sono ignorati |
| cambiare una quota | la quota la calcola il server; se quella mandata è diversa: `409 ODDS_CHANGED`, niente addebito |
| giocare a nome di un altro | l'identità viene solo dal token; `userId` e simili nel corpo sono ignorati |
| doppio clic, rete instabile, replay | ogni giocata ha una chiave (`clientKey`) unica per utente: la stessa richiesta restituisce la stessa scommessa |
| scrivere un risultato o farsi pagare | nessun indirizzo per farlo; la liquidazione la fa solo il Durable Object con i fatti della partita calcolata |
| scommettere a partita iniziata | chiuso 10 s prima del calcio d'inizio; il seme si rivela solo al calcio d'inizio |
| saldo insufficiente, anche con richieste in parallelo | vincolo `balance >= 0` nella stessa transazione: passa solo quella che ci sta (`402`) |
| comprare senza monete o a prezzo zero | il prezzo è quello del database; `402` e nessun oggetto |
| indossare oggetti non comprati | l'equipaggiamento si scrive solo se l'oggetto è nell'inventario (`403`) |
| modificare, condividere o cancellare scommesse altrui | solo il proprietario; per gli altri la scommessa "non esiste" (`404`) |
| vedere scommesse private | `404` come se non esistessero; nel feed solo pubbliche di profili pubblici |
| cambiare la privacy di un altro | la privacy si cambia solo per l'utente del token |
| indovinare password | stesso errore per utente inesistente e password sbagliata; dopo 8 errori blocco di 15 minuti |
| creare account in serie per le monete | al massimo `SIGNUP_PER_DAY` per rete al giorno |

Cosa vedono gli altri: nome utente, scommesse pubbliche (importo, quote, esito), aspetto del personaggio, obiettivi.
Mai: email (non viene chiesta), password, id interni, token, indirizzo IP, saldo.

Limiti onesti:
- il premio spettatore controlla solo il momento (secondo tempo di una partita in corso) e i limiti, non può sapere se lo
  schermo era davvero acceso;
- il seme pubblico dal calcio d'inizio permette a chiunque di calcolare il resto della partita: per questo non ci sono
  scommesse a partita in corso;
- il limite di registrazioni per rete si aggira cambiando rete: tiene lontani solo gli abusi più semplici.

## Indirizzi dell'API

Tutti sotto `/api`, JSON. Con `Authorization: Bearer <token>` quando serve l'accesso.

| Metodo e percorso | Accesso | Cosa fa |
|---|---|---|
| `GET /status` | — | versione dell'API, impronta del motore, ora del server |
| `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` | — / — / sì | account e sessione |
| `GET /me`, `GET /me/balance`, `GET /me/transactions?before=` | sì | profilo, saldo, movimenti (30 per pagina) |
| `GET /me/bets?status=open\|settled&before=` | sì | le tue scommesse (20 per pagina) |
| `POST /me/privacy` `{publicBets}`, `POST /me/avatar` `{number,name}`, `POST /me/daily` | sì | privacy, numero e nome, bonus |
| `GET /players/:nome`, `GET /players/:nome/loadout` | — | profilo pubblico, aspetto del personaggio |
| `GET /fixtures` | — | partite in corso, prossime, finite |
| `GET /fixtures/:codice` | — | dettaglio, mercati con quote attuali, eventi già avvenuti |
| `GET /fixtures/:codice/events?after=` | — | eventi nuovi (per la visione) |
| `GET /fixtures/:codice/bets?before=\|after=` | — | scommesse dei giocatori (20 per pagina) |
| `GET /fixtures/:codice/popular`, `GET /fixtures/:codice/stats` | — | più giocate, statistiche (in cache 10 s) |
| `POST /fixtures/:codice/watch-reward` | sì | premio spettatore |
| `POST /slip/quote` `{items}` | — | quote attuali e disponibilità della schedina |
| `POST /bets` `{items, stake, clientKey, visibility, copiedFrom}` | sì | gioca una scommessa |
| `GET /bets/:codice`, `POST /bets/status` `{codes}` | — | una scommessa (se visibile), esiti di più scommesse |
| `POST /bets/:codice/share`, `POST /bets/:codice/visibility`, `POST /bets/:codice/react` | sì | condividi, pubblica/privata, reazione |
| `GET /feed?before=` | — | scommesse pubbliche di tutte le partite |
| `GET /stats/today`, `GET /leaderboard?metric=&period=` | — | statistiche del giorno, classifiche (in cache) |
| `GET /shop`, `POST /shop/buy`, `GET /inventory`, `POST /inventory/equip`, `POST /inventory/unequip` | — / sì | negozio e inventario |

## Test

```bash
cd cloud
npm test                                 # mercati (21) e API (100) contro il server vero in locale
cd ..
npm run build:test
python3 tests/economy_browser_test.py    # il gioco nel browser con due giocatori e il server locale
```

I test dell'API e del browser avviano da soli `wrangler dev` con un database nuovo, in modalità test (orologio
spostabile per arrivare a fine partita senza aspettare).

Per provare tutto a mano in locale:

```bash
cd cloud
cp .dev.vars.example .dev.vars
npm run migrate:local
npm run dev                              # http://localhost:8787
curl -X POST localhost:8787/api/_test/tick   # crea subito le prime partite
```

e nel gioco *Impostazioni → Online → Server dell'economia* = `http://localhost:8787`.
