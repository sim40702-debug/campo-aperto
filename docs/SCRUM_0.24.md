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
