"""P841: warm pre-blurred backdrops with no blue (DESIGN.md v17, P841 update). Built from the two Unsplash-License
photos already downloaded for P840 (credited in scripts/make-shell-backdrop-840.py), no new downloads:
  a-warm-hills    "Hills landscape during sunset", whole frame
  b-desert-dusk   the same photo, cropped to the glowing cloud band over the ridge
  c-ember-horizon "Dark clouds over orange horizon" (Benjamin Chambon), cropped to the lit horizon
Each is gradient-mapped onto an amber / rust / earth ramp by brightness (so no pixel can be blue), then blurred the
same way as P840 (quarter size, Gaussian 14, back up, Gaussian 10) and saved as a ~1200px JPG.
  python scripts/make-shell-backdrop-841.py  -> qa/shell-841/backdrop-<name>.jpg + backdrop-options.jpg; the chosen
  one is copied to public/shell/backdrop-photo.jpg by hand.
"""
import os
from PIL import Image, ImageFilter, ImageOps

W, H = 1200, 896
SRC = 'qa/shell-840/backdrop-src'
OUT = 'qa/shell-841'
# name, source, crop box as fractions (l, t, r, b), ramp stops (brightness 0..1 -> colour)
OPTS = [
    ('a-warm-hills', 'b-hills-sunset', (0, 0, 1, 1), [(0, (22, 15, 10)), (.35, (78, 44, 26)), (.62, (150, 86, 46)), (1, (232, 170, 108))]),
    ('b-desert-dusk', 'b-hills-sunset', (0, .12, 1, .78), [(0, (34, 22, 14)), (.3, (102, 58, 32)), (.6, (182, 106, 56)), (1, (240, 196, 142))]),
    ('c-ember-horizon', 'c-clouds-horizon', (0, .5, 1, 1), [(0, (16, 11, 8)), (.35, (70, 38, 22)), (.65, (164, 88, 44)), (1, (226, 150, 86))]),
]


def ramp(stops):
    lut = []
    for v in range(256):
        x = v / 255
        for (a, ca), (b, cb) in zip(stops, stops[1:]):
            if a <= x <= b:
                t = (x - a) / (b - a)
                lut.append(tuple(round(ca[i] + (cb[i] - ca[i]) * t) for i in range(3)))
                break
    return lut


out = []
for name, src, (l, t, r, b), stops in OPTS:
    im = Image.open(f'{SRC}/{src}.jpg').convert('RGB')
    w, h = im.size
    im = im.crop((int(l * w), int(t * h), int(r * w), int(b * h)))
    im = ImageOps.fit(im, (W, H), Image.LANCZOS)
    g = ImageOps.autocontrast(im.convert('L'), cutoff=1)
    lut = ramp(stops)
    im = Image.merge('RGB', [g.point([c[i] for c in lut]) for i in range(3)])
    small = im.resize((W // 4, H // 4), Image.LANCZOS).filter(ImageFilter.GaussianBlur(14))
    im = small.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(10))
    p = f'{OUT}/backdrop-{name}.jpg'
    im.save(p, quality=86, optimize=True, progressive=True)
    blue = sum(1 for px in im.resize((300, 224)).getdata() if px[2] > px[0])
    bands = [im.crop((0, int(H * a), W, int(H * b))).resize((1, 1), Image.BOX).getpixel((0, 0)) for a, b in ((0, .25), (.375, .625), (.75, 1))]
    print(name, os.path.getsize(p) // 1024, 'KB', 'blue px', blue, 'top/mid/bottom', bands)
    out.append(im)
sheet = Image.new('RGB', (W // 2 * len(out) + 20 * (len(out) - 1), H // 2), (20, 20, 20))
for i, im in enumerate(out):
    sheet.paste(im.resize((W // 2, H // 2)), (i * (W // 2 + 20), 0))
sheet.save(f'{OUT}/backdrop-options.jpg', quality=82)
