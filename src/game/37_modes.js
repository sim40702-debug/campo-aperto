// ============================================================
// CONFIGURAZIONE DELLE MODALITÀ (0.24.6) — Partita e Allenamento hanno audio e feedback separati
// Ogni effetto "da partita ufficiale" chiede qui se nella modalità attuale è previsto. L'allenamento (anche il
// tutorial: match.training) è un campo di pratica: suoni veri del pallone, dei pali, delle parate e della rete, ma
// niente telecronaca, niente scritte PALO!/TRAVERSA!/GOL!, niente esultanze, replay, fuochi d'artificio, flash dei
// fotografi e cori; il pubblico si sente appena. La partita resta com'era.
// ============================================================
const MODE_FX = {
  partita: {
    commentary: true,      // telecronaca (se accesa nelle impostazioni)
    banners: true,         // scritte grandi PALO!, TRAVERSA!
    crowd: 1,              // volume del pubblico (1 = normale)
    crowdReactions: true,  // boati, "ooh", fischi
    replay: true,          // replay dopo il gol
    celebrations: true,    // coriandoli, fuochi d'artificio, campanelli, scossone e flash dopo il gol
    flashes: true,         // flash dei fotografi sui tiri
    shake: true,           // piccoli scossoni della telecamera
  },
  allenamento: {
    commentary: false, banners: false, crowd: 0.2, crowdReactions: false, replay: false,
    celebrations: false, flashes: false, shake: false,
  },
};

// la configurazione della modalità in corso
Game.prototype.modeFx = function () {
  return MODE_FX[this.match && this.match.training ? 'allenamento' : 'partita'];
};
