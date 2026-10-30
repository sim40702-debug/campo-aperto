# Novità della 0.25 nel gioco vero (Chromium headless). Sprint 0.25.0: la rete della porta.
# Scenari con tiri veri (motore): tiro forte al centro, negli angoli alto e basso, pallone lento, rete presa da fuori.
# Per ognuno si misura dove e quanto si deforma la rete, che l'oscillazione si spenga piano, che la rete non entri mai
# nel pallone, che il suono della rete parta una volta sola e più forte per i tiri forti. Poi i fili veri (cilindri
# con ombra da vicino, linee da lontano) e la rete attaccata dietro ai pali.
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

        check('nessun errore nella console', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (sum(results), len(results) - sum(results)))
    raise SystemExit(0 if all(results) else 1)

asyncio.run(main())
