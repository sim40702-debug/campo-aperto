# Avvio e passaggio tra versioni nel gioco vero (Chromium headless):
# schermata di caricamento a passi (stadio, server, aggiornamenti), aggiornamento che salta più versioni
# (con le novità di tutte), dati salvati da versioni vecchie o rovinati che non bloccano il gioco,
# versione dei dati, ripristino con copia quando il gioco non parte.
# Prima: node build.js test. Uso: python3 tests/avvio_browser_test.py
import asyncio, os, json
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
API = 'https://api.prova.invalid'
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

# finto ponte dell'app desktop: c'è la 0.20.0, e si arriva dalla 0.15.0 saltando quattro versioni
FAKE = """
window.__calls = [];
let cb = null;
window.__state = { fase: 'nessuno', attuale: '0.15.0' };
const nuovo = { fase: 'disponibile', attuale: '0.15.0', nuova: '0.20.0', automatico: true, saltate: ['0.20.0', '0.19.0', '0.17.0', '0.16.0'],
  note: '## 0.20.0\\n\\n- novità venti\\n\\n## 0.19.0\\n\\n- novità diciannove\\n\\n## 0.17.0\\n\\n- novità diciassette\\n\\n## 0.16.0\\n\\n- novità sedici' };
window.campoUpdate = {
  stato: () => Promise.resolve(window.__state),
  controlla: silenzioso => { __calls.push('controlla:' + silenzioso); return new Promise(ok => setTimeout(() => { window.__state = nuovo; if (cb) cb(nuovo); ok(nuovo); }, 300)); },
  aggiorna: () => Promise.resolve(window.__state), annulla: () => Promise.resolve(true), apriPagina: () => Promise.resolve(true), visto: () => Promise.resolve(true),
  onCambio: f => { cb = f; },
};
"""
# dati di una versione vecchia, in parte rovinati
OLD = {
    'campoAperto.dataVersion': '0.14.0',
    'campoAperto.settings.v1': json.dumps({'quality': 'bassa', 'dynamicRes': False, 'apiUrl': API, 'lang': 42, 'volMaster': 'tanto', 'keys': 'niente', 'lastSetup': {'home': 99, 'away': -3, 'onDraw': 'boh'}}),
    'campoAperto.career.v1': '{questo non è json',
    'campoAperto.manager.v1': json.dumps({'v': 1, 'team': 3}),
    'campoAperto.pro.v1': json.dumps({'v': 1, 'team': 2, 'p': {'name': 'Vecchio', 'attr': {'shot': 'tanto'}}}),
    'campoAperto.myteams.v1': json.dumps([{'name': 5}, None, 'x']),
    'campoAperto.training.v1': '[1,2,3]',
    'campoAperto.session.v1': json.dumps({'token': 'x' * 30, 'username': 'simone'}),
}

async def newpage(b, store, fake=True):
    ctx = await b.new_context(viewport={'width': 1280, 'height': 760})
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    # server finto: /api/status risponde, il resto no
    async def route(r):
        if r.request.url.endswith('/api/status'):
            await asyncio.sleep(0.3)   # un server vero ci mette un attimo
            await r.fulfill(status=200, content_type='application/json', body='{"api":1,"engine":"x","game":"0.15.0"}', headers={'access-control-allow-origin': '*'})
        else: await r.fulfill(status=401, content_type='application/json', body='{"error":"AUTH","message":"no"}', headers={'access-control-allow-origin': '*'})
    await ctx.route(API + '/**', route)
    await pg.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); const d = ' + json.dumps(store) + '; for (const k in d) localStorage.setItem(k, d[k]); }')
    if fake: await pg.add_init_script(FAKE)
    return ctx, pg, errs

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)

        # ---- caricamento a passi + dati vecchi
        ctx, pg, errs = await newpage(b, OLD)
        await pg.goto(URL + '?startup=1')
        seen = await pg.evaluate("""() => new Promise(ok => { const t0 = performance.now(), texts = [], bars = [];
            const iv = setInterval(() => { const t = document.getElementById('ld-text').textContent, w = document.getElementById('ld-bar').style.width;
              if (texts[texts.length - 1] !== t) texts.push(t); if (bars[bars.length - 1] !== w) bars.push(w);
              if (document.getElementById('loading').hidden) { clearInterval(iv); ok({ texts, bars, ms: performance.now() - t0 }); } }, 30); })""")
        check('caricamento: stadio, server, aggiornamenti, pronto', any('Collegamento' in t for t in seen['texts']) and any('Cerco aggiornamenti' in t for t in seen['texts']) and seen['texts'][-1] in ('Pronto', ''), seen['texts'])
        check('caricamento: avvisa che c\'è la versione nuova', any('0.20.0' in t for t in seen['texts']), seen['texts'])
        check('caricamento: la barra si riempie fino al 100%', '100%' in seen['bars'] and len(seen['bars']) >= 3, seen['bars'])
        check('caricamento: dura abbastanza per vederlo (almeno 1,3 s) e il controllo è silenzioso', seen['ms'] > 1200 and 'controlla:true' in await pg.evaluate("__calls"), seen['ms'])
        check('menu visibile con l\'avviso dell\'aggiornamento', await pg.evaluate("game.screen === 'menu' && document.getElementById('upd-pill').className.includes('new') && !document.getElementById('upd-pill-go').hidden"))
        st = await pg.evaluate("""() => ({ lang: game.settings.lang, vol: game.settings.volMaster, ver: localStorage.getItem('campoAperto.dataVersion'), home: game.setup.home, away: game.setup.away, onDraw: game.setup.onDraw,
            comps: game.comps.career.comps.length, manager: game.manager.data, pro: game.pro.data && game.pro.data.p.name, proShot: game.pro.data && game.pro.data.p.attr.shot, proTotal: game.pro.data && game.pro.data.total.apps })""")
        check('dati vecchi rovinati: valori predefiniti al loro posto, il gioco parte', st['lang'] in ('it', 'en', 'de', 'fr') and isinstance(st['vol'], (int, float)) and st['home'] != 99 and st['onDraw'] == 'draw' and st['comps'] == 0 and st['manager'] is None, st)
        check('carriera da giocatore vecchia e incompleta: sistemata, non persa', st['pro'] == 'Vecchio' and st['proShot'] == 60 and st['proTotal'] == 0, st)
        check('versione dei dati aggiornata alla versione del gioco', st['ver'] == await pg.evaluate("GAME_VERSION"), st['ver'])
        # le schermate con i dati vecchi si aprono senza errori
        await pg.evaluate("game.pro.open()"); await pg.evaluate("game.manager.open()"); await pg.evaluate("game.comps.openDashboard()"); await pg.evaluate("game.showScreen('training')")
        await pg.evaluate("game.showScreen('setup')"); await pg.evaluate("game.showScreen('teams')"); await pg.evaluate("game.showScreen('settings')")
        # aggiornamento che salta più versioni
        await pg.evaluate("game.showScreen('update')")
        up = await pg.evaluate("({ skip: document.getElementById('upd-skip').hidden ? '' : document.getElementById('upd-skip').textContent, h: [...document.querySelectorAll('#upd-notes h4')].map(h => h.textContent), cur: document.getElementById('upd-cur').textContent, nw: document.getElementById('upd-new').textContent, go: !document.getElementById('upd-go').hidden })")
        check('aggiornamento dalla 0.15.0 alla 0.20.0 in un colpo solo, con il pulsante Aggiorna ora', up['cur'] == '0.15.0' and up['nw'] == '0.20.0' and up['go'], up)
        check('si dice quali versioni sono comprese, e le novità di tutte', '4 versioni' in up['skip'] and '0.16.0, 0.17.0, 0.19.0, 0.20.0' in up['skip'] and up['h'] == ['0.20.0', '0.19.0', '0.17.0', '0.16.0'], up)
        check('nessun errore con i dati vecchi', not errs, errs[:3])
        await ctx.close()

        # ---- dati di una versione più nuova (si è tornati indietro): non si toccano
        ctx, pg, errs = await newpage(b, {'campoAperto.dataVersion': '9.0.0', 'campoAperto.settings.v1': json.dumps({'quality': 'bassa'})}, fake=False)
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        check('dati di una versione più nuova: versione dei dati lasciata com\'è', await pg.evaluate("localStorage.getItem('campoAperto.dataVersion')") == '9.0.0')
        # migrazioni: in ordine, una volta sola, solo quelle che mancano
        mg = await pg.evaluate("""() => { const log = []; DATA_MIGRATIONS.push({ version: '0.1.0', run: () => log.push('0.1.0') }, { version: '99.0.0', run: () => log.push('99') }, { version: '0.0.5', run: () => log.push('0.0.5') }, { version: '0.0.9', run: () => { throw new Error('rotta'); } });
            localStorage.setItem('campoAperto.dataVersion', '0.0.1'); const r1 = migrateSavedData(); const r2 = migrateSavedData(); DATA_MIGRATIONS.length = 0; return [log, r1.done, r2.done, localStorage.getItem('campoAperto.dataVersion') === GAME_VERSION]; }""")
        check('migrazioni: in ordine di versione, una volta sola, mai quelle future, una rotta non ferma le altre', mg[0] == ['0.0.5', '0.1.0'] and mg[1] == ['0.0.5', '0.1.0'] and mg[2] == [] and mg[3], mg)
        # ripristino quando il gioco non parte
        await pg.evaluate("localStorage.setItem('campoAperto.session.v1', 'accesso'); localStorage.setItem('campoAperto.career.v1', 'carriera'); showStartupProblem(new Error('dato rotto'))")
        check('gioco non partito: niente schermo nero, si può ripristinare', await pg.evaluate("!document.getElementById('data-rescue').hidden && document.getElementById('dr-error').textContent === 'dato rotto'"))
        async with pg.expect_navigation():
            await pg.click('#dr-reset')
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        after = await pg.evaluate("({ career: localStorage.getItem('campoAperto.career.v1'), session: localStorage.getItem('campoAperto.session.v1'), backup: JSON.parse(localStorage.getItem('campoAperto.backup') || 'null') })")
        check('ripristino: dati tolti, accesso all\'account tenuto, copia di tutto salvata', after['career'] is None and after['session'] == 'accesso' and after['backup'] and after['backup']['data'].get('campoAperto.career.v1') == 'carriera', after)
        check('la copia si può rimettere', await pg.evaluate("restoreSavedDataBackup() && localStorage.getItem('campoAperto.career.v1') === 'carriera'"))
        check('nessun errore', not errs, errs[:3])
        await ctx.close()
        await b.close()
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
