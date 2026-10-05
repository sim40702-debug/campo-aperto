# Test nel browser dei controlli (0.3.1): controller simulato, navigazione dei menu,
# schermata Comandi, rimappatura del controller, buffer dei tasti, telecamera dietro al giocatore,
# conferma di uscita, menu contestuale bloccato.
# Il controller è finto: navigator.getGamepads restituisce un oggetto che il test modifica.
import asyncio, os, json
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''))

FAKE_PAD = """
window.__pad = { id: 'Controller di prova (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })) };
navigator.getGamepads = () => [window.__pad];
window.__btn = (i, on) => { window.__pad.buttons[i] = { pressed: on, value: on ? 1 : 0, touched: on }; window.__pad.timestamp++; };
"""

# con il rendering software un fotogramma può durare più di un secondo:
# il pulsante resta premuto finché il gioco non ha letto almeno un fotogramma, poi si rilascia
async def frames(pg, n=1):
    for _ in range(n):
        t0 = await pg.evaluate('game.time')
        await pg.wait_for_function('game.time > %r' % t0, timeout=30000)

async def tap(pg, i):
    await pg.evaluate('__btn(%d, true)' % i); await frames(pg, 2)
    await pg.evaluate('__btn(%d, false)' % i); await frames(pg, 1)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': 960, 'height': 540})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        await pg.add_init_script(FAKE_PAD)
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", ' + json.dumps(json.dumps({'quality': 'bassa', 'dynamicRes': False})) + ')')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && window.game.loaded', timeout=60000)
        await pg.wait_for_timeout(300)

        # ---- menu con il controller
        await tap(pg, 13)   # croce giù: seleziona il primo pulsante
        check('controller: il dispositivo attivo diventa il controller', await pg.evaluate("game.input.lastDevice==='pad'"))
        f1 = await pg.evaluate("document.activeElement.id")
        await tap(pg, 13)
        f2 = await pg.evaluate("document.activeElement.id")
        await tap(pg, 13)
        f3 = await pg.evaluate("document.activeElement.id")
        # Home: Gioca, sotto le caselle larghe Competizioni e Guarda partita
        check('controller: la croce sposta la selezione nel menu', f1 == 'btn-quick' and f2 == 'btn-comps' and f3 == 'btn-watch', (f1, f2, f3))
        await tap(pg, 12); await tap(pg, 12)   # su, su: torna a Gioca
        await tap(pg, 0)    # A
        await pg.wait_for_timeout(200)
        check('controller: A apre la schermata selezionata', await pg.evaluate("game.screen==='setup'"))
        await tap(pg, 1)    # B
        await pg.wait_for_timeout(200)
        check('controller: B torna indietro', await pg.evaluate("game.screen==='menu'"))

        # ---- schermata comandi (tastiera)
        await pg.click('#btn-controls'); await pg.wait_for_timeout(200)
        rows = await pg.evaluate("document.querySelectorAll('#help-body tr').length")
        txt = await pg.evaluate("document.getElementById('help-body').textContent")
        check('schermata Comandi con tastiera e controller', rows > 20 and 'RB' in txt and 'Pressing' in txt, rows)
        await pg.screenshot(path=HERE + '/shots/20_comandi.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check('Esc chiude la schermata Comandi', await pg.evaluate("game.screen==='menu'"))
        # frecce della tastiera nei menu
        await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown')
        check('tastiera: le frecce spostano la selezione nel menu', await pg.evaluate("document.activeElement.classList.contains('home-tile')"))

        # ---- rimappatura del controller: scatto su LB (4)
        await pg.click('#btn-settings'); await pg.wait_for_timeout(200)
        await pg.click('[data-tab=controlli]'); await pg.wait_for_timeout(200)
        status = await pg.evaluate("document.getElementById('st-pad-status').textContent")
        check('impostazioni: controller riconosciuto', 'collegato' in status.lower(), status)
        await pg.click('[data-bind="sprint:pad"]'); await pg.wait_for_timeout(150)
        await tap(pg, 4)
        pad = await pg.evaluate("({ s: game.input.pad.sprint, sw: game.input.pad.switch, saved: JSON.parse(localStorage.getItem('campoAperto.settings.v1')).padKeys.sprint })")
        check('rimappatura controller: Scatto su LB, tolto dal Cambio e salvato', pad['s'] == 4 and pad['sw'] is None and pad['saved'] == 4, pad)
        await pg.screenshot(path=HERE + '/shots/21_controlli.png')
        await pg.click('#st-pad-reset'); await pg.wait_for_timeout(100)
        check('controller predefinito ripristinato', await pg.evaluate("game.input.pad.sprint===7 && game.input.pad.switch===4"))
        await pg.click('#st-back'); await pg.wait_for_timeout(200)

        # ---- partita con il controller
        await pg.click('#btn-quick'); await pg.wait_for_timeout(200)
        await pg.click('#setup-start')
        await pg.wait_for_function("game.screen==='match'")
        await tap(pg, 13)  # torna al controller
        await pg.wait_for_function("game.match.state==='KICKOFF' && game.match.setPieceReady", timeout=60000)
        chip = await pg.evaluate("document.querySelector('[data-chip=pass] b').textContent")
        check('riquadri dei comandi con i nomi del controller', chip == 'A', chip)
        await tap(pg, 0)
        await pg.wait_for_function("game.match.state==='PLAY'", timeout=20000)
        to = await pg.evaluate("(()=>{const pp=game.match.pendingPass; return pp&&pp.to? pp.to.team.index : -1})()")
        check('calcio d inizio con A senza direzione: palla a un compagno', to == 0, to)
        # levetta sinistra: il calciatore si muove verso +x
        await pg.evaluate("(()=>{window.__p=game.match.humans[0].player; window.__x0=__p.x; __pad.axes=[1,0,0,0];})()")
        await frames(pg, 3); await pg.wait_for_timeout(1000)
        mv = await pg.evaluate("(()=>{const r={dx:__p.x-__x0, vx:__p.vx, h:game.match.humans[0].player===__p}; __pad.axes=[0,0,0,0]; return r})()")
        check('levetta sinistra muove il calciatore', mv['dx'] > 1 or (not mv['h']), mv)
        # Start mette in pausa, B riprende
        await tap(pg, 9)
        check('Start mette in pausa', await pg.evaluate("game.paused"))
        await pg.screenshot(path=HERE + '/shots/22_pausa_controller.png')
        await tap(pg, 1)
        check('B riprende la partita', await pg.evaluate("!game.paused"))
        # il tasto B ancora premuto dopo la ripresa non deve caricare un tiro
        check('dopo la ripresa nessun pulsante resta "premuto"', await pg.evaluate("!game.input.held('shoot')"))
        # tastiera: i riquadri tornano ai tasti
        await pg.keyboard.press('KeyW'); await frames(pg, 1)
        chip = await pg.evaluate("document.querySelector('[data-chip=pass] b').textContent")
        check('premendo un tasto i riquadri mostrano la tastiera', chip == 'J', chip)

        # ---- buffer: tasto premuto in un fotogramma senza passi di simulazione
        buf = await pg.evaluate("""(()=>{
          game.paused = true;                       // ferma il ciclo normale
          game.acc = 0; game.pressBuf = null;
          game.input.justPressed.KeyJ = true;
          game.paused = false; game.updateOffline(0.004); game.paused = true; // nessun passo
          const kept = !!(game.pressBuf && game.pressBuf.pressed.pass);
          game.input.endFrame();
          game.paused = false; game.updateOffline(0.02); game.paused = true;  // un passo: consumato
          const used = !game.pressBuf;
          game.paused = false;
          return { kept, used };
        })()""")
        check('buffer: un tasto premuto tra due passi non va perso', buf['kept'] and buf['used'], buf)

        # ---- telecamera dietro al giocatore: su = verso la porta avversaria
        dirs = await pg.evaluate("""(()=>{
          const R = game.renderer, old = R.camMode; R.camMode = 2;
          game.input.down.KeyW = true;
          const i = game.gameInput(false);
          game.input.down.KeyW = false; R.camMode = old;
          const dir = game.match.teams[game.match.humans[0].team].dir;
          return { mx: i.mx, mz: i.mz, dir };
        })()""")
        check('telecamera dietro: su porta verso la porta avversaria', abs(dirs['mx'] - dirs['dir']) < 1e-6 and abs(dirs['mz']) < 1e-6, dirs)

        # ---- fluidità: a 144 Hz il calciatore deve muoversi a ogni fotogramma (prima 6 fotogrammi su 10 erano fermi)
        sm = await pg.evaluate("""(()=>{
          const m = game.match, wasPaused = game.paused, saveHumans = m.humans.slice();
          const p = m.teams[0].players[6]; const st = { x: p.x, z: p.z, vx: p.vx, vz: p.vz, stun: m.allPlayers().map(q => q.stunned) };
          m.humans.length = 0; for (const q of m.allPlayers()) q.stunned = 99;
          p.stunned = 0; p.x = 0; p.z = 0;
          const mesh = game.renderer.playerMeshes.find(pm => pm.player === p).root;
          const xs = []; game.paused = false; game.acc = 0;
          for (let i = 0; i < 144; i++) { p.vx = 6; p.vz = 0; game.updateOffline(1 / 144); xs.push(mesh.position.x); }
          m.humans.push(...saveHumans); m.allPlayers().forEach((q, i) => { q.stunned = st.stun[i]; });
          p.x = st.x; p.z = st.z; p.vx = st.vx; p.vz = st.vz; game.paused = wasPaused;
          let still = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - xs[i - 1]) < 1e-6) still++;
          return { still };
        })()""")
        check('fluidità a 144 Hz: il movimento disegnato avanza a ogni fotogramma', sm['still'] <= 2, sm)

        # ---- menu contestuale bloccato in partita (clic destro = tiro)
        blocked = await pg.evaluate("(()=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true}); document.getElementById('stage').dispatchEvent(e); return e.defaultPrevented})()")
        check('clic destro in partita: niente menu del browser', blocked)

        # ---- F1 apre i comandi e mette in pausa
        await pg.keyboard.press('F1')
        try: await pg.wait_for_function("game.screen==='help'", timeout=15000)
        except Exception: pass
        check('F1 apre i comandi (partita in pausa)', await pg.evaluate("game.screen==='help' && game.paused"))
        await pg.click('#help-back'); await pg.wait_for_timeout(200)
        check('chiudendo i comandi si torna alla pausa', await pg.evaluate("game.screen==='match' && game.paused && !document.getElementById('pause').hidden"))

        # ---- conferma per uscire
        await pg.click('#pause-quit'); await pg.wait_for_timeout(150)
        first = await pg.evaluate("game.screen")
        await pg.click('#pause-quit'); await pg.wait_for_timeout(300)
        second = await pg.evaluate("game.screen")
        check('Esci chiede conferma (serve un secondo clic)', first == 'match' and second == 'menu', (first, second))
        last = await pg.evaluate("JSON.parse(localStorage.getItem('campoAperto.settings.v1')).lastSetup")
        check('ultima partita ricordata', last and 'home' in last, last)

        # ---- controller scollegato: niente errori
        await pg.evaluate("(()=>{__pad.connected=false; const e=new Event('gamepaddisconnected'); e.gamepad=__pad; window.dispatchEvent(e);})()")
        await pg.wait_for_timeout(200)
        check('controller scollegato: avviso e tastiera di nuovo attiva', await pg.evaluate("game.input.lastDevice==='kb' && !document.getElementById('toast').hidden"))
        check('nessun errore JavaScript', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (results.count(True), results.count(False)))
    raise SystemExit(0 if all(results) else 1)
asyncio.run(main())
