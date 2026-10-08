# Aggiornamenti nell'interfaccia (src/game/25_updates.js) con un finto window.campoUpdate al posto dell'app desktop:
# avviso nella home solo se c'è una versione nuova, schermata con versioni, novità, barra del download, errori chiari,
# riga nelle impostazioni, messaggio dopo il riavvio. Prima: node build.js test. Uso: python3 tests/updates_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

# finto ponte dell'app desktop: lo stato si cambia dal test con __upd(stato)
FAKE = """
window.__calls = [];
let cb = null;
window.__state = { fase: 'nessuno', attuale: '0.13.0', appenaAggiornato: '0.13.0' };
window.__upd = s => { window.__state = s; if (cb) cb(s); };
window.campoUpdate = {
  stato: () => Promise.resolve(window.__state),
  controlla: () => { __calls.push('controlla'); return Promise.resolve(window.__state); },
  aggiorna: () => { __calls.push('aggiorna'); return Promise.resolve(window.__state); },
  annulla: () => { __calls.push('annulla'); return Promise.resolve(true); },
  apriPagina: () => { __calls.push('pagina'); return Promise.resolve(true); },
  visto: () => { __calls.push('visto'); return Promise.resolve(true); },
  onCambio: f => { cb = f; },
};
"""
NOTES = "- La **telecronaca parla**: frasi con `voce`\n  che continuano sulla riga dopo.\n- Seconda novità <img src=x onerror=window.__xss=1>\n\n## Altro\nTesto semplice."

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false}))')
        await pg.add_init_script(FAKE)
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        await pg.wait_for_timeout(300)

        # dopo il riavvio: messaggio di versione aggiornata, una volta sola
        toast = await pg.evaluate("document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent")
        check('dopo il riavvio: "Aggiornato alla versione 0.13.0"', 'Aggiornato alla versione 0.13.0' in toast, toast)
        check('il messaggio del riavvio viene segnato come visto', 'visto' in await pg.evaluate("__calls"))

        # nessun aggiornamento: niente avviso
        check('nessuna versione nuova: nessun avviso nella home', await pg.evaluate("document.getElementById('upd-pill').hidden"))

        # versione nuova disponibile
        await pg.evaluate("s => __upd(s)", {'fase': 'disponibile', 'attuale': '0.13.0', 'nuova': '0.14.0', 'note': NOTES, 'automatico': True})
        pill = await pg.evaluate("(()=>{const e=document.getElementById('upd-pill'); return {hidden: e.hidden, text: e.textContent.trim(), visible: e.offsetParent !== null}})()")
        check('versione nuova: avviso "Nuovo aggiornamento disponibile" nella home', not pill['hidden'] and pill['visible'] and 'Nuovo aggiornamento disponibile' in pill['text'], pill)
        await pg.click('#upd-pill')
        check('clic sull\'avviso: schermata Aggiornamento', await pg.evaluate("game.screen") == 'update')
        v = await pg.evaluate("[document.getElementById('upd-cur').textContent, document.getElementById('upd-new').textContent]")
        check('versione installata e nuova versione', v == ['0.13.0', '0.14.0'], v)
        notes = await pg.evaluate("(()=>{const n=document.getElementById('upd-notes'); return {li: n.querySelectorAll('li').length, b: n.querySelectorAll('b').length, code: n.querySelectorAll('code').length, h: n.querySelectorAll('h4').length, img: n.querySelectorAll('img').length, text: n.textContent}})()")
        check('novità: elenco, grassetto, codice e titoli', notes['li'] == 2 and notes['b'] == 1 and notes['code'] == 1 and notes['h'] == 1, notes)
        check('novità: la riga che continua resta nella stessa voce', 'voce che continuano sulla riga dopo' in notes['text'], notes['text'])
        check('novità: niente HTML dalla release (solo testo)', notes['img'] == 0 and not await pg.evaluate("!!window.__xss"), notes)
        btns = await pg.evaluate("['upd-go','upd-cancel','upd-page'].map(id => !document.getElementById(id).hidden)")
        check('pulsante "Aggiorna ora" (senza Annulla e senza pagina)', btns == [True, False, False] and await pg.evaluate("document.getElementById('upd-go').textContent") == 'Aggiorna ora', btns)

        # download
        await pg.click('#upd-go')
        check('"Aggiorna ora" chiede l\'aggiornamento all\'app', 'aggiorna' in await pg.evaluate("__calls"))
        await pg.evaluate("s => __upd(s)", {'fase': 'scarico', 'attuale': '0.13.0', 'nuova': '0.14.0', 'note': NOTES, 'automatico': True, 'percentuale': 42.7, 'scaricati': 35651584, 'totale': 83886080})
        prog = await pg.evaluate("(()=>({shown: !document.getElementById('upd-progress').hidden, w: document.getElementById('upd-bar').style.width, t: document.getElementById('upd-progress-text').textContent, cancel: !document.getElementById('upd-cancel').hidden, go: !document.getElementById('upd-go').hidden, pill: document.getElementById('upd-pill-text').textContent}))()")
        check('barra del download con la percentuale vera', prog['shown'] and prog['w'] == '42.7%', prog)
        check('MB scaricati e totali', prog['t'] == '42% — 34,0 MB di 80,0 MB', prog['t'])
        check('durante il download: Annulla, niente "Aggiorna ora"', prog['cancel'] and not prog['go'], prog)
        check('avviso nella home con la percentuale', 'Scarico l\'aggiornamento… 42%' in prog['pill'], prog['pill'])
        await pg.click('#upd-cancel')
        check('Annulla ferma il download', 'annulla' in await pg.evaluate("__calls"))
        # il gioco resta usabile: si torna al menu durante il download
        await pg.keyboard.press('Escape')
        check('Esc durante il download: si torna al menu (il download continua)', await pg.evaluate("game.screen") == 'menu')

        # errore di rete: frase chiara, si può riprovare
        await pg.evaluate("s => __upd(s)", {'fase': 'errore', 'errore': 'rete', 'attuale': '0.13.0', 'nuova': '0.14.0', 'note': NOTES, 'automatico': True})
        await pg.click('#upd-pill')
        err = await pg.evaluate("(()=>({msg: document.getElementById('upd-msg').textContent, shown: !document.getElementById('upd-msg').hidden, go: document.getElementById('upd-go').textContent, goShown: !document.getElementById('upd-go').hidden}))()")
        check('errore di rete: messaggio chiaro, niente errore tecnico', err['shown'] and err['msg'].startswith('GitHub non è raggiungibile'), err)
        check('errore: pulsante Riprova', err['goShown'] and err['go'] == 'Riprova', err)
        await pg.evaluate("s => __upd(s)", {'fase': 'errore', 'errore': 'verifica', 'attuale': '0.13.0', 'nuova': '0.14.0', 'automatico': True})
        check('file non integro: messaggio chiaro', 'non è integro' in await pg.evaluate("document.getElementById('upd-msg').textContent"))

        # release senza file per questo sistema: niente installazione, pagina della versione
        await pg.evaluate("s => __upd(s)", {'fase': 'disponibile', 'attuale': '0.13.0', 'nuova': '0.14.0', 'automatico': False})
        man = await pg.evaluate("(()=>({go: !document.getElementById('upd-go').hidden, page: !document.getElementById('upd-page').hidden, msg: document.getElementById('upd-msg').textContent, notes: document.getElementById('upd-notes').hidden}))()")
        check('release senza file compatibile: niente "Aggiorna ora", c\'è la pagina della versione', not man['go'] and man['page'] and 'non ha il file' in man['msg'], man)
        check('senza note: la sezione Novità non si vede', man['notes'], man)
        await pg.click('#upd-page')
        check('pulsante pagina della versione', 'pagina' in await pg.evaluate("__calls"))

        # installazione: Indietro disattivato
        await pg.evaluate("s => __upd(s)", {'fase': 'installo', 'attuale': '0.13.0', 'nuova': '0.14.0', 'automatico': True, 'percentuale': 100})
        inst = await pg.evaluate("(()=>({t: document.getElementById('upd-progress-text').textContent, back: document.getElementById('upd-back').disabled, w: document.getElementById('upd-bar').style.width}))()")
        check('installazione: messaggio di riavvio, barra piena, Indietro disattivato', inst['t'].startswith('Download completato e verificato') and inst['back'] and inst['w'] == '100%', inst)

        # impostazioni: riga Aggiornamenti
        await pg.evaluate("s => __upd(s)", {'fase': 'nessuno', 'attuale': '0.13.0', 'controllato': 1})
        await pg.evaluate("game.showScreen('menu')")
        check('di nuovo nessun aggiornamento: l\'avviso sparisce', await pg.evaluate("document.getElementById('upd-pill').hidden"))
        await pg.click('#btn-settings')
        row = await pg.evaluate("(()=>({shown: !document.getElementById('st-updrow').hidden, b: document.getElementById('st-upd').textContent, i: document.getElementById('st-updinfo').textContent}))()")
        check('impostazioni: "Controlla ora" e versione installata', row['shown'] and row['b'] == 'Controlla ora' and row['i'] == 'Hai l\'ultima versione (0.13.0)', row)
        await pg.click('#st-upd')
        check('"Controlla ora" chiede il controllo', 'controlla' in await pg.evaluate("__calls"))

        # lingua inglese
        await pg.evaluate("setLanguage('en')")
        await pg.evaluate("s => __upd(s)", {'fase': 'disponibile', 'attuale': '0.13.0', 'nuova': '0.14.0', 'automatico': True})
        check('in inglese: "New update available"', await pg.evaluate("document.getElementById('upd-pill-text').textContent") == 'New update available')
        await pg.evaluate("setLanguage('it')")

        check('nessun errore nella pagina', not errs, errs)
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (results.count(True), results.count(False)))
    raise SystemExit(0 if all(results) else 1)

asyncio.run(main())
