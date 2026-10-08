# Competizioni nel gioco vero (Chromium headless): cruscotto, creazione, partita giocata con il motore e risultato che
# torna nella classifica, simulazione, abbandono a metà, torneo con supplementari e rigori tirati con la tastiera,
# coppa con gironi, salvataggio dopo il ricaricamento. Prima: node build.js test. Uso: python3 tests/competitions_browser_test.py
import asyncio, os, json, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

async def main():
    os.makedirs(HERE + '/shots', exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        ctx = await b.new_context(viewport={'width': 1366, 'height': 820})
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        await pg.add_init_script('if (!localStorage.getItem("campoAperto.settings.v1")) localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false}))')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)

        # ---- cruscotto
        check('Home: riquadro Competizioni', await pg.is_visible('#btn-comps'))
        await pg.click('#btn-comps')
        await pg.wait_for_function("game.screen==='comps'", timeout=5000)
        secs = await pg.evaluate("[...document.querySelectorAll('#comps .comp-sec:not([hidden]) h3')].map(e=>e.textContent)")
        check('Competizioni: Carriera da allenatore, Campionato, Torneo, Coppe', secs[:4] == ['Carriera da allenatore', 'Campionato', 'Torneo', 'Coppe'], secs)
        await pg.wait_for_timeout(400); await pg.screenshot(path=HERE + '/shots/70_competizioni_vuoto.png')

        # ---- nuovo campionato a 8 con la squadra 0
        await pg.click('[data-new=league]')
        await pg.wait_for_function("game.screen==='comp-new'", timeout=5000)
        await pg.click('#cn-size .seg:has-text("8 squadre")')
        await pg.select_option('#cn-team', '0')
        await pg.click('#cn-legs .seg:has-text("Solo andata")')
        summary = await pg.text_content('#cn-summary')
        check('creazione: riepilogo del formato (7 giornate, 28 partite)', '7 giornate' in summary and '28 partite' in summary, summary[-60:])
        await pg.screenshot(path=HERE + '/shots/71_nuovo_campionato.png')
        await pg.click('#cn-create')
        await pg.wait_for_function("game.screen==='comp' && document.querySelector('#cp-play')", timeout=5000)
        comp_id = await pg.evaluate("game.comps.compId")
        check('campionato creato: giornata 1 e partita della tua squadra con Gioca e Simula', 'Giornata 1' in await pg.text_content('#cp-body') and await pg.is_visible('#cp-sim'))
        await pg.wait_for_timeout(400); await pg.screenshot(path=HERE + '/shots/72_campionato_panoramica.png')

        # ---- GIOCA: partita vera fino al fischio finale
        fid = await pg.evaluate("game.comps.career.userFixture(game.comps.comp, game.comps.career.currentRound(game.comps.comp)).id")
        await pg.click('#cp-play')
        await pg.wait_for_function("game.screen==='match' && game.match && game.compMatch", timeout=15000)
        inprog = await pg.evaluate("!!game.comps.career.fixture(game.comps.career.byId(%s), %s).inProgress" % (json.dumps(comp_id), json.dumps(fid)))
        check('partita di competizione avviata con il motore (segnata in corso: non si può rigiocare)', inprog)
        check('in pausa niente "Ricomincia" nelle competizioni', await pg.evaluate("game.togglePause(true); const h = document.getElementById('pause-restart').hidden; game.togglePause(false); h"))
        # fine partita veloce: si porta l'orologio alla fine del secondo tempo con 2-1 per la tua squadra
        await pg.evaluate("""(()=>{const m=game.match; m.half=2; m.clock=2695; m.setState('PLAY');
            // la tua squadra vince 2-1 (in casa o in trasferta: dipende dal calendario)
            const u=m.humans[0].team, W=m.teams[u], L=m.teams[1-u]; W.score=2; L.score=1;
            m.log.push({team:W, scorer:W.players[9].data.name, own:false, minute:30}, {team:W, scorer:W.players[9].data.name, own:false, minute:70}, {team:L, scorer:L.players[10].data.name, own:false, minute:80});})()""")
        await pg.wait_for_function("game.screen==='fulltime'", timeout=30000, polling=200)
        await pg.screenshot(path=HERE + '/shots/73_fine_partita_competizione.png')
        rec = await pg.evaluate("(()=>{const c=game.comps.career.byId(%s); const f=game.comps.career.fixture(c, %s); return {played:f.played, how:f.how, h:f.h, a:f.a, sc:f.scorers.length, round:c.fixtures.filter(x=>x.round===0).every(x=>x.played), inprog:!!f.inProgress}})()" % (json.dumps(comp_id), json.dumps(fid)))
        check('fischio finale: risultato del motore registrato da solo (2-1, marcatori), giornata completata con le simulazioni', rec['played'] and rec['how'] == 'played' and sorted([rec['h'], rec['a']]) == [1, 2] and rec['sc'] == 3 and rec['round'] and not rec['inprog'], rec)
        check('fine partita: "Torna alla competizione", niente Rivincita', await pg.is_visible('#ft-comp') and not await pg.is_visible('#ft-rematch') and 'risultato registrato' in await pg.text_content('#ft-comp-note'))
        await pg.click('#ft-comp')
        await pg.wait_for_function("game.screen==='comp'", timeout=10000)
        check('ritorno alla competizione: giornata 2', 'Giornata 2' in await pg.text_content('#cp-body'))

        # ---- classifica
        await pg.click('[data-cpt=table]')
        rows = await pg.evaluate("[...document.querySelectorAll('#cp-body table.stand tbody tr')].map(r=>[...r.children].map(td=>td.textContent))")
        mine = await pg.evaluate("document.querySelector('#cp-body tr.mine td:nth-child(10)').textContent")
        check('classifica: 8 squadre, PG/V/N/P/GF/GS/DR/PT, la tua squadra con 3 punti', len(rows) == 8 and all(r[2] == '1' for r in rows) and mine == '3', (len(rows), mine))
        heads = await pg.evaluate("[...document.querySelectorAll('#cp-body table.stand th')].map(e=>e.textContent)")
        check('classifica professionale: colonne complete con forma e serie', heads[:10] == ['Pos', 'Squadra', 'PG', 'V', 'N', 'P', 'GF', 'GS', 'DR', 'PT'] and 'Forma' in heads, heads)
        await pg.screenshot(path=HERE + '/shots/74_classifica.png')

        # ---- simula partita
        await pg.click('[data-cpt=over]')
        await pg.click('#cp-sim')
        st = await pg.text_content('#cp-status')
        check('Simula partita: risultato e giornata 3', 'Partita simulata' in st and 'Giornata 3' in await pg.text_content('#cp-body'), st)

        # ---- calendario
        await pg.click('[data-cpt=cal]')
        cal = await pg.evaluate("({label: document.querySelector('.calnav b').textContent, n: document.querySelectorAll('#cp-body .fx-item').length})")
        check('calendario: giornata con 4 partite, navigazione tra le giornate', cal['n'] == 4 and 'Giornata' in cal['label'], cal)

        # ---- abbandono a metà
        await pg.click('[data-cpt=over]')
        fid2 = await pg.evaluate("game.comps.career.userFixture(game.comps.comp, game.comps.career.currentRound(game.comps.comp)).id")
        await pg.click('#cp-play')
        await pg.wait_for_function("game.screen==='match' && game.match", timeout=15000)
        await pg.evaluate("(()=>{const m=game.match; m.half=1; m.clock=1800; m.teams[0].score=1; m.teams[1].score=0;})()")
        await pg.evaluate("game.togglePause(true)")
        await pg.click('#pause-quit'); await pg.click('#pause-quit')
        await pg.wait_for_function("game.screen==='menu'", timeout=10000)
        ab = await pg.evaluate("(()=>{const c=game.comps.career.byId(%s); const f=game.comps.career.fixture(c, %s); return {played:f.played, how:f.how, sum:f.h+f.a}})()" % (json.dumps(comp_id), json.dumps(fid2)))
        check('uscita a metà: il resto si simula dal punteggio, risultato registrato (non si rigioca)', ab['played'] and ab['how'] == 'abbandonata' and ab['sum'] >= 1, ab)

        # ---- salvataggio dopo il ricaricamento
        await pg.reload(); await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        kept = await pg.evaluate("(()=>{const c=game.comps.career.byId(%s); return c ? c.fixtures.filter(f=>f.played).length : -1})()" % json.dumps(comp_id))
        check('salvataggio: dopo il ricaricamento il campionato è lì con i risultati (' + str(kept) + ' partite)', kept == 12, kept)

        # ---- torneo a 8: supplementari e rigori con la tastiera
        await pg.click('#btn-comps'); await pg.click('[data-new=tournament]')
        await pg.click('#cn-size .seg:has-text("8 squadre")'); await pg.select_option('#cn-team', '1')
        await pg.click('#cn-create')
        await pg.wait_for_function("game.screen==='comp' && document.querySelector('#cp-play')", timeout=5000)
        tid = await pg.evaluate("game.comps.compId")
        check('torneo: quarti di finale, tabellone', 'Quarti di finale' in await pg.text_content('#cp-body'))
        await pg.click('#cp-play')
        await pg.wait_for_function("game.screen==='match' && game.match && game.match.ko", timeout=15000)
        # pari a fine 90': supplementari
        await pg.evaluate("(()=>{const m=game.match; m.half=2; m.clock=2695; m.setState('PLAY'); m.teams[0].score=1; m.teams[1].score=1;})()")
        await pg.wait_for_function("game.match.half===3", timeout=30000, polling=200)
        hud = await pg.text_content('#sb-time')
        check('pareggio al 90°: supplementari (minuto ' + hud + ')', int(hud.rstrip("'")) >= 90 if hud.rstrip("'").isdigit() else False, hud)
        await pg.evaluate("(()=>{const m=game.match; m.half=4; m.clock=895; m.setState('PLAY'); m.teams[0].score=1; m.teams[1].score=1;})()")
        await pg.wait_for_function("game.match.so", timeout=30000, polling=200)
        check('ancora pari dopo 120 minuti: rigori sul tabellone', (await pg.text_content('#sb-time')) == 'Rigori')
        await pg.screenshot(path=HERE + '/shots/75_rigori.png')
        # i rigori della tua squadra si tirano con il tiro (K tenuto e rilasciato)
        kicks = 0
        t0 = time.time()
        while time.time() - t0 < 240:
            s = await pg.evaluate("(()=>{const m=game.match; if(!m) return {done:true}; const so=m.so, h=m.humans[0]; return {done: m.state==='FULLTIME', mine: !!so && so.phase==='kick' && m.state==='SETPIECE' && m.setPieceReady && h && h.player===so.kicker}})()")
            if s['done']: break
            if s['mine']:
                await pg.keyboard.down('k'); await pg.wait_for_timeout(450); await pg.keyboard.up('k'); kicks += 1
                await pg.wait_for_timeout(1500)
            else:
                await pg.wait_for_timeout(250)
        await pg.wait_for_function("game.screen==='fulltime'", timeout=30000, polling=200)
        res = await pg.evaluate("(()=>{const c=game.comps.career.byId(%s); const f=c.fixtures.find(x=>x.how==='played'); return {pens:f.pens, et:f.et, w:f.winner}})()" % json.dumps(tid))
        check('rigori tirati con la tastiera (' + str(kicks) + '), vincitore deciso dal motore e registrato nel tabellone', kicks >= 3 and res['pens'] and res['pens']['h'] != res['pens']['a'] and res['w'] in (0, 1) and res['et'] == {'h': 0, 'a': 0}, res)
        verdict = await pg.text_content('#ft-verdict')
        check('fine partita: esito ai rigori', 'rigori' in verdict, verdict)
        await pg.screenshot(path=HERE + '/shots/76_fine_rigori.png')
        await pg.click('#ft-comp')
        await pg.wait_for_function("game.screen==='comp'", timeout=10000)
        await pg.click('[data-cpt=bracket]')
        br = await pg.evaluate("({cols: [...document.querySelectorAll('.br-col h3')].map(e=>e.textContent), win: document.querySelectorAll('.br-team.win').length})")
        check('tabellone: Quarti → Semifinali → Finale, vincenti dei quarti segnati', br['cols'] == ['Quarti di finale', 'Semifinali', 'Finale'] and br['win'] == 4, br)
        await pg.screenshot(path=HERE + '/shots/77_tabellone.png')

        # ---- coppa con gironi (modello Coppa dei Campioni)
        await pg.click('#cp-back'); await pg.click('[data-new=cup]')
        await pg.click('#cn-preset .seg:has-text("Coppa dei Campioni")')
        await pg.select_option('#cn-team', '-1')
        await pg.click('#cn-create')
        await pg.wait_for_function("game.screen==='comp'", timeout=5000)
        await pg.click('[data-cpt=groups]')
        ng = await pg.evaluate("document.querySelectorAll('#cp-body .groups > div').length")
        check('coppa con gironi: 8 gironi', ng == 8, ng)
        await pg.click('[data-cpt=over]'); await pg.click('#cp-simend'); await pg.click('#cp-simend')
        await pg.wait_for_function("document.querySelector('#cp-body .champion')", timeout=20000)
        check('coppa simulata fino alla fine: vincitore e finale', 'Finale:' in await pg.text_content('#cp-body .champion'))
        await pg.screenshot(path=HERE + '/shots/78_coppa_vincitore.png')

        # ---- cruscotto con le competizioni
        await pg.click('#cp-back')
        cards = await pg.evaluate("document.querySelectorAll('#comps .comp-card').length")
        check('cruscotto: le tre competizioni con stato, squadra e progresso', cards == 3, cards)
        await pg.wait_for_timeout(400); await pg.screenshot(path=HERE + '/shots/79_competizioni.png')
        lay = await pg.evaluate("(()=>{const r=[]; document.querySelectorAll('#comps .comp-card, #comps button').forEach(e=>{const b=e.getBoundingClientRect(); if(b.right>innerWidth+1||b.left<-1) r.push(e.textContent.slice(0,20));}); return r})()")
        check('nessun elemento fuori dallo schermo', not lay, lay)
        check('nessun errore JavaScript', not errs, errs[:3])
        await b.close()
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
