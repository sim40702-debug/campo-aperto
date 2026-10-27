# Tema di Natale (0.21, sempre acceso dalla 0.22) nel gioco vero (Chromium headless): giorni che mancano a Natale,
# Home (riquadro, neve, cappello sul titolo), stadio addobbato (alberi, lucine, neve sui tetti, cartelloni, pallone,
# tifosi con il cappello), cappelli di Babbo Natale, Partita di Natale (neve, sera), fuochi d'artificio sul gol, trofei,
# rifinitura dell'immagine (bagliore) da Media in su.
# Prima: node build.js test. Uso: python3 tests/natale_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

# foto per controllare a occhio: senza scheda grafica a volte sono lente, e non devono far fallire il test
async def shot(pg, name):
    try: await pg.screenshot(path=HERE + '/shots/' + name + '.png', timeout=90000, animations='disabled')
    except Exception as e: print('foto non riuscita:', name, str(e)[:80], flush=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "media", dynamicRes: false, })); localStorage.setItem("campoAperto.tutorialHint", "1")')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=90000, polling=250)
        # il ciclo del gioco si ferma: con il disegno senza scheda grafica e la rifinitura dell'immagine ogni fotogramma
        # è lento, e le foto della pagina aspetterebbero troppo. Si disegna a mano quando serve.
        await pg.evaluate("() => { game.loop = () => {}; }")

        # ---- date
        d = await pg.evaluate("""() => { const D = (y, m, g) => new Date(y, m - 1, g, 12);
            return [isChristmasTime(D(2026, 11, 30)), isChristmasTime(D(2026, 12, 1)), isChristmasTime(D(2026, 12, 31)), isChristmasTime(D(2027, 1, 6)), isChristmasTime(D(2027, 1, 7)),
              daysToChristmas(D(2026, 10, 27)), daysToChristmas(D(2026, 12, 24)), daysToChristmas(D(2026, 12, 25)), daysToChristmas(D(2027, 1, 3)), daysToChristmas(D(2027, 3, 1))]; }""")
        check('Automatico: acceso dal 1° dicembre al 6 gennaio', d[:5] == [False, True, True, True, False], d[:5])
        check('giorni a Natale: 59 il 27 ottobre, 1 la vigilia, 0 a Natale, dopo negativo, a marzo verso il prossimo', d[5:] == [59, 1, 0, -9, 299], d[5:])

        segs = await pg.evaluate("() => { game.openSettings('generale', 'menu'); return document.getElementById('st-xmas'); }")
        check('niente scelta del tema nelle impostazioni: il Natale è sempre acceso', segs is None)
        on = await pg.evaluate("""() => { const R = game.renderer, X = R.xmasDeco;
            return { deco: !!X, lights: X ? X.lightN : 0, stars: X ? X.stars.length : 0,
              body: document.body.classList.contains('xmas'), demo: game.demo && game.demo.weather, time: game.demo && game.demo.timeOfDay,
              boards: R.boards.every(t => t.image === R._xmasBoards), ball: R.ballMesh.material.map === R._xmasBall }; }""")
        check('stadio addobbato da subito (7 alberi con la stella, centinaia di lucine)', on['deco'] and on['stars'] == 7 and on['lights'] > 600, on)
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
        await pg.evaluate("() => game.renderer.render()")
        await shot(pg, 'natale_home')

        # ---- Partita di Natale
        await pg.evaluate("() => { game.setup.side = -1; document.getElementById('btn-xmas').click(); }")
        m = await pg.evaluate("[game.screen, game.match.weather, game.match.timeOfDay, game.match.xmasMatch, game.match.humanTeam !== undefined ? game.setup.side : null]")
        check('Partita di Natale: si gioca (non si guarda), di sera con la neve', m[0] == 'match' and m[1] == 'snow' and m[2] == 'night' and m[3] is True and m[4] == 0, m)
        await pg.evaluate("() => { for (let i = 0; i < 90; i++) game.updateOffline(1/60); game.renderer.render(); }")
        await shot(pg, 'natale_partita')
        # gol: fuochi d'artificio e trofeo
        g = await pg.evaluate("""() => { const m = game.match, t = m.teams[0]; m.ball.owner = null; m.ball.lastTouch = t.players[9]; m.goal(t);
            for (let i = 0; i < 100; i++) { game.updateOffline(1/60); game.replayPending = false; game.replay = null; }
            return { sparks: game.renderer.xmasDeco.sparks.length, trophy: game.trophies.has('xmas_goal') }; }""")
        check('gol: fuochi d\'artificio sopra lo stadio', g['sparks'] > 100, g)
        check('trofeo Gol sotto l\'albero', g['trophy'], g)
        await pg.evaluate("() => game.renderer.render()")
        await shot(pg, 'natale_gol')
        w = await pg.evaluate("""() => { const m = game.match; game.trophies.endMatch(m, false); return game.trophies.has('xmas_win'); }""")
        check('vincere la Partita di Natale: trofeo Regalo di Natale', w)
        rem = await pg.evaluate("() => { game.paused = true; document.getElementById('pause-restart').click(); document.getElementById('pause-restart').click(); return [game.match.xmasMatch, game.match.weather]; }")
        check('Ricomincia: resta la Partita di Natale', rem == [True, 'snow'], rem)

        # ---- rifinitura dell'immagine: con Media sì, con Bassa no (si disegna come prima)
        post = await pg.evaluate("() => { const R = game.renderer; R.render(); const a = !!R.post && R.postEnabled(); R.setQuality('bassa'); R.render(); const b = R.postEnabled(); R.setQuality('media'); return [a, b, !R.post]; }")
        check('bagliore e colori da Media in su, in Bassa si disegna direttamente', post[0] and not post[1], post)
        crowd = await pg.evaluate("() => { const d = game.renderer.crowdCanvas.getContext('2d').getImageData(0, 0, 512, 256).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] === 196 && d[i + 1] === 12 && d[i + 2] === 36) n++; return n; }")
        check('tifosi con il cappello di Babbo Natale', crowd > 500, crowd)
        fans = await pg.evaluate("() => { game.renderer.setupStadiumLife(game.renderer.match); return game.renderer.life.fans || 0; }")
        check('tifosi in 3D nelle prime file', fans > 2000, fans)
        song = await pg.evaluate("() => { const f = jingleBellsScore(false), c = jingleBellsScore(true); return [f.beats, c.beats, f.ev.filter(e => e.kind === 'mel').length, typeof game.audio.playJingleBells, !!document.getElementById('st-vmu')]; }")
        voice = await pg.evaluate("() => { game.audio.init(); return game.audio.loadVoice().then(b => b ? Math.round(b.duration) : 0); }")
        check('voce che canta le parole: dentro il gioco e leggibile (circa un minuto)', 55 <= voice <= 65, voice)
        check('Jingle Bells: strofa e ritornello (128 battiti), allo stadio solo il ritornello, volume Musica', song[0] == 128 and song[1] == 64 and song[2] > 80 and song[3] == 'function' and song[4], song)
        check('nessun errore', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (sum(results), len(results) - sum(results)))
    raise SystemExit(0 if all(results) else 1)

os.makedirs(os.path.join(HERE, 'shots'), exist_ok=True)
asyncio.run(main())
