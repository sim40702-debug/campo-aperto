# Partita veloce online («Cerca avversario») e stagioni della classifica online nel gioco vero (Chromium headless)
# contro il server vero in locale (wrangler dev). Tre giocatori: senza account non si cerca; Annulla toglie dalla
# coda; due che cercano si trovano, entrano nella stessa stanza senza codice e la partita parte da sola; poi la
# classifica del mese, la scheda "Di sempre", e a fine mese premi e distintivi.
# Prima: node build.js test. Uso: python3 tests/partita_veloce_browser_test.py
import asyncio, os, json, subprocess, tempfile, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
CLOUD = os.path.join(ROOT, 'cloud')
URL = 'file://' + os.path.join(ROOT, 'dist', 'test.html')
PORT = 8796
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


async def post_api(path, body):
    import urllib.request
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())

async def main():
    persist = tempfile.mkdtemp(prefix='campo-veloce-')
    srv = start_server(persist)
    sfx = str(int(time.time()))[-4:]
    NA, NB, NC = 'anna' + sfx, 'bruno' + sfx, 'carla' + sfx
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=ARGS)
            ca, A, ea = await newpage(b)
            cb, B, eb = await newpage(b)
            cc, C, ec = await newpage(b)
            # senza account: il pulsante spiega che serve l'account
            await C.click('#btn-online')
            info = await C.text_content('#on-quick-info')
            check('Multiplayer: card Partita veloce, senza account dice di accedere', await C.is_visible('#on-quick') and 'account' in info, info)
            await C.click('#on-quick')
            await C.wait_for_timeout(300)
            check('senza account non entra nella coda', await C.evaluate("!game.quick.searching()"))
            await C.evaluate("game.showScreen('menu')")
            await register(A, NA); await register(B, NB); await register(C, NC)
            # C cerca e poi annulla: esce dalla coda
            await C.click('#btn-online'); await C.click('#on-quick')
            await C.wait_for_function("!document.getElementById('busy').hidden && document.getElementById('busy-text').textContent.includes('Cerco')", timeout=10000)
            await C.wait_for_timeout(1800)
            check('mentre cerca: avviso con i secondi e Annulla', ' s' in await C.text_content('#busy-text'))
            await C.click('#busy-cancel')
            await C.wait_for_timeout(800)
            q = await C.evaluate("game.eco.api.post('/api/online/queue', { action: 'poll' })")
            check('Annulla: fuori dalla coda sul server', q['status'] == 'none' and not await C.evaluate("game.quick.searching()"), q)
            # A cerca, poi B: si trovano e la partita parte da sola
            await A.click('#btn-online'); await A.click('#on-quick')
            await A.wait_for_timeout(1200)
            await B.click('#btn-online'); await B.click('#on-quick')
            await A.wait_for_function("game.screen==='lobby' && game.net && game.net.host && game.net.quick", timeout=30000)
            check('A aspettava da prima: apre la stanza (host)', await A.evaluate("game.net.quick") == NB)
            await B.wait_for_function("game.net && game.net.client && game.net.quick", timeout=30000)
            check('B entra da solo nella stanza di A, senza codice', await B.evaluate("game.net.link.code") == await A.evaluate("game.net.link.code"))
            sub = await B.evaluate("document.getElementById('lb-sub').textContent")
            await A.wait_for_function("game.screen==='match' && game.match", timeout=30000)
            await B.wait_for_function("game.screen==='match'", timeout=30000)
            check('la partita comincia da sola', True)
            st = await A.evaluate("({ s: game.net.host.settings, sides: game.net.host.match.humans.map(h => h.team), names: [...game.net.host.members.values()].map(m => [m.name, m.side]) })")
            check('squadre a caso (diverse), tempi da 3 minuti, host in casa e avversario fuori', st['s']['home'] != st['s']['away'] and st['s']['halfSeconds'] == 180 and sorted(st['sides']) == [0, 1] and [NA, 0] in st['names'] and [NB, 1] in st['names'], st)
            check('trofeo "Avversario trovato" all\'host', await A.evaluate("game.trophies.has('quick_match')"))
            q = await A.evaluate("game.eco.api.post('/api/online/queue', { action: 'poll' })")
            check('a partita cominciata nessuno è più in coda', q['status'] == 'none', q)
            # fine partita: punti in classifica (vale come le altre partite online)
            await A.evaluate("() => { const m = game.net.host.match; m.half = 2; m.clock = 2699; }")
            await A.wait_for_function("game.screen==='fulltime'", timeout=60000)
            await B.wait_for_function("game.screen==='fulltime'", timeout=60000)
            await A.wait_for_function("document.getElementById('ft-online-note').textContent.includes('+')", timeout=60000)
            check('la partita veloce vale per la classifica online', '+' in await A.text_content('#ft-online-note'))
            await A.evaluate("game.quitToMenu()"); await B.evaluate("game.quitToMenu()")
            # classifica: stagione del mese
            await A.wait_for_timeout(500)
            await A.evaluate("game.ranking.open('menu')")
            await A.wait_for_function("document.querySelector('#rk-body .rk-table')", timeout=20000)
            seas = await A.text_content('#rk-body .rk-season')
            check('classifica: "Questo mese" con fine stagione (ultimo giorno del mese) e premi', 'Stagione' in seas and 'finisce' in seas and '1000' in seas and ' 1 ' not in seas.split('finisce')[1][:6], seas)
            rows = await A.evaluate("[...document.querySelectorAll('#rk-body .rk-table tr')].slice(1).map(r => [...r.children].map(td => td.textContent))")
            check('stagione: i due giocatori, il primo con la medaglia', len(rows) == 2 and rows[0][0] == '🥇', rows)
            await A.click('#rk-tab-all')
            await A.wait_for_function("document.querySelector('#rk-body .rk-table') && !document.querySelector('#rk-body .rk-season')", timeout=20000)
            check('scheda "Di sempre"', await A.evaluate("document.getElementById('rk-tab-all').classList.contains('on') && game.ranking.board.which === 'all'"))
            # mese dopo: premi e distintivi
            import datetime
            now = datetime.datetime.now(datetime.timezone.utc)
            nxt = datetime.datetime(now.year + (now.month // 12), now.month % 12 + 1, 1, 2, tzinfo=datetime.timezone.utc)
            await post_api('/api/_test/clock', {'offsetMs': int(nxt.timestamp() * 1000 - time.time() * 1000)})
            tk = await post_api('/api/_test/tick', {})
            check('fine del mese: premi della stagione online pagati', tk.get('onlinePrizes') == 2, tk)
            await A.click('#rk-refresh')
            await A.wait_for_function("document.querySelector('#rk-body .rk-badge')", timeout=20000)
            t = await A.evaluate("document.querySelector('#rk-body .rk-badge').title")
            check('distintivo vicino al nome con la stagione', 'posto' in t, t)
            await A.click('#rk-tab-season')
            await A.wait_for_function("game.ranking.board && game.ranking.board.which === 'season'", timeout=20000)
            check('nuova stagione: classifica del mese vuota', 'Nessuno ha ancora punti questo mese' in await A.text_content('#rk-body'))
            check('nessun errore nelle pagine', not ea and not eb and not ec, (ea[:3], eb[:3], ec[:3]))
            await b.close()
    finally:
        try: os.killpg(srv.pid, 15)
        except Exception: pass
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
