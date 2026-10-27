// ============================================================
// NATALE (0.21) — tema di Natale del gioco
// Dalla 0.22 è il tema del gioco, sempre acceso (nella 0.21 si sceglieva in Impostazioni → Generale).
// Con il tema acceso:
// - stadio addobbato, cappelli di Babbo Natale, pallone e cartelloni di Natale, fuochi d'artificio sui gol
//   (src/client/09_render_natale.js);
// - il pubblico canta Jingle Bells e sui gol suonano i campanelli della slitta (src/client/10_audio.js);
// - telecronaca con qualche frase di Natale sui gol (src/game/21_commentary.js);
// - nella Home: neve che cade, cappello sul titolo, quanti giorni mancano a Natale e la Partita di Natale
//   (una partita rapida con la neve, di sera, con le squadre scelte nella Nuova partita);
// - due trofei: Gol sotto l'albero e Regalo di Natale (src/game/33_trophies.js).
// È solo grafica e suoni: motore, partite del server e online non cambiano.
// ============================================================

// dal 1° dicembre al 6 gennaio (l'Epifania) compreso
function isChristmasTime(d) {
  d = d || new Date();
  const m = d.getMonth(), day = d.getDate();
  return m === 11 || (m === 0 && day <= 6);
}

// giorni che mancano al 25 dicembre (0 il giorno di Natale, negativo dopo)
function daysToChristmas(d) {
  d = d || new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // fino all'Epifania conta il Natale appena passato, poi quello che arriva
  const year = d.getMonth() === 0 && d.getDate() <= 6 ? d.getFullYear() - 1 : d.getFullYear();
  const xmas = new Date(year, 11, 25);
  return Math.round((xmas - today) / 86400000);
}

class Christmas {
  constructor(game) {
    this.g = game;
    this.on = false;
  }

  // dalla 0.22 il tema di Natale è sempre acceso: è il tema del gioco per queste feste
  wanted() { return true; }

  // accende o spegne tutto il tema (all'avvio e quando cambia l'impostazione)
  apply() {
    const on = this.wanted(), changed = on !== this.on;
    this.on = on;
    const g = this.g;
    g.renderer.setChristmas(on);
    g.audio.xmas = on;
    if (g.commentary) g.commentary.xmas = on;
    document.body.classList.toggle('xmas', on);
    $('btn-xmas').hidden = !on;
    this.renderTile();
    // nel menu la partita dimostrativa ricomincia con la neve (o senza)
    if (changed && g.mode === 'menu' && g.demo) g.startDemo();
    if (g.updateMusic) g.updateMusic();
    return changed;
  }

  // riquadro della Home: quanti giorni mancano a Natale
  renderTile() {
    if (!this.on) return;
    const n = daysToChristmas();
    $('xmas-count').textContent = n > 1 ? trf('Mancano {0} giorni a Natale', n) : n === 1 ? tr('Domani è Natale!') : n === 0 ? tr('Buon Natale!') : tr('Buone feste!');
  }

  // Partita di Natale: le squadre della Nuova partita, di sera sotto la neve
  start() {
    this.g.startMatch(true);
  }
}
