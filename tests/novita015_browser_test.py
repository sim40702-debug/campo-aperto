# Novità della 0.15 nel gioco vero (Chromium headless), senza server:
# rigori nella partita rapida (opzione "In caso di pareggio", inquadratura, riquadro dei tiri, battito del cuore),
# arbitro in campo con il cartellino, infortuni (a terra, barella, zoppia), suoni nuovi, carriera da giocatore.
# Prima: node build.js test. Uso: python3 tests/novita015_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false}))')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        # il ciclo del gioco si ferma: i fotogrammi li fa il test
        await pg.evaluate("game.loop = () => {}")

        # ---- partita rapida: in caso di pareggio
        await pg.click('#btn-quick')
        segs = await pg.evaluate("[...document.querySelectorAll('#opt-draw .seg')].map(b => b.textContent)")
        check('partita rapida: scelta "In caso di pareggio"', segs == ['Resta pari', 'Supplementari e rigori', 'Subito i rigori'], segs)
        await pg.click('#opt-draw .seg:nth-child(3)')
        await pg.evaluate("() => { game.setup.side = -1; game.startMatch(); }")
        kind = await pg.evaluate("[game.match.constructor.name, game.match.ko.extraTime, game.match.ko.penalties, game.match.injuries, game.settings.lastSetup.onDraw]")
        check('subito i rigori: partita a eliminazione diretta senza supplementari (con infortuni), scelta ricordata', kind == ['KnockoutMatch', False, True, True, 'pens'], kind)
        # fine dei 90 minuti in parità: si va ai rigori
        so = await pg.evaluate("""() => { const m = game.match; m.teams[0].score = m.teams[1].score = 0; m.half = 2; m.clock = 2699;
            const seen = { cam: false, panel: false, hb: false, quiet: false };
            const hb = game.audio.heartbeat.bind(game.audio); game.audio.heartbeat = (dt, on) => { if (on) seen.hb = true; return hb(dt, on); };
            for (let i = 0; i < 1200 && !(m.so && m.so.phase === 'kick' && m.state === 'SETPIECE' && m.stateTime > 1); i++) game.updateOffline(1/60);
            const R = game.renderer, c = R.camera.position;
            seen.cam = !!m.so && c.x > CONFIG.HALF_L - 20 && c.x < CONFIG.HALF_L - 8 && c.y < 3;
            seen.panel = !document.getElementById('so-panel').hidden && document.querySelectorAll('#so-d0 i').length >= 5 && !!document.querySelector('#so-panel i.now');
            return [m.so && m.so.phase, seen, document.getElementById('commentary').textContent, [c.x, c.y, c.z].map(v => Math.round(v * 10) / 10)]; }""")
        check('rigori: telecamera dietro al tiratore', so[1]['cam'], so[3])
        check('rigori: riquadro con 5 pallini per squadra e il tiro che lampeggia', so[1]['panel'])
        check('rigori: battito del cuore durante la rincorsa', so[1]['hb'])
        check('telecronaca: "si va ai rigori" (non "finisce qui")', 'rigor' in so[2] or 'dischetto' in so[2], so[2])
        fin = await pg.evaluate("""() => { const m = game.match; for (let i = 0; i < 60 * 300 && game.screen === 'match'; i++) game.updateOffline(1/60);
            return [m.so.phase, m.so.score, m.so.log.length, document.getElementById('ft-score').textContent, document.querySelectorAll('#so-d0 i.in, #so-d0 i.out').length]; }""")
        check('serie finita: punteggio dei rigori a fine partita', fin[0] == 'done' and '(rigori' in fin[3] and fin[1][0] != fin[1][1], fin)
        await pg.evaluate("game.quitToMenu()")

        # ---- arbitro e cartellino
        await pg.evaluate("() => { game.setup.side = -1; game.setup.onDraw = 'draw'; game.startMatch(); }")
        ref = await pg.evaluate("""() => { const m = game.match, R = game.renderer, o = R.officials;
            for (let i = 0; i < 120; i++) game.updateOffline(1/60);
            const start = [o.x, o.z];
            for (let i = 0; i < 600; i++) game.updateOffline(1/60);
            const moved = Math.hypot(o.x - start[0], o.z - start[1]);
            const inField = Math.abs(o.x) < CONFIG.HALF_L && Math.abs(o.z) < CONFIG.HALF_W;
            const p = m.teams[1].players[5];
            game.handleEvent({ type: 'ref', r: { type: 'YELLOW_CARD', player: { id: m.allSlots().indexOf(p), name: p.data.name, team: 1 }, minute: 10, x: p.x, z: p.z } });
            let up = 0, icon = false;
            for (let i = 0; i < 240; i++) { game.updateOffline(1/60); if (o.card.visible) up = Math.max(up, o.ref.arms[1].sh.rotation.x); if (o.icons.length) icon = true; }
            return [moved, inField, up, icon, o.ref.root.visible, o.tasks.length]; }""")
        check('arbitro in campo: segue il gioco senza uscire dal campo', ref[0] > 2 and ref[1] and ref[4], ref)
        check('cartellino: l\'arbitro alza il braccio con il cartellino, e sopra il giocatore compare il cartellino', ref[2] > 2.5 and ref[3] and ref[5] == 0, ref)

        # ---- infortunio: a terra, barella, zoppia (evento finto, partita ferma)
        hurt = await pg.evaluate("""() => { const m = game.match, R = game.renderer; const v = m.teams[0].players[7]; const pm = R.playerMeshes.find(x => x.player === v);
            v.vx = v.vz = 0;
            R.officialsEvent({ type: 'FOUL', victim: { id: m.allSlots().indexOf(v) }, x: v.x, z: v.z, severity: 0.9, consequence: 'FREE_KICK' }, m);
            const out = { lying: 0, medics: !!R.officials.medics, help: false, limp: 0 };
            for (let i = 0; i < 60 * 25; i++) { R.syncFromMatch(m, 1/60); out.lying = Math.max(out.lying, pm.body.rotation.z); if (R.officials.medics && R.officials.medics.state === 'help') out.help = true; }
            out.limp = pm.limpT; out.gone = !R.officials.medics; out.hurtNow = pm.hurtAmt;
            return out; }""")
        check('fallo molto duro: a terra sulla schiena', hurt['lying'] > 1.2, hurt)
        check('arrivano i barellieri, aiutano e se ne vanno', hurt['medics'] and hurt['help'] and hurt['gone'], hurt)
        check('poi zoppica per un po\'', hurt['limp'] > 12 and hurt['hurtNow'] < 0.1, hurt)
        # motore: il fallo duro allunga la pausa e fa zoppicare (solo con opts.injuries)
        eng = await pg.evaluate("""() => { const mk = inj => { const m = new Match(game.db[0], game.db[1], { humanTeam: -1, injuries: inj }); const v = m.teams[0].players[6], o = m.teams[1].players[6];
              m.injure(v, 0.9); return [m.injuryPause, v.limp || 0, v.maxSpeed(true)]; };
            const a = mk(true), b = new Match(game.db[0], game.db[1], { humanTeam: -1 });
            return [a, b.injuries, b.teams[0].players[6].maxSpeed(true)]; }""")
        check('motore: infortunio con la barella = 7 s di pausa e zoppia; senza l\'opzione niente', eng[0][0] == 7 and eng[0][1] == 45 and eng[1] is False and eng[0][2] < eng[2], eng)
        await pg.evaluate("game.quitToMenu()")

        # ---- suoni: ogni suono nuovo parte senza errori
        snd = await pg.evaluate("""() => { const A = game.audio; A.init(); if (!A.ctx) return 'niente audio';
            try { A.kick(25, 'shot'); A.kick(8, 'pass'); A.kick(18, 'cross'); A.kick(10, 'header'); A.kick(5, 'throw'); A.post(); A.ooh(); A.crowdWhistles(0.8); A.roar(true); A.roar(false);
              const len = A.chant(1); A.heartbeat(1, true); A.chantTick(100, true); return ['ok', len > 2]; } catch (e) { return String(e); } }""")
        check('suoni: tiro, passaggio, cross, testa, palo, "ooh", fischi, boato, cori, battito', snd == ['ok', True], snd)

        # ---- carriera da giocatore
        await pg.click('#btn-comps')
        check('competizioni: sezione "Carriera da giocatore"', 'Carriera da giocatore' in await pg.text_content('#comps'))
        await pg.click('#cl-pro-open')
        await pg.click('#pr-start')
        check('senza nome non parte', 'nome' in (await pg.text_content('#pr-status')).lower())
        await pg.fill('#pr-name', 'Simo Test'); await pg.fill('#pr-num', '7')
        await pg.click('#pr-role .seg:nth-child(1)'); await pg.click('[data-pr-team="6"]')
        await pg.click('[data-pr-skin]:nth-child(4)')
        await pg.click('#pr-start')
        d = await pg.evaluate("[game.pro.data.p.name, game.pro.data.p.number, game.pro.data.p.role, game.pro.data.team, game.pro.comp().pro, game.pro.data.p.look.skin === SKIN_TONES[3]]")
        check('calciatore creato: nome, numero, ruolo, squadra, pelle; campionato della carriera', d == ['Simo Test', 7, 'FW', 6, True, True], d)
        await pg.click('#pr-play'); await pg.click('#cp-play')
        lock = await pg.evaluate("""() => { const m = game.match, h = m.humans[0]; const names = new Set();
            for (let i = 0; i < 60 * 30; i++) { game.updateOffline(1/60, ); names.add(h.player && h.player.data.name); }
            h.input = { mx: 0, mz: 0, pressed: { switch: true } }; m.update(1/60, { mx: 0, mz: 0, pressed: { switch: true } });
            names.add(h.player && h.player.data.name);
            return [[...names], h.lock && h.lock.data.number, m.teams[h.team].roster.filter(p => p.data.name === 'Simo Test').length]; }""")
        check('in partita guidi solo il tuo calciatore (anche premendo Cambio)', lock[0] == ['Simo Test'] and lock[1] == 7 and lock[2] == 1, lock)
        ft = await pg.evaluate("""() => { for (let i = 0; i < 60 * 1500 && game.screen === 'match'; i++) game.updateOffline(1/60);
            return [game.screen, document.getElementById('ft-comp-note').textContent, game.pro.data.total.apps, game.pro.data.log[0] && game.pro.data.log[0].how]; }""")
        check('fine partita: voto ed esperienza del tuo calciatore', ft[0] == 'fulltime' and 'Il tuo voto' in ft[1] and ft[2] == 1 and ft[3] == 'played', ft)
        lv = await pg.evaluate("""() => { const P = game.pro, d = P.data; const before = d.p.attr.shot;
            const ups = P.addXp(400); P.raise('shot'); P.raise('shot'); return [ups >= 1, d.level >= 2, d.p.attr.shot === before + 2, d.points === ups * 3 - 2]; }""")
        check('livelli: punti esperienza -> livello -> punti sulle caratteristiche', all(lv), lv)
        sim = await pg.evaluate("""() => { const c = game.pro.comp(); const f = game.comps.career.userFixture(c, game.comps.career.currentRound(c)); game.comps.simUser(c); return [game.pro.data.total.apps, game.pro.data.log[0].how]; }""")
        check('partita simulata: conta la presenza (senza voto)', sim == [2, 'sim'], sim)
        end = await pg.evaluate("""() => { const P = game.pro, d = P.data; d.cur.ratingSum = 7.8 * 2; d.cur.rated = 2; d.cur.goals = 12;
            game.comps.career.simulateToEnd(P.comp()); const r = P.endSeason(); P.render();
            return [!!r, d.season, d.p.age, Array.isArray(d.offers), d.offers.every(t => game.db[t].rating > game.db[6].rating), document.querySelectorAll('[data-pr-go]').length === d.offers.length + 1]; }""")
        check('fine stagione: età, offerte solo da squadre più forti, scelta tra restare o andare', end[0] and end[1] == 2 and end[2] == 19 and end[3] and end[4] and end[5], end)
        go = await pg.evaluate("""() => { const P = game.pro, d = P.data; const t = d.offers.length ? d.offers[0] : d.team; const err = P.nextSeason(t);
            return [err, d.team === t, P.comp() && P.comp().status, P.comp() && P.comp().config.userTeam === t]; }""")
        check('nuova stagione con la squadra scelta', go[0] is None and go[1] and go[2] == 'active' and go[3], go)

        check('nessun errore nella pagina', not errs, errs[:3])
        await b.close()
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
