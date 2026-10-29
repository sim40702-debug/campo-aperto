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
# - 0.24.2: visuale "Dietro al giocatore": la telecamera segue il pallone e il calciatore comandato cambia da solo
#   (al più vicino al pallone, a chi riceve un passaggio); con la visuale televisiva no.
# - 0.24.3: porta come quelle vere: sostegni dietro FUORI dalla rete, rete appesa (legata in pochi punti, spigoli
#   dietro liberi).
# - 0.24.4: il portiere cade dalla parte del pallone (su tutte e due le porte); tutorial: arrivato nel cerchio il
#   pallone non scappa e al passo dopo torna al piede.
# - 0.24.5: in allenamento e nel tutorial niente telecronaca (con la telecronaca accesa nelle impostazioni).
# - 0.24.6: Partita e Allenamento separati: in allenamento pali e traversa suonano ma senza scritte né "ooh", il gol
#   senza esultanza, replay, flash, fuochi e boato, pubblico basso; in partita "Palo!" e "Traversa!" e tutto come prima.
# - 0.24.8: presentazione della partita (telecamera che vola, scheda delle squadre, si salta con un tasto, mai in
#   allenamento), panchine con riserve e allenatori, tunnel.
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

        # ---- 0.24.2: visuale dietro al giocatore
        AUTO = """(cam) => { game.quitToMenu(); game.setup.side = 0; game.startMatch(); game.renderer.camMode = cam;
            for (let i = 0; i < 200; i++) game.updateOffline(1/60);
            const m = game.match, R = game.renderer, h = m.humanById(R.localId), me = m.teams[h.team], opp = me.opponent();
            // un avversario con la palla lontano dal tuo calciatore
            const far = me.players.filter(p => !p.isGK).sort((a, b) => b.x - a.x)[0];
            h.player = far; const a = opp.players[9]; m.state = 'PLAY'; m.ball.owner = a; a.x = me.ownGoalX() - me.dir * -25; a.z = 10; a.vx = a.vz = 0;
            for (let i = 0; i < 40; i++) game.updateOffline(1/60);
            const near = me.players.filter(p => !p.isGK).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0];
            const out = { switched: h.player !== far, nearest: h.player === near };
            // la telecamera guarda il pallone (non il calciatore)
            out.camLook = Math.abs(R.camTarget.z - m.ball.z * 0.85) < 3;
            return out; }"""
        tv = await pg.evaluate(AUTO, 0)
        bh = await pg.evaluate(AUTO, 2)
        check('dietro al giocatore: senza palla il calciatore comandato passa da solo al più vicino al pallone', bh['switched'] and bh['nearest'], bh)
        check('dietro al giocatore: la telecamera segue il pallone', bh['camLook'], bh)
        check('visuale televisiva: nessun cambio automatico (come prima)', not tv['switched'], tv)
        recv = await pg.evaluate("""() => { const m = game.match, R = game.renderer, h = m.humanById(R.localId), me = m.teams[h.team];
            const [p1, p2] = me.players.filter(p => !p.isGK).slice(5, 7); m.state = 'PLAY';
            p1.x = 0; p1.z = 0; p2.x = me.dir * 20; p2.z = 5; h.player = p1; m.ball.owner = null; m.ball.x = 0.3; m.ball.z = 0; m.ball.vx = me.dir * 15; m.ball.vz = 3.5;
            m.pendingPass = { from: p1, to: p2, t: 0 }; game.updateOffline(1/60); game.updateOffline(1/60); return h.player === p2; }""")
        check('dietro al giocatore: passaggio in viaggio, il comando passa subito a chi lo riceve', recv, recv)
        await pg.evaluate("() => { game.renderer.camMode = 0; }")

        # ---- 0.24.3: porta con i sostegni dietro
        gs = await pg.evaluate("""() => { const R = game.renderer, net = R.nets.find(n => n.side > 0), C = CONFIG, D = C.GOAL_DEPTH, W = C.GOAL_HALF_W;
            // nessun nodo della rete sta oltre il fondo o fuori dai lati (i sostegni sono più in là)
            let maxDepth = 0, maxZ = 0, cornerGap = 9, cornerPins = 0, pins = 0;
            for (let i = 0; i < net.n; i++) {
              const x = net.rest[i * 3], y = net.rest[i * 3 + 1], z = net.rest[i * 3 + 2];
              maxDepth = Math.max(maxDepth, x - C.HALF_L); maxZ = Math.max(maxZ, Math.abs(z));
              // spigolo verticale dietro (tra fondo e lato): niente nodi fermi sullo spigolo dritto (non c'è un palo), la
              // rete lì è arrotondata (0.24.4)
              if (y > 0.3 && y < 1.5) cornerGap = Math.min(cornerGap, Math.hypot(x - C.HALF_L - D, Math.abs(z) - W));
              if (y > 0.3 && y < 1.5 && Math.abs(x - C.HALF_L - D) < 0.3 && Math.abs(Math.abs(z) - W) < 0.3 && net.pin[i]) cornerPins++;
              if (net.pin[i]) pins++;
            }
            // tubi curvi (sostegni) presenti, più lontani della rete
            let tubes = 0, tubeMaxZ = 0;
            R.scene.traverse(o => { if (o.geometry && o.geometry.type === 'TubeGeometry') { tubes++; o.geometry.computeBoundingBox(); tubeMaxZ = Math.max(tubeMaxZ, o.geometry.boundingBox.max.z); } });
            return { maxDepth: maxDepth, maxZ: maxZ, cornerGap: cornerGap, cornerPins: cornerPins, ties: net.ties.length, pins: pins, n: net.n, tubes: tubes, tubeMaxZ: tubeMaxZ }; }""")
        check('porta: sostegni curvi dietro, fuori dalla rete', gs['tubes'] >= 4 and gs['tubeMaxZ'] > gs['maxZ'] + 0.08, gs)
        check('porta: rete appesa, legata in pochi punti, spigoli dietro morbidi e arrotondati (nessun palo)', gs['ties'] >= 10 and gs['cornerPins'] == 0 and gs['cornerGap'] > 0.05 and gs['pins'] < gs['n'] * 0.25, gs)

        # ---- 0.24.4: il portiere cade verso il pallone, su tutte e due le porte
        for gs_, vz in ((1, 6.0), (1, -6.0), (-1, 6.0), (-1, -6.0)):
            r = await pg.evaluate("""([gs, vz]) => { game.quitToMenu(); game.setup.side = 0; game.startMatch(); for (let i = 0; i < 100; i++) game.updateOffline(1/60);
                const m = game.match, R = game.renderer, t = m.teams.find(q => q.dir === gs), s = t.players[9], k = t.opponent().gk, gx = t.oppGoalX();
                const pm = R.playerMeshes.find(q => q.player === k);
                m.state = 'PLAY'; m.ball.owner = null; k.x = gx - t.dir * 0.9; k.z = 0; k.vx = k.vz = 0; k.gkAi = null; k.anim.dive = 0;
                m.ball.x = gx - t.dir * 16; m.ball.z = 0; m.ball.y = 0.11; m.ball.vx = t.dir * 24; m.ball.vy = 3.2; m.ball.vz = vz;
                m.ball.lastTouch = s; m.lastKick = { kind: 'shot', player: s, time: m.time }; s.x = m.ball.x - t.dir * 3; s.kickCooldown = 5;
                let head = 0, dived = false;
                for (let f = 0; f < 45; f++) { game.updateOffline(1/60);
                  if (k.anim.dive > 0) { dived = true; pm.root.updateMatrixWorld(true); const v = new THREE.Vector3(); pm.neck.getWorldPosition(v); head = v.z - pm.root.position.z; } }
                return { dived: dived, head: head }; }""", [gs_, vz])
            check('portiere (porta %s, tiro verso %s): cade dalla parte del pallone' % ('destra' if gs_ > 0 else 'sinistra', '+z' if vz > 0 else '-z'), r['dived'] and r['head'] * vz > 0.3, r)
        # ---- 0.24.4: tutorial, cerchio raggiunto: il pallone resta vicino e poi torna al piede
        tut = await pg.evaluate("""() => { game.quitToMenu(); game.startTutorial(); const m = game.match, out = [], gi = game.gameInput;
            for (let i = 0; i < 60; i++) game.updateOffline(1/60);
            for (const step of ['move', 'sprint']) {
              let f = 0;
              while (TUTORIAL_STEPS[m.tu.i].id === step && f < 1500) {
                const p = m.humans[0].player, t = m.tu.target;
                game.gameInput = () => { const r = { mx: 0, mz: 0, sprint: step === 'sprint', shoot: false, press: false, pressed: {} };
                  if (t && !m.tu.ok) { const dx = t.x - p.x, dz = t.z - p.z, l = Math.hypot(dx, dz) || 1; r.mx = dx / l; r.mz = dz / l; } return r; };
                game.updateOffline(1/60); f++;
                if (m.tu.ok) {
                  let maxD = 0; for (let k = 0; k < 100 && m.tu.ok; k++) { game.updateOffline(1/60); if (m.tu.ok) maxD = Math.max(maxD, Math.hypot(m.ball.x - p.x, m.ball.z - p.z)); }
                  out.push({ step: step, maxDist: maxD, owner: m.ball.owner === m.humans[0].player });
                }
              }
            }
            game.gameInput = gi; return out; }""")
        check('tutorial: arrivato nel cerchio il pallone non scappa e al passo dopo torna al piede', len(tut) == 2 and all(x['maxDist'] < 2 and x['owner'] for x in tut), tut)

        # ---- 0.24.5: niente telecronaca in allenamento e nel tutorial
        tc = await pg.evaluate("""() => { game.settings.commentary = true; const out = {};
            for (const what of ['shots', 'tutorial', 'partita']) {
              game.quitToMenu();
              if (what === 'tutorial') game.startTutorial(); else if (what === 'partita') { game.setup.side = 0; game.startMatch(); } else game.startTraining(what);
              for (let i = 0; i < 60; i++) game.updateOffline(1/60);
              game.commentary.reset();
              let shown = 0;
              for (let k = 0; k < 4; k++) {
                game.handleEvent({ type: k % 2 ? 'post' : 'save', x: 52, z: 0 });
                game.commentary.update(game.time + k);
                if (!document.getElementById('commentary').hidden && document.getElementById('commentary').textContent.trim()) shown++;
              }
              out[what] = shown;
            }
            return out; }""")
        check('telecronaca: niente scritte in allenamento e nel tutorial (in partita sì)', tc['shots'] == 0 and tc['tutorial'] == 0 and tc['partita'] > 0, tc)

        # ---- 0.24.6: allenamento e partita separati (eventi veri dal motore)
        SEP = """(mode) => { game.quitToMenu(); if (mode === 'partita') { game.setup.side = 0; game.startMatch(); } else game.startTraining('shots');
            for (let i = 0; i < 90; i++) game.updateOffline(1/60);
            const m = game.match, R = game.renderer, A = game.audio, calls = [];
            for (const f of ['post', 'save', 'roar', 'ooh', 'fireworks', 'sleighBells']) { const o = A[f].bind(A); A['__' + f] = o; A[f] = function () { calls.push(f + (f === 'post' ? ':' + arguments[0] + ':' + arguments[1] : '')); return o.apply(A, arguments); }; }
            const fl = R.cameraFlashes.bind(R); let flashes = 0; R.cameraFlashes = function () { flashes++; return fl.apply(R, arguments); };
            const out = { banners: [], replay: false };
            const shot = (z, y) => { const t = m.teams[0], s = m.trMain || t.players[9], k = t.opponent().gk; m.state = 'PLAY'; if (m.tr) m.tr.phase = 'live';
              if (k) { k.x = -40; k.z = 25; } m.ball.owner = null; m.ball.x = t.oppGoalX() - t.dir * 6; m.ball.y = y; m.ball.z = z; m.ball.vx = t.dir * 24; m.ball.vy = 0.6; m.ball.vz = 0; m.ball.lastTouch = s; s.kickCooldown = 5;
              for (let i = 0; i < 40; i++) { game.updateOffline(1/60); if (m.banner && out.banners.indexOf(m.banner.text) < 0) out.banners.push(m.banner.text); if (game.replayPending) out.replay = true; } };
            shot(CONFIG.GOAL_HALF_W + 0.12, 0.6);          // palo
            shot(0, CONFIG.GOAL_H + 0.1);                   // traversa
            shot(1, 0.5);                                   // gol
            for (const f of ['post', 'save', 'roar', 'ooh', 'fireworks', 'sleighBells']) A[f] = A['__' + f];
            R.cameraFlashes = fl;
            out.calls = calls; out.flashes = flashes; out.commentary = !document.getElementById('commentary').hidden;
            return out; }"""
        tr_ = await pg.evaluate(SEP, 'allenamento')
        pt = await pg.evaluate(SEP, 'partita')
        check('allenamento: palo e traversa suonano (senza "ooh"), niente scritte PALO!/TRAVERSA!/GOL! grandi', 'post:false:false' in tr_['calls'] and 'post:false:true' in tr_['calls'] and 'ooh' not in tr_['calls'] and not any(b in ('Palo!', 'Traversa!', 'GOL!') for b in tr_['banners']), tr_)
        check('allenamento: gol senza boato, replay, flash e fuochi; niente telecronaca', 'roar' not in tr_['calls'] and 'fireworks' not in tr_['calls'] and not tr_['replay'] and tr_['flashes'] == 0 and not tr_['commentary'], tr_)
        check('partita: "Palo!" e "Traversa!" con il suono giusto, gol con replay e festa (come prima)', 'Palo!' in pt['banners'] and 'Traversa!' in pt['banners'] and 'post:true:false' in pt['calls'] and 'post:true:true' in pt['calls'] and 'roar' in pt['calls'] and pt['replay'], pt)

        # ---- 0.24.8: presentazione e panchine
        it = await pg.evaluate("""() => { game.quitToMenu(); game.settings.intro = true; game.setup.side = 0; document.getElementById('setup-start').click();
            const R = game.renderer, out = { started: !!game.intro, card: !document.getElementById('intro-card').hidden, text: document.getElementById('intro-card').textContent };
            const clock0 = game.match.clock; const p0 = R.camera.position.clone();
            for (let i = 0; i < 60; i++) game.updateOffline(1/60);
            out.camMoved = R.camera.position.distanceTo(p0) > 3; out.camHigh = R.camera.position.y > 25; out.clockStill = game.match.clock === clock0;
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); game.updateOffline(1/60);
            out.skipped = !game.intro && document.getElementById('intro-card').hidden;
            for (let i = 0; i < 60; i++) game.updateOffline(1/60);
            out.subs = R.benches.filter(b => b.subs && b.coach).length;
            game.quitToMenu(); game.startTraining('shots'); for (let i = 0; i < 10; i++) game.updateOffline(1/60);
            out.trainingIntro = !!game.intro; out.trainingSubs = R.benches.filter(b => b.subs).length;
            let tunnel = false; R.scene.traverse(o => { if (o.geometry && o.geometry.type === 'TorusGeometry' && Math.abs(o.position.z + 42) < 3) tunnel = true; });
            out.tunnel = tunnel; game.settings.intro = false;
            return out; }""")
        check('presentazione: scheda con le squadre e telecamera che vola sopra lo stadio, la partita aspetta', it['started'] and it['card'] and 'contro' in it['text'] and it['camMoved'] and it['camHigh'] and it['clockStill'], it)
        check('presentazione: si salta con un tasto; in allenamento non c\'è', it['skipped'] and not it['trainingIntro'], it)
        check('stadio: panchine con riserve e allenatori in partita (vuote in allenamento), tunnel', it['subs'] == 2 and it['trainingSubs'] == 0 and it['tunnel'], it)

        check('nessun errore nella console', not errs, errs[:3])
        await b.close()
    print('\nRisultato: %d superati, %d falliti' % (sum(results), len(results) - sum(results)))
    raise SystemExit(0 if all(results) else 1)

os.makedirs(os.path.join(HERE, 'shots'), exist_ok=True)
asyncio.run(main())
