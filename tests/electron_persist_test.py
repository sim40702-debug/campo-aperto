# App desktop vera (desktop/main.js): una modifica salvata un istante prima di chiudere l'app deve esserci al
# riavvio (main.js scrive subito su disco il localStorage alla chiusura). 5 cicli apri -> modifica -> chiudi subito.
# Prima: node build.js desktop. Uso: xvfb-run -a python3 tests/electron_persist_test.py
import asyncio, os, shutil, subprocess, time, json, glob
from playwright.async_api import async_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ELECTRON = os.path.join(ROOT, 'node_modules', '.bin', 'electron')
PORT = 9339
PROFILO = 'provapersist'
results = []

def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

def avvia():
    return subprocess.Popen([ELECTRON, '--no-sandbox', '.', '--profilo=' + PROFILO, '--remote-debugging-port=%d' % PORT], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

async def collega(p):
    for _ in range(120):
        try:
            b = await p.chromium.connect_over_cdp('http://127.0.0.1:%d' % PORT)
            for ctx in b.contexts:
                for pg in ctx.pages:
                    if pg.url.startswith('file:'):
                        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
                        return b, pg
            await b.close()
        except Exception:
            pass
        await asyncio.sleep(0.5)
    raise RuntimeError('app non raggiungibile')

async def main():
    # cartella dati del profilo di prova: si parte puliti
    for d in glob.glob(os.path.expanduser('~/.config/*-' + PROFILO)): shutil.rmtree(d, ignore_errors=True)
    async with async_playwright() as p:
        atteso = None
        for i in range(5):
            proc = avvia()
            try:
                b, pg = await collega(p)
                if atteso is not None:
                    got = await pg.evaluate("({n: game.settings.teamNames[0] || null, k: game.settings.keys.sprint[0], tok: (JSON.parse(localStorage.getItem('campoAperto.session.v1') || '{}')).token || null})")
                    check('riavvio %d: ritrovata la modifica fatta un istante prima di chiudere' % i, got['n'] == atteso and got['k'] == 'Key' + atteso[-1] and got['tok'] == 'tok' + str(i - 1), got)
                atteso = 'Squadra prova ' + 'ABCDE'[i]
                # modifica + chiusura subito dopo (come chi cambia un'impostazione ed esce)
                await pg.evaluate("""(n) => { game.settings.teamNames[0] = n; game.settings.keys.sprint = ['Key' + n.slice(-1), null];
                    saveSettings(game.settings); localStorage.setItem('campoAperto.session.v1', JSON.stringify({ token: 'tok%d', username: 'prova' }));
                    setTimeout(() => window.close(), 0); }""" % i, atteso)
                try: await b.close()
                except Exception: pass
                for _ in range(100):
                    if proc.poll() is not None: break
                    time.sleep(0.1)
                check('chiusura %d: l\'app si chiude con la finestra' % i, proc.poll() is not None)
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, 9)
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
