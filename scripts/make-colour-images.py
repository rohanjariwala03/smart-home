# Generates assets/images/colour-wheel.png (hue around, white at the centre, like HA's hs_color) and
# assets/images/white-strip.png (2000 K → 9000 K). Pure stdlib; rerun if the sizes change.
import colorsys, math, struct, zlib

def png(path, w, h, pixel):
    rows = b''.join(b'\x00' + b''.join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))

def kelvin(k):  # Tanner Helland's approximation, also in src/components/light-colour.tsx
    t = k / 100
    r = 255 if t <= 66 else 329.698727446 * (t - 60) ** -0.1332047592
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255 if t >= 66 else 0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    return [max(0, min(255, round(c))) for c in (r, g, b)]

S = 600
def wheel(x, y):
    dx, dy = x + 0.5 - S / 2, y + 0.5 - S / 2
    d = math.hypot(dx, dy) / (S / 2)
    hue = (math.degrees(math.atan2(dy, dx)) + 360) % 360
    r, g, b = colorsys.hsv_to_rgb(hue / 360, min(d, 1), 1)
    return [round(r * 255), round(g * 255), round(b * 255), round(255 * max(0, min(1, (1 - d) * S / 2)))]

png('assets/images/colour-wheel.png', S, S, wheel)
png('assets/images/white-strip.png', 600, 1, lambda x, y: kelvin(2000 + 7000 * x / 599) + [255])
