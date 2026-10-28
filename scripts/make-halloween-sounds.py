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
# Spoken lines: a deep voice and a whisper together, with a long echo. Keep LINES in step with src/automations.ts.
import os, struct, subprocess, sys, tempfile, wave

RATE = 44100
OUT = 'assets/sounds'
LINES = ['I… see… you.', 'Come closer…', 'Take one… if you dare.', 'Happy Halloween!']
EFFECTS = {  # name: (source file, seconds kept at most)
    'evil_laugh': ('laugh-evil-1_0.ogg', 4.5),
    'evil_laugh_2': ('evil_laugh_02_0.ogg', 4.5),
    'witch_cackle': ('witch_cackle-1_0.ogg', 4.5),
    'monster_growl': ('monsters-snarls-3_0.ogg', 4.5),
    'monster_snarl': ('monster-snarl-attack.ogg', 4.5),
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
for name, (file, seconds) in EFFECTS.items():
    save(name, echo(loudest(read(os.path.join(src, file)), seconds), OUTDOOR))
for i, text in enumerate(LINES):
    save(f'line{i}', line(text))
