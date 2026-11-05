"""P843: the light-mode shell backdrop. Same glows as backdrop-842 (same places, same hue family: muted sky, apricot,
sage, butter, a grey haze), on a light warm-grey base, so light mode shows the same scene, lighter, instead of a flat
wash (P842 put the dark image under a .80 light wash, which hid it). Dark mode keeps backdrop-842.jpg.
  python scripts/make-shell-backdrop-843.py  -> public/shell/backdrop-843-light.jpg + qa/shell-843/backdrop-843-light.jpg
"""
import os
import numpy as np
from PIL import Image

W, H = 1600, 1000
BASE = np.array([229, 231, 226], float)        # light warm grey (between --sh-base and --sh-surface)
GLOWS = [  # same placement as 842; colours are the pastel side of the same hues
    (0.16, 0.12, 0.42, 0.34, (150, 182, 222), 0.70),  # sky, top left
    (0.86, 0.80, 0.46, 0.34, (232, 180, 132), 0.62),  # apricot, bottom right
    (0.10, 0.88, 0.34, 0.26, (168, 198, 150), 0.55),  # sage, bottom left
    (0.78, 0.10, 0.34, 0.24, (230, 214, 150), 0.55),  # butter, top right
    (0.50, 0.42, 0.50, 0.30, (244, 245, 242), 0.35),  # light haze, centre
]


def desat(c, k=0.2):
    c = np.array(c, float)
    return c + (c.mean() - c) * k


y, x = np.mgrid[0:H, 0:W]
fx, fy = x / W, y / W
img = np.tile(BASE, (H, W, 1))
for cx, cy, rx, ry, col, s in GLOWS:
    d2 = ((fx - cx) / rx) ** 2 + ((fy - cy * H / W) / ry) ** 2
    a = s * np.exp(-d2 * 1.6)
    img = img * (1 - a[..., None]) + desat(col)[None, None, :] * a[..., None]
img += np.random.default_rng(843).uniform(-0.5, 0.5, img.shape)
im = Image.fromarray(np.clip(img, 0, 255).round().astype('uint8'))
os.makedirs('qa/shell-843', exist_ok=True)
for p in ('public/shell/backdrop-843-light.jpg', 'qa/shell-843/backdrop-843-light.jpg'):
    im.save(p, quality=88, optimize=True, progressive=True)
a = np.asarray(im, float)
print('mean', a.mean(axis=(0, 1)).round(1), 'min', a.min(axis=(0, 1)), 'luma mean', (a @ [0.2126, 0.7152, 0.0722]).mean().round(1))
