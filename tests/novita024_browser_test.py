# Novità della 0.24 nel gioco vero (Chromium headless), una parte per ogni sprint:
# - portiere: tuffo vero del motore disegnato in modo fluido (niente scatti tra un fotogramma e l'altro), corpo che si
#   stende verso il pallone, poi resta a terra un attimo e si rialza senza teletrasporti.
# - porta e rete: rete 3D a nodi che si deforma nel punto colpito (fondo, lati, tetto), l'onda si propaga e torna a
#   riposo; il pallone non la attraversa; poco costosa da calcolare.
# - pallone: pannelli, cuciture e rilievo (bumpMap), stessa dimensione, rotazione vera (asse giusto, angolo = strada
#   diviso raggio).
# - calciatori: materiale con opacità per pezzo e pieghe della stoffa, volti con occhi, tacchetti; i piedi non
#   attraversano il pallone; frenata con la gamba avanti.
# - campo, telecamera, effetti: linee del campo come geometria nitida (non più nella texture), telecamera televisiva
#   che anticipa il pallone e si avvicina davanti alle porte, piccolo effetto sul palo.
# - 0.24.1: in allenamento (tiri, punizioni, rigori, dribbling) dopo il gol il pallone disegnato entra in rete e la
#   rete si gonfia; il portiere nuovo si tuffa.
# Prima: node build.js test. Uso: python3 tests/novita024_browser_test.py
import asyncio, os
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'file://' + os.path.join(HERE, '..', 'dist', 'test.html')
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
results = []
def check(name, cond, extra=''):
    results.append(bool(cond)); print(('OK   ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if extra != '' else ''), flush=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda msg: errs.append(msg.text) if msg.type == 'error' else None)
        await pg.add_init_script('localStorage.setItem("campoAperto.settings.v1", JSON.stringify({quality: "bassa", dynamicRes: false})); localStorage.setItem("campoAperto.tutorialHint", "1")')
        await pg.goto(URL)
        await pg.wait_for_function('window.game && game.loaded', timeout=90000, polling=250)
        # il ciclo del gioco si ferma: i passi si fanno a mano, sempre uguali
        await pg.evaluate("() => { game.loop = () => {}; game.setup.side = 0; game.startMatch(); for (let i = 0; i < 300; i++) game.updateOffline(1/60); }")

        # ---- SPRINT 1: portiere. Tiro vero verso l'angolo: il motore fa tuffare il portiere, il disegno lo segue
        dive = await pg.evaluate("""() => { const m = game.match, R = game.renderer, t = m.teams[0], s = t.players[9], k = t.opponent().gk, gx = t.oppGoalX();
            const pm = R.playerMeshes.find(q => q.player === k);
            m.state = 'PLAY'; m.ball.owner = null; k.x = gx - t.dir * 0.9; k.z = 0; k.vx = k.vz = 0; k.gkAi = null; k.anim.dive = 0;
            m.ball.x = gx - t.dir * 16; m.ball.z = 0; m.ball.y = 0.11; m.ball.vx = t.dir * 24; m.ball.vy = 3.2; m.ball.vz = 6.2;
            m.ball.lastTouch = s; m.lastKick = { kind: 'shot', player: s, time: m.time }; s.x = m.ball.x - t.dir * 3; s.kickCooldown = 5;
            const out = { dived: false, maxTilt: 0, maxJump: 0, maxPosJump: 0, upFrames: 0, endTilt: 0 };
            game.updateOffline(1/60);   // primo fotogramma: il portiere spostato a mano si disegna al suo posto
            let prevT = pm.body.rotation.x, prevX = pm.root.position.x, prevZ = pm.root.position.z;
            for (let f = 0; f < 150; f++) {
              game.updateOffline(1/60);
              if (k.anim.dive > 0) out.dived = true;
              const tl = pm.body.rotation.x;
              out.maxTilt = Math.max(out.maxTilt, Math.abs(tl));
              out.maxJump = Math.max(out.maxJump, Math.abs(tl - prevT));
              out.maxPosJump = Math.max(out.maxPosJump, Math.hypot(pm.root.position.x - prevX, pm.root.position.z - prevZ));
              if (out.dived && k.anim.dive <= 0 && pm.dv && pm.dv.up > 0) out.upFrames++;
              prevT = tl; prevX = pm.root.position.x; prevZ = pm.root.position.z;
              if (m.state !== 'PLAY' && !out.state) out.state = m.state;   // pallone fuori: si continua a guardare il portiere
              if (m.state === 'SETPIECE' || m.state === 'KICKOFF') break;
            }
            out.endTilt = Math.abs(pm.body.rotation.x);
            return out; }""")
        check('portiere: il tiro all\'angolo fa partire un tuffo vero (motore) e il corpo si stende', dive['dived'] and dive['maxTilt'] > 1.0, dive)
        check('portiere: tuffo fluido, nessuno scatto tra due fotogrammi (rotazione e posizione)', dive['maxJump'] < 0.35 and dive['maxPosJump'] < 0.2, dive)
        check('portiere: dopo il tuffo resta a terra un attimo e si rialza piano', dive['upFrames'] >= 30, dive)
        await pg.screenshot(path=HERE + '/shots/024_portiere.png')

        # ---- SPRINT 2: rete. Tiri veri in porta (motore) e rete disegnata che risponde
        NET = """([y, vz, side]) => { const m = game.match, R = game.renderer, t = m.teams.find(q => q.dir > 0), s = t.players[9], k = t.opponent().gk;
            m.state = 'PLAY'; m.ball.owner = null; k.x = 40; k.z = 20; s.x = 30; s.kickCooldown = 5;
            m.ball.x = 52.5 - 10; m.ball.z = side; m.ball.y = y; m.ball.vx = 30; m.ball.vy = 1.2; m.ball.vz = vz; m.ball.lastTouch = s;
            const net = R.nets.find(q => q.side > 0), C = CONFIG, out = { maxD: 0, where: null, maxBallX: 0, ms: 0, frames: 0 };
            for (let f = 0; f < 90; f++) {
              const t0 = performance.now(); game.updateOffline(1/60); out.ms += performance.now() - t0; out.frames++;
              let mx = 0, mi = 0; for (let i = 0; i < net.d.length; i += 3) { const v = Math.hypot(net.d[i], net.d[i + 1], net.d[i + 2]); if (v > mx) { mx = v; mi = i; } }
              if (mx > out.maxD) { out.maxD = mx; out.where = [net.nrm[mi], net.nrm[mi + 1], net.nrm[mi + 2]]; }
              out.maxBallX = Math.max(out.maxBallX, R.ballMesh.position.x);
            }
            out.ms /= out.frames; out.state = m.state; out.inNet = m.ball.inNet;
            // dopo qualche secondo con il pallone lontano la rete torna ferma
            R.ballMesh.position.set(0, 0.2, 0);
            for (let f = 0; f < 240; f++) R.updateNets(1/60);
            out.asleep = !net.awake; let rest = 0; for (let i = 0; i < net.d.length; i++) rest = Math.max(rest, Math.abs(net.d[i])); out.rest = rest;
            return out; }"""
        await pg.evaluate("() => { game.quitToMenu(); game.setup.side = 0; game.startMatch(); for (let i = 0; i < 200; i++) game.updateOffline(1/60); }")
        strong = await pg.evaluate(NET, [0.9, 0.6, 0])
        check('rete: tiro forte in porta, il fondo si gonfia in modo evidente (oltre 30 cm)', strong['maxD'] > 0.3 and strong['where'] == [1, 0, 0] and strong['inNet'], strong)
        check('rete: il pallone non la attraversa (resta entro il fondo che cede)', strong['maxBallX'] < 52.5 + 2.2 + 0.6, strong['maxBallX'])
        check('rete: poi torna ferma alla forma di riposo e smette di calcolare', strong['asleep'] and strong['rest'] == 0, strong)
        await pg.evaluate("() => { game.quitToMenu(); game.setup.side = 0; game.startMatch(); for (let i = 0; i < 200; i++) game.updateOffline(1/60); }")
        top = await pg.evaluate(NET, [1.6, 3.6, -1])
        check('rete: tiro all\'incrocio, si muovono lati o tetto', top['maxD'] > 0.1 and top['inNet'], top)
        await pg.evaluate("() => { game.quitToMenu(); game.setup.side = 0; game.startMatch(); for (let i = 0; i < 200; i++) game.updateOffline(1/60); }")
        outside = await pg.evaluate(NET, [0.5, -6, 6])
        check('rete: tiro sull\'esterno della rete, il lato si muove e il pallone resta fuori', outside['maxD'] > 0.05 and not outside['inNet'] and outside['where'] == [0, 0, 1], outside)
        check('rete: costa poco (fotogramma intero sotto i 40 ms anche in questo browser lento)', strong['ms'] < 40, strong['ms'])

        # ---- SPRINT 3: pallone
        ball = await pg.evaluate("""() => { const R = game.renderer, M = R.ballMesh, out = {};
            out.r = M.geometry.parameters.radius; out.bump = !!M.material.bumpMap; out.mapW = M.material.map.image.width;
            // rotola verso +x a 5 m/s per un fotogramma: asse -z, angolo = 5/60/raggio
            M.quaternion.identity(); R.ballW.set(0, 0, 0); R.spinBall(1/60, 5, 0, true, 0, 0);
            const q = M.quaternion, ang = 2 * Math.acos(Math.min(1, q.w)), s = Math.sqrt(1 - q.w * q.w) || 1;
            out.ang = ang; out.want = 5 / 60 / out.r; out.axis = [q.x / s, q.y / s, q.z / s];
            // il punto che tocca l'erba è fermo: dopo la rotazione il punto più basso si sposta all'indietro (verso -x)
            const p = new THREE.Vector3(0, -out.r, 0).applyQuaternion(q); out.low = [p.x, p.y];
            // verso +z: asse +x
            M.quaternion.identity(); R.spinBall(1/60, 0, 5, true, 0, 0); out.axisZ = M.quaternion.x > 0;
            // in volo mantiene la rotazione
            M.quaternion.identity(); R.ballW.set(0, 0, -20); R.spinBall(1/60, 20, 0, false, 0, 0); out.air = M.quaternion.z < 0;
            return out; }""")
        check('pallone: stessa dimensione di prima, con rilievo (cuciture e micro-trama)', abs(ball['r'] - 0.176) < 1e-6 and ball['bump'] and ball['mapW'] >= 512, ball)
        check('pallone: rotola girando attorno all\'asse giusto con l\'angolo giusto', abs(ball['ang'] - ball['want']) < 1e-3 and ball['axis'][2] < -0.99 and ball['axisZ'], ball)
        check('pallone: il punto a contatto con l\'erba va all\'indietro (rotola, non striscia) e in volo continua a girare', ball['low'][0] < 0 and ball['air'], ball)

        # ---- SPRINT 4: calciatori
        pl = await pg.evaluate("""() => { const R = game.renderer, m = game.match, out = {};
            const pm = R.playerMeshes.find(q => !q.player.isGK), g = pm.chest.children[0].geometry;
            out.attrs = !!(g.attributes.aRough && g.attributes.aFabric);
            const r = Array.from(new Set(Array.from(pm.legs[0].ankle.children[0].geometry.attributes.aRough.array.map(v => Math.round(v * 100)))));
            out.bootRough = r.sort((a, b) => a - b);
            out.fabric = Math.max(...g.attributes.aFabric.array);
            // pallone dentro la scarpa: il disegno lo sposta fuori
            pm.root.updateMatrixWorld(true);
            const toe = new THREE.Vector3(0.1, -0.02, 0); pm.legs[1].ankle.localToWorld(toe);
            R.ballMesh.position.set(toe.x, 0.18, toe.z); const b0 = R.ballMesh.position.clone(); R.keepBallOffFeet();
            out.pushed = R.ballMesh.position.distanceTo(b0);
            // frenata forte da scatto
            const p = pm.player; p.x = 0; p.z = 10; p.vx = 8; p.vz = 0; p.facing = 0;
            for (let i = 0; i < 20; i++) { p.anim.phase += 0.4; R.syncFromMatch(m, 1/60); }
            let br = 0, hip = 0;   // frena a 21 m/s² (come uno scatto fermato di colpo)
            for (let i = 0; i < 20; i++) { p.vx = Math.max(0, p.vx - 0.35); R.syncFromMatch(m, 1/60); br = Math.max(br, pm.brake); hip = Math.max(hip, pm.legs[0].hip.rotation.z, pm.legs[1].hip.rotation.z); }
            out.brake = br; out.hip = hip; p.vx = 0;
            return out; }""")
        check('calciatori: opacità diversa per pezzo (scarpe lucide, suola opaca) e stoffa con le pieghe', pl['attrs'] and pl['fabric'] == 1 and min(pl['bootRough']) <= 30 and max(pl['bootRough']) >= 60, pl)
        check('calciatori: il pallone dentro la scarpa viene spostato fuori', pl['pushed'] > 0.02, pl)
        check('calciatori: frenata forte con la gamba avanti', pl['brake'] > 0.3 and pl['hip'] > 0.35, pl)
        await pg.screenshot(path=HERE + '/shots/024_calciatori.png')

        # ---- SPRINT 5: campo, telecamera, effetti
        await pg.evaluate("() => { game.quitToMenu(); game.setup.side = 0; game.startMatch(); for (let i = 0; i < 300; i++) game.updateOffline(1/60); }")
        f5 = await pg.evaluate("""() => { const R = game.renderer, m = game.match, out = {};
            out.lines = !!R.fieldLines && R.fieldLines.geometry.attributes.position.count > 1000 && R.fieldLines.visible;
            // il pallone corre verso destra: la telecamera guarda più avanti del pallone
            m.state = 'PLAY'; m.ball.owner = null; m.ball.x = -10; m.ball.z = 0; m.ball.y = 0.11; m.ball.vy = 0;
            for (let i = 0; i < 60; i++) { m.ball.vx = 18; m.ball.vz = 0; R.syncFromMatch(m, 1/60); }
            out.lead = R._tv.lx; out.lookAhead = R.camTarget.x - m.ball.x * 0.9;
            // vicino alla porta: più bassa e più vicina
            m.ball.vx = 0; m.ball.x = 0; for (let i = 0; i < 300; i++) R.syncFromMatch(m, 1/60); const y0 = R.camera.position.y, z0 = R.camera.position.z;
            m.ball.x = 46; for (let i = 0; i < 400; i++) R.syncFromMatch(m, 1/60); out.dy = R.camera.position.y - y0; out.dz = R.camera.position.z - z0;
            R.onPost(); out.shake = R.shake;
            return out; }""")
        check('campo: linee del campo come geometria nitida', f5['lines'], f5)
        check('telecamera: anticipa il pallone che corre (guarda più avanti)', f5['lead'] > 3 and f5['lookAhead'] > 2, f5)
        check('telecamera: davanti alla porta si abbassa e si avvicina', f5['dy'] < -1.5 and f5['dz'] < -2.5, f5)
        check('effetti: piccolo scossone sul palo (discreto)', 0 < f5['shake'] <= 0.2, f5)

        # ---- 0.24.1: allenamento
        for drill in ('shots', 'freekick', 'penalty', 'dribble'):
            r = await pg.evaluate("""(d) => { game.quitToMenu(); game.startTraining(d); for (let i = 0; i < 90; i++) game.updateOffline(1/60);
                const m = game.match, R = game.renderer, b = m.ball, me = m.trMain, gk = m.teams[1].players.find(p => p.isGK);
                m.state = 'PLAY'; m.tr.phase = 'live';
                b.owner = null; b.x = 52.5 - 14; b.z = 0; b.y = 0.11; b.vx = 26; b.vy = 2.5; b.vz = 6.5; b.lastTouch = me; m.lastKick = { kind: 'shot', player: me, time: m.time }; me.kickCooldown = 5;
                const net = R.nets.find(n => n.side > 0); let dive = false, netMax = 0, ballX = 0;
                for (let i = 0; i < 80; i++) { game.updateOffline(1/60); if (gk && gk.anim.dive > 0) dive = true; ballX = Math.max(ballX, R.ballMesh.position.x);
                  for (let k = 0; k < net.d.length; k++) netMax = Math.max(netMax, Math.abs(net.d[k])); }
                return { last: m.tr.last, dive: dive, netMax: netMax, ballX: ballX }; }""", drill)
            check('allenamento ' + drill + ': gol, il pallone disegnato entra in rete e la rete si gonfia, il portiere si tuffa', r['last'] == 'Gol!' and r['netMax'] > 0.3 and r['ballX'] > 54 and r['dive'], r)

        check('nessun errore nella console', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (sum(results), len(results) - sum(results)))
    raise SystemExit(0 if all(results) else 1)

os.makedirs(os.path.join(HERE, 'shots'), exist_ok=True)
asyncio.run(main())
