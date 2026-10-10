# Classifica online e amici nel gioco vero (Chromium headless) contro il server vero in locale (wrangler dev:
# Worker, D1, Durable Object del relay). Due giocatori con l'account: l'invito a giocare compare anche fuori dalla
# Home (avviso in alto con Entra), partita online tra i due, risultato mandato da tutti e due -> punti in classifica,
# schermata Classifica online, livello e stato "online" degli amici.
# Prima: node build.js test. Uso: python3 tests/classifica_browser_test.py
import asyncio, os, json, subprocess, tempfile, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
CLOUD = os.path.join(ROOT, 'cloud')
URL = 'file://' + os.path.join(ROOT, 'dist', 'test.html')
PORT = 8795
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
    persist = tempfile.mkdtemp(prefix='campo-classifica-')
    srv = start_server(persist)
    sfx = str(int(time.time()))[-4:]
    NA, NB = 'anna' + sfx, 'bruno' + sfx
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=ARGS)
            ca, A, ea = await newpage(b)
            cb, B, eb = await newpage(b)
            await register(A, NA); await register(B, NB)
            await A.evaluate("game.eco.api.post('/api/friends/request', { username: %s })" % json.dumps(NB))
            await B.evaluate("game.eco.api.post('/api/friends/accept', { username: %s })" % json.dumps(NA))
            await wait_social(A, "document.querySelector('#so-content').textContent.includes('Amici · 1')")
            # B è nelle competizioni (non nella Home): l'invito arriva lo stesso
            await B.click('#btn-comps')
            await A.click('#so-content [data-so=play][data-u="%s"]' % NB)
            await A.wait_for_function("game.screen==='lobby' && game.net && game.net.host", timeout=20000)
            await B.evaluate("game.social.pollInvites()")
            await B.wait_for_function("!document.getElementById('invite-pop').hidden", timeout=20000)
            check('invito a giocare anche fuori dalla Home: avviso in alto con Entra', NA in await B.text_content('#invite-text') and await B.evaluate("game.screen") == 'comps')
            await B.click('#invite-join')
            await B.wait_for_function("game.screen==='lobby' && game.net && game.net.client", timeout=20000)
            await A.wait_for_function("game.net.host.lobbyState().members.length===2", timeout=20000)
            check('Entra: B nella stanza di A', True)
            await A.click('#lb-start')
            await A.wait_for_function("game.screen==='match' && game.match.state==='PLAY'", timeout=30000)
            await B.wait_for_function("game.screen==='match'", timeout=20000)
            # fine partita subito: ultimo secondo del secondo tempo sull'host
            await A.evaluate("() => { const m = game.net.host.match; m.half = 2; m.clock = 2699; }")
            await A.wait_for_function("game.screen==='fulltime'", timeout=60000)
            await B.wait_for_function("game.screen==='fulltime'", timeout=60000)
            score = await A.evaluate("game.net.host.match.teams.map(t => t.score)")
            await A.wait_for_function("document.getElementById('ft-online-note').textContent.includes('+')", timeout=60000)
            await B.wait_for_function("document.getElementById('ft-online-note').textContent.includes('+')", timeout=60000)
            na, nb = await A.text_content('#ft-online-note'), await B.text_content('#ft-online-note')
            exp = (30, 5) if score[0] > score[1] else (5, 30) if score[0] < score[1] else (12, 12)
            check('fine partita: tutti e due mandano il risultato e prendono i punti giusti', ('+%d' % exp[0]) in na and ('+%d' % exp[1]) in nb, (score, na, nb))
            # classifica
            await A.evaluate("game.quitToMenu()"); await B.evaluate("game.quitToMenu()")
            await A.wait_for_timeout(500)
            await A.evaluate("game.ranking.open('menu')")
            await A.wait_for_function("document.querySelector('#rk-body .rk-table')", timeout=20000)
            rows = await A.evaluate("[...document.querySelectorAll('#rk-body .rk-table tr')].slice(1).map(r => [...r.children].map(td => td.textContent))")
            check('Classifica online: tutti e due, in ordine di punti', len(rows) == 2 and {rows[0][1], rows[1][1]} == {NA, NB} and int(rows[0][3]) >= int(rows[1][3]), rows)
            me = await A.text_content('#rk-body .rk-me')
            check('la mia riga: livello, punti, posto e quanto manca al prossimo livello', 'livello' in me and 'punti' in me and 'posto' in me and 'mancano' in me, me)
            # amici: livello e online
            await B.evaluate("game.social.refresh()")
            await A.evaluate("game.showScreen('menu')")
            await wait_social(A, "document.querySelector('#so-content .so-lv')")
            row = await A.evaluate("[...document.querySelectorAll('#so-content .so-row')].find(r => r.textContent.includes(%s)).textContent" % json.dumps(NB))
            check('amici: livello della classifica e "online"', 'online' in row, row)
            # dal menu Multiplayer
            await A.click('#btn-online'); await A.click('#on-ranking')
            check('pulsante Classifica online nel Multiplayer', await A.evaluate("game.screen") == 'ranking')
            await A.click('#rk-back')
            check('Indietro torna al Multiplayer', await A.evaluate("game.screen") == 'online')
            check('nessun errore nelle pagine', not ea and not eb, (ea[:3], eb[:3]))
            await b.close()
    finally:
        try: os.killpg(srv.pid, 15)
        except Exception: pass
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
