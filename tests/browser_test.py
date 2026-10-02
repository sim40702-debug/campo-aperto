# Test nel browser (Chromium headless, WebGL software): menu, partita offline, tastiera,
# pausa e perdita del focus, impostazioni, rimappatura, HiDPI e risoluzioni diverse.
import asyncio, os, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''))

async def newpage(b, w=960, h=540, dpr=1, settings=None):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    s = {'quality': 'bassa', 'dynamicRes': False}
    if settings: s.update(settings)
    await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", ' + json.dumps(json.dumps(s)) + ')')
    await pg.goto(URL)
    await pg.wait_for_function('window.game && window.game.loaded', timeout=60000)
    return pg, errs

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg, errs = await newpage(b)
        await pg.wait_for_timeout(800)
        check('caricamento: schermata di caricamento chiusa e menu visibile', await pg.evaluate("document.getElementById('loading').hidden && !document.getElementById('menu').hidden"))
        await pg.screenshot(path=HERE + '/shots/10_menu.png')
        # partita offline
        await pg.click('#btn-quick'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=HERE + '/shots/11_setup.png')
        await pg.click('#setup-start')
        await pg.wait_for_function("game.screen==='match'")
        check('partita offline avviata', await pg.evaluate("game.mode==='offline' && !!game.match"))
        await pg.wait_for_function("game.match.state==='KICKOFF' && game.match.setPieceReady", timeout=60000)
        # calcio d'inizio con J (passaggio): l'umano è il battitore
        await pg.keyboard.press('j')
        await pg.wait_for_function("game.match.state==='PLAY'", timeout=30000)
        check('tastiera: J batte il calcio d inizio', True)
        # movimento con D: il calciatore controllato va verso +x
        x0 = await pg.evaluate("(()=>{const p=game.match.humans[0].player; window.__p=p; return p.x})()")
        await pg.keyboard.down('d'); await pg.wait_for_timeout(2500)
        vx = await pg.evaluate("__p.vx")
        await pg.keyboard.up('d')
        x1 = await pg.evaluate("__p.x")
        check('tastiera: D muove il calciatore verso destra (+x)', x1 - x0 > 0.5 or vx > 1, '%.2f -> %.2f' % (x0, x1))
        # feedback visivo del tasto premuto
        await pg.keyboard.down('k'); await pg.wait_for_timeout(400)
        held = await pg.evaluate("document.querySelector('[data-chip=shoot]').classList.contains('held')")
        await pg.keyboard.up('k')
        check('feedback: il riquadro Tiro si illumina mentre K è premuto', held)
        # perdita del focus: nessun tasto bloccato e pausa automatica offline
        await pg.keyboard.down('d')
        await pg.evaluate("window.dispatchEvent(new Event('blur'))")
        await pg.wait_for_timeout(300)
        st = await pg.evaluate("({held: game.input.held('right'), paused: game.paused})")
        await pg.keyboard.up('d')
        check('perdita del focus: tasti rilasciati e pausa automatica', not st['held'] and st['paused'], st)
        await pg.screenshot(path=HERE + '/shots/12_pause.png')
        await pg.keyboard.press('Escape')
        await pg.wait_for_function("!game.paused", timeout=20000)
        check('Esc riprende la partita', True)
        # rimappatura: lo scatto passa da Shift a X
        await pg.keyboard.press('Escape'); await pg.wait_for_function("game.paused", timeout=20000)
        await pg.click('#pause-settings'); await pg.wait_for_timeout(200)
        await pg.click('[data-tab=controlli]'); await pg.wait_for_timeout(200)
        await pg.click('[data-bind="sprint:0"]')   # Scatto, tasto principale
        await pg.keyboard.press('x'); await pg.wait_for_timeout(200)
        keys = await pg.evaluate("game.input.keys.sprint")
        saved = await pg.evaluate("JSON.parse(localStorage.getItem('campoAperto.settings.v1')).keys.sprint")
        check('rimappatura: Scatto assegnato a X e salvato', keys[0] == 'KeyX' and saved[0] == 'KeyX', keys)
        await pg.screenshot(path=HERE + '/shots/13_settings_keys.png')
        await pg.click('[data-tab=grafica]'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=HERE + '/shots/14_settings_gfx.png')
        await pg.click('#st-back'); await pg.wait_for_timeout(200)
        check('dalle impostazioni si torna alla pausa', await pg.evaluate("game.paused && !document.getElementById('pause').hidden"))
        await pg.click('#pause-resume'); await pg.wait_for_timeout(200)
        await pg.keyboard.down('x'); await pg.wait_for_timeout(300)
        check('il nuovo tasto X fa scattare', await pg.evaluate("game.input.held('sprint')"))
        await pg.keyboard.up('x')
        # fine partita forzata
        await pg.evaluate("(()=>{const m=game.match; m.half=2; m.clock=2699.5; m.setState('PLAY')})()")
        await pg.wait_for_function("game.screen==='fulltime'", timeout=60000)
        check('fine partita mostrata', True)
        await pg.screenshot(path=HERE + '/shots/15_fulltime.png')
        check('nessun errore JavaScript (partita offline)', not errs, errs[:3])
        await pg.close()

        # HiDPI / 4K: rapporto pixel e dimensione reale del disegno per preset
        for (w, h, dpr, q, expect) in [(1280, 720, 2, 'ultra', 2.0), (1280, 720, 2, 'alta', 1.5), (1280, 720, 2, 'media', 1.0), (1920, 1080, 2, 'ultra', 2.0), (800, 600, 1, 'bassa', 1.0)]:
            pg, errs = await newpage(b, w, h, dpr, {'quality': q})
            d = await pg.evaluate("game.renderer.drawingSize()")
            check('%s %dx%d a %gx: disegno %dx%d (atteso %dx%d)' % (q, w, h, dpr, d['w'], d['h'], int(w * expect), int(h * expect)),
                  abs(d['w'] - w * expect) <= 2 and abs(d['h'] - h * expect) <= 2)
            if q == 'ultra' and w == 1920:
                check('Ultra su schermo 1920x1080 a 2x = 3840x2160 (4K)', d['w'] == 3840 and d['h'] == 2160)
                await pg.screenshot(path=HERE + '/shots/16_menu_4k.png', timeout=180000)
            check('nessun errore (%s %dx%d)' % (q, w, h), not errs, errs[:2])
            await pg.close()
        # scala di risoluzione e ridimensionamento finestra
        pg, errs = await newpage(b, 1000, 600, 1, {'quality': 'alta', 'resScale': 0.5})
        d = await pg.evaluate("game.renderer.drawingSize()")
        check('scala di risoluzione 50%: 500x300', d['w'] == 500 and d['h'] == 300, d)
        await pg.set_viewport_size({'width': 700, 'height': 900})
        try: await pg.wait_for_function("game.renderer.drawingSize().w===350", timeout=15000)
        except Exception: pass
        d = await pg.evaluate("game.renderer.drawingSize()")
        check('ridimensionamento finestra: il disegno segue (350x450)', d['w'] == 350 and d['h'] == 450, d)
        await pg.screenshot(path=HERE + '/shots/17_menu_portrait.png')
        # risoluzione dinamica: con fps bassi scende da sola
        await pg.evaluate("game.settings.dynamicRes=true")
        await pg.wait_for_timeout(4000)
        dyn = await pg.evaluate("game.renderer.dynScale")
        check('risoluzione dinamica: con il rendering software la scala scende', dyn < 1, dyn)
        # schermo intero (API del browser)
        await pg.click('#btn-settings'); await pg.wait_for_timeout(200)
        await pg.click('#st-full'); await pg.wait_for_timeout(600)
        fs = await pg.evaluate("!!document.fullscreenElement")
        check('schermo intero attivato dal pulsante', fs)
        if fs:
            await pg.evaluate("document.exitFullscreen()"); await pg.wait_for_timeout(300)
        check('nessun errore (scala e dinamica)', not errs, errs[:2])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (results.count(True), results.count(False)))
    raise SystemExit(0 if all(results) else 1)
asyncio.run(main())
