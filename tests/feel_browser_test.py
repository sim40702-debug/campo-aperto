# Reattività nel gioco vero (Chromium headless): tasti di gioco che arrivano al calciatore al fotogramma dopo,
# passaggio e cambio giocatore immediati, pulsanti che reagiscono alla pressione (stato premuto e suono), cambio di
# schermata nello stesso istante del clic. Prima: node build.js test. Uso: python3 tests/feel_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

# aspetta il prossimo fotogramma disegnato (il ciclo del gioco gira con requestAnimationFrame)
NEXT_FRAMES = "n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false}))')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)

        # ---- menu: risposta nello stesso istante del clic, stato premuto e suono alla pressione
        await pg.evaluate("window.__ui = 0; const o = game.audio.ui.bind(game.audio); game.audio.ui = () => { window.__ui++; o(); }; 0")
        # (le transizioni CSS qui girano ai fotogrammi lenti del rendering software: per misurare lo stato premuto in
        # sé si tolgono durante la verifica)
        await pg.evaluate("(()=>{const st=document.createElement('style'); st.id='__nt'; st.textContent='*{transition:none!important}'; document.head.appendChild(st);})()")
        box = await pg.locator('#btn-comps').bounding_box()
        await pg.mouse.move(box['x'] + 30, box['y'] + 20)
        await pg.mouse.down()
        ui_now = await pg.evaluate("window.__ui")
        await pg.wait_for_timeout(80)
        pressed = await pg.evaluate("(()=>{const m = getComputedStyle(document.getElementById('btn-comps')).transform.match(/matrix\\(([^,]+)/); return {tf: m ? parseFloat(m[1]) : 1, ui: window.__ui}})()")
        check('pulsante premuto: si abbassa subito, prima del rilascio (scala %.3f)' % pressed['tf'], pressed['tf'] < 0.995, pressed)
        check('suono del pulsante alla pressione, non al rilascio (uno solo)', ui_now == 1 and pressed['ui'] == 1, (ui_now, pressed['ui']))
        await pg.mouse.up()
        await pg.evaluate("document.getElementById('__nt').remove()")
        check('clic: la schermata cambia nello stesso istante (nessuna attesa)', await pg.evaluate("game.screen") == 'comps')
        t = await pg.evaluate("(()=>{ const t0 = performance.now(); document.getElementById('comps-back').click(); return {dt: performance.now() - t0, s: game.screen}; })()")
        check('Indietro: menu pronto in meno di 50 ms (%.1f ms)' % t['dt'], t['s'] == 'menu' and t['dt'] < 50, t)

        # ---- partita: comandi al fotogramma successivo
        await pg.click('#btn-quick'); await pg.click('#setup-start')
        await pg.wait_for_function("game.screen==='match' && game.match.state==='KICKOFF' && game.match.setPieceReady", timeout=60000, polling=100)
        await pg.keyboard.press('j')
        await pg.wait_for_function("game.match.state==='PLAY'", timeout=20000, polling=50)
        await pg.wait_for_timeout(600)
        # il calciatore controllato senza palla, fermo
        me = "game.match.humanById('local').player"
        await pg.evaluate("(()=>{const p=%s; p.vx=0; p.vz=0;})()" % me)
        await pg.keyboard.down('d')
        await pg.evaluate(NEXT_FRAMES, 2)
        v = await pg.evaluate("%s.vx" % me)
        check('D: il calciatore accelera già al fotogramma successivo (vx %.2f m/s)' % v, v > 0.15, v)
        await pg.keyboard.down('ShiftLeft')
        sp0 = await pg.evaluate("%s.sprinting" % me)
        await pg.evaluate(NEXT_FRAMES, 2)
        check('Shift: lo scatto parte subito', await pg.evaluate("%s.sprinting" % me) is True, sp0)
        await pg.keyboard.up('ShiftLeft'); await pg.keyboard.up('d')
        # cambio giocatore: Q al fotogramma dopo
        before = await pg.evaluate("game.match.humanById('local').player.data.name")
        await pg.evaluate("(()=>{const m=game.match; m.ball.owner=m.teams[1].players[9]; m.teams[1].players[9].x=30; m.teams[1].players[9].z=20;})()")
        await pg.keyboard.press('q')
        await pg.evaluate(NEXT_FRAMES, 2)
        after = await pg.evaluate("game.match.humanById('local').player.data.name")
        check('Q: cambio giocatore immediato (%s → %s)' % (before, after), after != before)
        # passaggio con la palla: calcio al fotogramma dopo
        await pg.evaluate("(()=>{const m=game.match, p=%s; m.ball.owner=p; p.vx=p.vz=0; m.lastKick=null;})()" % me)
        await pg.evaluate(NEXT_FRAMES, 1)
        await pg.keyboard.press('j')
        await pg.evaluate(NEXT_FRAMES, 2)
        kick = await pg.evaluate("(()=>{const m=game.match, p=%s; return {kicked: !!(m.lastKick && m.lastKick.player===p), anim: p.anim.kick}})()" % me)
        check('J con la palla: passaggio partito subito, gesto visibile', kick['kicked'] and kick['anim'] > 0, kick)
        # carica del tiro: la preparazione si vede mentre si tiene premuto
        await pg.evaluate("(()=>{const m=game.match, p=%s; m.ball.owner=p; m.ball.x=p.x+0.6; m.ball.z=p.z;})()" % me)
        await pg.keyboard.down('k')
        await pg.evaluate(NEXT_FRAMES, 6)
        ch = await pg.evaluate("(()=>{const h=game.match.humanById('local'); const pm=game.renderer.playerMeshes.find(x=>x.player===h.player); return {charge:h.shootCharge, hip:pm.legs[1].hip.rotation.z}})()")
        await pg.keyboard.up('k')
        check('K tenuto: barra della potenza e gamba che si carica subito (carica %.2f)' % ch['charge'], ch['charge'] > 0 and ch['hip'] < -0.2, ch)
        check('nessun errore JavaScript', not errs, errs[:3])
        await b.close()
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
