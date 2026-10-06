# Amici e sfide tra amici nel gioco vero (Chromium headless) contro il server vero in locale (wrangler dev: Worker,
# D1, Durable Object del relay). Due giocatori su due "computer" (contesti separati): pannello Amici a destra nella
# Home, richiesta di amicizia, sfida con invito, scelta della squadra, avvio, partita contro l'IA giocata con il
# motore, partita online tra i due amici (stanza aperta dal pannello, l'altro entra con un clic, risultato concordato).
# Prima: node build.js test. Uso: python3 tests/social_browser_test.py
import asyncio, os, json, subprocess, tempfile, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
CLOUD = os.path.join(ROOT, 'cloud')
URL = 'file://' + os.path.join(ROOT, 'dist', 'test.html')
PORT = 8793
API = 'http://127.0.0.1:%d' % PORT
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
WRANGLER = os.path.join(CLOUD, 'node_modules', '.bin', 'wrangler')
results = []

def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

def start_server(persist):
    if not os.path.exists(os.path.join(CLOUD, '.dev.vars')):
        with open(os.path.join(CLOUD, '.dev.vars.example')) as f, open(os.path.join(CLOUD, '.dev.vars'), 'w') as g: g.write(f.read())
    subprocess.run(['npm', 'run', 'engine'], cwd=CLOUD, check=True, stdout=subprocess.DEVNULL)
    subprocess.run([WRANGLER, 'd1', 'migrations', 'apply', 'campo-aperto', '--local', '--persist-to', persist], cwd=CLOUD, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log = open(os.path.join(persist, 'wrangler.log'), 'w')
    p = subprocess.Popen([WRANGLER, 'dev', '--port', str(PORT), '--ip', '127.0.0.1', '--persist-to', persist], cwd=CLOUD, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    import urllib.request
    for _ in range(120):
        try:
            with urllib.request.urlopen(API + '/api/status', timeout=5) as r:
                if r.status == 200: return p
        except Exception: pass
        time.sleep(0.5)
    raise RuntimeError('server non partito')

async def newpage(b):
    ctx = await b.new_context(viewport={'width': 1400, 'height': 820})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    s = {'quality': 'bassa', 'dynamicRes': False, 'apiUrl': API}
    await pg.add_init_script('if (!localStorage.getItem("campoAperto.settings.v1")) localStorage.setItem("campoAperto.settings.v1", ' + json.dumps(json.dumps(s)) + ')')
    await pg.goto(URL)
    await pg.wait_for_function('window.game && window.game.loaded', timeout=60000, polling=250)
    return ctx, pg, errs

async def register(pg, name):
    await pg.click('#eco-user'); await pg.wait_for_function("game.screen==='account'")
    await pg.fill('#ac-new-user', name); await pg.fill('#ac-new-pass', 'password-' + name); await pg.fill('#ac-new-pass2', 'password-' + name)
    await pg.click('#ac-register')
    await pg.wait_for_function("game.eco.api.me && game.eco.api.me.username", timeout=20000)
    await pg.evaluate("game.showScreen('menu')")

async def social_text(pg): return await pg.text_content('#so-content') or ''
async def wait_social(pg, js, timeout=20000):
    await pg.evaluate("game.social.refresh()")
    await pg.wait_for_function(js, timeout=timeout, polling=200)

async def main():
    persist = tempfile.mkdtemp(prefix='campo-social-')
    srv = start_server(persist)
    sfx = str(int(time.time()))[-4:]
    NA, NB = 'anna' + sfx, 'bruno' + sfx
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=ARGS)
            ca, A, ea = await newpage(b)
            cb, B, eb = await newpage(b)

            # ---- pannello a destra, a metà schermo
            box = await A.locator('#social').bounding_box()
            check('pannello Amici nella Home: a destra, a metà altezza', box and abs(box['x'] + box['width'] - 1400) < 2 and abs(box['y'] + box['height'] / 2 - 410) < 40, box)
            check('aperto su schermo largo, senza account chiede di accedere', await A.is_visible('#social-body') and 'Accedi' in await social_text(A))
            await A.click('#social-toggle')
            check('si chiude e resta solo la linguetta', not await A.is_visible('#social-body') and await A.is_visible('#social-toggle'))
            await A.click('#social-toggle')

            # ---- account e amicizia
            await register(A, NA); await register(B, NB)
            await wait_social(A, "document.querySelector('#so-users') && document.querySelector('#so-users').textContent.includes(%s)" % json.dumps(NB))
            check('tutti i giocatori dal server: A vede B (e sé stesso con "tu")', NB in await A.text_content('#so-users') and 'tu' in await A.text_content('#so-users'))
            await A.click('#so-users [data-so=add][data-u="%s"]' % NB)
            await A.wait_for_function("document.querySelector('#so-content').textContent.includes('richiesta inviata')", timeout=15000)
            check('A chiede l\'amicizia: "richiesta inviata"', True)
            await wait_social(B, "!document.getElementById('social-badge').hidden")
            check('B: pallino con 1 richiesta e A tra "Richieste e inviti"', await B.text_content('#social-badge') == '1' and 'vuole essere tuo amico' in await social_text(B))
            await B.click('#so-content [data-so=accept][data-u="%s"]' % NA)
            await B.wait_for_function("document.querySelector('#so-content').textContent.includes('Amici · 1')", timeout=15000)
            check('B accetta: A tra gli amici', True)
            await wait_social(A, "document.querySelector('#so-content').textContent.includes('Amici · 1')")

            # ---- sfida: A crea un campionato e invita B
            await A.click('#so-content [data-so=challenge][data-u="%s"]' % NB)
            await A.wait_for_function("game.screen==='comp-new' && game.comps.draft.friends", timeout=10000)
            check('«Sfida»: creazione con tipo, squadra e B già invitato', await A.is_visible('#cn-kind') and await A.is_visible('#cn-friends') and
                  await A.get_attribute('#cn-friends [data-inv="%s"]' % NB, 'aria-pressed') == 'true' and await A.text_content('#cn-create') == 'Crea e invita')
            await A.click('#cn-size button:has-text("6 squadre")')
            await A.select_option('#cn-team', '0')
            await A.click('#cn-create')
            await A.wait_for_function("game.screen==='comp' && game.comps.friend && game.comps.friend.view.status==='OPEN'", timeout=15000)
            code = await A.evaluate("game.comps.friend.code")
            check('sfida creata: iscrizioni aperte, B invitato', 'invitato' in await A.text_content('#cp-body') and await A.is_visible('#cpf-start'))

            await wait_social(B, "document.querySelector('#so-content').textContent.includes('ti invita')")
            check('B vede l\'invito di A nel pannello', 'ti invita' in await social_text(B))
            await B.click('#so-content [data-so=open][data-c="%s"]' % code)
            await B.wait_for_function("game.screen==='comp' && document.getElementById('cpf-accept')", timeout=15000)
            opts = await B.evaluate("[...document.querySelectorAll('#cpf-team option')].map(o=>Number(o.value))")
            check('B sceglie tra le squadre libere (non quella di A)', 0 not in opts and len(opts) == 5, opts)
            await B.select_option('#cpf-team', str(opts[0]))
            await B.click('#cpf-accept')
            await B.wait_for_function("game.comps.friend.view.myStatus==='ACCEPTED'", timeout=15000)
            await A.evaluate("game.comps.reloadFriend(false)")
            await A.wait_for_function("game.comps.friend.view.members.some(m=>m.status==='ACCEPTED' && !m.me)", timeout=15000)
            await A.click('#cpf-start')
            await A.wait_for_function("game.comps.friend.view.status==='ACTIVE'", timeout=15000)
            check('A avvia: calendario, schede Classifica e Calendario', await A.is_visible('[data-cpt=table]') and await A.is_visible('[data-cpt=cal]'))
            await A.click('[data-cpt=table]')
            tbl = await A.text_content('#cp-body')
            check('classifica con le squadre degli amici (nomi dei giocatori accanto)', NA in tbl and NB in tbl)
            await A.click('[data-cpt=over]')

            # ---- giocare la stagione: contro l'IA con il motore, tra amici online
            played_ai = played_online = False
            for rnd in range(12):
                v = await A.evaluate("game.comps.friend.view")
                if v['status'] != 'ACTIVE': break
                mine = next((x for x in v['pending'] if x['home'] == v['myTeam'] or x['away'] == v['myTeam']), None)
                if mine and not (mine['homeUser'] and mine['awayUser']):
                    if not played_ai:
                        await A.click('#cp-play')
                        await A.wait_for_function("game.screen==='match' && game.compMatch && game.compMatch.friend", timeout=15000)
                        await A.evaluate("""(()=>{const m=game.match; m.half=2; m.clock=2695; m.setState('PLAY'); m.teams[0].score=3; m.teams[1].score=1;
                            m.log.push({team:m.teams[0], scorer:m.teams[0].players[9].data.name, own:false, minute:20});})()""")
                        await A.wait_for_function("game.screen==='fulltime' && document.getElementById('ft-comp-note').textContent.includes('registrato')", timeout=40000, polling=200)
                        await A.click('#ft-comp')
                        await A.wait_for_function("game.screen==='comp' && game.comps.friend", timeout=15000)
                        fx = await A.evaluate("game.comps.friend.view.comp.fixtures.find(f=>f.id===%s)" % json.dumps(mine['fixture']))
                        check('partita contro l\'IA giocata con il motore: 3-1 sul server, da A', fx['played'] and fx['h'] == 3 and fx['a'] == 1 and fx['how'] == 'played' and fx['by'] == NA, fx)
                        played_ai = True
                    else:
                        await A.click('#cp-sim'); await A.wait_for_timeout(300)
                elif mine and not played_online:
                    # A apre la stanza dalla competizione
                    await A.click('#cp-online')
                    await A.wait_for_function("game.screen==='lobby' && game.net && game.net.friend", timeout=20000)
                    check('lobby della sfida: lati e impostazioni fissati', await A.evaluate("[...document.querySelectorAll('[data-side]')].every(b=>b.disabled)") and not await A.is_visible('#lb-host-opts') and await A.is_disabled('#lb-start'))
                    await B.evaluate("game.comps.reloadFriend(false)")
                    await B.wait_for_function("document.getElementById('cp-join')", timeout=20000)
                    check('B vede la stanza di A e entra con un clic', True)
                    await B.click('#cp-join')
                    await B.wait_for_function("game.screen==='lobby' && game.net && game.net.friend", timeout=20000)
                    await A.wait_for_function("!document.getElementById('lb-start').disabled", timeout=20000)
                    sides = await A.evaluate("game.net.host.lobbyState().members.map(m=>[m.name,m.side])")
                    check('ognuno con la sua squadra (casa/trasferta dalla partita)', sorted(sides) == sorted([[mine['homeUser'], 0], [mine['awayUser'], 1]]), sides)
                    await A.click('#lb-start')
                    await A.wait_for_function("game.screen==='match'", timeout=20000)
                    await B.wait_for_function("game.screen==='match'", timeout=20000)
                    await A.evaluate("""(()=>{const m=game.match; m.half=2; m.clock=2696; m.teams[0].score=2; m.teams[1].score=2;})()""")
                    await A.wait_for_function("game.screen==='fulltime'", timeout=40000, polling=200)
                    await B.wait_for_function("game.screen==='fulltime'", timeout=40000, polling=200)
                    await A.wait_for_function("/registrato|mandato/.test(document.getElementById('ft-comp-note').textContent)", timeout=20000)
                    await B.wait_for_function("/registrato|mandato/.test(document.getElementById('ft-comp-note').textContent)", timeout=20000)
                    await A.wait_for_timeout(500)
                    await A.evaluate("game.quitToMenu()"); await B.evaluate("game.quitToMenu()")
                    await A.evaluate("game.comps.openFriend(%s)" % json.dumps(code))
                    await A.wait_for_function("game.screen==='comp' && game.comps.friend", timeout=15000)
                    fx = await A.evaluate("game.comps.friend.view.comp.fixtures.find(f=>f.id===%s)" % json.dumps(mine['fixture']))
                    check('partita online tra amici: 2-2 mandato da entrambi e registrato', fx['played'] and fx['h'] == 2 and fx['a'] == 2 and fx['by'] == 'online', fx)
                    played_online = True
                elif mine:
                    await A.click('#cp-fsim')
                    await B.evaluate("game.comps.openFriend(%s)" % json.dumps(code))
                    await B.wait_for_function("document.getElementById('cp-fsim')", timeout=15000)
                    await B.click('#cp-fsim'); await B.wait_for_timeout(500)
                # partite di B contro l'IA: le simula B
                if await B.evaluate("game.screen") != 'comp':
                    await B.evaluate("game.comps.openFriend(%s)" % json.dumps(code))
                    await B.wait_for_function("game.screen==='comp' && game.comps.friend", timeout=15000)
                await B.evaluate("game.comps.reloadFriend(false)")
                await B.wait_for_timeout(300)
                if await B.is_visible('#cp-sim'): await B.click('#cp-sim'); await B.wait_for_timeout(400)
                await A.evaluate("game.comps.reloadFriend(false)")
                await A.wait_for_timeout(400)
            v = await A.evaluate("game.comps.friend.view")
            check('stagione giocata fino alla fine (campione)', v['status'] == 'FINISHED' and v['comp']['champion'] is not None, v['status'])
            check('si è giocato contro l\'IA e online tra amici', played_ai and played_online, (played_ai, played_online))
            check('fine stagione: «Nuova stagione» solo per chi ha creato la sfida', await A.is_visible('#cp-newseason'))
            await A.screenshot(path=HERE + '/shots/80_sfida_tra_amici.png')

            # ---- di nuovo nella Home: la sfida nel pannello
            await A.evaluate("game.showScreen('menu')")
            await A.wait_for_function("document.querySelector('#so-content').textContent.includes('conclusa')", timeout=15000)
            check('pannello: la sfida conclusa con il vincitore', '🏆' in await social_text(A))
            await A.screenshot(path=HERE + '/shots/81_pannello_amici.png')
            check('nessun errore JavaScript', not ea and not eb, (ea[:3], eb[:3]))
            await b.close()
    finally:
        try: os.killpg(srv.pid, 15)
        except Exception: pass
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)


asyncio.run(main())
