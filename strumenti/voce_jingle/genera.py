# ============================================================
# VOCE DI JINGLE BELLS — genera la voce che canta le parole (src/audio/jingle_voce.mp3)
# Si usa solo quando si vuole rifare la voce, non serve per compilare il gioco.
# Come funziona:
# 1. espeak-ng (sintesi vocale, libera) dice ogni sillaba scritta con i fonemi inglesi;
# 2. WORLD (pyworld) separa la voce in intonazione, timbro e soffio;
# 3. l'intonazione si sostituisce con la nota della melodia (con un po' di vibrato) e la sillaba si allunga o si
#    accorcia fino alla durata della nota;
# 4. tre voci (una bassa, una media, una alta) un po' sfasate fanno il coro; si salva in mp3.
# La melodia e il tempo sono gli stessi di src/client/10_audio_music.js (132 battiti al minuto, sol maggiore).
# Uso: pip install espeakng-loader pyworld soundfile numpy ; python3 strumenti/voce_jingle/genera.py
# Serve ffmpeg per l'mp3.
# ============================================================
import ctypes, os, subprocess, sys, tempfile
import numpy as np
import pyworld, soundfile, espeakng_loader

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'src', 'audio', 'jingle_voce.mp3')
BPM = 132
SPB = 60 / BPM

# melodia [nota MIDI, battiti] e sillabe con i fonemi di espeak (tra [[ ]]), una per nota
VERSE = [(62, 1), (71, 1), (69, 1), (67, 1), (62, 3), (62, .5), (62, .5), (62, 1), (71, 1), (69, 1), (67, 1), (64, 4),
         (64, 1), (72, 1), (71, 1), (69, 1), (66, 4), (74, 1), (74, 1), (72, 1), (69, 1), (71, 4),
         (62, 1), (71, 1), (69, 1), (67, 1), (62, 4), (62, 1), (71, 1), (69, 1), (67, 1), (64, 3), (64, 1),
         (64, 1), (72, 1), (71, 1), (69, 1), (74, 1), (74, 1), (74, 1), (74, 1), (76, 1), (74, 1), (72, 1), (69, 1), (67, 4)]
VERSE_W = ('daS IN Tru: D@ snoU In @ wVn hO@s oU p@n sleI O@ D@ fi:ldz wi: goU laf IN O:l D@ weI '
           'bElz 0n b0b teIl rIN meIk IN spI rIts braIt wVt fVn It Iz tu: raId and sIN @ sleI IN s0N t@ naIt').split()
CHORUS = [(71, 1), (71, 1), (71, 2), (71, 1), (71, 1), (71, 2), (71, 1), (74, 1), (67, 1.5), (69, .5), (71, 4),
          (72, 1), (72, 1), (72, 1.5), (72, .5), (72, 1), (71, 1), (71, 1), (71, .5), (71, .5),
          (71, 1), (69, 1), (69, 1), (71, 1), (69, 2), (74, 2)]
CHORUS = CHORUS + CHORUS[:20] + [(74, 1), (74, 1), (72, 1), (69, 1), (67, 4)]
CHORUS_W = ('dZIN g@L bElz dZIN g@L bElz dZIN g@L O:l D@ weI oU wVt fVn It Iz tu: raId In @ wVn hO@s oU p@n sleI heI '
            'dZIN g@L bElz dZIN g@L bElz dZIN g@L O:l D@ weI oU wVt fVn It Iz tu: raId In @ wVn hO@s oU p@n sleI').split()
assert len(VERSE) == len(VERSE_W) == 46 and len(CHORUS) == len(CHORUS_W) == 51, (len(VERSE), len(VERSE_W), len(CHORUS), len(CHORUS_W))

# ---- espeak-ng attraverso la sua libreria (sintesi in memoria)
lib = ctypes.CDLL(espeakng_loader.get_library_path())
SR = lib.espeak_Initialize(2, 0, espeakng_loader.get_data_path().encode(), 0)   # 2 = sincrono, in memoria
CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
_buf = []
@CB
def _cb(wav, n, ev):
    if n > 0: _buf.append(np.ctypeslib.as_array(wav, shape=(n,)).copy())
    return 0
lib.espeak_SetSynthCallback(_cb)
lib.espeak_SetVoiceByName(b'en-us')
lib.espeak_SetParameter(1, 130, 0)   # velocità
def say(phonemes):
    _buf.clear()
    t = ('[[' + phonemes + ']]').encode()
    lib.espeak_Synth(t, len(t) + 1, 0, 1, 0, 0, None, None)
    lib.espeak_Synchronize()
    x = np.concatenate(_buf).astype(np.float64) / 32768 if _buf else np.zeros(100)
    # toglie il silenzio all'inizio e alla fine
    idx = np.where(np.abs(x) > 0.01)[0]
    return x[idx[0]:idx[-1] + 1] if len(idx) else x

def midi_hz(m): return 440 * 2 ** ((m - 69) / 12)

# una sillaba cantata: la voce di espeak, intonata sulla nota e lunga quanto la nota
def sing(ph, note, dur, shift, vib_phase):
    x = say(ph)
    f0, t = pyworld.harvest(x, SR, f0_floor=60, f0_ceil=500, frame_period=5)
    sp = pyworld.cheaptrick(x, f0, t, SR)
    ap = pyworld.d4c(x, f0, t, SR)
    n0 = len(f0)
    target = max(int(dur / 0.005), 8)
    voiced = f0 > 0
    # le consonanti all'inizio restano com'erano; si allunga la parte cantata (vocale) fino alla durata della nota
    first = int(np.argmax(voiced)) if voiced.any() else 0
    head = min(first, target // 3)
    idx_head = np.arange(head)
    rest = np.linspace(head, n0 - 1, max(target - head, 2))
    idx = np.concatenate([idx_head, rest]).astype(int)
    f0n, spn, apn = f0[idx].copy(), sp[idx], ap[idx]
    freq = midi_hz(note + shift)
    k = np.arange(len(idx))
    vib = 1 + 0.012 * np.sin(2 * np.pi * 5.2 * k * 0.005 + vib_phase) * np.clip((k * 0.005 - 0.18) / 0.2, 0, 1)
    # piccola salita all'attacco della nota, come una voce vera
    glide = 1 - 0.03 * np.exp(-k * 0.005 / 0.04)
    f0n = np.where(f0n > 0, freq * vib * glide, 0.0)
    # timbro adattato all'altezza (voce più chiara se più alta: si sposta un po' lo spettro)
    y = pyworld.synthesize(f0n, np.ascontiguousarray(spn), np.ascontiguousarray(apn), SR, 5)
    fade = min(len(y), int(0.03 * SR))
    y[-fade:] *= np.linspace(1, 0, fade)
    return y

def track(melody, words, shift, lag, seed):
    rng = np.random.default_rng(seed)
    total = sum(d for _, d in melody) * SPB + 2
    out = np.zeros(int(total * SR) + SR)
    t = 0.0
    for (m, d), ph in zip(melody, words):
        y = sing(ph, m, d * SPB * 0.95, shift, rng.uniform(0, 6.28))
        # la consonante parte un pochino prima del battito, così la vocale cade sul tempo
        start = int((t + lag - 0.035) * SR)
        if start < 0: y = y[-start:]; start = 0
        out[start:start + len(y)] += y[:len(out) - start]
        t += d * SPB
    return out

full_m, full_w = VERSE + CHORUS, VERSE_W + CHORUS_W
voices = [track(full_m, full_w, -12, 0.0, 1) * 1.0,    # voce bassa (maschile)
          track(full_m, full_w, -12, 0.018, 2) * 0.55,  # raddoppio un po' in ritardo (coro)
          track(full_m, full_w, 0, 0.009, 3) * 0.6]     # voce alta, un'ottava sopra
n = max(len(v) for v in voices)
mix = sum(np.pad(v, (0, n - len(v))) for v in voices)
mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.9
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
    wav = os.path.join(tmp, 'voce.wav')
    soundfile.write(wav, mix, SR)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-b:a', '64k', OUT], check=True)
print('voce ->', os.path.relpath(OUT, ROOT), round(len(mix) / SR, 1), 's,', os.path.getsize(OUT) // 1024, 'KB, inizio del ritornello a', round(sum(d for _, d in VERSE) * SPB, 3), 's')
