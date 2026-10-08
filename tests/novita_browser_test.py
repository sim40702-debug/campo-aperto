# Novità della 0.14 nel gioco vero (Chromium headless): meteo e ora del giorno, statistiche e migliore in campo,
# azioni migliori a fine partita, Allenamento, aspetto dei giocatori delle tue squadre (solo oggetti comprati).
# Prima: node build.js test. Uso: python3 tests/novita_browser_test.py
import asyncio, json, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

# partita tra IA giocata di corsa fino alla fine (stesso ciclo del gioco, senza aspettare i fotogrammi)
RUN = """() => { for (let i = 0; i < 1200 && game.screen === 'match'; i++) game.updateOffline(1/60); return game.screen; }"""
TRAIN = """() => { for (let i = 0; i < 900 && game.screen === 'match' && !(game.match && game.match.tr.leaving); i++) game.updateOffline(1/60); return game.screen; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false}))')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)

        # ---- meteo e ora del giorno nella partita rapida
        await pg.click('#btn-quick')
        segs = await pg.evaluate("[...document.querySelectorAll('#opt-weather .seg')].map(b => b.textContent)")
        check('partita rapida: scelta del meteo', segs == ['Sereno', 'Pioggia', 'Neve', 'A caso'], segs)
        await pg.click("#opt-weather .seg:nth-child(3)")
        await pg.click("#opt-time .seg:nth-child(2)")
        await pg.click('#setup-start')
        await pg.wait_for_timeout(600)
        env = await pg.evaluate("[game.match.weather, game.match.timeOfDay, game.renderer.weather, game.renderer.timeOfDay, game.renderer.snowCount > 0, game.renderer.snowPoints.visible, game.renderer.rainLines.visible]")
        check('neve al tramonto: partita e grafica (fiocchi visibili, niente pioggia)', env == ['snow', 'sunset', 'snow', 'sunset', True, True, False], env)
        f1 = await pg.evaluate("Array.from(game.renderer.snowPos.slice(0, 6))")
        await pg.wait_for_timeout(400)
        f2 = await pg.evaluate("Array.from(game.renderer.snowPos.slice(0, 6))")
        check('i fiocchi cadono', f1 != f2)
        check('scelta ricordata per la prossima partita', await pg.evaluate("game.settings.lastSetup.weather === 'snow' && game.settings.lastSetup.timeOfDay === 'sunset'"))
        await pg.evaluate("game.quitToMenu()")
        check('menu: di nuovo sera e niente neve', await pg.evaluate("game.renderer.timeOfDay === 'night' && !game.renderer.snowPoints.visible"))

        # ---- fine partita: statistiche, migliore in campo, azioni migliori
        await pg.evaluate("() => { game.setup.side = -1; game.setup.halfSeconds = 120; game.setup.weather = 'rain'; game.setup.timeOfDay = 'day'; game.startMatch(); }")
        check('pioggia di giorno: righe di pioggia', await pg.evaluate("game.renderer.rainLines.visible && game.renderer.rainCount > 0 && game.match.weather === 'rain'"))
        for k in range(60):
            if await pg.evaluate(RUN) != 'match': break
        check('partita finita: schermata di fine partita', await pg.evaluate("game.screen") == 'fulltime')
        rows = await pg.evaluate("[...document.querySelectorAll('#ft-stats th')].map(t => t.textContent)")
        check('statistiche: possesso per tempo, parate, precisione dei passaggi', all(r in rows for r in ['Possesso 1º tempo', 'Possesso 2º tempo', 'Parate', 'Precisione passaggi']), rows)
        mvp = await pg.evaluate("(()=>{const e=document.getElementById('ft-mvp'); return {shown: !e.hidden, text: e.textContent, top: document.querySelectorAll('#ft-top > div').length}})()")
        check('migliore in campo con voto', mvp['shown'] and 'Migliore in campo' in mvp['text'] and mvp['top'] >= 4, mvp)
        hl = await pg.evaluate("(()=>({n: game.hlChosen().length, btn: document.getElementById('ft-highlights').textContent, shown: !document.getElementById('ft-highlights').hidden, kinds: game.hlChosen().map(c => c.kind)}))()")
        goals = await pg.evaluate("game.match.teams[0].score + game.match.teams[1].score")
        check('azioni migliori: ci sono, con tutti i gol (fino a 6)', hl['shown'] and hl['n'] >= 1 and hl['kinds'].count('goal') == min(goals, 6), [hl, goals])
        await pg.click('#ft-highlights')
        await pg.wait_for_timeout(500)
        st = await pg.evaluate("(()=>({bar: !document.getElementById('hl-bar').hidden, ft: document.getElementById('fulltime').hidden, label: document.getElementById('hl-label').textContent, i: game.hlPlay && game.hlPlay.i}))()")
        check('azioni migliori: si vedono con il minuto e il numero (1/N)', st['bar'] and st['ft'] and '1/' in st['label'] and st['i'] > 0, st)
        await pg.click('#hl-next')
        if hl['n'] > 1:
            check('Prossima: seconda azione', '2/' in await pg.evaluate("document.getElementById('hl-label').textContent"))
        await pg.keyboard.press('Escape')
        check('Esc: si torna al resoconto', await pg.evaluate("!game.hlPlay && !document.getElementById('fulltime').hidden && document.getElementById('hl-bar').hidden"))
        await pg.click('#ft-menu')

        # ---- allenamento
        await pg.click('#btn-training')
        cards = await pg.evaluate("[...document.querySelectorAll('#tr-list .tr-card b')].map(b => b.textContent)")
        check('Allenamento: cinque esercizi', cards == ['Tiri in porta', 'Punizioni', 'Rigori', 'Dribbling', 'Passaggi'], cards)
        await pg.click('[data-drill="penalty"]')
        await pg.wait_for_timeout(300)
        hud = await pg.evaluate("(()=>({screen: game.screen, tr: !!game.match.training, hud: document.getElementById('tr-hud').textContent, sb: getComputedStyle(document.querySelector('.scoreboard')).display, players: game.match.allPlayers().length}))()")
        check('rigori: solo tiratore e portiere, riquadro dell\'esercizio al posto del tabellone', hud['screen'] == 'match' and hud['tr'] and 'Rigori' in hud['hud'] and hud['sb'] == 'none' and hud['players'] == 2, hud)
        for k in range(80):
            if await pg.evaluate(TRAIN) != 'match' or await pg.evaluate("!!(game.match && game.match.tr.leaving)"): break
        await pg.wait_for_timeout(200)
        res = await pg.evaluate("(()=>({screen: game.screen, res: document.getElementById('tr-result').textContent, rec: JSON.parse(localStorage.getItem('campoAperto.training.v1') || '{}')}))()")
        check('fine esercizio: si torna agli esercizi con il risultato e il record', res['screen'] == 'training' and 'Rigori' in res['res'] and 'penalty' in res['rec'], res)
        await pg.click('[data-drill="freekick"]')
        await pg.wait_for_function("game.match && game.match.state === 'SETPIECE'", timeout=20000, polling=100)
        fk = await pg.evaluate("(()=>({state: game.match.state, wall: game.match.teams[1].players.length, mine: game.match.humans[0].player === game.match.trMain}))()")
        check('punizioni: barriera e il tuo tiratore', fk['state'] == 'SETPIECE' and fk['wall'] == 5 and fk['mine'], fk)
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(200)
        await pg.evaluate("game.quitToMenu()")
        check('Esci dall\'allenamento: di nuovo la lista degli esercizi', await pg.evaluate("game.screen") == 'training' and await pg.evaluate("document.getElementById('tr-hud').hidden"))
        await pg.click('#tr-back')

        # ---- aspetto dei giocatori: senza accesso niente oggetti dello Shop
        await pg.evaluate("game.teamEditor.open('menu')")
        await pg.click('#te-new')
        await pg.wait_for_timeout(200)
        off = await pg.evaluate("(()=>({hair: document.querySelector('.te-hair').disabled, boots: document.querySelector('.te-boots').disabled, shirt: document.getElementById('te-shirt').disabled, note: document.getElementById('te-shop-note').textContent}))()")
        check('senza oggetti comprati: capelli, scarpe e maglia bloccati', off['hair'] and off['boots'] and off['shirt'] and 'Shop' in off['note'], off)
        # la pelle si sceglie sempre
        await pg.click('.te-skin')
        check('pelle: clic per cambiare tono', await pg.evaluate("document.querySelector('.te-skin').dataset.skin") == '0')
        # accesso finto con oggetti comprati (come li ricorda l'editor dopo aver letto l'inventario)
        items = [{'id': 'capelli_blu', 'category': 'capelli', 'name': 'Capelli blu', 'data': {'style': 'cresta', 'color': '#2255ff'}},
                 {'id': 'scarpe_oro', 'category': 'scarpe', 'name': 'Scarpe oro', 'data': {'color': '#e8c34a'}},
                 {'id': 'maglia_righe', 'category': 'maglia', 'name': 'Maglia a righe', 'data': {'pattern': 'righe', 'color': '#111111'}},
                 {'id': 'pant_oro', 'category': 'pantaloncini', 'name': 'Pantaloncini oro', 'data': {'color': '#e8c34a'}}]
        await pg.evaluate("items => { localStorage.setItem('campoAperto.session.v1', JSON.stringify({ token: 't', username: 'Anna' })); rememberOwned('Anna', items); game.teamEditor.owned = ownedCosmetics(); game.teamEditor.readForm(); game.teamEditor.renderLook(); game.teamEditor.renderPlayers(); }", items)
        on = await pg.evaluate("(()=>({hair: [...document.querySelector('.te-hair').options].map(o => o.value), shirt: [...document.getElementById('te-shirt').options].map(o => o.value), owned: [...ownedCosmetics().keys()]}))()")
        check('con l\'accesso: solo gli oggetti comprati (capelli, scarpe, maglia; i pantaloncini no)', on['hair'] == ['', 'capelli_blu'] and on['shirt'] == ['', 'maglia_righe'] and 'pant_oro' not in on['owned'], on)
        await pg.evaluate("""() => { const rows = document.querySelectorAll('#te-players .te-row'); rows[9].querySelector('.te-hair').value = 'capelli_blu'; rows[9].querySelector('.te-boots').value = 'scarpe_oro'; document.getElementById('te-shirt').value = 'maglia_righe'; }""")
        await pg.click('#te-save')
        built = await pg.evaluate("(()=>{ const t = game.teamEditor.teams()[0]; const p = t.players[9]; return { items: p.look.items, skin: t.players[0].look.skin, gkShirt: !!(t.players[0].look.items && t.players[0].look.items.maglia) }; })()")
        check('squadra salvata: capelli e scarpe al n. 10, maglia a righe, pelle scelta', built['items'] and built['items'].get('capelli', {}).get('color') == '#2255ff' and built['items'].get('scarpe', {}).get('color') == '#e8c34a' and built['items'].get('maglia', {}).get('pattern') == 'righe' and built['skin'] == '#f1d3b8' and not built['gkShirt'], built)
        # un altro account (o nessuno): gli oggetti non si vedono più
        await pg.evaluate("localStorage.setItem('campoAperto.session.v1', JSON.stringify({ token: 't', username: 'Marco' }))")
        other = await pg.evaluate("game.teamEditor.teams()[0].players[9].look.items || null")
        check('con un altro account gli oggetti comprati da Anna non si vedono', other is None, other)
        await pg.evaluate("localStorage.setItem('campoAperto.session.v1', JSON.stringify({ token: 't', username: 'anna' }))")
        # in partita la grafica usa l'aspetto scelto
        await pg.evaluate("() => { game.teamEditor.close(); game.refreshMyTeams(); game.setup.home = game.db.length; game.setup.side = 0; game.setup.weather = 'clear'; game.startMatch(); }")
        await pg.wait_for_timeout(400)
        look = await pg.evaluate("(()=>{ const p = game.match.teams[0].roster.find(x => x.data.look.items && x.data.look.items.capelli); return p ? p.data.look.items.capelli.style : null; })()")
        check('partita con la tua squadra: il giocatore ha i capelli comprati', look == 'cresta', look)
        await pg.evaluate("game.quitToMenu()")

        # ---- inglese: le scritte nuove sono tradotte
        await pg.evaluate("setLanguage('en')")
        await pg.click('#btn-training')
        en = await pg.evaluate("[document.querySelector('#training h2').textContent, document.querySelector('#tr-list .tr-card b').textContent]")
        check('in inglese: Training, Shots on target', en == ['Training', 'Shots on target'], en)
        await pg.evaluate("setLanguage('it')")

        check('nessun errore nella pagina', not errs, errs)

        # ---- avvio: controllo dei server (server finto con le route di Playwright)
        await pg.close()   # una pagina sola alla volta (quella nascosta non disegnerebbe)
        for up in (True, False):
            ctx = await b.new_context(viewport={'width': 1280, 'height': 760})
            q = await ctx.new_page()
            await q.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false}))')
            if up: await q.route('**/api/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'engine': 'x'}), headers={'Access-Control-Allow-Origin': '*'}))
            else: await q.route('**/api/**', lambda r: r.abort())
            await q.goto(URL + '?startup=1')
            await q.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
            if up:
                await q.wait_for_function("document.getElementById('loading').hidden", timeout=10000, polling=200)
                check('avvio con il server attivo: si entra nel menu, niente avviso offline', await q.evaluate("!game.offline && document.getElementById('offline-pill').hidden"))
            else:
                await q.wait_for_function("!document.getElementById('ld-offline').hidden", timeout=15000, polling=200)
                txt = await q.evaluate("document.getElementById('ld-offline').textContent")
                check('server spento: "Server non raggiungibile" con Gioca offline e Riprova', 'Server non raggiungibile' in txt and 'Gioca offline' in txt and 'Riprova' in txt, txt[:80])
                await q.click('#ld-play-offline')
                await q.wait_for_timeout(800)
                st = await q.evaluate("({hidden: document.getElementById('loading').hidden, offline: game.offline, pill: !document.getElementById('offline-pill').hidden, screen: game.screen})")
                check('Gioca offline: si entra nel menu con "Offline · Riprova"', st['hidden'] and st['offline'] and st['pill'] and st['screen'] == 'menu', st)
                await q.click('#btn-training')
                check('offline: l\'allenamento funziona', await q.evaluate("game.screen") == 'training')
                await q.click('#tr-back')
                # i server tornano: Riprova dalla home
                await q.unroute('**/api/**')
                await q.route('**/api/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"ok":true}', headers={'Access-Control-Allow-Origin': '*'}))
                await q.click('#offline-pill')
                await q.wait_for_function("!game.offline", timeout=10000, polling=200)
                check('Riprova: di nuovo online, l\'avviso sparisce', await q.evaluate("document.getElementById('offline-pill').hidden"))
            await ctx.close()
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (results.count(True), results.count(False)))
    raise SystemExit(0 if all(results) else 1)

asyncio.run(main())
