# Makes the iPad's Halloween sounds in assets/sounds/ (macOS only: say, afconvert; pure stdlib otherwise).
#
#   python3 scripts/make-halloween-sounds.py <folder with the .ogg files below>
#
# Effects: CC0 (public domain) recordings from OpenGameArt.org, trimmed, given an outdoor echo and levelled:
#   laugh-evil-1_0.ogg        https://opengameart.org/content/evil-laugh        (AntumDeluge)
#   evil_laugh_02_0.ogg       https://opengameart.org/content/evil-laugh-2      (AntumDeluge)
#   witch_cackle-1_0.ogg      https://opengameart.org/content/witch-cackle
#   monsters-snarls-3_0.ogg   https://opengameart.org/content/monster-snarls    (Darsycho)
#   monster-snarl-attack.ogg  https://opengameart.org/content/monster-snarls    (Darsycho)
#   monster-snarls_0.ogg      https://opengameart.org/content/monster-snarls    (Darsycho)
#   monster-snarl-5.ogg       https://opengameart.org/content/monster-snarls    (Darsycho)
#   creaky_door_hinge.wav     https://opengameart.org/content/creaky-door-hinge-spooky
#   scaryhighpitchedghost_0.ogg https://opengameart.org/content/scary-high-pitched-ghost
#   screams_0.ogg             https://opengameart.org/node/131040               (WuxiaScrub)
#   ambient_horror_0.ogg      https://opengameart.org/content/ambient-horror    (techiew)
# Thunder and the heartbeat are synthesised here.
# Spoken lines: a deep voice and a whisper together, with a long echo. Keep LINES in step with src/automations.ts.
import math, os, random, struct, subprocess, sys, tempfile, wave

RATE = 44100
OUT = 'assets/sounds'
LINES = ['I… see… you.', 'Come closer…', 'Take one… if you dare.', 'Happy Halloween!']
EFFECTS = {  # name: (source file, seconds kept at most, echo)
    'evil_laugh': ('laugh-evil-1_0.ogg', 4.5, True),
    'evil_laugh_2': ('evil_laugh_02_0.ogg', 4.5, True),
    'witch_cackle': ('witch_cackle-1_0.ogg', 4.5, True),
    'monster_growl': ('monsters-snarls-3_0.ogg', 4.5, True),
    'monster_snarl': ('monster-snarl-attack.ogg', 4.5, True),
    'monster_roar': ('monster-snarls_0.ogg', 4.5, True),
    'monster_breath': ('monster-snarl-5.ogg', 4.5, True),
    'creaky_door': ('creaky_door_hinge.wav', 4.5, True),
    'ghost': ('scaryhighpitchedghost_0.ogg', 5, False),
    'scream': ('screams_0.ogg', 3, True),
    'haunted_choir': ('ambient_horror_0.ogg', 5, False),
}
OUTDOOR = ((0.21, 0.4), (0.43, 0.22), (0.68, 0.1))
CAVE = ((0.12, 0.5), (0.29, 0.35), (0.47, 0.25), (0.71, 0.15), (0.97, 0.08))


def read(path):
    """Any audio file → mono samples at RATE, -1…1."""
    tmp = os.path.join(tempfile.gettempdir(), 'halloween-in.wav')
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{RATE}', '-c', '1', path, tmp], check=True)
    data = open(tmp, 'rb').read()  # afconvert writes WAVE_FORMAT_EXTENSIBLE, which `wave` can't read
    at = data.index(b'data') + 8
    raw = data[at:at + struct.unpack('<I', data[at - 4:at])[0]]
    return [v / 32768 for v in struct.unpack(f'<{len(raw) // 2}h', raw)]


def loudest(x, seconds):
    """The loudest stretch of `seconds` (by energy), faded in and out."""
    n = int(seconds * RATE)
    if len(x) > n:
        hop, best, at = RATE // 10, -1.0, 0
        for i in range(0, len(x) - n, hop):
            e = sum(v * v for v in x[i:i + n:8])
            if e > best:
                best, at = e, i
        x = x[at:at + n]
    fade = int(0.15 * RATE)
    return [v * min(1, i / fade, (len(x) - i) / fade) for i, v in enumerate(x)]


def echo(x, taps):
    y = x + [0.0] * int(RATE * taps[-1][0] + 1)
    for d, g in taps:
        n = int(RATE * d)
        for i, v in enumerate(x):
            y[i + n] += v * g
    return y


def noise_rumble(seconds, smooth, seed):
    random.seed(seed)
    y, out = 0.0, []
    for _ in range(int(seconds * RATE)):
        y += smooth * (random.uniform(-1, 1) - y)
        out.append(y)
    return out


def thunder():
    """A close crack, then a rolling rumble that dies away."""
    L = 6.0
    crack, rumble = noise_rumble(L, 0.5, 1), noise_rumble(L, 0.004, 2)
    rolls = [(0.0, 1.0), (0.6, 0.7), (1.3, 0.9), (2.2, 0.5), (3.1, 0.35)]
    out = []
    for i in range(int(L * RATE)):
        t = i / RATE
        roll = sum(g * math.exp(-max(0, t - at) * 1.6) * (t >= at) for at, g in rolls)
        out.append(0.5 * crack[i] * math.exp(-t * 9) + 14 * rumble[i] * roll * min(1, t / 0.05))
    return out


def heartbeat():
    """Lub-dub, getting faster: 70 to 130 beats a minute over 7 s."""
    L, out, t = 7.0, [0.0] * int(7.0 * RATE), 0.2
    while t < L - 0.5:
        bpm = 70 + 60 * t / L
        for at, level in ((t, 1.0), (t + 0.16, 0.6)):
            for j in range(int(0.18 * RATE)):
                s = j / RATE
                out[int(at * RATE) + j] += level * math.exp(-s * 28) * math.sin(2 * math.pi * (48 + 30 * math.exp(-s * 40)) * s)
        t += 60 / bpm
    return out


def save(name, x):
    peak = max(abs(v) for v in x) or 1
    tmp = os.path.join(tempfile.gettempdir(), name + '.wav')
    with wave.open(tmp, 'wb') as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(v / peak * 0.95 * 32767)) for v in x))
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '96000', tmp, f'{OUT}/{name}.m4a'], check=True)


def say(voice, rate, text):
    tmp = os.path.join(tempfile.gettempdir(), 'halloween-say.aiff')
    subprocess.run(['say', '-v', voice, '-r', str(rate), '-o', tmp, text], check=True)
    return read(tmp)


def line(text):
    deep = say('Ralph', 105, f'[[pbas 15]] {text}')
    whisper = say('Whisper', 105, text)
    lag = int(0.05 * RATE)
    mix = [0.0] * max(len(deep), len(whisper) + lag)
    for i, v in enumerate(deep):
        mix[i] += v
    for i, v in enumerate(whisper):
        mix[i + lag] += 0.8 * v
    return echo(mix, CAVE)


src = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
for name in os.listdir(OUT):
    os.remove(os.path.join(OUT, name))
for name, (file, seconds, outdoor) in EFFECTS.items():
    x = loudest(read(os.path.join(src, file)), seconds)
    save(name, echo(x, OUTDOOR) if outdoor else x)
save('thunder', thunder())
save('heartbeat', heartbeat())
for i, text in enumerate(LINES):
    save(f'line{i}', line(text))
