# Tema di Natale (0.21) nel gioco vero (Chromium headless): date dell'accensione automatica, giorni che mancano a
# Natale, Home (riquadro, neve, cappello sul titolo), stadio addobbato (alberi, lucine, neve sui tetti, cartelloni,
# pallone), cappelli di Babbo Natale, Partita di Natale (neve, sera), fuochi d'artificio sul gol, trofei, Spento.
# Prima: node build.js test. Uso: python3 tests/natale_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "media", dynamicRes: false, xmas: "off"})); localStorage.setItem("campoAperto.tutorialHint", "1")')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=90000, polling=250)

        # ---- date
        d = await pg.evaluate("""() => { const D = (y, m, g) => new Date(y, m - 1, g, 12);
            return [isChristmasTime(D(2026, 11, 30)), isChristmasTime(D(2026, 12, 1)), isChristmasTime(D(2026, 12, 31)), isChristmasTime(D(2027, 1, 6)), isChristmasTime(D(2027, 1, 7)),
              daysToChristmas(D(2026, 10, 27)), daysToChristmas(D(2026, 12, 24)), daysToChristmas(D(2026, 12, 25)), daysToChristmas(D(2027, 1, 3)), daysToChristmas(D(2027, 3, 1))]; }""")
        check('Automatico: acceso dal 1° dicembre al 6 gennaio', d[:5] == [False, True, True, True, False], d[:5])
        check('giorni a Natale: 59 il 27 ottobre, 1 la vigilia, 0 a Natale, dopo negativo, a marzo verso il prossimo', d[5:] == [59, 1, 0, -9, 299], d[5:])

        # ---- spento: niente addobbi
        off = await pg.evaluate("[!!game.renderer.xmasDeco, document.getElementById('btn-xmas').hidden, document.body.classList.contains('xmas'), game.renderer.playerMeshes.length]")
        check('Spento: niente addobbi, niente riquadro, niente neve nella Home', off[:3] == [False, True, False], off)

        # ---- acceso dalle impostazioni
        await pg.evaluate("() => { game.openSettings('generale', 'menu'); }")
        segs = await pg.evaluate("[...document.querySelectorAll('#st-xmas .seg')].map(b => b.textContent)")
        check('Impostazioni → Generale: Tema di Natale con Automatico, Sempre, Spento', segs == ['Automatico', 'Sempre', 'Spento'], segs)
        await pg.evaluate("() => [...document.querySelectorAll('#st-xmas .seg')][1].click()")
        on = await pg.evaluate("""() => { const R = game.renderer, X = R.xmasDeco;
            return { saved: JSON.parse(localStorage.getItem('campoAperto.settings.v1')).xmas, deco: !!X, lights: X ? X.lightN : 0, stars: X ? X.stars.length : 0,
              body: document.body.classList.contains('xmas'), demo: game.demo && game.demo.weather, time: game.demo && game.demo.timeOfDay,
              boards: R.boards.every(t => t.image === R._xmasBoards), ball: R.ballMesh.material.map === R._xmasBall }; }""")
        check('Sempre: salvato, stadio addobbato (7 alberi con la stella, centinaia di lucine)', on['saved'] == 'on' and on['deco'] and on['stars'] == 7 and on['lights'] > 600, on)
        check('cartelloni e pallone di Natale', on['boards'] and on['ball'], on)
        check('nel menu una sera con la neve', on['demo'] == 'snow' and on['time'] == 'night' and on['body'], on)
        # cappelli: la testa ha più vertici (rosso del cappello nei colori)
        hat = await pg.evaluate("""() => { const pm = game.renderer.playerMeshes[3]; let red = 0;
            pm.neck.traverse(o => { if (o.geometry && o.geometry.attributes.color) { const c = o.geometry.attributes.color.array; for (let i = 0; i < c.length; i += 3) if (c[i] > 0.5 && c[i + 1] < 0.1 && c[i + 2] < 0.2) red++; } });
            return red; }""")
        check('cappello di Babbo Natale in testa ai calciatori', hat > 50, hat)
        ref = await pg.evaluate("""() => { const o = game.renderer.officials; if (!o) return -1; let red = 0; o.ref.neck.traverse(m => { if (m.geometry && m.geometry.attributes.color) { const c = m.geometry.attributes.color.array; for (let i = 0; i < c.length; i += 3) if (c[i] > 0.5 && c[i + 1] < 0.1 && c[i + 2] < 0.2) red++; } }); return red; }""")
        check('anche l\'arbitro ha il cappello', ref > 50 or ref == -1, ref)

        # ---- Home
        await pg.evaluate("() => game.showScreen('menu')")
        home = await pg.evaluate("""() => { const t = document.getElementById('btn-xmas'); const r = t.getBoundingClientRect();
            const hat = getComputedStyle(document.querySelector('#menu .title span'), '::before').backgroundImage;
            return { shown: !t.hidden && r.height > 0, text: t.textContent, hat: hat.startsWith('url("data:image/svg'), snow: getComputedStyle(document.getElementById('menu'), '::before').animationName,
              titleTop: document.querySelector('#menu .title').getBoundingClientRect().top }; }""")
        check('Home: riquadro Partita di Natale con i giorni che mancano', home['shown'] and 'Partita di Natale' in home['text'] and ('Natale' in home['text'].split('Partita di Natale')[1] or 'feste' in home['text']), home)
        check('Home: neve che cade e cappello sul titolo, titolo non tagliato', home['hat'] and home['snow'] == 'xmas-snow' and home['titleTop'] >= 0, home)
        await pg.screenshot(path=HERE + '/shots/natale_home.png')

        # ---- Partita di Natale
        await pg.evaluate("() => { game.setup.side = -1; document.getElementById('btn-xmas').click(); }")
        m = await pg.evaluate("[game.screen, game.match.weather, game.match.timeOfDay, game.match.xmasMatch, game.match.humanTeam !== undefined ? game.setup.side : null]")
        check('Partita di Natale: si gioca (non si guarda), di sera con la neve', m[0] == 'match' and m[1] == 'snow' and m[2] == 'night' and m[3] is True and m[4] == 0, m)
        await pg.evaluate("() => { game.loop = () => {}; for (let i = 0; i < 90; i++) game.updateOffline(1/60); }")
        await pg.screenshot(path=HERE + '/shots/natale_partita.png')
        # gol: fuochi d'artificio e trofeo
        g = await pg.evaluate("""() => { const m = game.match, t = m.teams[0]; m.ball.owner = null; m.ball.lastTouch = t.players[9]; m.goal(t);
            for (let i = 0; i < 100; i++) { game.updateOffline(1/60); game.replayPending = false; game.replay = null; }
            return { sparks: game.renderer.xmasDeco.sparks.length, trophy: game.trophies.has('xmas_goal') }; }""")
        check('gol: fuochi d\'artificio sopra lo stadio', g['sparks'] > 100, g)
        check('trofeo Gol sotto l\'albero', g['trophy'], g)
        await pg.screenshot(path=HERE + '/shots/natale_gol.png')
        w = await pg.evaluate("""() => { const m = game.match; game.trophies.endMatch(m, false); return game.trophies.has('xmas_win'); }""")
        check('vincere la Partita di Natale: trofeo Regalo di Natale', w)
        rem = await pg.evaluate("() => { game.paused = true; document.getElementById('pause-restart').click(); document.getElementById('pause-restart').click(); return [game.match.xmasMatch, game.match.weather]; }")
        check('Ricomincia: resta la Partita di Natale', rem == [True, 'snow'], rem)

        # ---- di nuovo spento
        await pg.evaluate("() => { game.quitToMenu(); game.openSettings('generale', 'menu'); [...document.querySelectorAll('#st-xmas .seg')][2].click(); }")
        back = await pg.evaluate("""() => { const R = game.renderer; return [!!R.xmasDeco, R.boards.every(t => t.image === R.adTex.image), R.ballMesh.material.map === R.ballTexNormal, document.body.classList.contains('xmas'), document.getElementById('btn-xmas').hidden]; }""")
        check('Spento: tutto torna come prima', back == [False, True, True, False, True], back)
        check('nessun errore', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (sum(results), len(results) - sum(results)))
    raise SystemExit(0 if all(results) else 1)

os.makedirs(os.path.join(HERE, 'shots'), exist_ok=True)
asyncio.run(main())
