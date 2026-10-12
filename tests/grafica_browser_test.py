# Grafica dei giocatori nel gioco vero (Chromium headless): tuffi del portiere (basso, medio, alto), palla in mano,
# uscita bassa, esultanze dopo il gol (marcatore, compagni che lo abbracciano, portiere disperato, chi subisce),
# gesti dei calci (piatto, collo, rovesciata, tuffo di testa), stadio vivo (bandiere, sciarpe, flash).
# Prima: node build.js test. Uso: python3 tests/grafica_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

DIVE = """(h) => { const m = game.match, R = game.renderer, t = m.teams[0], gk = t.gk; const gx = t.ownGoalX(); const pm = R.playerMeshes.find(q => q.player === gk);
  gk.x = gx + t.dir * 0.8; gk.z = 0; gk.vx = gk.vz = 0;
  const b = m.ball; b.owner = null; b.x = gx + t.dir * 6; b.z = 2.5; b.y = h; b.vx = -t.dir * 20; b.vy = 0; b.vz = 0;
  pm.dv = null; gk.anim.dive = 0.9; gk.anim.diveDir = -1;
  let maxY = 0, maxTilt = 0, arms = 0;
  for (let i = 0; i < 40; i++) { gk.anim.dive -= 1/60; R.syncFromMatch(m, 1/60); maxY = Math.max(maxY, pm.body.position.y); maxTilt = Math.max(maxTilt, Math.abs(pm.body.rotation.x)); arms = Math.max(arms, Math.abs(pm.arms[1].sh.rotation.x)); }
  gk.anim.dive = 0; for (let i = 0; i < 60; i++) R.syncFromMatch(m, 1/60);
  return { maxY, maxTilt, arms, after: Math.abs(pm.body.rotation.x) }; }"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false}))')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=60000, polling=250)
        await pg.evaluate("() => { game.loop = () => {}; game.setup.side = -1; game.startMatch(); for (let i = 0; i < 60; i++) game.updateOffline(1/60); }")

        lo, mid, hi = [await pg.evaluate(DIVE, h) for h in (0.2, 1.0, 2.2)]
        check('tuffo: il portiere vola sul fianco con le braccia tese', mid['maxTilt'] > 1.2 and mid['arms'] > 2.5, mid)
        check('tuffo rasoterra più basso e più steso, tuffo alto più in alto e più dritto', lo['maxY'] < mid['maxY'] < hi['maxY'] and lo['maxTilt'] > hi['maxTilt'], [lo, mid, hi])
        check('dopo il tuffo si rialza', hi['after'] < 0.05 and lo['after'] < 0.05, [lo['after'], hi['after']])
        held = await pg.evaluate("""() => { const m = game.match, R = game.renderer, gk = m.teams[0].gk; m.ball.owner = gk; m.ball.y = 0.11;
            let top = 0; for (let i = 0; i < 20; i++) { R.syncFromMatch(m, 1/60); top = Math.max(top, R.ballMesh.position.y); }   // la palla arrivava alta: presa alta
            for (let i = 0; i < 30; i++) R.syncFromMatch(m, 1/60);
            const bm = R.ballMesh.position; return { y: bm.y, d: Math.hypot(bm.x - gk.x, bm.z - gk.z), top: top }; }""")
        check('presa alta (la palla arrivava alta): salto con il pallone sopra la testa', held['top'] > 1.8, held)
        check('poi il pallone sta nelle mani, davanti al petto', 0.9 < held['y'] < 1.4 and held['d'] < 0.6, held)
        sm = await pg.evaluate("""() => { const m = game.match, R = game.renderer, t = m.teams[0], gk = t.gk, pm = R.playerMeshes.find(q => q.player === gk);
            m.ball.owner = null; m.ball.x = gk.x + t.dir * 1.8; m.ball.z = gk.z; m.ball.y = 0.11; gk.vx = t.dir * 4;
            for (let i = 0; i < 30; i++) R.syncFromMatch(m, 1/60); const y = pm.body.position.y; gk.vx = 0; return { y: y, s: pm.smother }; }""")
        check('uscita bassa sui piedi dell\'attaccante: si butta basso', sm['s'] > 0.8 and sm['y'] < -0.15, sm)
        # gol: esultanza
        ce = await pg.evaluate("""() => { const m = game.match, R = game.renderer, t = m.teams[0]; const s = t.players[9]; const gx = t.oppGoalX();
            m.ball.owner = null; m.ball.lastTouch = s; s.x = gx - t.dir * 8; s.z = 3;
            t.players.forEach((p, i) => { if (!p.isGK && p !== s) { p.x = s.x - t.dir * (4 + i); p.z = s.z + (i % 3) * 3 - 3; } });
            for (let i = 0; i < 5; i++) R.syncFromMatch(m, 1/60);
            m.goal(t); game.replayPending = false;
            const sx0 = s.x, sz0 = s.z;
            while (m.stateTime < 2.4) { game.updateOffline(1/60); game.replayPending = false; game.replay = null; }
            const pms = R.playerMeshes, cel = q => q.cel || {};
            const sp = pms.find(q => q.player === s);
            const roles = {}; for (const q of pms) if (q.cel) roles[q.cel.role] = (roles[q.cel.role] || 0) + 1;
            const gk1 = pms.find(q => q.player === m.teams[1].gk);
            const near = pms.filter(q => cel(q).role === 'mate' && Math.hypot(q.root.position.x - sp.root.position.x, q.root.position.z - sp.root.position.z) < 2).length;
            return { roles, near, moved: Math.hypot(sp.root.position.x - sx0, sp.root.position.z - sz0), gkY: gk1.body.position.y, style: R.celeb.style }; }""")
        check('esultanza: il marcatore corre via esultando', ce['roles'].get('scorer') == 1 and ce['moved'] > 2, ce)
        check('i compagni gli corrono incontro e lo abbracciano', ce['near'] >= 6, ce)
        check('il portiere che subisce si inginocchia, gli altri a testa bassa', ce['gkY'] < -0.3 and ce['roles'].get('down', 0) >= 9 and ce['roles'].get('despair') == 1, ce)
        back = await pg.evaluate("""() => { const m = game.match, R = game.renderer; while (m.state === 'GOAL') { game.updateOffline(1/60); game.replay = null; } for (let i = 0; i < 3; i++) game.updateOffline(1/60);
            return R.playerMeshes.every(q => !q.cel) && R.playerMeshes.every(q => Math.hypot(q.root.position.x - q.player.rx, q.root.position.z - q.player.rz) < 0.01); }""")
        check('al calcio d\'inizio tutti tornano al loro posto', back)
        # ---- tiri e passaggi: un gesto diverso per ogni calcio
        KICK = """(a) => { const [kind, y, frames] = a; const m = game.match, R = game.renderer, p = m.teams[0].players[9], pm = R.playerMeshes.find(q => q.player === p);
            p.vx = p.vz = 0; pm.bike = 0; pm.dh = 0; p.anim.kick = kind === 'header' ? 0 : 0.3; p.anim.header = kind === 'header' ? 0.35 : 0;
            R.onKick({ x: p.x, z: p.z, kind: kind, y: y, power: 28 });
            let hip = -9, twist = 0, bodyZ = 0, bodyY = 0;
            for (let i = 0; i < frames; i++) { if (p.anim.kick > 0) p.anim.kick -= 1/60; if (p.anim.header > 0) p.anim.header -= 1/60; R.syncFromMatch(m, 1/60);
              hip = Math.max(hip, pm.legs[1].hip.rotation.z); twist = Math.min(twist, pm.legs[1].hip.rotation.y); bodyZ = Math.abs(pm.body.rotation.z) > Math.abs(bodyZ) ? pm.body.rotation.z : bodyZ; bodyY = Math.max(bodyY, pm.body.position.y); }
            return { hip, twist, bodyZ, bodyY }; }"""
        await pg.evaluate("() => { game.setup.side = -1; game.startMatch(); for (let i = 0; i < 30; i++) game.updateOffline(1/60); }")
        ps, sh, bk, dh = [await pg.evaluate(KICK, a) for a in (['pass', 0.11, 18], ['shot', 0.11, 18], ['shot', 1.8, 50], ['header', 0.6, 50])]
        check('passaggio di piatto: movimento corto con la gamba ruotata in fuori', ps['twist'] < -0.6 and ps['hip'] < 0.9, ps)
        check('tiro di collo: caricamento e accompagnamento più ampi', sh['hip'] > 1.3 and sh['hip'] > ps['hip'] + 0.4, sh)
        check('rovesciata: in aria all\'indietro con la gamba sopra la testa', bk['bodyZ'] > 1.2 and bk['bodyY'] > 0.6 and bk['hip'] > 2.5, bk)
        check('tuffo di testa: in avanti a corpo steso', dh['bodyZ'] < -1.2 and dh['bodyY'] > 0.3, dh)
        # ---- stadio vivo (con la qualità media in su)
        st = await pg.evaluate("""() => { const R = game.renderer; game.applyQuality ? 0 : 0; R.setQuality('media'); const L = R.life;
            const f = L.flags[0].geo.attributes.position.array, a0 = f[5];
            const sc = new THREE.Matrix4(), v = new THREE.Vector3();
            R.crowdExcite = 0; R.updateStadiumLife(1/60); L.scarves.getMatrixAt(3, sc); const y0 = v.setFromMatrixPosition(sc).y;
            for (let i = 0; i < 30; i++) R.updateStadiumLife(1/60);
            const a1 = f[5];
            R.crowdExcite = 1; R.updateStadiumLife(1/60); L.scarves.getMatrixAt(3, sc); const y1 = v.setFromMatrixPosition(sc).y;
            R.cameraFlashes(2); R.updateStadiumLife(1/60); const on = L.flashPts.visible; let lit = 0; for (let i = 1; i < L.flashPos.length; i += 3) if (L.flashPos[i] > 0) lit++;
            for (let i = 0; i < 200; i++) R.updateStadiumLife(1/60);
            R.setQuality('bassa'); const low = !!(R.life && R.life.flags.length);
            return { flags: L.flags.length, waving: a0 !== a1, up: y1 - y0, on: on, lit: lit, off: !L.flashPts.visible, low: low }; }""")
        check('stadio: bandiere delle squadre che sventolano', st['flags'] >= 30 and st['waving'], st)
        check('sciarpe che si alzano quando il pubblico si scalda', st['up'] > 0.5, st)
        check('flash dei fotografi dopo il gol, poi si spengono', st['on'] and st['lit'] > 20 and st['off'], st)
        check('qualità bassa: niente bandiere e sciarpe', not st['low'], st)
        check('nessun errore', not errs, errs[:3])
        await b.close()
    ok = sum(results); print('\nRisultato: %d superati, %d falliti' % (ok, len(results) - ok))
    raise SystemExit(0 if ok == len(results) else 1)

asyncio.run(main())
