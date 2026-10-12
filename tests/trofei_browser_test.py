# Trofei e tutorial nel gioco vero (Chromium headless): il tutorial giocato da un "bot" passo dopo passo (muoversi,
# scattare, passare, finta, tiro, contrasto), trofei sbloccati dalle partite (primo gol, vittoria, rimonta, goleada,
# difficile), dalle competizioni e dalle carriere, avviso in alto, schermata Trofei, salvataggio.
# Prima: node build.js test. Uso: python3 tests/trofei_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

BOT = """() => { const m = game.match, tu = m.tu; const log = []; let last = -1, hold = 0;
  for (let f = 0; f < 60 * 240 && !tu.finished; f++) {
    const h = m.humans[0], p = h.player, s = TUTORIAL_STEPS[Math.min(tu.i, 5)];
    if (tu.i !== last) { last = tu.i; log.push(s.id + '@' + f); }
    let inp = { mx: 0, mz: 0, sprint: false, shoot: false, press: false, pressed: {} };
    if (p && !tu.ok) {
      const go = (x, z) => { const dx = x - p.x, dz = z - p.z, l = Math.hypot(dx, dz) || 1; inp.mx = dx / l; inp.mz = dz / l; };
      if (s.id === 'move' || s.id === 'sprint') { go(tu.target.x, tu.target.z); inp.sprint = s.id === 'sprint'; }
      if (s.id === 'pass' && m.ball.owner === p && f % 30 === 0) { const mt = m.mates[0]; go(mt.x, mt.z); inp.pressed.pass = true; }
      if (s.id === 'feint' && m.ball.owner === p && f % 20 === 0) { inp.mx = 1; inp.pressed.dribble = true; }
      if (s.id === 'feint' && m.ball.owner !== p && !m.ball.owner) go(m.ball.x, m.ball.z);
      if (s.id === 'shot' && m.ball.owner === p) { go(CONFIG.HALF_L, 2.6); inp.shoot = hold < 0.4; hold += 1/60; } else hold = 0;
      if (s.id === 'tackle') { const d = m.def; go(d.x, d.z); if (Math.hypot(d.x - p.x, d.z - p.z) < 1.6 && f % 10 === 0) inp.pressed.pass = true; }
    }
    game.input.injected = inp; m.update(1/60, inp); m.events.length = 0;
    if (f % 6 === 0) { game.renderTutorialHud(); }
  }
  return { log, finished: tu.finished, i: tu.i, hud: document.getElementById('tr-hud').textContent, done: localStorage.getItem('campoAperto.tutorial.v1') }; }"""

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
        check('home: pulsante Trofei con il conteggio', await pg.evaluate("document.getElementById('tp-mini').textContent") == '0/22')

        # ---- tutorial
        await pg.evaluate("game.openTraining()")
        check('allenamento: il Tutorial c\'è, da fare', 'Da fare' in await pg.text_content('[data-tutorial]'))
        await pg.click('[data-tutorial]')
        hud = await pg.evaluate("() => { for (let i = 0; i < 5; i++) game.updateOffline(1/60); return [document.getElementById('tr-hud').textContent, game.renderer.tutRing.visible]; }")
        check('tutorial: primo passo con il tasto da usare e il cerchio sul campo', 'Passo 1 di 6' in hud[0] and 'WASD' in hud[0] and hud[1], hud)
        r = await pg.evaluate(BOT)
        check('tutorial: i sei passi uno dopo l\'altro, fino alla fine', r['finished'] and [x.split('@')[0] for x in r['log']] == ['move', 'sprint', 'pass', 'feint', 'shot', 'tackle'], r)
        await pg.evaluate("() => { for (let i = 0; i < 300; i++) game.updateOffline(1/60); }")
        st = await pg.evaluate("[game.screen, game.trophies.has('tutorial'), document.getElementById('trophy-pop').hidden ? '' : document.getElementById('trophy-name').textContent, tutorialDone()]")
        check('fine tutorial: torna all\'allenamento, trofeo "Primi passi" con l\'avviso, completato', st == ['training', True, 'Primi passi', True], st)

        # ---- partita: rimonta da 0-2, goleada, difficile
        res = await pg.evaluate("""() => { game.setup.side = 0; game.setup.difficulty = 2; game.setup.onDraw = 'draw'; game.startMatch(); const m = game.match;
            for (let i = 0; i < 30; i++) game.updateOffline(1/60);
            m.teams[1].score = 2; game.handleEvent({ type: 'goal', team: 1, x: 0, z: 0 });
            m.teams[0].score = 6; game.handleEvent({ type: 'goal', team: 0, x: 0, z: 0 });
            m.teams[0].stats.yellow = 0; m.teams[0].stats.red = 0;
            m.half = 2; m.clock = 2699; m.setState('PLAY');
            for (let i = 0; i < 60 * 20 && game.screen === 'match'; i++) game.updateOffline(1/60);
            return [game.screen, ['first_goal', 'first_win', 'comeback', 'thrash', 'hard', 'fair', 'clean_sheet'].map(id => game.trophies.has(id)), game.trophies.count('goals'), game.trophies.count('wins')]; }""")
        check('vinta 6-2 dopo essere stato sotto 0-2 a difficile: primo gol, prima vittoria, rimonta, goleada, difficile, fair play', res[0] == 'fulltime' and res[1][:6] == [True] * 6, res)
        check('porta inviolata no (2 gol subiti); gol e vittorie contati', res[1][6] is False and res[2] >= 6 and res[3] == 1, res)
        # ---- competizioni e carriere
        cc = await pg.evaluate("""() => { const T = game.trophies; T.checkComp({ status: 'finished', champion: 3, config: { userTeam: 3 }, manager: true });
            T.checkComp({ status: 'finished', champion: 2, config: { userTeam: 5 } }); return [T.has('champion'), T.has('manager_title')]; }""")
        check('competizione vinta: Campione (e Allenatore vincente nella carriera)', cc == [True, True], cc)
        pr = await pg.evaluate("""() => { const T = game.trophies; T.add('posts', 10); T.add('goals', 100); T.add('wins', 49); return ['posts_10', 'goals_25', 'goals_100', 'wins_10', 'wins_50'].map(id => T.has(id)); }""")
        check('contatori: 10 pali, 25 e 100 gol, 10 e 50 vittorie', all(pr), pr)
        # ---- schermata e salvataggio
        await pg.evaluate("game.showScreen('menu')")
        await pg.click('#btn-trophies')
        tp = await pg.evaluate("[game.screen, document.getElementById('tp-count').textContent, document.querySelectorAll('#tp-list .tp-card').length, document.querySelectorAll('#tp-list .tp-card.got').length, !!document.querySelector('#tp-list .tp-card:not(.got) .bar')]")
        check('schermata Trofei: tutti i trofei, quelli presi evidenziati, barre per quelli a contatore', tp[0] == 'trophies' and tp[2] == 22 and tp[3] >= 14 and tp[1] == '%d di 22' % tp[3] and tp[4], tp)
        got = tp[3]
        await pg.reload()
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        check('dopo il riavvio i trofei ci sono ancora', await pg.evaluate("game.trophies.done()") == got)
        check('nessun errore', not errs, errs[:3])
        await b.close()
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
