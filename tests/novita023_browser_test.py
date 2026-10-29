# Novità della 0.23 nel gioco vero (Chromium headless):
# - dopo il gol: esultanza intera, stacco come in TV, replay, stacco, subito il calcio d'inizio con la telecamera al
#   suo posto (niente seconda esultanza, niente telecamera che vola, niente teletrasporti visibili); pausa durante
#   lo stacco;
# - punizioni e rigori (partita e allenamento) e tiri dell'allenamento: tutta la porta nell'inquadratura;
# - portiere: passi laterali, saltello prima del tiro, parate centrali (bassa, media, alta), rilancio con le mani.
# Prima: node build.js test. Uso: python3 tests/novita023_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

# la porta attaccata (pali e traversa) è tutta dentro l'inquadratura?
GOAL_IN_VIEW = """(gx) => { const cam = game.renderer.camera; cam.updateMatrixWorld();
  return [[gx, 0, -3.66], [gx, 0, 3.66], [gx, 2.44, -3.66], [gx, 2.44, 3.66]].every(q => { const v = new THREE.Vector3(q[0], q[1], q[2]).project(cam); return Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98 && v.z < 1; }); }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false})); localStorage.setItem("campoAperto.tutorialHint", "1")')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=90000, polling=250)
        # il ciclo del gioco si ferma: i passi si fanno a mano, sempre uguali
        await pg.evaluate("() => { game.loop = () => {}; game.setup.side = 0; game.startMatch(); for (let i = 0; i < 400; i++) game.updateOffline(1/60); }")

        # ---- dopo il gol
        await pg.evaluate("""() => { const m = game.match, t = m.teams[0], s = t.players[9], gx = t.oppGoalX();
            m.state = 'PLAY'; m.ball.owner = null; m.ball.x = gx - t.dir * 6; m.ball.z = 1; m.ball.y = 0.3; m.ball.vx = t.dir * 26; m.ball.vy = 1; m.ball.vz = 0.4; m.ball.lastTouch = s; m.lastKick = { kind: 'shot', player: s };
            const k = t.opponent().gk; k.x = gx + t.dir * 0.4; k.z = -3.4; }""")
        seq = await pg.evaluate("""() => { const m = game.match, out = { goalAt: -1, wipeAt: -1, replayAt: -1, endWipeAt: -1, kickoffAt: -1, maxStateBeforeReplay: 0, celebBeforeReplay: 0 };
            for (let f = 0; f < 60 * 30; f++) {
              game.updateOffline(1/60);
              const s = f / 60;
              if (m.state === 'GOAL' && out.goalAt < 0) out.goalAt = s;
              if (out.goalAt >= 0 && out.replayAt < 0) { out.maxStateBeforeReplay = Math.max(out.maxStateBeforeReplay, m.state === 'GOAL' ? m.stateTime : 0); out.celebBeforeReplay = Math.max(out.celebBeforeReplay, game.renderer.playerMeshes.filter(pm => pm.cel).length); }
              if (game.wipe && out.wipeAt < 0) out.wipeAt = s;
              if (game.replay && out.replayAt < 0) { out.replayAt = s; out.replayFrames = game.replay.frames.length; }
              if (game.replay && game.replay.ending && out.endWipeAt < 0) out.endWipeAt = s;
              if (m.state === 'KICKOFF' && out.goalAt >= 0 && out.kickoffAt < 0) {
                out.kickoffAt = s; out.replayLeft = !!game.replay; out.stateAtKickoff = m.state;
                const R = game.renderer; R.syncFromMatch(m, 1/60);
                out.camX = +R.camera.position.x.toFixed(1); out.celebAfter = R.playerMeshes.filter(pm => pm.cel).length;
                break;
              }
            }
            return out; }""")
        check('gol: prima tutta l\'esultanza (3 s), poi il replay', seq['goalAt'] >= 0 and seq['maxStateBeforeReplay'] >= 2.95 and seq['celebBeforeReplay'] > 10, seq)
        check('il replay si apre con lo stacco come in TV', 0 <= seq['wipeAt'] < seq['replayAt'] and seq['replayAt'] - seq['wipeAt'] < 0.35, seq)
        check('replay: dal tiro a poco dopo il gol (non giocatori fermi)', 120 <= seq.get('replayFrames', 0) <= 280, seq)
        check('fine del replay: stacco e subito il calcio d\'inizio, niente seconda esultanza', seq['endWipeAt'] > seq['replayAt'] and 0 < seq['kickoffAt'] - seq['endWipeAt'] < 0.6 and not seq['replayLeft'], seq)
        check('calcio d\'inizio: la telecamera è già al centro (non vola dalla porta) e le pose sono da capo', abs(seq['camX']) < 3 and seq['celebAfter'] == 0, seq)
        await pg.evaluate("() => { for (let i = 0; i < 60; i++) game.updateOffline(1/60); }")
        check('lo stacco finisce e sparisce', await pg.evaluate("!game.wipe && document.getElementById('tv-wipe').hidden"))
        # pausa durante lo stacco: lo stacco si chiude e quello che doveva fare si fa
        pz = await pg.evaluate("() => { let done = false; game.tvWipe('Replay', () => { done = true; }); game.updateOffline(1/60); game.togglePause(true); const r = [done, !game.wipe, document.getElementById('tv-wipe').hidden]; game.togglePause(false); return r; }")
        check('pausa durante lo stacco: si chiude e fa quello che doveva', pz == [True, True, True], pz)

        # ---- punizione diretta in partita: telecamera dietro al pallone, porta tutta in vista
        fk = await pg.evaluate("""(gv) => { const m = game.match, t = m.teams[0], gx = t.oppGoalX(); const goalIn = eval(gv);
            m.pendingSetPiece = { type: 'FREE_KICK', team: t, x: gx - t.dir * 23, z: -9 }; m.startSetPiece();
            for (let i = 0; i < 30; i++) game.updateOffline(1/60);
            const R = game.renderer; return { state: m.state, inView: goalIn(gx), mode: R._spc && R._spc.mode, camY: +R.camera.position.y.toFixed(1) }; }""", GOAL_IN_VIEW)
        check('punizione in partita: la porta è tutta nell\'inquadratura, dietro al pallone', fk['state'] == 'SETPIECE' and fk['inView'] and fk['mode'] == 'set', fk)
        await pg.screenshot(path=HERE + '/shots/023_punizione.png')
        far = await pg.evaluate("""() => { const m = game.match, t = m.teams[0], gx = t.oppGoalX();
            m.pendingSetPiece = { type: 'FREE_KICK', team: t, x: gx - t.dir * 60, z: 5 }; m.startSetPiece(); for (let i = 0; i < 10; i++) game.updateOffline(1/60); return game.renderer._spc.mode; }""")
        check('punizione lontana (60 m): inquadratura di sempre', far is None, far)

        # ---- allenamento: punizioni, rigori, tiri
        for drill in ('freekick', 'penalty', 'shots'):
            r = await pg.evaluate("""([d, gv]) => { game.quitToMenu(); game.startTraining(d); const goalIn = eval(gv); const res = [];
                for (let a = 0; a < 3; a++) { const m = game.match; if (a) { m.tr.phase = 'ready'; m.tr.t = 5; } for (let i = 0; i < 120; i++) game.updateOffline(1/60); res.push(goalIn(CONFIG.HALF_L)); }
                return res; }""", [drill, GOAL_IN_VIEW])
            check('allenamento %s: la porta sempre tutta in vista (3 tentativi)' % drill, all(r), r)
        await pg.screenshot(path=HERE + '/shots/023_allenamento_tiri.png')

        # ---- portiere
        await pg.evaluate("() => { game.quitToMenu(); game.setup.side = -1; game.startMatch(); for (let i = 0; i < 60; i++) game.updateOffline(1/60); }")
        side = await pg.evaluate("""() => { const m = game.match, R = game.renderer, t = m.teams[1], gk = t.gk, pm = R.playerMeshes.find(q => q.player === gk), gx = t.ownGoalX();
            gk.x = gx + t.dir * 0.8; gk.z = -2; gk.facing = t.dir > 0 ? 0 : Math.PI; gk.vx = 0; gk.vz = 2.2; m.ball.owner = null; m.ball.x = gx + t.dir * 25; m.ball.z = 0; m.ball.vx = m.ball.vz = 0;
            let mx = 0; for (let i = 0; i < 40; i++) { gk.anim.phase += 0.12; R.syncFromMatch(m, 1/60); mx = Math.max(mx, Math.abs(pm.legs[1].hip.rotation.x - pm.legs[0].hip.rotation.x)); }
            const k = Math.abs(pm.legs[0].knee.rotation.z); gk.vz = 0; return { side: pm.side, spread: mx, knee: k }; }""")
        check('portiere che si sposta lungo la linea: passi laterali (gambe che si aprono, ginocchia piegate)', side['side'] > 0.8 and side['spread'] > 0.35 and side['knee'] > 0.3, side)
        st = await pg.evaluate("""() => { const m = game.match, R = game.renderer, t = m.teams[1], gk = t.gk, pm = R.playerMeshes.find(q => q.player === gk), gx = t.ownGoalX(), a = m.teams[0].players[9];
            gk.vx = gk.vz = 0; gk.z = 0; a.x = gx + t.dir * 32; a.z = 2; m.ball.owner = a; for (let i = 0; i < 10; i++) R.syncFromMatch(m, 1/60);
            a.x = gx + t.dir * 17; let hop = 0, up = 0; for (let i = 0; i < 40; i++) { R.syncFromMatch(m, 1/60); hop = Math.max(hop, pm.setHop || 0); } m.ball.owner = null; return { hop: hop, setK: pm.setK }; }""")
        check('attaccante con la palla vicino alla porta: saltello e posizione pronta', st['hop'] > 0.2 and st['setK'] > 0.4, st)
        blocks = []
        for h in (0.2, 1.1, 2.0):
            blocks.append(await pg.evaluate("""(h) => { const m = game.match, R = game.renderer, t = m.teams[1], gk = t.gk, pm = R.playerMeshes.find(q => q.player === gk), gx = t.ownGoalX();
                m.ball.owner = null; gk.x = gx + t.dir * 0.8; gk.z = 0; gk.vx = gk.vz = 0; gk.anim.dive = 0; m.ball.x = gx + t.dir * 5; m.ball.z = 0.2; m.ball.y = h; m.ball.vx = -t.dir * 20; m.ball.vy = 0; m.ball.vz = 0;
                for (let i = 0; i < 12; i++) R.syncFromMatch(m, 1/60); return [pm.block, pm.body.position.y, pm.arms[1].sh.rotation.x]; }""", h))
        check('tiro centrale: va incontro al pallone (basso si china, alto braccia in alto)', all(x[0] > 0.8 for x in blocks) and blocks[0][1] < -0.15 and blocks[2][2] > 2, blocks)
        rel = await pg.evaluate("""() => { const m = game.match, R = game.renderer, t = m.teams[1], gk = t.gk, pm = R.playerMeshes.find(q => q.player === gk);
            m.ball.owner = gk; m.ball.vx = m.ball.vy = m.ball.vz = 0; for (let i = 0; i < 5; i++) R.syncFromMatch(m, 1/60);
            m.ball.owner = null; gk.anim.kick = 0.3; m.ball.vx = t.dir * 12; m.ball.vy = 0.2; let n = 0, low = 0;
            for (let i = 0; i < 40; i++) { gk.anim.kick = Math.max(0, gk.anim.kick - 1/60); R.syncFromMatch(m, 1/60); if (pm.release) n++; low = Math.min(low, pm.body.position.y); }
            return { n: n, low: low, end: !pm.release }; }""")
        check('rilancio corto con le mani: la fa rotolare (si china), poi torna normale', 25 <= rel['n'] <= 40 and rel['low'] < -0.2 and rel['end'], rel)
        check('nessun errore', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (sum(results), len(results) - sum(results)))
    raise SystemExit(0 if all(results) else 1)

os.makedirs(os.path.join(HERE, 'shots'), exist_ok=True)
asyncio.run(main())
