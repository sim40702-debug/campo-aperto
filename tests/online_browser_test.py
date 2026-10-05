# Test online nel browser: due giocatori in due contesti separati, server relay vero.
# Crea partita, codice, ingresso con codice, lobby, scelta squadra, avvio, comandi del client,
# sincronizzazione, chiusura dell'host.
import asyncio, os, json, subprocess, time
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
PORT = 8791
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''))

async def player(b, name):
    ctx = await b.new_context(viewport={'width': 900, 'height': 520})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    s = {'quality': 'bassa', 'dynamicRes': False, 'name': name, 'server': 'ws://127.0.0.1:%d' % PORT}
    await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", ' + json.dumps(json.dumps(s)) + ')')
    await pg.goto(URL)
    await pg.wait_for_function('window.game && game.loaded', timeout=60000)
    return pg, errs

async def main():
    srv = subprocess.Popen(['node', os.path.join(HERE, '..', 'server', 'relay.js'), '--port', str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=ARGS)
            A, errA = await player(b, 'Simone')
            B, errB = await player(b, 'Luca')
            # server sbagliato: errore chiaro, nessun crash
            await A.evaluate("game.settings.server='ws://127.0.0.1:1'")
            await A.click('#btn-online'); await A.wait_for_timeout(200)
            await A.click('#on-create')
            await A.wait_for_function("document.getElementById('on-status').textContent.length>0", timeout=15000)
            msg = await A.evaluate("document.getElementById('on-status').textContent")
            check('server non raggiungibile: messaggio di errore', 'server' in msg.lower(), msg)
            await A.evaluate("game.settings.server='ws://127.0.0.1:%d'" % PORT)
            # creazione
            await A.click('#on-create')
            await A.wait_for_function("game.screen==='lobby'", timeout=15000)
            code = await A.evaluate("game.net.link.code")
            board = await A.evaluate("[...document.querySelectorAll('#lb-board .flap')].map(e=>e.textContent).join('')")
            check('partita creata, codice mostrato sul tabellone', len(code) == 6 and board == code, code)
            await A.wait_for_timeout(500)
            await A.screenshot(path=HERE + '/shots/20_lobby_host.png')
            # codice sbagliato
            await B.click('#btn-online'); await B.wait_for_timeout(200)
            await B.fill('#on-code', 'ZZZZ99'); await B.click('#on-join')
            await B.wait_for_function("document.getElementById('on-status').textContent.length>0", timeout=15000)
            check('codice sbagliato: errore chiaro', 'Nessuna partita' in await B.evaluate("document.getElementById('on-status').textContent"))
            # ingresso con il codice scritto in minuscolo
            await B.fill('#on-code', code.lower()); await B.press('#on-code', 'Enter')
            await B.wait_for_function("game.screen==='lobby' && game.net && game.net.client.lobby && game.net.client.lobby.members.length===2", timeout=15000)
            check('ingresso con codice: il client vede la lobby con 2 giocatori', True)
            await A.wait_for_function("document.querySelectorAll('#lobby li .nm').length>=2", timeout=10000)
            names = await A.evaluate("[...document.querySelectorAll('#lobby li .nm')].map(e=>e.textContent).sort().join(',')")
            check('lista giocatori dell host aggiornata', names == 'Luca,Simone', names)
            # Luca va negli ospiti (Simone è in casa)
            await B.click('[data-side="1"]')
            await A.wait_for_function("game.net.host.members.get(game.net.host.slots.length>=0 && [...game.net.host.members.keys()][1]).side===1", timeout=10000)
            check('scelta squadra del client applicata', True)
            # l'host cambia la durata: il client lo vede
            await A.click('#lb-len .seg:nth-child(1)')
            await B.wait_for_function("game.net.client.lobby.settings.halfSeconds===120", timeout=10000)
            check('impostazioni dell host sincronizzate nella lobby', True)
            # l'host dà un nome alla squadra di casa: il client lo vede nella lobby e in partita
            await A.fill('#lb-home-name', 'Squadra di Simone')
            await A.press('#lb-home-name', 'Enter')
            await B.wait_for_function("game.net.client.lobby.settings.names[0]==='Squadra di Simone' && document.getElementById('lb-team-0').textContent==='Squadra di Simone'", timeout=10000)
            check('nome della squadra scelto dall host visibile al client nella lobby', True)
            await B.wait_for_timeout(400)
            await B.screenshot(path=HERE + '/shots/21_lobby_client.png')
            check('il client non può avviare la partita', await B.evaluate("document.getElementById('lb-start').hidden"))
            # avvio
            await A.click('#lb-start')
            await A.wait_for_function("game.screen==='match' && game.mode==='host'", timeout=15000)
            await B.wait_for_function("game.screen==='match' && game.mode==='client'", timeout=15000)
            check('avvio: entrambi in partita (host e client)', True)
            tn = [await pg.evaluate("[game.match.teams[0].data.name, document.getElementById('sb-home').textContent]") for pg in (A, B)]
            check('in partita: host e client con il nome scelto e la sigla SQU', tn[0] == tn[1] == ['Squadra di Simone', 'SQU'], tn)
            # l'host batte il calcio d'inizio
            await A.wait_for_function("game.match.setPieceReady", timeout=60000)
            await A.keyboard.press('j')
            await A.wait_for_function("game.match.state==='PLAY'", timeout=30000)
            # Luca tiene premuto D: il suo calciatore sull'host va verso +x
            lid = await B.evaluate("game.net.link.id")
            x0 = await A.evaluate("(()=>{const h=game.match.humanById('%s'); window.__lp=h.player; return h.player.x})()" % lid)
            # predizione: sul client il proprio calciatore si muove subito, prima che arrivi la risposta dell'host
            # (senza predizione il client mostra l'host 100 ms nel passato: in 90 ms non si vedrebbe nulla)
            cx0 = await B.evaluate("(()=>{const c=game.net.client, p=c.match.humanById(game.net.link.id).player; return p.x})()")
            await B.keyboard.down('d'); await B.wait_for_timeout(90)
            cx1 = await B.evaluate("(()=>{const c=game.net.client, p=c.match.humanById(game.net.link.id).player; return {x:p.x, pred:!!c.pr}})()")
            check('client: il proprio calciatore risponde subito al tasto (predizione locale, %.2f m in 90 ms)' % (cx1['x'] - cx0), cx1['pred'] and cx1['x'] - cx0 > 0.04, (cx0, cx1))
            await B.wait_for_timeout(2910)
            st = await A.evaluate("({x: __lp.x, vx: __lp.vx, mx: game.match.humanById('%s').input.mx})" % lid)
            await B.keyboard.up('d')
            check('tastiera del client: comando arrivato all host e calciatore in movimento', st['mx'] == 1 and (st['x'] - x0 > 0.5 or st['vx'] > 1), st)
            await B.wait_for_timeout(1500)
            hostP = await A.evaluate("(()=>{const p=game.match.humanById('%s').player; return [p.x, p.z]})()" % lid)
            cliP = await B.evaluate("(()=>{const p=game.net.client.match.humanById(game.net.link.id).player; return [p.x, p.z]})()")
            err = ((hostP[0] - cliP[0]) ** 2 + (hostP[1] - cliP[1]) ** 2) ** 0.5
            check('predizione corretta dall\'host: da fermo la posizione sul client coincide con quella vera (scarto %.2f m)' % err, err < 0.6, (hostP, cliP))
            # sincronizzazione: stesso punteggio e palla vicina
            sync = await B.evaluate("(()=>{const c=game.match; return {bx:c.ball.x, bz:c.ball.z, s:c.teams[0].score+'-'+c.teams[1].score, snaps:game.net.client.snaps.length, rtt:game.net.client.rtt}})()")
            hb = await A.evaluate("({bx:game.match.ball.x, bz:game.match.ball.z, s:game.match.teams[0].score+'-'+game.match.teams[1].score})")
            check('sincronizzazione: il client riceve lo stato', sync['snaps'] > 5 and sync['s'] == hb['s'], (sync, hb))
            await B.screenshot(path=HERE + '/shots/22_match_client.png')
            await A.screenshot(path=HERE + '/shots/23_match_host.png')
            ind = await B.evaluate("document.getElementById('net-text').textContent")
            check('indicatore di connessione nel client', 'Online' in ind, ind)
            # pausa online: il gioco continua
            t0 = await A.evaluate("game.match.clock")
            await B.keyboard.press('Escape'); await B.wait_for_timeout(1500)
            t1 = await A.evaluate("game.match.clock")
            check('pausa del client: la partita sull host continua', t1 > t0 and await B.evaluate("game.paused"))
            await B.keyboard.press('Escape'); await B.wait_for_timeout(300)
            # l'host chiude la partita: il client torna al menu con un messaggio
            await A.keyboard.press('Escape'); await A.wait_for_function("game.paused", timeout=10000)
            await A.click('#pause-quit')          # primo clic: chiede conferma (0.3.1)
            await A.wait_for_timeout(300)
            check('host: chiudere la partita chiede conferma', await A.evaluate("game.screen==='match' && document.getElementById('pause-quit').classList.contains('confirm')"))
            await A.click('#pause-quit')          # secondo clic: chiude
            await B.wait_for_function("game.screen==='menu' && !document.getElementById('toast').hidden", timeout=15000)
            toast = await B.evaluate("document.getElementById('toast').textContent")
            check('host esce: il client viene avvisato e torna al menu', 'host' in toast.lower(), toast)
            check('nessun errore JavaScript nei due giocatori', not errA and not errB, (errA[:2], errB[:2]))
            await b.close()
    finally:
        srv.terminate()
    print('\nRisultato: %d superati, %d falliti' % (results.count(True), results.count(False)))
    raise SystemExit(0 if all(results) else 1)
asyncio.run(main())
