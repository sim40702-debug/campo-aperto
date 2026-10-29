# Scrum — versione 0.24.0 (nuova generazione)

## Ruoli
- **Product Owner**: Simone. Decide le priorità (le 8 della richiesta del 29/10/2026) e accetta il lavoro.
- **Scrum Master e team di sviluppo**: Claude. Organizza gli sprint, sviluppa, prova, prepara la review.

## Definition of Done (vale per ogni storia)
1. Implementato nei file veri del gioco (non solo descritto) e compatibile: controlli, punteggio, gol, online e
   partite del server funzionano come prima.
2. Verificato con un test automatico che misura la cosa richiesta (non solo un'immagine).
3. Nessun errore nella console, `npm test` e i test nel browser superati.
4. Prestazioni: niente oggetti in più per ogni fotogramma, qualità Bassa sempre leggera.
5. Scritto nel CHANGELOG.

## Product Backlog (in ordine di priorità del Product Owner)
| # | Storia | Criteri di accettazione principali |
|---|---|---|
| 1 | **Portiere** con reazioni intelligenti, tuffi fluidi e parate credibili | tempo di reazione, lettura di traiettoria (velocità, altezza, direzione), passi laterali morbidi, tuffi con preparazione/spinta/volo/contatto/atterraggio, parate alte, basse, centrali, ravvicinate, con deviazione, recupero senza teletrasporto, reattivo ma non imbattibile (dipende da traiettoria, distanza, reazione) |
| 2 | **Giocatori** con modelli, divise e animazioni migliori | proporzioni, volti (occhi, capelli), maglie con cuciture e colletto, materiali distinti, corsa/sprint/frenata/cambio di direzione/salto/tiro naturali, piede che non attraversa il pallone |
| 3 | **Porta e rete 3D dinamica** | maglie sottili e regolari attaccate a pali e traversa, deformazione nel punto d'impatto che si propaga e oscilla, dipende da velocità, direzione e punto, il pallone non attraversa mai la rete, pali metallici con ombre |
| 4 | **Pallone premium originale** | pannelli moderni, cuciture e micro-rilievi, materiale sintetico con riflessi, nessun marchio o scritta, rotazione corretta e ben visibile, dimensione e collisione invariate |
| 5 | **Campo** | erba più naturale, linee nitide, ombre e luce migliori |
| 6 | **Fisica del pallone** coerente | velocità, rimbalzi, collisioni con pali, traversa e rete |
| 7 | **Telecamera** più cinematografica | movimenti fluidi, anticipo dell'azione, inquadrature chiare |
| 8 | **Effetti** discreti | tiri, parate e gol senza esagerare |

## Sprint
- **Sprint 1 — Portiere** (storia 1).
- **Sprint 2 — Porta e rete** (storie 3 e 6: la rete fa parte della fisica del pallone).
- **Sprint 3 — Pallone** (storia 4).
- **Sprint 4 — Giocatori** (storia 2).
- **Sprint 5 — Campo, telecamera, effetti, rilascio** (storie 5, 7, 8; quote ricalcolate; release 0.24.0).

Ogni sprint finisce con una **review** (cosa è fatto, come è stato provato, cosa resta) scritta qui sotto.

## Review degli sprint
(si compila alla fine di ogni sprint)

### Sprint 1 — Portiere: fatto
- **Motore** (`07_ai.js`, `08_match.js`, `04_player.js`): il portiere vede il tiro, aspetta il suo tempo di reazione
  (0,25-0,45 s secondo la bravura), calcola dove il pallone attraversa la sua linea (velocità, altezza, direzione) con
  un piccolo errore di lettura che diminuisce mentre il pallone si avvicina. Passi laterali con accelerazione e frenata
  graduali; si tuffa solo se a piedi non ci arriva, all'ultimo momento utile. Tuffo vero nel motore: spinta (0,13 s),
  volo, atterraggio con attrito, 0,5 s a terra. Tocca il pallone solo se è davvero alla portata delle mani (non più a un
  metro di distanza). Parate: presa, respinta, deviazione con la punta delle dita (sopra la traversa o di lato quando
  è fisicamente possibile), e a volte il pallone gli scivola sotto.
- **Grafica** (`09_render_keeper.js`): la posa voluta si fonde con quella del fotogramma prima (blending), il corpo in
  volo si inclina verso l'altezza del pallone, dopo il tuffo resta a terra, si spinge con le braccia e si rialza.
- **Prove**: `tests/portiere_test.js` (14 controlli: reazione, tuffo vero, niente teletrasporti, accelerazione, parate
  centrali sicure, tiri angolati a volte gol, lontano parato più spesso che vicino, stesso seme stesso risultato);
  `tests/novita024_browser_test.py` (tuffo nel gioco vero senza scatti, recupero lento); `rules_test` 31/31.
- **Equilibrio**: 3,8 → 3,3 gol a partita tra computer (16 partite di prova): il portiere è più bravo ma non imbattibile.
- **Resta**: il riferimento del motore (`motore_ref.json`) e le quote si rifanno nello sprint 5.

### Sprint 2 — Porta e rete (con la fisica del pallone nella rete): fatto
- **Motore** (`03_ball.js`): la rete è elastica. Il pallone entra solo dalla bocca della porta; dentro, fondo, lati e
  tetto lo frenano come molle che cedono (il fondo fino a 55 cm) e poi lo lasciano ricadere piano (niente effetto
  fionda). Da fuori (esterno della rete, pallone che cade sul tetto, pallone da dietro) rimbalza piano e non entra mai.
  Il tetto ha la stessa pendenza della rete disegnata (`goalRoofY`). Il gol si riconosce come prima.
- **Grafica** (`09_render_net.js`, nuovo): rete 3D a nodi (maglie di 13-22 cm secondo la qualità) agganciata a pali,
  traversa e telaio dietro. Il pallone spinge i nodi nel punto preciso dove arriva (da dentro e da fuori), i fili
  tirano i vicini e la deformazione si propaga come un'onda, poi oscilla e torna a riposo. Quando nessuno la tocca non
  si calcola. Pali e traversa in metallo verniciato lucido con ombre, telaio dietro in metallo grigio.
- **Prove**: `tests/rete_test.js` (14 controlli: cede e frena gradualmente, non esce dal fondo, niente fionda, tiro
  debole, incrocio, esterno della rete, tetto, da dietro, gol riconosciuti); `novita024_browser_test.py` (rete che si
  gonfia di oltre 30 cm sul tiro forte, lati sull'esterno della rete, torna ferma, costo basso).
- **Resta**: le linee della rete non fanno ombra sull'erba (in three.js le linee non proiettano ombre; servirebbe una
  rete fatta di superfici, molto più pesante).

### Sprint 3 — Pallone: fatto
- **Grafica** (`09_render_ball.js`, nuovo): disegno originale senza marchi né scritte, 6 pannelli a elica con bordi
  curvi, fasce blu notte e oro lungo le cuciture (a Natale rosso, verde e oro), solco delle cuciture e micro-trama a
  esagoni in rilievo (bumpMap), materiale sintetico con vernice lucida (clearcoat) a qualità alta. Dimensione
  disegnata e collisioni uguali a prima.
- **Rotazione vera**: prima il pallone girava con due angoli sommati in modo sbagliato (a volte "scivolava"); ora
  ruota con un quaternione attorno all'asse perpendicolare alla direzione, angolo = strada / raggio; in volo mantiene
  la rotazione del calcio e segue l'effetto (spin e topspin del motore); anche nel replay.
- **Prove**: `novita024_browser_test.py` (dimensione, rilievo, asse e angolo della rotazione, punto a contatto che
  non striscia, rotazione in volo).
- **Resta**: niente.

### Sprint 4 — Giocatori: fatto (con i limiti dei modelli fatti di forme semplici)
- **Modelli** (`09_render.js`, `09_render_players.js` nuovo): occhi con bianco, iride e pupilla, bocca e zigomi;
  maglia con colletto a polo e apertura, orlo, cuciture sui fianchi (anche sui pantaloncini) e orlo dei pantaloncini;
  parastinchi sotto il calzettone; scarpe con zona dei lacci, suola e tacchetti (qualità media e alta).
- **Materiali**: un solo materiale per tutti (nessun costo in più), ma ogni pezzo ha la sua opacità (pelle, stoffa,
  capelli, scarpe lucide, suola, occhi) e la stoffa ha pieghe calcolate sulla superficie (in vita, sotto le braccia).
- **Animazioni**: corsa, scatto, cambio di direzione, salto, tiro, dribbling, contrasti ed esultanze c'erano già
  (09_render_gait.js, 09_render_kicks.js, 09_render_celebrate.js). Nuovo: frenata forte con la gamba avanti che pianta
  il piede e braccia larghe; braccio esterno che si apre in curva; il pallone disegnato non entra mai nelle scarpe.
- **Prove**: `novita024_browser_test.py` (opacità per pezzo, stoffa, pallone fuori dalla scarpa, frenata).
- **Resta / asset esterni**: volti e corpi realistici come nei giochi commerciali non si fanno con forme semplici.
  Servirebbero modelli 3D con scheletro (file GLTF/GLB, ~5.000-15.000 triangoli per calciatore, con texture di
  volto e divisa e normal map) e animazioni registrate dal vivo (motion capture: corsa, scatto, frenata, tiro,
  passaggio, contrasto, esultanze), con una licenza che permetta di usarli nel gioco. Il gioco è pronto ad
  accoglierli (three.js li carica con GLTFLoader e AnimationMixer) ma è un lavoro a parte.

### Sprint 5 — Campo, telecamera, effetti, rilascio: fatto
- **Campo** (`09_render_field.js`, nuovo): linee del campo fatte di geometria (12 cm, nitide da vicino e da lontano,
  ricevono le ombre), non più disegnate nella texture; prato con macchie di colore larghe e naturali.
- **Telecamera televisiva**: guarda avanti nella direzione del pallone (o di chi lo porta) e davanti alle porte si
  abbassa e si avvicina, con movimenti morbidi.
- **Effetti discreti**: sbuffo e piccolo scossone sul palo, zolle d'erba quando il portiere atterra dopo un tuffo.
- **Prove**: `novita024_browser_test.py` (20 controlli in tutto), `npm test` tutto superato, test nel browser delle
  versioni precedenti superati, nessun errore nella console.
- **Rilascio**: riferimento del motore (`motore_ref.json`) rifatto per la 0.24.0. Le quote delle scommesse vanno
  ricalcolate con il nuovo motore (`cloud/scripts/calibra-quote.mjs`) prima di aggiornare il server: il ricalcolo è
  lungo e il Product Owner ha chiesto di pubblicare subito l'app.

## Sprint dopo la 0.24.0 (uno alla volta, ognuno con la sua versione)
Il Product Owner ha chiesto: ogni sprint finito e provato esce subito come versione (0.24.1, 0.24.2, …), poi si
parte con il prossimo.

### Sprint 0.24.1 — Tutte le novità anche in allenamento: fatto
- **Problema trovato**: l'allenamento usa lo stesso motore e la stessa grafica della partita, ma nelle pause tra un
  tentativo e l'altro (`TrainingMatch.step`) non si salvavano le posizioni del passo precedente, che la grafica usa
  per disegnare: pallone e giocatori disegnati restavano fermi. Dopo un gol il pallone si fermava sulla linea, la
  rete non si muoveva e il tuffo del portiere si bloccava. Stessa cosa nel tutorial.
- **Correzione**: `rememberPositions()` in `28_training.js`, usata nelle pause dell'allenamento e del tutorial.
- **In più**: il messaggio "Aggiornato alla versione" aspetta la fine del caricamento.
- **Prove**: `novita024_browser_test.py` (gol in tiri, punizioni, rigori e dribbling: pallone in rete, rete che si
  gonfia, portiere che si tuffa), `updates_browser_test.py` 32/32, `npm test`.
