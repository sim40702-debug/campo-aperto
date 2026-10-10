// ============================================================
// RIGORI — inquadrature della serie dei rigori
// Come in televisione: tutti in fila a centrocampo, poi la telecamera dietro al tiratore (che si avvicina piano
// piano mentre lui prende la rincorsa), poi il tiratore visto dalla porta mentre esulta o si dispera.
// Tra un'inquadratura e l'altra c'è uno stacco netto, dentro la stessa inquadratura la telecamera si muove morbida.
// ============================================================
Renderer.prototype.shootoutCamera = function (dt, m, bx, by, bz) {
  const so = m.so, cam = this.camera;
  const want = this._want, look = this._look;
  const gx = CONFIG.HALF_L;                         // chi tira attacca sempre verso destra (x positiva)
  const spot = gx - CONFIG.PENALTY_SPOT;
  const k = so.kicker;
  const kx = k ? (k.rx !== undefined ? k.rx : k.x) : spot, kz = k ? (k.rz !== undefined ? k.rz : k.z) : 0;
  let shot;
  if (so.phase === 'intro') {
    // le due squadre in fila a centrocampo, viste di lato
    shot = 'intro';
    want.set(-7, 4.2, 15); look.set(0, 1.2, -2);
  } else if (so.phase === 'kick' && m.state !== 'PLAY') {
    // rincorsa: dietro al tiratore, la porta in fondo. Più dura l'attesa, più la telecamera si avvicina
    shot = 'kick' + so.log.length;
    const push = Math.min(1, m.stateTime / 4);
    want.set(spot - 7.5 + push * 2.2, 2.1 - push * 0.3, 2.4 - push * 0.6);
    look.set(gx, 1.2, 0);
  } else if (so.phase === 'kick') {
    // tiro partito: la telecamera resta ferma e segue il pallone
    shot = 'kick' + so.log.length;
    want.copy(cam.position);
    look.set(Math.max(bx, spot + 2), Math.max(1, by * 0.8), bz * 0.8);
  } else {
    // risultato: il tiratore visto dalla porta
    shot = 'result' + so.log.length;
    want.set(gx - 2.5, 1.7, kz > 0 ? -3.5 : 3.5);
    look.set(kx, 1.3, kz);
  }
  if (shot !== this._soShot) {
    // stacco: la telecamera salta subito al punto giusto
    this._soShot = shot;
    cam.position.copy(want);
    this.camTarget.copy(look);
  } else {
    cam.position.lerp(want, 1 - Math.exp(-2.2 * dt));
    this.camTarget.lerp(look, 1 - Math.exp(-4 * dt));
  }
  cam.lookAt(this.camTarget);
};
