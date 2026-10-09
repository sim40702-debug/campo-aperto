# ============================================================
# OMINO DI CAMPO APERTO — script per Autodesk Fusion (Python)
# Ricrea il calciatore del gioco con le stesse misure di src/client/09_render.js (makePlayerMesh):
# pantaloncini e busto "torniti" dai profili, testa, capelli, braccia, gambe, calzettoni e scarpe.
# Ogni pezzo è un corpo con il suo nome e il suo colore, così lo puoi modificare come vuoi.
#
# Come si usa:
#   1. In Fusion: Utilità → Componenti aggiuntivi → Script e componenti aggiuntivi → "+" (Crea) → Script, Python,
#      nome "OminoCampoAperto". Apri la cartella dello script e metti questo file al posto di OminoCampoAperto.py
#      (oppure copia tutto il testo dentro quel file).
#   2. Apri un disegno vuoto e lancia lo script (Esegui).
#   3. Cambia le impostazioni qui sotto (altezza, colori, capelli...) e rilancialo per avere un omino diverso.
#
# Misure: nel gioco 1 unità = 1 metro e il calciatore guarda verso +X; qui tutto è in centimetri.
# ============================================================
import adsk.core, adsk.fusion, traceback, math

# ---------------- IMPOSTAZIONI (cambia qui) ----------------
ALTEZZA = 1.80          # metri (nel gioco da 1,68 a 1,95)
CORPORATURA = 1.0       # larghezza del corpo (nel gioco da 0,90 a 1,12)
ALTO = 'Z'              # asse verso l'alto del tuo disegno: 'Z' (predefinito di Fusion) oppure 'Y'
CAPELLI = 'corti'       # corti, rasati, medi, ricci, cresta, nessuno
BARBA = False
PORTIERE = False        # True = maniche lunghe e guanti

PELLE = '#e0b48f'       # toni del gioco: #f1d3b8 #e0b48f #c68c62 #9c6644 #6e4630 #4a2f22
COLORE_CAPELLI = '#3a2618'
MAGLIA = '#c8202f'
PANTALONCINI = '#ffffff'
CALZETTONI = '#c8202f'
SCARPE = '#1a1a1a'
SUOLA = '#141414'
OCCHI = '#1b1410'
GUANTI = '#f2f2f2'

# ---------------- MISURE DEL GIOCO (metri, per 1,80 m) ----------------
HIP, WAIST, NECK, HY = 0.92, 0.98, 1.5, 1.665     # anca, vita, base del collo, centro della testa
H = HY - NECK
TORSO_PROFILE = [[0.0, 0.93], [0.15, 0.935], [0.158, 0.98], [0.155, 1.06], [0.163, 1.16], [0.182, 1.27], [0.198, 1.36],
                 [0.205, 1.42], [0.19, 1.47], [0.15, 1.505], [0.085, 1.525], [0.055, 1.53], [0.0, 1.53]]
SHORTS_PROFILE = [[0.0, 0.765], [0.172, 0.765], [0.176, 0.8], [0.172, 0.88], [0.163, 0.95], [0.156, 0.995], [0.0, 0.995]]

W = CORPORATURA
K = ALTEZZA / 1.8 * 100   # da metri del gioco a centimetri di Fusion (con l'altezza scelta)

app = adsk.core.Application.get()
ui = app.userInterface


# ---------------- AIUTI ----------------
def pt(x, y, z):
    # punto del gioco (x avanti, y in alto, z di lato) -> punto di Fusion in cm
    if ALTO == 'Z':
        return adsk.core.Point3D.create(x * K, -z * K, y * K)
    return adsk.core.Point3D.create(x * K, y * K, z * K)


def vec(x, y, z):
    # direzione del gioco -> direzione di Fusion (lunga 1)
    p = pt(x, y, z)
    v = adsk.core.Vector3D.create(p.x, p.y, p.z)
    v.normalize()
    return v


def scala_fusion(s):
    # scala [x, y, z] del gioco -> scala sugli assi di Fusion
    if ALTO == 'Z':
        return [s[0], s[2], s[1]]
    return list(s)


def rotazione(rx, ry, rz):
    # matrice 3x3 come in three.js (ordine XYZ: prima Rz, poi Ry, poi Rx), nelle coordinate del gioco
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    mx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    my = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    mz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    def per(a, b):
        return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    return per(per(mx, my), mz)


def matrice(rot, pos):
    # rotazione e spostamento del gioco -> Matrix3D di Fusion
    r = rotazione(*rot) if rot else [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    if ALTO == 'Z':
        # cambio di assi: gioco (x, y, z) -> Fusion (x, -z, y)
        c = [[1, 0, 0], [0, 0, -1], [0, 1, 0]]
        ct = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
        def per(a, b):
            return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        r = per(per(c, r), ct)
    t = pt(*pos)
    m = adsk.core.Matrix3D.create()
    m.setWithArray([r[0][0], r[0][1], r[0][2], t.x,
                    r[1][0], r[1][1], r[1][2], t.y,
                    r[2][0], r[2][1], r[2][2], t.z,
                    0, 0, 0, 1])
    return m


tbm = adsk.fusion.TemporaryBRepManager.get()


def sfera(r):
    return tbm.createSphere(pt(0, 0, 0), r * K)


def cilindro(r_sopra, r_sotto, lunghezza):
    # come CylinderGeometry di three.js: in piedi lungo l'asse verticale, centrato
    return tbm.createCylinderOrCone(pt(0, -lunghezza / 2, 0), r_sotto * K, pt(0, lunghezza / 2, 0), r_sopra * K)


def cono(r, lunghezza):
    return tbm.createCylinderOrCone(pt(0, -lunghezza / 2, 0), r * K, pt(0, lunghezza / 2, 0), 0.0001)


def scatola(lx, ly, lz):
    obb = adsk.core.OrientedBoundingBox3D.create(pt(0, 0, 0), vec(1, 0, 0), vec(0, 1, 0), lx * K, ly * K, lz * K)
    return tbm.createBox(obb)


def calotta(r, angolo):
    # parte alta di una sfera fino all'angolo dal polo (come i capelli del gioco)
    s = tbm.createSphere(pt(0, 0, 0), r * K)
    taglio = r * math.cos(angolo)
    altezza = taglio + r + 0.05
    sotto = tbm.createBox(adsk.core.OrientedBoundingBox3D.create(pt(0, (taglio - r - 0.05) / 2, 0), vec(1, 0, 0), vec(0, 1, 0),
                                                                  (2 * r + 0.1) * K, altezza * K, (2 * r + 0.1) * K))
    tbm.booleanOperation(s, sotto, adsk.fusion.BooleanTypes.DifferenceBooleanType)
    return s


def fascia_sfera(r, da, a):
    # pezzo di sfera tra due angoli dal polo (la barba)
    s = tbm.createSphere(pt(0, 0, 0), r * K)
    y1, y2 = r * math.cos(da), r * math.cos(a)
    lato = (2 * r + 0.1) * K
    sopra = tbm.createBox(adsk.core.OrientedBoundingBox3D.create(pt(0, (y1 + r + 0.05) / 2, 0), vec(1, 0, 0), vec(0, 1, 0), lato, (r + 0.05 - y1) * K, lato))
    sotto = tbm.createBox(adsk.core.OrientedBoundingBox3D.create(pt(0, (y2 - r - 0.05) / 2, 0), vec(1, 0, 0), vec(0, 1, 0), lato, (y2 + r + 0.05) * K, lato))
    tbm.booleanOperation(s, sopra, adsk.fusion.BooleanTypes.DifferenceBooleanType)
    tbm.booleanOperation(s, sotto, adsk.fusion.BooleanTypes.DifferenceBooleanType)
    return s


# ---------------- I PEZZI DELL'OMINO ----------------
# ogni pezzo: nome, forma (al centro), colore, posizione nel gioco, scala, rotazione
pezzi = []


def pezzo(nome, forma, colore, pos, scala=None, rot=None):
    pezzi.append({'nome': nome, 'forma': forma, 'colore': colore, 'pos': pos, 'scala': scala, 'rot': rot})


def costruisci_pezzi():
    trim = '#ffffff' if PANTALONCINI == MAGLIA else PANTALONCINI   # colletto e bordi delle maniche
    pelle_scura = scurisci(PELLE, 0.8)
    # ---- spalle e colletto (il busto e i pantaloncini si fanno con la rivoluzione, più sotto)
    for lato, nome in [(1, 'destra'), (-1, 'sinistra')]:
        pezzo('Spalla ' + nome, sfera(0.07), MAGLIA, (0, 1.435, lato * 0.222 * W), (1, 0.86, 1))
    pezzo('Colletto', cilindro(0.068, 0.086, 0.04), trim, (0, 1.515, 0))
    # ---- collo e testa
    pezzo('Collo', cilindro(0.054, 0.062, 0.12), PELLE, (0, NECK + 0.045, 0))
    pezzo('Testa', sfera(0.112), PELLE, (0, NECK + H, 0), (1.02, 1.16, 0.94))
    pezzo('Mento', sfera(0.07), PELLE, (0.045, NECK + H - 0.075, 0), (1, 0.75, 1.1))
    for lato, nome in [(1, 'destro'), (-1, 'sinistro')]:
        pezzo('Orecchio ' + nome, sfera(0.025), pelle_scura, (-0.005, NECK + H, lato * 0.103), (0.7, 1.2, 0.6))
        pezzo('Occhio ' + nome, sfera(0.011), OCCHI, (0.104, NECK + H + 0.018, lato * 0.036))
        pezzo('Sopracciglio ' + nome, scatola(0.012, 0.01, 0.036), COLORE_CAPELLI, (0.108, NECK + H + 0.043, lato * 0.036), None, (lato * 0.15, 0, 0))
    pezzo('Naso', cono(0.018, 0.045), pelle_scura, (0.115, NECK + H - 0.012, 0), None, (0, 0, -math.pi / 2))
    # ---- capelli (stili del gioco)
    stili = {'ricci': ((1.12, 1.2, 1.06), 1.55, 0.024), 'cresta': ((1.0, 1.05, 0.96), 1.1, 0.0), 'medi': ((1.06, 1.16, 1.0), 1.95, 0.0),
             'rasati': ((1.0, 1.15, 0.95), 1.25, 0.004), 'corti': ((1.03, 1.15, 0.97), 1.4, 0.01)}
    if CAPELLI in stili:
        sc, ang, dy = stili[CAPELLI]
        pezzo('Capelli', calotta(0.118, ang), COLORE_CAPELLI, (-0.008, NECK + H + dy, 0), sc, (0, 0, 0.32))
        if CAPELLI == 'cresta':
            pezzo('Cresta', scatola(0.17, 0.06, 0.05), COLORE_CAPELLI, (0.0, NECK + H + 0.13, 0), None, (0, 0, 0.15))
    if BARBA:
        pezzo('Barba', fascia_sfera(0.098, 1.75, 3.0), COLORE_CAPELLI, (0.018, NECK + H - 0.012, 0), (1.02, 1.12, 0.95))
    # ---- gambe e braccia
    for lato, nome in [(1, 'destra'), (-1, 'sinistra')]:
        z = lato * 0.09 * W
        anca = HIP - 0.03
        ginocchio = anca - 0.45
        pezzo('Coscia ' + nome, cilindro(0.092, 0.07, 0.45), PELLE, (0, anca - 0.225, z), (1.06, 1, 0.95))
        pezzo('Gamba pantaloncini ' + nome, cilindro(0.096, 0.09, 0.15), PANTALONCINI, (0, anca - 0.05, z))
        pezzo('Ginocchio ' + nome, sfera(0.064), PELLE, (0.008, ginocchio, z))
        pezzo('Polpaccio ' + nome, cilindro(0.068, 0.052, 0.2), CALZETTONI, (-0.006, ginocchio - 0.12, z))
        pezzo('Tibia ' + nome, cilindro(0.052, 0.042, 0.2), CALZETTONI, (0, ginocchio - 0.3, z))
        pezzo('Risvolto calzettone ' + nome, cilindro(0.07, 0.066, 0.05), CALZETTONI, (0, ginocchio - 0.035, z))
        pezzo('Scarpa ' + nome, scatola(0.19, 0.07, 0.088), SCARPE, (0.045, ginocchio - 0.41, z))
        pezzo('Punta scarpa ' + nome, sfera(0.047), SCARPE, (0.14, ginocchio - 0.418, z), (1.2, 0.68, 0.94))
        pezzo('Tallone ' + nome, sfera(0.044), SCARPE, (-0.045, ginocchio - 0.405, z), (0.8, 0.85, 0.95))
        pezzo('Suola ' + nome, scatola(0.24, 0.016, 0.09), SUOLA, (0.055, ginocchio - 0.452, z))
        # braccio: spalla a 1,43 m, gomito 29 cm più in basso
        zb = lato * 0.228 * W
        spalla = 1.43
        gomito = spalla - 0.29
        pezzo('Manica ' + nome, cilindro(0.063, 0.058, 0.16), MAGLIA, (0, spalla - 0.07, zb))
        pezzo('Bordo manica ' + nome, cilindro(0.06, 0.06, 0.025), trim, (0, spalla - 0.145, zb))
        if PORTIERE:
            pezzo('Manica lunga ' + nome, cilindro(0.054, 0.048, 0.16), MAGLIA, (0, spalla - 0.21, zb))
        else:
            pezzo('Braccio ' + nome, cilindro(0.05, 0.044, 0.15), PELLE, (0, spalla - 0.215, zb))
        pezzo('Avambraccio ' + nome, cilindro(0.045, 0.034, 0.25), MAGLIA if PORTIERE else PELLE, (0, gomito - 0.125, zb))
        pezzo('Mano ' + nome, sfera(0.05 if PORTIERE else 0.042), GUANTI if PORTIERE else PELLE, (0.005, gomito - 0.285, zb), (0.75, 1.25, 0.6))


def scurisci(hex_colore, f):
    r, g, b = int(hex_colore[1:3], 16), int(hex_colore[3:5], 16), int(hex_colore[5:7], 16)
    return '#%02x%02x%02x' % (int(r * f), int(g * f), int(b * f))


# ---------------- COLORI ----------------
aspetti = {}


def colore(design, corpo, hex_colore):
    # un aspetto di plastica opaca per ogni colore (copiato dalla libreria di Fusion e ricolorato)
    try:
        if hex_colore not in aspetti:
            base = None
            for lib in app.materialLibraries:
                for nome in ['Plastic - Matte (Yellow)', 'Plastica - Opaca (gialla)', 'Paint - Enamel Glossy (Yellow)']:
                    try:
                        base = lib.appearances.itemByName(nome)
                    except Exception:
                        base = None
                    if base:
                        break
                if base:
                    break
            if not base:
                # nessun nome conosciuto: il primo aspetto della libreria che ha un colore
                for lib in app.materialLibraries:
                    for a0 in lib.appearances:
                        if a0.appearanceProperties.itemByName('Color'):
                            base = a0
                            break
                    if base:
                        break
            if not base:
                return
            a = design.appearances.addByCopy(base, 'Omino ' + hex_colore)
            r, g, b = int(hex_colore[1:3], 16), int(hex_colore[3:5], 16), int(hex_colore[5:7], 16)
            prop = a.appearanceProperties.itemByName('Color') or a.appearanceProperties.itemById('opaque_albedo')
            if prop:
                adsk.core.ColorProperty.cast(prop).value = adsk.core.Color.create(r, g, b, 0)
            aspetti[hex_colore] = a
        corpo.appearance = aspetti[hex_colore]
    except Exception:
        pass   # senza colore l'omino resta comunque giusto


# ---------------- BUSTO E PANTALONCINI (rivoluzione dei profili) ----------------
def tornito(comp, nome, profilo, larghezza):
    piano = comp.xZConstructionPlane if ALTO == 'Z' else comp.xYConstructionPlane
    asse = comp.zConstructionAxis if ALTO == 'Z' else comp.yConstructionAxis
    sk = comp.sketches.add(piano)
    sk.name = 'Profilo ' + nome
    punti = [sk.modelToSketchSpace(pt(max(0.001, r * larghezza), y, 0)) for r, y in profilo]
    linee = sk.sketchCurves.sketchLines
    for i in range(len(punti) - 1):
        linee.addByTwoPoints(punti[i], punti[i + 1])
    linee.addByTwoPoints(punti[-1], punti[0])   # chiusura lungo l'asse
    inp = comp.features.revolveFeatures.createInput(sk.profiles.item(0), asse, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    inp.setAngleExtent(False, adsk.core.ValueInput.createByString('360 deg'))
    rev = comp.features.revolveFeatures.add(inp)
    corpo = rev.bodies.item(0)
    corpo.name = nome
    return corpo


def scala_corpo(comp, corpo, s):
    # scala diversa per asse (es. busto meno profondo che largo), attorno all'origine
    s = scala_fusion(s)
    coll = adsk.core.ObjectCollection.create()
    coll.add(corpo)
    inp = comp.features.scaleFeatures.createInput(coll, comp.originConstructionPoint, adsk.core.ValueInput.createByReal(1))
    inp.setToNonUniform(adsk.core.ValueInput.createByReal(s[0]), adsk.core.ValueInput.createByReal(s[1]), adsk.core.ValueInput.createByReal(s[2]))
    comp.features.scaleFeatures.add(inp)


def sposta_corpo(comp, corpo, m):
    coll = adsk.core.ObjectCollection.create()
    coll.add(corpo)
    try:
        inp = comp.features.moveFeatures.createInput2(coll)
        inp.defineAsFreeMove(m)
    except Exception:
        inp = comp.features.moveFeatures.createInput(coll, m)
    comp.features.moveFeatures.add(inp)


# ---------------- PROGRAMMA ----------------
def run(context):
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('Apri un disegno di Fusion prima di lanciare lo script.')
            return
        # un componente nuovo per l'omino
        occ = design.rootComponent.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        comp = occ.component
        comp.name = 'Omino Campo Aperto'
        costruisci_pezzi()

        # 1. i pezzi senza scala vanno subito al loro posto; quelli con la scala restano al centro per ora
        parametrico = design.designType == adsk.fusion.DesignTypes.ParametricDesignType
        base = comp.features.baseFeatures.add() if parametrico else None
        if base:
            base.startEdit()
        for p in pezzi:
            if not p['scala']:
                tbm.transform(p['forma'], matrice(p['rot'], p['pos']))
            if base:
                corpo = comp.bRepBodies.add(p['forma'], base)
            else:
                corpo = comp.bRepBodies.add(p['forma'])
            corpo.name = p['nome']
        if base:
            base.finishEdit()

        # 2. busto e pantaloncini torniti, poi schiacciati come nel gioco
        busto = tornito(comp, 'Busto', TORSO_PROFILE, W)
        scala_corpo(comp, busto, (0.7, 1, 1.18))
        pant = tornito(comp, 'Pantaloncini', SHORTS_PROFILE, W)
        scala_corpo(comp, pant, (0.8, 1, 1.2))

        # 3. scala e posto dei pezzi rimasti al centro
        for p in pezzi:
            if p['scala']:
                corpo = comp.bRepBodies.itemByName(p['nome'])
                scala_corpo(comp, corpo, p['scala'])
                corpo = comp.bRepBodies.itemByName(p['nome'])
                sposta_corpo(comp, corpo, matrice(p['rot'], p['pos']))

        # 4. colori
        colore(design, comp.bRepBodies.itemByName('Busto'), MAGLIA)
        colore(design, comp.bRepBodies.itemByName('Pantaloncini'), PANTALONCINI)
        for p in pezzi:
            corpo = comp.bRepBodies.itemByName(p['nome'])
            if corpo:
                colore(design, corpo, p['colore'])

        ui.messageBox('Omino creato: %d pezzi, alto %.2f m.\nOgni pezzo ha il suo nome nel browser: puoi modificarlo come vuoi.' % (len(pezzi) + 2, ALTEZZA))
    except Exception:
        ui.messageBox('Errore:\n{}'.format(traceback.format_exc()))
