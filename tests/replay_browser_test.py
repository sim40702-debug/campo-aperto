# Replay salvati nel gioco vero (Chromium headless): a fine partita «Salva» su un'azione migliore, schermata Replay,
# riproduzione con telecamere, velocità, pausa e barra, codifica compatta (2 byte per numero), eliminazione,
# salvataggio dopo il riavvio. Prima: node build.js test. Uso: python3 tests/replay_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)
RUN = """() => { for (let i = 0; i < 1500 && game.screen === 'match'; i++) game.updateOffline(1/60); return game.screen; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('if (!sessionStorage.getItem("s")) { sessionStorage.setItem("s", "1"); localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false})); }')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        await pg.evaluate("game.loop = () => {}")
        # codifica: precisione e grandezza
        enc = await pg.evaluate("""() => { const f = []; for (let n = 0; n < 120; n++) { const a = [n * 0.1, 0.5, -3.21]; for (let i = 0; i < 22; i++) a.push(10.123 + i, -5.5, 1.234, n * 0.37 + 20, 6.78, 0.15, i % 3 - 1); f.push(a); }
            const e = encodeReplayFrames(f), d = decodeReplayFrames(e); const a = d[10], o = f[20];
            return { count: e.count, bytes: e.data.length, x: Math.abs(a[3] - o[3]), face: Math.abs(a[5] - o[5]), dive: a[9] === o[9], ball: Math.abs(a[0] - o[0]) }; }""")
        check('codifica: 30 fotogrammi al secondo, 2 byte per numero, errore sotto il centimetro', enc['count'] == 60 and enc['bytes'] < 60 * 157 * 2 * 1.4 and enc['x'] < 0.01 and enc['face'] < 0.002 and enc['dive'] and enc['ball'] < 0.01, enc)
        # partita fino alla fine
        await pg.evaluate("() => { game.setup.side = -1; game.setup.halfSeconds = 120; game.startMatch(); }")
        for k in range(60):
            if await pg.evaluate(RUN) != 'match': break
        n = await pg.evaluate("game.hlChosen().length")
        check('fine partita: ci sono azioni da rivedere', n >= 1, n)
        await pg.click('#ft-highlights')
        check('azioni migliori: pulsante Salva', await pg.is_visible('#hl-save'))
        await pg.click('#hl-save')
        t = await pg.evaluate("document.getElementById('toast').textContent")
        check('Salva: "Replay salvato"', 'Replay salvato' in t, t)
        await pg.click('#hl-save')
        check('salvare due volte la stessa azione: una sola copia', await pg.evaluate("loadReplays().length") == 1 and 'già salvata' in await pg.evaluate("document.getElementById('toast').textContent"))
        size = await pg.evaluate("localStorage.getItem('campoAperto.replays.v1').length")
        check('un replay occupa poco (meno di 150 KB)', size < 150000, size)
        await pg.click('#hl-exit')
        await pg.evaluate("game.quitToMenu ? game.quitToMenu() : game.showScreen('menu')")
        await pg.evaluate("game.showScreen('menu')")
        # schermata Replay
        await pg.click('#btn-replays')
        rp = await pg.evaluate("[game.screen, document.querySelectorAll('#rp-list .rp-card').length, document.getElementById('rp-count').textContent]")
        check('Home → Replay: il replay salvato con il nome dell\'azione', rp == ['replays', 1, '1 di 25'], rp)
        await pg.click('[data-rp-watch]')
        st = await pg.evaluate("""() => { const v = game.rv, R = game.renderer; const out = { screen: game.screen, slots: R.playerMeshes.length };
            const p0 = R.playerMeshes[5].root.position.x;
            for (let i = 0; i < 40; i++) game.stepReplayViewer(1/60);
            out.moving = v.i > 4 && R.playerMeshes.some(pm => Math.abs(pm.root.position.x - p0) > 0.01);
            out.i = v.i; return out; }""")
        check('riproduzione: i giocatori si muovono, la barra va avanti', st['screen'] == 'rview' and st['slots'] == 22 and st['moving'], st)
        cams = await pg.evaluate("""() => { const R = game.renderer, out = {}; for (const c of ['tv', 'stand', 'goal', 'top', 'ball']) { game.rv.cam = c; for (let i = 0; i < 30; i++) game.stepReplayViewer(1/60); out[c] = [R.camera.position.x, R.camera.position.y, R.camera.position.z].map(v => Math.round(v)); } return out; }""")
        check('cinque telecamere diverse (dall\'alto più in alto di tutte)', len(set(map(tuple, cams.values()))) == 5 and cams['top'][1] > 30, cams)
        sp = await pg.evaluate("""() => { const v = game.rv; v.i = 0; v.playing = true; v.speed = 0.25; for (let i = 0; i < 60; i++) game.stepReplayViewer(1/60); const slow = v.i;
            v.i = 0; v.speed = 1; for (let i = 0; i < 60; i++) game.stepReplayViewer(1/60); const fast = v.i;
            v.i = 2; v.playing = true; document.getElementById('rv-play').click(); const at = v.i; for (let i = 0; i < 30; i++) game.stepReplayViewer(1/60); const still = at === v.i;
            const pos = document.getElementById('rv-pos'); pos.value = 5; pos.dispatchEvent(new Event('input')); return [slow, fast, still, v.i, document.getElementById('rv-play').textContent]; }""")
        check('velocità: a 0,25× quattro volte più lento che a 1×', abs(sp[1] / sp[0] - 4) < 0.2, sp)
        check('Pausa ferma il replay, la barra lo sposta', sp[2] and sp[3] == 5 and sp[4] == 'Avanti', sp)
        await pg.click('#rv-exit')
        check('Chiudi: di nuovo la lista dei replay', await pg.evaluate("game.screen") == 'replays' and await pg.evaluate("!game.rv"))
        # dopo il riavvio
        await pg.reload()
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        check('dopo il riavvio il replay c\'è ancora', await pg.evaluate("loadReplays().length") == 1)
        await pg.evaluate("game.openReplays()")
        await pg.click('[data-rp-del]'); await pg.click('[data-rp-del]')
        check('Elimina (con conferma)', await pg.evaluate("loadReplays().length") == 0 and 'Nessun replay' in await pg.text_content('#rp-list'))
        check('nessun errore', not errs, errs[:3])
        await b.close()
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
