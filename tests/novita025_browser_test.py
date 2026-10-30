# Novità della 0.25 nel gioco vero (Chromium headless). Sprint 0.25.0: la rete della porta.
# Scenari con tiri veri (motore): tiro forte al centro, negli angoli alto e basso, pallone lento, rete presa da fuori.
# Per ognuno si misura dove e quanto si deforma la rete, che l'oscillazione si spenga piano, che la rete non entri mai
# nel pallone, che il suono della rete parta una volta sola e più forte per i tiri forti. Poi i fili veri (cilindri
# con ombra da vicino, linee da lontano) e la rete attaccata dietro ai pali.
# Sprint 0.25.2: luce e ombre: ombra del sole che segue l'inquadratura (più nitida), riflessi dell'ambiente,
# ombre dei fari di sera (quattro per calciatore) e non di giorno.
# Sprint 0.25.3: palo e traversa fanno vibrare la porta e tremare la rete.
# Sprint 0.25.4: palloni da scegliere nelle impostazioni, telecamera TV col teleobiettivo, riflesso dell'erba, fasci dei fari.
# Sprint 0.25.5: punizioni dell'allenamento più giuste (barriera di due, mirino preciso, portiere battibile negli angoli).
# Prima: node build.js test. Uso: python3 tests/novita025_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

# un tiro verso la porta di destra (x = 52,5), portiere e giocatori lontani; misure della rete fotogramma per fotogramma
SHOT = """(sc) => { const [x0, y, z, vx, vy, vz] = sc;
    game.quitToMenu(); game.setup.side = -1; game.startMatch(); for (let i = 0; i < 30; i++) game.updateOffline(1/60);
    const m = game.match, R = game.renderer, t = m.teams.find(q => q.dir > 0), s = t.players[9];
    for (const q of m.allPlayers()) { q.x = -30; q.z = 30; }
    m.state = 'PLAY'; m.ball.owner = null; m.ball.x = 52.5 - x0; m.ball.y = y; m.ball.z = z; m.ball.vx = vx; m.ball.vy = vy; m.ball.vz = vz; m.ball.lastTouch = s;
    const net = R.nets.find(n => n.side > 0), env = []; let maxD = 0, at = null, viol = 0;
    const sounds = []; const he = game.handleEvent.bind(game); game.handleEvent = e => { if (e.type === 'net') sounds.push(e.power || 0); return he(e); };
    for (let f = 0; f < 150; f++) {
      game.updateOffline(1/60);
      let fm = 0, fi = 0;
      for (let i = 0; i < net.n; i++) { const o = i * 3, v = Math.hypot(net.d[o], net.d[o + 1], net.d[o + 2]); if (v > fm) { fm = v; fi = i; } }
      if (f % 10 === 9) env.push(fm);
      if (fm > maxD) { maxD = fm; at = [net.rest[fi * 3], net.rest[fi * 3 + 1], net.rest[fi * 3 + 2]]; }
      const B = R.ballMesh.position;
      for (let i = 0; i < net.n; i++) { const o = i * 3; if (Math.hypot(net.rest[o] + net.d[o] - B.x, net.rest[o + 1] + net.d[o + 1] - B.y, net.rest[o + 2] + net.d[o + 2] - B.z) < BALL_VIS_R - 0.01) viol++; }
    }
    game.handleEvent = he;
    const peak = Math.max(...env);
    return { maxD: maxD, at: at, peak: peak, end: env[env.length - 1], viol: viol, sounds: sounds, goal: t.score }; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda msg: errs.append(msg.text) if msg.type == 'error' else None)
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "media", dynamicRes: false, intro: false})); localStorage.setItem("campoAperto.tutorialHint", "1")')
        await pg.goto(URL, timeout=120000)
        await pg.wait_for_function('window.game && game.loaded', timeout=90000, polling=250)
        await pg.evaluate("() => { game.loop = () => {}; }")

        forte = await pg.evaluate(SHOT, [10, 1.0, 0.3, 32, 1.2, 0])
        check('tiro forte al centro: gol, la rete si gonfia molto (oltre 40 cm) proprio dove arriva il pallone', forte['goal'] == 1 and forte['maxD'] > 0.4 and abs(forte['at'][2] - 0.3) < 0.8 and forte['at'][1] < 1.6, forte)
        check('tiro forte al centro: l\'oscillazione si spegne piano (dopo 2,5 s meno di un decimo)', forte['end'] < forte['peak'] * 0.1 and forte['end'] > 0, [forte['peak'], forte['end']])
        check('tiro forte al centro: la rete non entra mai nel pallone; un solo suono della rete', forte['viol'] == 0 and len(forte['sounds']) == 1, forte)
        alto = await pg.evaluate(SHOT, [10, 1.6, 0.5, 28, 2.4, 6.0])
        check('angolo alto: si deforma proprio l\'angolo (in alto, vicino al lato)', alto['goal'] == 1 and alto['maxD'] > 0.3 and alto['at'][2] > 2.6 and alto['at'][1] > 1.0, alto)
        basso = await pg.evaluate(SHOT, [10, 0.2, -0.5, 26, 0.6, -6.5])
        check('angolo basso: si deforma l\'angolo in basso dall\'altra parte', basso['goal'] == 1 and basso['maxD'] > 0.3 and basso['at'][2] < -2.6 and basso['at'][1] < 0.8, basso)
        lento = await pg.evaluate(SHOT, [4, 0.11, 0, 9, 0, 0.3])
        check('pallone lento: entra e la rete si muove poco (meno del tiro forte), suono più debole', lento['goal'] == 1 and 0.03 < lento['maxD'] < forte['maxD'] * 0.6 and len(lento['sounds']) == 1 and lento['sounds'][0] < forte['sounds'][0], [lento['maxD'], lento['sounds'], forte['sounds']])
        fuori = await pg.evaluate(SHOT, [2, 0.6, 6.0, 10, 1.0, -9.0])
        check('rete presa da fuori: il lato cede verso dentro, il pallone resta fuori (niente gol)', fuori['goal'] == 0 and fuori['maxD'] > 0.08 and fuori['at'][2] > 3.4 and fuori['viol'] == 0, fuori)
        check('tutti i tiri: nessuna compenetrazione tra rete e pallone', all(x['viol'] == 0 for x in (forte, alto, basso, lento, fuori)))

        th = await pg.evaluate("""() => { const R = game.renderer, net = R.nets.find(n => n.side > 0), C = CONFIG;
            const T = net.threads; const out = { threads: !!T && T.count === net.edges.length / 2, shadow: !!T && T.castShadow };
            // da vicino: fili veri visibili e niente linee; da lontano: linee e fili solo per l'ombra
            R.camera.position.set(48, 2, -5); R.updateNets(1/60); out.near = T.material === T.userData.near && !net.lines.visible;
            R.camera.position.set(0, 20, 41); R.updateNets(1/60); out.far = T.material === T.userData.far && net.lines.visible;
            // la rete parte dal retro dei pali: i nodi fissati davanti stanno a POST_R dalla linea di porta
            let front = 9; for (let i = 0; i < net.n; i++) if (net.pin[i] && net.rest[i * 3 + 1] > 0.3) front = Math.min(front, net.rest[i * 3] - C.HALF_L);
            out.front = front; return out; }""")
        check('fili veri: un cilindro per filo che fa ombra; da vicino i fili, da lontano le linee', th['threads'] and th['shadow'] and th['near'] and th['far'], th)
        check('rete attaccata dietro ai pali e alla traversa (non dentro)', abs(th['front'] - 0.06) < 0.02, th)

        lt = await pg.evaluate("""() => { const out = {};
            for (const tod of ['night', 'day']) {
              game.quitToMenu(); game.setup.side = -1; game.setup.timeOfDay = tod; game.setup.weather = 'clear'; game.startMatch();
              for (let i = 0; i < 120; i++) game.updateOffline(1/60);
              const R = game.renderer, c = R.sun.shadow.camera, players = game.match.allPlayers().filter(p => !p.gone).length;
              out[tod] = { follow: Math.hypot(R.sun.target.position.x - R.camTarget.x, R.sun.target.position.z - R.camTarget.z) < 2, width: c.right - c.left,
                env: !!R.scene.environment, floods: R.floodShadows.count, players: Math.min(22, players) };
            }
            return out; }""")
        check('ombre: la luce principale fa ombra solo dove si guarda (zona più piccola di prima, 140 m) e la segue', lt['night']['follow'] and lt['night']['width'] < 140 and lt['day']['follow'], lt)
        check('riflessi dell\'ambiente sui materiali lucidi (qualità media)', lt['night']['env'] and lt['day']['env'], lt)
        check('ombre dei fari: di sera quattro per calciatore, di giorno nessuna', lt['night']['floods'] == lt['night']['players'] * 4 and lt['day']['floods'] == 0, lt)

        wd = await pg.evaluate("""() => { const out = {};
            for (const [name, z, y] of [['palo', CONFIG.GOAL_HALF_W + 0.12, 0.8], ['traversa', 0.5, CONFIG.GOAL_H + 0.1]]) {
              game.quitToMenu(); game.setup.side = -1; game.startMatch(); for (let i = 0; i < 30; i++) game.updateOffline(1/60);
              const m = game.match, R = game.renderer, t = m.teams.find(q => q.dir > 0), s = t.players[9];
              for (const q of m.allPlayers()) { q.x = -30; q.z = 30; }
              m.state = 'PLAY'; m.ball.owner = null; m.ball.x = 52.5 - 6; m.ball.y = y; m.ball.z = z; m.ball.vx = 26; m.ball.vy = 0.4; m.ball.vz = 0; m.ball.lastTouch = s;
              const g = R.goalGroups[1], net = R.nets.find(n => n.side > 0); let maxOff = 0, netMove = 0, hit = false;
              for (let f = 0; f < 60; f++) { game.updateOffline(1/60); if (R.woodShake) hit = true; maxOff = Math.max(maxOff, g.position.length());
                for (let i = 0; i < net.n; i++) netMove = Math.max(netMove, Math.abs(net.d[i * 3]) + Math.abs(net.d[i * 3 + 1])); }
              out[name] = { hit: hit, maxOff: maxOff, netMove: netMove, rest: g.position.length() };
            }
            return out; }""")
        check('palo: la porta vibra (pochi centimetri al massimo) e poi torna ferma, la rete trema', wd['palo']['hit'] and 0.002 < wd['palo']['maxOff'] < 0.03 and wd['palo']['rest'] < 0.001 and wd['palo']['netMove'] > 0.02, wd['palo'])
        check('traversa: la porta vibra e la rete trema', wd['traversa']['hit'] and wd['traversa']['maxOff'] > 0.002 and wd['traversa']['netMove'] > 0.02, wd['traversa'])

        # sprint 0.25.4: palloni da scegliere, telecamera TV col teleobiettivo, riflesso dell'erba, fasci dei fari
        bl = await pg.evaluate("""() => { const R = game.renderer, out = { ids: Object.keys(BALL_DESIGNS) }, maps = new Set();
            for (const k of out.ids) { R.setBallDesign(k); maps.add(R.ballMesh.material.map); }
            out.distinct = maps.size;
            R.xmas = true; R.setBallDesign('auto'); out.autoXmas = R.ballMesh.material.map === R._ballTexs.natale.map;
            R.xmas = false; R.setBallDesign('auto'); out.autoNormal = R.ballMesh.material.map === R._ballTexs.premium.map;
            // la scelta nelle impostazioni si salva
            game.openSettings('grafica', 'menu'); const sel = document.getElementById('st-ball');
            out.options = sel.options.length; sel.value = 'retro'; sel.onchange();
            out.saved = JSON.parse(localStorage.getItem('campoAperto.settings.v1')).ballDesign;
            out.applied = R.ballMesh.material.map === R._ballTexs.retro.map;
            sel.value = 'auto'; sel.onchange();
            return out; }""")
        check('palloni: ogni disegno ha la sua texture; automatico = Natale a dicembre, premium di solito', bl['distinct'] == len(bl['ids']) >= 8 and bl['autoXmas'] and bl['autoNormal'], bl)
        check('palloni: il menu nelle impostazioni li elenca tutti, la scelta si applica e si salva', bl['options'] == len(bl['ids']) + 1 and bl['saved'] == 'retro' and bl['applied'], bl)
        cam = await pg.evaluate("""() => { const out = {};
            game.quitToMenu(); game.setup.side = -1; game.setup.timeOfDay = 'night'; game.setup.weather = 'clear'; game.startMatch();
            const R = game.renderer;
            for (const mode of [0, 1]) { R.camMode = mode; for (let i = 0; i < 120; i++) { game.updateOffline(1/60); R.updateCamera && R.render(); } out['fov' + mode] = R.camera.fov; }
            R.camMode = 0; out.grass = R.grassView.value; out.beams = R.beams.visible;
            game.quitToMenu(); game.setup.timeOfDay = 'day'; game.startMatch(); out.beamsDay = R.beams.visible;
            return out; }""")
        check('telecamera TV col teleobiettivo (30 gradi), le altre normali (38)', abs(cam['fov0'] - 30) < 0.5 and abs(cam['fov1'] - 38) < 0.5, cam)
        check('erba: il riflesso delle strisce segue la telecamera; fasci dei fari di sera e non di giorno', cam['grass'] != 0 and cam['beams'] and not cam['beamsDay'], cam)

        # sprint 0.25.5: punizioni dell'allenamento più giuste
        fk = await pg.evaluate("""() => { const keep = game.gameInput, res = { gol: 0, barriera: 0, tiri: 0 }; let seed = 7;
            const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
            game.quitToMenu(); game.startTraining('freekick'); const m = game.match, tr = m.tr; tr.drill.tries = 999;
            res.wall = m.teams[1].players.filter(p => !p.isGK).length;
            for (let a = 0; a < 20; a++) {
              let g = 0; while ((tr.phase !== 'live' || m.state !== 'SETPIECE') && g++ < 900) game.updateOffline(1/60);
              // un giocatore normale: mira verso un angolo, alza un poco il mirino, carica il tiro
              const side = rnd() < 0.5 ? -1 : 1, aimF = 18 + rnd() * 24 | 0, upF = rnd() * 20 | 0, chF = 27 + rnd() * 30 | 0; let f = 0, wall = false;
              const start = tr.done, score = tr.score;
              game.gameInput = () => { if (m.aimMarker || f > 0) f++; if (f === 1) res.aimY = m.aimMarker.y; return { mx: f < upF ? 1 : 0, mz: f < aimF ? side : 0, sprint: false, shoot: f > 45 && f < 45 + chF, press: false, pressed: {} }; };
              while (tr.done === start && f < 60 * 14) { game.updateOffline(1/60); const t = m.ball.lastTouch; if (t && t.team === m.teams[1] && !t.isGK) wall = true; }
              res.tiri++; if (tr.score > score) res.gol++; if (wall) res.barriera++;
            }
            game.gameInput = keep;
            // il mirino non mente: un tiro col mirino a 1,2 m arriva in porta a quell'altezza (prima 30-50 cm più in alto)
            game.quitToMenu(); game.setup.side = -1; game.startMatch(); for (let i = 0; i < 30; i++) game.updateOffline(1/60);
            const t = m && game.match.teams.find(q => q.dir > 0), p = t.players[9], gx = t.oppGoalX(), b = game.match.ball, ys = [];
            for (let k = 0; k < 8; k++) {
              for (const q of game.match.allPlayers()) { q.x = -30; q.z = 30; q.kickCooldown = 0; }
              game.match.state = 'PLAY'; b.reset(gx - 22, 0); p.x = b.x - 0.7; p.z = 0; p.facing = 0; p.vx = p.vz = 0; b.owner = p;
              doShot(p, 0.5, 0.5, { curl: true, aimH: 1.2 }); b.owner = null;
              for (let f = 0; f < 200 && b.x < gx; f++) game.match.stepBallFree(1/60);
              ys.push(b.y);
            }
            res.aimErr = ys.reduce((s, y) => s + y, 0) / ys.length - 1.2;
            return res; }""")
        check('punizioni in allenamento: barriera di due, mirino che parte a 1,6 m', fk['wall'] == 2 and abs(fk['aimY'] - 1.6) < 0.05, fk)
        check('punizioni in allenamento: tirando negli angoli si segna spesso (almeno 1 su 4), la barriera respinge poco', fk['gol'] >= 5 and fk['barriera'] <= 5, fk)
        check('mirino preciso: il tiro arriva all\'altezza del mirino (in media entro 20 cm)', abs(fk['aimErr']) < 0.2, fk)

        check('nessun errore nella console', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (sum(results), len(results) - sum(results)))
    raise SystemExit(0 if all(results) else 1)

asyncio.run(main())
