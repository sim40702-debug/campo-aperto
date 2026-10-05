# Arbitro, eventi e fisica — come funzionano (0.5.0)

## Principio
Il contatto da solo non è mai fallo. Ogni contrasto passa per due funzioni in `src/08_referee.js`:

1. `analyzeChallenge(match, tackler, victim, kind)` ricostruisce la dinamica (`kind`: `stand` in piedi, `slide` scivolata,
   `charge` urto di corsa):
   - linea dell'intervento: in piedi verso il pallone, in scivolata lungo la corsa, nell'urto verso l'avversario;
   - pallone raggiungibile (portata 1.5 m in piedi, 2.6 m in scivolata, poco di lato, sotto 0.9 m di altezza);
   - corpo dell'avversario (raggio 0.28 m più 0.12 della gamba): se sta prima del pallone sulla linea, il pallone è coperto;
   - il piede arriva sul pallone? Unica parte casuale, solo se il pallone è raggiungibile e non coperto: difesa contro
     dribbling, distanza laterale, velocità del portatore;
   - fin dove arriva la gamba: dopo il pallone solo con lo slancio; a vuoto in piedi si ferma dove era il pallone
     (l'avversario lo ha spostato e salta il difensore), in scivolata va fino in fondo;
   - contatto, chi tocca prima il pallone, punto di contatto (piedi, gambe, corpo), da dietro o di lato, velocità di impatto;
   - contesto: area di rigore, attacco promettente, chiara occasione da rete (nessun difensore di movimento tra
     l'attaccante e la porta, entro 28 m, diretto verso la porta).
2. `evaluateChallenge(c)` decide in modo deterministico e restituisce
   `{ legal, foul, advantage, yellow_card, red_card, severity, reason }`:
   - nessun contatto: regolare;
   - pallone preso per primo: regolare, salvo forza eccessiva (gravità ≥ 0.72);
   - contatto senza aver preso prima il pallone: fallo;
   - urto di corsa: regolare di fianco o di fronte, fallo solo se da dietro sopra 4.5 m/s;
   - gravità = velocità di impatto / 9 × 0.5 + scivolata 0.18 + da dietro 0.24 (di lato 0.06) + gambe 0.08;
     giallo da 0.55 (imprudente), rosso da 0.85 (grave fallo di gioco);
   - occasione da rete negata: rosso, oppure giallo in area se si è provato a giocare il pallone (regola 12);
   - attacco promettente interrotto: giallo (fallo tattico);
   - fascia di incertezza ±0.04 attorno alle soglie: l'unica componente casuale della decisione.

## Dopo il fallo (`src/08_match.js`)
- **Vantaggio**: solo nella metà campo d'attacco, con un compagno che arriva per primo sul pallone (chi subisce il fallo è a
  terra). Mai per rigori, rossi od occasioni da rete negate. Se entro 2.5 s un avversario tocca il pallone si torna al
  punto del fallo; altrimenti si gioca e il cartellino arriva alla prossima interruzione.
- **Punizione** nel punto del fallo (avversari a 9.15 m, barriera vicino alla porta), **rigore** se il punto è nell'area
  di chi commette il fallo.
- **Cartellini** al fischio (la ripresa aspetta 1.6 s per cartellino). Secondo giallo = rosso. L'espulso esce dalla squadra
  (`team.players`) ma resta nella rosa (`team.roster`), cammina fuori dal campo e sparisce. Portiere espulso: in porta va
  il difensore più arretrato.
- **Fuorigioco**: posizione registrata nel momento in cui il compagno gioca il pallone (passaggio, cross, colpo di testa e
  anche tiro), punito solo se il giocatore in fuorigioco tocca il pallone. Parate e deviazioni non lo annullano.

## Eventi di partita
`match.matchEvent(type, info)` registra in `match.timeline`: GOAL, FOUL, YELLOW_CARD, SECOND_YELLOW, RED_CARD, PENALTY,
FREE_KICK, CORNER, OFFSIDE, THROW_IN, GOAL_KICK, ADVANTAGE, KICK_OFF, HALF_TIME, FULL_TIME. Ogni evento ha minuto, tempo,
giocatore, vittima, squadra, posizione, motivo, gravità e conseguenza.

## Multiplayer
Solo l'host simula e decide. I client ricevono:
- gli eventi (`ref`, ripuliti da `cleanNetEvent`) e li aggiungono al proprio registro, identico a quello dell'host;
- nell'istantanea binaria (14 valori per calciatore, sempre tutti i 22 nell'ordine della rosa) cartellini, espulsione,
  uscita dal campo e caduta; il vantaggio in corso nell'intestazione;
- nel messaggio `meta` il testo e lo stile della scritta, le statistiche e l'elenco dei cartellini.

## Fisica
- **Movimento** (`Player.steer`): variazione di velocità limitata dall'accelerazione; la spinta cala forte verso la
  velocità massima (90% in circa 1.1 s, l'ultimo tratto il più lento), frenare è due volte più rapido, in sprint si curva
  più largo. Il pallone al piede si allontana di più correndo e in sprint.
- **Pallone** (`stepBallPhysics`): resistenza dell'aria proporzionale a v² (un tiro a 30 m/s perde circa il 30% in un secondo,
  un passaggio a 10 m/s l'11%), effetto Magnus laterale (tiro a giro, cross) e verticale (topspin scende, backspin
  galleggia), rimbalzo che restituisce meno energia negli impatti forti, attrito e rotolamento sull'erba.
- **Calci**: passaggi alti e tiri calcolati simulando il volo vero (`solveFlight`, `simulateFlight`), con mira corretta per
  la curva dell'effetto. Tiri: piatto rasoterra (carica corta), normale, potente (topspin, meno preciso, rischia di
  andare alto), a giro (tasto del pressing tenuto). Passaggi: corto, teso (pressing + passaggio), lungo, cross, filtrante
  nello spazio davanti alla corsa del compagno, filtrante alto (pressing + filtrante).
- **Controllo**: sopra una certa velocità relativa il primo tocco è lungo e il pallone scappa avanti.
- **Collisioni**: tra giocatori urto con massa (fisico e altezza), senza compenetrazioni; il pallone rimbalza sul corpo di
  chi non lo può giocare; pali, traversa e rete come prima, con la rete che si gonfia nella grafica.

## Test
`node tests/referee_test.js`: i 10 casi richiesti (contrasti veri ripetuti con 100-200 semi) più fuorigioco, eventi e
fisica. Il caso in multiplayer è in `tests/net_test.js` (TEST 10).
