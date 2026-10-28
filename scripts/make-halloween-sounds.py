# Makes the iPad's Halloween sounds in assets/sounds/: three effects synthesised here (named after the Alexa sounds
# they stand in for) and the spoken lines in a deep, slow macOS voice with an echo. macOS only (say, afconvert);
# pure stdlib otherwise. Rerun after changing LINES (keep them in step with LINES in src/automations.ts).
import math, os, random, struct, subprocess, tempfile, wave

RATE = 22050
OUT = 'assets/sounds'
LINES = ['Happy Halloween!', 'Trick or treat!', 'Take one… if you dare.', 'Welcome, little monsters.']
random.seed(31)


def echo(x, taps=((0.18, 0.45), (0.37, 0.25), (0.6, 0.12))):
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
        w.writeframes(b''.join(struct.pack('<h', int(v / peak * 0.89 * 32767)) for v in x))
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '64000', tmp, f'{OUT}/{name}.m4a'], check=True)


def tone(freq, seconds, harmonics, env):
    """A voice-like tone: `freq(t)` in Hz, `env(t)` 0–1, harmonics as (multiple, level)."""
    phase, out = 0.0, []
    for i in range(int(seconds * RATE)):
        t = i / RATE
        phase += 2 * math.pi * freq(t) / RATE
        out.append(env(t) * sum(level * math.sin(k * phase) for k, level in harmonics))
    return out


def lowpass_noise(seconds, smooth):
    y, out = 0.0, []
    for _ in range(int(seconds * RATE)):
        y += smooth * (random.uniform(-1, 1) - y)
        out.append(y)
    return out


def ramp(t, a, b):  # 0 before a, 1 after b, smooth between
    return 0 if t <= a else 1 if t >= b else 0.5 - 0.5 * math.cos(math.pi * (t - a) / (b - a))


def wolf():  # amzn_sfx_wolf_howl_02
    L = 3.4
    f = lambda t: 300 + 240 * ramp(t, 0, 0.7) + 30 * ramp(t, 0.7, 2.4) - 190 * ramp(t, 2.5, L) + 10 * math.sin(2 * math.pi * 5.5 * t) * ramp(t, 0.6, 1.0)
    env = lambda t: ramp(t, 0, 0.35) * (1 - ramp(t, 2.6, L))
    x = tone(f, L, [(1, 1), (2, 0.45), (3, 0.2), (4, 0.08)], env)
    breath = lowpass_noise(L, 0.3)
    return echo([v + 0.06 * b * env(i / RATE) for i, (v, b) in enumerate(zip(x, breath))])


def creak():  # squeaky_12: a door's stick-slip creak, then it bangs shut
    L, out = 2.9, [0.0] * int(2.9 * RATE)
    t, rate = 0.05, 30.0
    while t < 2.3:
        rate = min(85, max(18, rate + random.uniform(-6, 6) + (55 - rate) * 0.04))
        amp = 0.4 + 0.6 * math.sin(math.pi * t / 2.3) * random.uniform(0.7, 1)
        f1 = 650 + rate * 6
        for j in range(int(0.012 * RATE)):
            s = j / RATE
            v = amp * math.exp(-s * 450) * (math.sin(2 * math.pi * f1 * s) + 0.5 * math.sin(2 * math.pi * 2.1 * f1 * s))
            i = int(t * RATE) + j
            if i < len(out):
                out[i] += v
        t += 1 / rate
    thud = lowpass_noise(0.5, 0.08)
    for j, n in enumerate(thud):
        s = j / RATE
        out[int(2.35 * RATE) + j] += 1.6 * math.exp(-s * 12) * (math.sin(2 * math.pi * 55 * s) + 2 * n)
    return echo(out, ((0.11, 0.3), (0.23, 0.15)))


def ghost():  # horror_10: a moaning "ooooo" over wind
    L = 4.0
    f = lambda t: 170 + 90 * math.sin(math.pi * t / L) + 9 * math.sin(2 * math.pi * 4 * t) - 40 * ramp(t, 3.0, L)
    env = lambda t: ramp(t, 0, 0.8) * (1 - ramp(t, 3.0, L)) * (0.75 + 0.25 * math.sin(2 * math.pi * 0.7 * t))
    moan = tone(f, L, [(1, 1), (2, 0.25), (3, 0.06)], env)
    wind = lowpass_noise(L, 0.02)
    return echo([m + 1.8 * w * (0.4 + 0.6 * math.sin(math.pi * i / RATE / L)) for i, (m, w) in enumerate(zip(moan, wind))],
                ((0.25, 0.5), (0.5, 0.3), (0.75, 0.15)))


def line(i, text):
    tmp = os.path.join(tempfile.gettempdir(), f'line{i}-voice.wav')
    subprocess.run(['say', '-v', 'Ralph', '-r', '125', '-o', tmp, '--file-format=WAVE', f'--data-format=LEI16@{RATE}',
                    f'[[pbas 22]] {text}'], check=True)
    with wave.open(tmp) as w:
        raw = w.readframes(w.getnframes())
    return echo([v / 32768 for v in struct.unpack(f'<{len(raw) // 2}h', raw)])


os.makedirs(OUT, exist_ok=True)
save('amzn_sfx_wolf_howl_02', wolf())
save('squeaky_12', creak())
save('horror_10', ghost())
for i, text in enumerate(LINES):
    save(f'line{i}', line(i, text))
