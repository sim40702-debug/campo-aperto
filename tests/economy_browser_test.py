# Test dell'economia nel gioco vero (Chromium headless) contro il server vero in locale (wrangler dev: Worker,
# D1 e Durable Object). Due giocatori su due "computer" diversi (contesti del browser separati, niente in comune).
# Prima: node build.js test. Uso: python3 tests/economy_browser_test.py
import asyncio, os, json, subprocess, tempfile, time, signal, urllib.request
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
CLOUD = os.path.join(ROOT, 'cloud')
URL = 'file://' + os.path.join(ROOT, 'dist', 'test.html')
PORT = 8791
API = 'http://127.0.0.1:%d' % PORT
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
WRANGLER = os.path.join(CLOUD, 'node_modules', '.bin', 'wrangler')
results = []

def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

def http(method, path, body=None, token=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode())
    req.add_header('content-type', 'application/json')
    if token: req.add_header('authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

def set_clock(t):
    _, r = http('POST', '/api/_test/clock', {'offsetMs': 0})
    return http('POST', '/api/_test/clock', {'offsetMs': t - r['serverTime']})

def start_server(persist):
    if not os.path.exists(os.path.join(CLOUD, '.dev.vars')):
        with open(os.path.join(CLOUD, '.dev.vars.example')) as f, open(os.path.join(CLOUD, '.dev.vars'), 'w') as g: g.write(f.read())
    subprocess.run([WRANGLER, 'd1', 'migrations', 'apply', 'campo-aperto', '--local', '--persist-to', persist], cwd=CLOUD, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['node', 'build.js', 'engine'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    log = open(os.path.join(persist, 'wrangler.log'), 'w')
    print('log del server:', log.name, flush=True)
    p = subprocess.Popen([WRANGLER, 'dev', '--port', str(PORT), '--ip', '127.0.0.1', '--persist-to', persist], cwd=CLOUD, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(120):
        try:
            if http('GET', '/api/status')[0] == 200: return p
        except Exception: pass
        time.sleep(0.5)
    raise RuntimeError('server non partito')

async def newpage(b, w=1280, h=800):
    ctx = await b.new_context(viewport={'width': w, 'height': h})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
    s = {'quality': 'bassa', 'dynamicRes': False, 'apiUrl': API}
    await pg.add_init_script('if (!localStorage.getItem("campoAperto.settings.v1")) localStorage.setItem("campoAperto.settings.v1", ' + json.dumps(json.dumps(s)) + ')')
    await pg.goto(URL)
    await pg.wait_for_function('window.game && window.game.loaded', timeout=60000)
    return ctx, pg, errs

async def text(pg, sel): return (await pg.text_content(sel) or '').strip()
async def menu_balance(pg): return await pg.evaluate("document.querySelector('#eco-wallet [data-balance]').textContent")

async def register(pg, name, pw):
    await pg.click('#eco-user'); await pg.wait_for_function("game.screen==='account'")
    await pg.fill('#ac-new-user', name); await pg.fill('#ac-new-pass', pw); await pg.fill('#ac-new-pass2', pw)
    await pg.click('#ac-register')
    await pg.wait_for_function("game.screen==='menu' && game.eco.api.me", timeout=30000)

async def main():
    persist = tempfile.mkdtemp(prefix='campo-e2e-')
    srv = start_server(persist)
    try:
        await run()
    finally:
        os.killpg(srv.pid, signal.SIGTERM)
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))

async def run():
    sfx = hex(int(time.time()))[-4:]
    NA, NB = 'anna_' + sfx, 'bruno_' + sfx
    http('POST', '/api/_test/tick')
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctxA, A, errA = await newpage(b)
        ctxB, B, errB = await newpage(b)
        check('menu: saldo sconosciuto senza account (nessun valore inventato)', await menu_balance(A) == '—' and await text(A, '#eco-user') == 'Accedi')
        await A.screenshot(path=HERE + '/shots/40_menu_economia.png')
        await register(A, NA, 'password-a1')
        check('A registrato: saldo 1.000 dal server', await menu_balance(A) == '1.000', await menu_balance(A))
        await register(B, NB, 'password-b1')
        check('B registrato su un altro "computer": saldo 1.000', await menu_balance(B) == '1.000')
        tokA = await A.evaluate('game.eco.api.token'); tokB = await B.evaluate('game.eco.api.token')
        check('sul computer resta solo il token, non il saldo', await A.evaluate("!JSON.stringify(localStorage).includes('balance') && !JSON.stringify(localStorage).includes('1000')"))

        # ---- partite e centro partita (A) ----
        await A.click('[data-eco=fixtures]'); await A.wait_for_selector('.fxrow', timeout=20000)
        n = await A.evaluate("document.querySelectorAll('.fxrow').length")
        check('PARTITE: elenco dal server (%d)' % n, n >= 2)
        await A.screenshot(path=HERE + '/shots/41_partite.png')
        code = await A.evaluate("game.eco.fixtures.next[0].code")
        await A.click('.fxrow[data-fx="%s"]' % code)
        await A.wait_for_function("game.screen==='center' && game.eco.fx && document.querySelectorAll('#mc-markets .sel').length > 0", timeout=20000)
        tabs = await A.evaluate("[...document.querySelectorAll('#mc-tabs .tab')].map(t=>t.textContent)")
        check('centro partita: schede 1X2 / Gol / Corner / Cartellini / Altro', tabs == ['1X2', 'Gol', 'Corner', 'Cartellini', 'Altro'], tabs)
        for t in ['Gol', 'Corner', 'Cartellini', 'Altro']:
            await A.click('#mc-tabs .tab:has-text("%s")' % t)
            k = await A.evaluate("document.querySelectorAll('#mc-markets .sel').length")
            check('scheda %s: selezioni con quote (%d)' % (t, k), k > 0)
        await A.click('#mc-tabs .tab:has-text("1X2")')
        home_odds = await A.evaluate("game.eco.fx.markets.find(m=>m.id==='1X2').sels.find(s=>s.id==='1').odds")
        await A.click('#mc-markets [data-m="1X2"][data-s="1"]')
        check('schedina: compare con la selezione', await A.evaluate("!document.getElementById('slip').hidden && game.eco.slip.items.length===1"))
        await A.fill('#slip-stake', '100')
        await A.screenshot(path=HERE + '/shots/42_centro_partita.png')
        await A.click('#slip-confirm')
        await A.wait_for_function("game.eco.slip.items.length===0", timeout=20000)
        await A.wait_for_function("game.eco.api.me.balance===950", timeout=20000)
        check('A gioca 100 @%.2f: saldo 950 (1000 - 100 + 50 obiettivo)' % home_odds, await A.evaluate("document.querySelector('.wallet [data-balance]').textContent") in ('950',))
        await A.wait_for_selector('#mc-feed .betcard', timeout=20000)
        codeA = await A.evaluate("document.querySelector('#mc-feed .betcard').dataset.bet")

        # ---- B vede la scommessa di A ----
        await B.click('[data-eco=fixtures]'); await B.wait_for_selector('.fxrow[data-fx="%s"]' % code, timeout=20000)
        await B.click('.fxrow[data-fx="%s"]' % code)
        await B.wait_for_selector('#mc-feed .betcard[data-bet="%s"]' % codeA, timeout=20000)
        card = await B.evaluate("document.querySelector('#mc-feed .betcard[data-bet=\"%s\"]').innerText" % codeA)
        check('B vede la scommessa di A con nome, selezione, importo e quota', NA in card and 'vincente' in card and '100 🪙' in card and ('@%.2f' % home_odds) in card, card.replace('\n', ' | '))
        check('B non vede dati privati nella scheda (niente id, saldo, token)', not any(w in card.lower() for w in ['user_id', 'token', 'saldo', 'password']))
        await B.click('#mc-feed .betcard[data-bet="%s"] [data-react="🔥"]' % codeA)
        await B.wait_for_function("document.querySelector('#mc-feed .betcard[data-bet=\"%s\"] [data-react=\"🔥\"]').textContent.trim()==='🔥 1'" % codeA, timeout=10000)
        check('reazione 🔥 di B registrata dal server', True)
        # copia: la schedina si riempie, niente viene giocato finché B non conferma
        before = http('GET', '/api/me/bets', token=tokB)[1]['bets']
        await B.click('#mc-feed .betcard[data-bet="%s"] [data-copy]' % codeA)
        await B.wait_for_function("game.eco.slip.copiedFrom===%s" % json.dumps(codeA), timeout=10000)
        after = http('GET', '/api/me/bets', token=tokB)[1]['bets']
        check('COPIA SCOMMESSA: schedina riempita, nessuna giocata automatica', len(before) == len(after) == 0 and await B.evaluate("game.eco.api.me.balance") == 1000)
        slip_txt = await B.evaluate("document.getElementById('slip').innerText")
        check('schedina copiata: mostra da chi e chiede conferma', 'Copiata da ' + codeA in slip_txt, slip_txt.replace('\n', ' | '))
        # A gioca molto sulla stessa selezione dal server: la quota cambia e la schedina di B lo mostra
        q = http('POST', '/api/slip/quote', {'items': [{'fixture': code, 'market': '1X2', 'selection': '1'}]}, tokA)[1]['items'][0]
        http('POST', '/api/bets', {'items': [{'fixture': code, 'market': '1X2', 'selection': '1', 'odds': q['odds']}], 'stake': 800, 'clientKey': 'bigbet' + sfx}, tokA)
        await B.fill('#slip-stake', '10')
        await B.click('#slip-confirm')
        await B.wait_for_function("document.getElementById('slip-status').textContent.includes('Quota cambiata')", timeout=15000)
        chg = await B.evaluate("document.getElementById('slip').innerText")
        check('quota ricontrollata alla conferma: "Quota cambiata", originale e attuale', 'Quota cambiata' in chg and ('originale %.2f' % home_odds) in chg, chg.replace('\n', ' | '))
        check('dopo "Quota cambiata" nessun addebito', http('GET', '/api/me/balance', token=tokB)[1]['balance'] == 1000)
        await B.click('#slip-confirm')
        await B.wait_for_function("game.eco.slip.items.length===0", timeout=15000)
        bb = http('GET', '/api/me/bets', token=tokB)[1]['bets']
        check('conferma manuale con la quota nuova: scommessa copiata', len(bb) == 1 and bb[0]['copiedFrom'] == codeA)
        await B.wait_for_function("game.eco.api.me.balance===1040", timeout=15000)
        check('saldi separati: A %s, B %s' % (await A.evaluate('game.eco.api.refreshBalance()'), await B.evaluate('game.eco.api.me.balance')), True)
        await B.screenshot(path=HERE + '/shots/43_feed_copia.png')
        # privacy: una scommessa privata di A non arriva a B
        q2 = http('POST', '/api/slip/quote', {'items': [{'fixture': code, 'market': 'BTTS', 'selection': 'SI'}]}, tokA)[1]['items'][0]
        priv = http('POST', '/api/bets', {'items': [{'fixture': code, 'market': 'BTTS', 'selection': 'SI', 'odds': q2['odds']}], 'stake': 5, 'clientKey': 'priv' + sfx, 'visibility': 'private'}, tokA)[1]['bet']['code']
        await B.evaluate("game.eco.loadFeed('newer')"); await B.wait_for_timeout(800)
        check('scommessa privata di A: non compare nel feed di B', await B.evaluate("!document.querySelector('[data-bet=\"%s\"]')" % priv))

        # ---- negozio, inventario, personaggio (B) ----
        await B.click('#mc-back'); await B.wait_for_function("game.screen==='fixtures'")
        await B.evaluate("game.showScreen('menu')")
        await B.click('[data-eco=shop]'); await B.wait_for_selector('#sh-grid .item', timeout=20000)
        n_items = await B.evaluate("document.querySelectorAll('#sh-grid .item').length")
        drawn = await B.evaluate("(()=>{const c=document.querySelector('#sh-grid canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4) if(d[i]>0) n++;return n})()")
        check('NEGOZIO: %d oggetti con anteprima disegnata' % n_items, n_items >= 20 and drawn > 1000)
        await B.screenshot(path=HERE + '/shots/44_negozio.png')
        await B.click('#sh-tabs .tab:has-text("Scarpe")')
        btn = '#sh-grid [data-buy="scarpe_fuoco"]'
        await B.click(btn); await B.click(btn)   # secondo clic = conferma
        await B.wait_for_function("game.eco.shopItems.find(i=>i.id==='scarpe_fuoco').owned", timeout=15000)
        check('acquisto scarpe fuoco (450): saldo dal server', http('GET', '/api/me/balance', token=tokB)[1]['balance'] == 1040 - 450 + 50)
        await B.click('#sh-grid [data-eq="scarpe_fuoco"]')
        await B.wait_for_function("game.eco.shopItems.find(i=>i.id==='scarpe_fuoco').equipped", timeout=15000)
        await B.click('#sh-char'); await B.wait_for_function("game.screen==='character' && game.eco.myLoadout", timeout=15000)
        check('PERSONAGGIO: scarpe indossate (dal server)', await B.evaluate("game.eco.myLoadout.items.scarpe.id==='scarpe_fuoco'"))
        await B.fill('#ch-number', '9'); await B.fill('#ch-name', 'bruno')
        await B.click('#ch-save'); await B.wait_for_function("game.eco.myLoadout && game.eco.myLoadout.number===9 && game.eco.myLoadout.name==='BRUNO'", timeout=15000)
        check('numero e nome salvati sul server', http('GET', '/api/players/%s/loadout' % NB)[1]['number'] == 9)
        await B.screenshot(path=HERE + '/shots/45_personaggio.png')
        # in partita: il calciatore di B ha l'aspetto comprato (modello 3D ricostruito)
        await B.evaluate("game.showScreen('menu')")
        await B.click('#btn-quick'); await B.click('#setup-start')
        await B.wait_for_function("game.screen==='match' && game.renderer.cosmetics.size===1", timeout=20000)
        dressed = await B.evaluate("(()=>{const [p,lo]=[...game.renderer.cosmetics][0];return {team:p.team.index, gk:p.isGK, role:p.data.role, boots:lo.items.scarpe.color, n:game.renderer.playerMeshes.length}})()")
        check('in partita: attaccante della tua squadra vestito con gli oggetti del server', dressed['team'] == 0 and not dressed['gk'] and dressed['role'] == 'FW' and dressed['boots'] == '#ff5a1f' and dressed['n'] == 22, dressed)
        await B.wait_for_timeout(1200)
        await B.screenshot(path=HERE + '/shots/46_partita_cosmetici.png')
        await B.evaluate("game.quitToMenu()")

        # ---- profilo: privacy, bonus, movimenti ----
        await A.evaluate("game.showScreen('menu')")
        await A.click('[data-eco=profile]'); await A.wait_for_selector('#pf-claim', timeout=15000)
        await A.click('#pf-claim'); await A.wait_for_function("document.querySelector('#pf-daily').innerText.includes('Già riscosso')", timeout=15000)
        check('bonus giornaliero riscosso una volta', http('POST', '/api/me/daily', {}, tokA)[0] == 409)
        txs = await A.evaluate("document.querySelectorAll('#pf-tx .txrow').length")
        check('movimenti del portafoglio dal server (%d)' % txs, txs >= 5)
        await A.click('#pf-public'); await A.wait_for_timeout(800)
        check('privacy: "Mostra pubblicamente le mie scommesse" disattivato sul server', http('GET', '/api/me', token=tokA)[1]['publicBets'] is False)
        st, feed = http('GET', '/api/fixtures/%s/bets' % code, token=tokB)
        check('dopo la privacy: le scommesse di A spariscono dal feed di B', all(x['user'] != NA for x in feed['bets']))
        await A.screenshot(path=HERE + '/shots/47_profilo.png')
        await A.click('#pf-public'); await A.wait_for_timeout(800)

        # ---- persistenza: refresh, altro browser, logout/login ----
        balA = http('GET', '/api/me/balance', token=tokA)[1]['balance']; balB = http('GET', '/api/me/balance', token=tokB)[1]['balance']
        pre = await B.evaluate("({keys: Object.keys(localStorage), sess: !!localStorage.getItem('campoAperto.session.v1'), tok: !!game.eco.api.token, url: location.href})")
        await B.reload()
        post = await B.evaluate("({keys: Object.keys(localStorage), sess: !!localStorage.getItem('campoAperto.session.v1'), url: location.href})")
        print('localStorage di B prima/dopo il ricaricamento:', pre, post, flush=True)
        try: await B.wait_for_function("window.game && game.loaded && game.eco.api.me", timeout=30000)
        except Exception:
            print('errori B:', errB[-5:], await B.evaluate("({loaded: window.game && game.loaded, tok: !!(window.game && game.eco.api.token)})"), flush=True); raise
        check('refresh di B: ancora collegato, saldo %d' % balB, await B.evaluate("game.eco.api.me.balance") == balB and await menu_balance(B) == format(balB, ',').replace(',', '.'))
        ctxA2, A2, errA2 = await newpage(b)
        await A2.click('#eco-user'); await A2.fill('#ac-user', NA); await A2.fill('#ac-pass', 'password-a1'); await A2.click('#ac-login')
        await A2.wait_for_function("game.screen==='menu' && game.eco.api.me", timeout=30000)
        check('A da un altro browser: stesso saldo %d' % balA, await A2.evaluate("game.eco.api.me.balance") == balA)
        await A2.click('[data-eco=bets]'); await A2.wait_for_selector('#bt-list .betcard', timeout=15000)
        check('SCOMMESSE di A dall\'altro browser: in corso %d' % await A2.evaluate("document.querySelectorAll('#bt-list .betcard').length"), await A2.evaluate("document.querySelectorAll('#bt-list .betcard').length") == 3)
        await A2.click('[data-bt=top]'); await A2.wait_for_selector('#bt-list table, #bt-list .empty', timeout=15000)
        await A2.screenshot(path=HERE + '/shots/48_scommesse.png')
        check('classifica senza saldo', 'Saldo' not in await A2.evaluate("document.getElementById('bt-list').innerText"))

        # ---- multiplayer: ognuno vede l'aspetto dell'altro, letto dal server (non mandato dai giocatori) ----
        # nessun server impostato: si usa il relay del Worker dell'economia (stesso indirizzo per tutti, /relay)
        try:
            for pg in (A, B):
                await pg.evaluate("game.settings.server=''; game.showScreen('menu')")
            await A.click('#btn-online'); await A.wait_for_timeout(200)
            check('online senza impostazioni: server predefinito = relay del Worker', await A.evaluate("game.onlineServer()") == 'ws://127.0.0.1:%d/relay' % PORT and await A.evaluate("document.getElementById('on-create').textContent") == 'Crea partita online')
            check('online con account: il nome è quello dell\'account', await A.evaluate("document.getElementById('on-name').value") == NA and await A.evaluate("document.getElementById('on-name').disabled"))
            await A.click('#on-create'); await A.wait_for_function("game.screen==='lobby'", timeout=15000)
            room = await A.evaluate("game.net.link.code")
            check('partita creata sul Worker con il codice ' + room, len(room) == 6 and room[0] != 'L')
            await B.click('#btn-online'); await B.wait_for_timeout(200)
            await B.fill('#on-code', room); await B.click('#on-join')
            await B.wait_for_function("game.screen==='lobby' && game.net.client.lobby && game.net.client.lobby.members.length===2", timeout=15000)
            await B.click('[data-side="1"]'); await A.wait_for_timeout(800)
            await A.click('#lb-start')
            await A.wait_for_function("game.screen==='match' && game.renderer.cosmetics.size===2", timeout=20000)
            await B.wait_for_function("game.screen==='match' && game.renderer.cosmetics.size===2", timeout=20000)
            seen = {}
            for nm, pg in (('A', A), ('B', B)):
                seen[nm] = await pg.evaluate("[...game.renderer.cosmetics].map(([p,lo])=>({team:p.team.index, role:p.data.role, user:lo.username, boots:(lo.items.scarpe||{}).color||null, number:lo.number})).sort((a,b)=>a.team-b.team)")
            exp = [{'team': 0, 'role': 'FW', 'user': NA, 'boots': None, 'number': 10}, {'team': 1, 'role': 'FW', 'user': NB, 'boots': '#ff5a1f', 'number': 9}]
            check('multiplayer: host e client vedono gli stessi calciatori vestiti (scarpe fuoco e numero 9 di B)', seen['A'] == exp and seen['B'] == exp, seen)
            await A.wait_for_timeout(1500)
            await A.screenshot(path=HERE + '/shots/51_online_cosmetici.png')
            await A.evaluate("game.quitToMenu()"); await B.wait_for_function("game.screen==='menu'", timeout=15000)
        finally:
            pass

        # ---- transizioni: la schermata nasce al suo posto (nessuno spostamento laterale) ----
        ctxC, C, errC = await newpage(b)
        NC = 'carla_' + sfx
        await register(C, NC, 'password-c1')
        await C.evaluate("game.showScreen('menu')")
        await C.evaluate("window.__xs=[]; (function f(t0){ const r=document.querySelector('#fixtures .sheet').getBoundingClientRect(); window.__xs.push(r.left); if (performance.now()-t0<400) requestAnimationFrame(()=>f(t0)); })(performance.now()); document.querySelector('[data-eco=fixtures]').click();")
        await C.wait_for_timeout(600)
        xs = await C.evaluate("window.__xs.filter(x => x !== 0)")
        final = await C.evaluate("document.querySelector('#fixtures .sheet').getBoundingClientRect().left")
        check('transizione: la schermata entra al suo posto (spostamento massimo %.1f px, mai fuori schermo)' % (max(abs(x - final) for x in xs) if xs else 0), xs and min(xs) >= 0 and max(abs(x - final) for x in xs) <= 8, xs[:6])

        # ---- multipla sulla stessa partita costruita dall'interfaccia, conflitti ----
        await C.wait_for_selector('.fxrow[data-fx="%s"]' % code, timeout=20000)
        await C.click('.fxrow[data-fx="%s"]' % code)
        await C.wait_for_function("game.screen==='center' && document.querySelectorAll('#mc-markets .sel').length > 0", timeout=20000)
        await C.click('#mc-markets [data-m="1X2"][data-s="1"]')
        await C.click('#mc-tabs .tab:has-text("Gol")')
        over = await C.evaluate("game.eco.fx.markets.find(m=>m.id==='TG').sels.find(s=>/^O/.test(s.id)).id")
        await C.click('#mc-markets [data-m="TG"][data-s="%s"]' % over)
        check('stessa partita: 1 + %s entrambe in schedina' % over, await C.evaluate("game.eco.slip.items.length===2 && !game.eco.slip.conflict"))
        await C.click('#mc-markets [data-m="CS"][data-s="0-1"]')
        await C.wait_for_function("!document.getElementById('slip-conflict').hidden", timeout=5000)
        ctext = await C.evaluate("document.getElementById('slip-conflict-text').textContent")
        check('selezione incompatibile: non entra, si vede il motivo e la selezione in conflitto', await C.evaluate("game.eco.slip.items.length===2 && document.querySelectorAll('#slip .slip-it.conflict').length>=1") and '0-1' in ctext and 'non' in ctext, ctext)
        await C.click('#slip-conflict-cancel')
        check('Annulla: la schedina resta com\'era', await C.evaluate("game.eco.slip.items.length===2 && document.getElementById('slip-conflict').hidden"))
        await C.click('#mc-markets [data-m="CS"][data-s="0-1"]')
        await C.click('#slip-conflict-replace')
        sl = await C.evaluate("game.eco.slip.items.map(i=>i.market+':'+i.selection)")
        check('Sostituisci: tolta la selezione in conflitto, aggiunta la nuova', 'CS:0-1' in sl and '1X2:1' not in sl, sl)
        await C.click('#mc-tabs .tab:has-text("1X2")')
        check('selezioni incompatibili smorzate (1X2 "1" con 0-1 in schedina)', await C.evaluate("document.querySelector('#mc-markets [data-m=\"1X2\"][data-s=\"1\"]').classList.contains('blocked') && !document.querySelector('#mc-markets [data-m=\"1X2\"][data-s=\"2\"]').classList.contains('blocked')"))
        await C.wait_for_function("game.eco.slip.quote && game.eco.slip.quote.valid", timeout=10000)
        st = await C.evaluate("({sel: document.getElementById('slip-sel').textContent, odds: document.getElementById('slip-odds').textContent, bonus: document.getElementById('slip-bonus').textContent, txt: document.getElementById('slip').innerText})")
        check('La mia schedina: selezioni, quota totale, bonus, partita', st['sel'] == str(len(sl)) and st['odds'] != '—' and 'La mia schedina' in st['txt'], st)
        await C.fill('#slip-stake', '10')
        await C.click('#slip-confirm')
        await C.wait_for_function("game.eco.slip.items.length===0", timeout=15000)
        tokC = await C.evaluate('game.eco.api.token')
        cb = http('GET', '/api/me/bets', token=tokC)[1]['bets']
        check('multipla della stessa partita accettata dal server (%d selezioni)' % (len(cb[0]['items']) if cb else 0), len(cb) == 1 and len(cb[0]['items']) == len(sl) and all(i['fixture'] == code for i in cb[0]['items']))
        await C.screenshot(path=HERE + '/shots/52_multipla_stessa_partita.png')

        # ---- comandi personalizzati salvati sull'account: un altro browser li ritrova ----
        await C.evaluate("game.settings.keys.sprint = ['KeyX', 'ShiftRight']; game.input.setKeys(game.settings.keys); saveSettings(game.settings)")
        await C.wait_for_timeout(2500)
        ctxC2, C2, errC2 = await newpage(b)
        await C2.click('#eco-user'); await C2.fill('#ac-user', NC); await C2.fill('#ac-pass', 'password-c1'); await C2.click('#ac-login')
        await C2.wait_for_function("game.screen==='menu' && game.eco.api.me", timeout=30000)
        await C2.wait_for_function("game.settings.keys.sprint[0]==='KeyX'", timeout=10000)
        check('comandi personalizzati: sull\'altro browser Scatto = X (dall\'account)', await C2.evaluate("game.input.keys.sprint[0]==='KeyX'"))
        await C2.reload(); await C2.wait_for_function("window.game && game.loaded", timeout=30000)
        check('comandi personalizzati: restano dopo il refresh', await C2.evaluate("game.settings.keys.sprint[0]==='KeyX'"))
        for nm, e in [('C', errC), ('C2', errC2)]:
            check('nessun errore JavaScript (%s)' % nm, len(e) == 0, e[:3])

        # ---- guarda partita: sincronizzata con il server ----
        fx = http('GET', '/api/fixtures/' + code)[1]
        set_clock(fx['kickoffAt'] + 20000)
        await A.evaluate("game.showScreen('menu')")
        await A.evaluate("game.eco.openCenter(%s)" % json.dumps(code))
        await A.wait_for_function("game.eco.fx && game.eco.fx.phase==='LIVE' && !document.getElementById('mc-watch').disabled", timeout=20000)
        check('dal calcio d\'inizio: scommesse chiuse, "Guarda partita" attivo', await A.evaluate("document.querySelectorAll('#mc-markets .sel:not([disabled])').length") == 0)
        await A.click('#mc-watch')
        await A.wait_for_function("game.mode==='fixture' && game.fxw && game.match.realTime > 19", timeout=60000)
        rt = await A.evaluate("game.match.realTime")
        check('guarda partita: avanti veloce fino al minuto del server (%.1f s)' % rt, 19 < rt < 30)
        await A.wait_for_timeout(3000)
        check('cronaca del server visibile accanto al campo', await A.evaluate("!document.getElementById('fxside').hidden"))
        await A.screenshot(path=HERE + '/shots/49_guarda_partita.png')
        # verso la fine: la partita del gioco deve coincidere con quella del server
        set_clock(fx['kickoffAt'] + 20000 + 1000)
        dur = http('GET', '/api/fixtures/' + code)[1]['durationMs']
        await A.evaluate("game.stopFixtureWatch(true)")
        set_clock(fx['kickoffAt'] + dur - 3000)
        await A.evaluate("game.eco.loadCenter(true)")
        await A.wait_for_function("game.eco.fx.elapsedMs > %d" % (dur - 8000), timeout=20000)
        await A.click('#mc-watch')
        await A.wait_for_function("game.mode==='fixture' && game.match && game.match.state==='FULLTIME'", timeout=90000)
        local = await A.evaluate("[game.match.teams[0].score, game.match.teams[1].score]")
        set_clock(fx['kickoffAt'] + dur + 2000)
        http('POST', '/api/_test/tick')
        res = http('GET', '/api/fixtures/' + code)[1]
        check('il gioco ha rigiocato la partita del server: %s = %s (nessuna seconda simulazione)' % (local, res['result']['goals']), local == res['result']['goals'] and await A.evaluate("!game.fxw || !game.fxw.desync"))
        await A.wait_for_function("game.screen==='fulltime'", timeout=20000)
        await A.click('#ft-menu'); await A.wait_for_function("game.screen==='center'", timeout=10000)
        await A.wait_for_function("game.eco.fx.settled", timeout=30000)
        await A.wait_for_function("[...document.querySelectorAll('#mc-feed .betcard')].every(c => c.dataset.status !== 'OPEN')", timeout=30000)
        st_txt = await A.evaluate("[...document.querySelectorAll('#mc-feed .betcard .pill')].map(p=>p.textContent).join(' ')")
        check('liquidazione: esiti ✅ VINTA / ❌ PERSA nel feed', ('Vinta' in st_txt) or ('Persa' in st_txt), st_txt)
        await A.screenshot(path=HERE + '/shots/50_liquidata.png')

        for nm, e in [('A', errA), ('B', errB), ('A2', errA2)]:
            check('nessun errore JavaScript (%s)' % nm, len(e) == 0, e[:3])
        await b.close()

asyncio.run(main())
