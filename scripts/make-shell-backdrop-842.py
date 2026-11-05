"""P842: the shell backdrop as a soft multi-hue "blurred photo" (DESIGN.md v17, P842 update). No photo, no download:
mostly near-black with several large, low-saturation glows from the shell palette family (a muted sky blue, a warm
apricot, a faint sage, a butter haze and a lighter grey haze), each a wide Gaussian so there are no edges. A sub-1
level dither stops banding without visible grain. Light mode uses the same image under a light wash (index.css P842).
  python scripts/make-shell-backdrop-842.py  -> public/shell/backdrop-842.jpg + qa/shell-842/backdrop-842.jpg
"""
import numpy as np
from PIL import Image

W, H = 1600, 1000
BASE = np.array([11, 12, 14], float)          # near-black, a touch cool
# centre x, centre y (fractions), radius x, radius y (fractions of width), colour, strength
GLOWS = [
    (0.16, 0.12, 0.42, 0.34, (64, 92, 132), 0.62),   # muted sky, top left
    (0.86, 0.80, 0.46, 0.34, (150, 98, 58), 0.52),   # warm apricot, bottom right
    (0.10, 0.88, 0.34, 0.26, (78, 104, 70), 0.38),   # faint sage, bottom left
    (0.78, 0.10, 0.34, 0.24, (140, 124, 72), 0.34),  # butter haze, top right
    (0.50, 0.42, 0.50, 0.30, (120, 124, 130), 0.20), # lighter grey haze, centre
]


def desat(c, k=0.35):
    c = np.array(c, float)
    g = c.mean()
    return c + (g - c) * k


y, x = np.mgrid[0:H, 0:W]
fx, fy = x / W, y / W  # same unit both ways so glows are round, not stretched
img = np.tile(BASE, (H, W, 1))
for cx, cy, rx, ry, col, s in GLOWS:
    d2 = ((fx - cx) / rx) ** 2 + ((fy - cy * H / W) / ry) ** 2
    a = s * np.exp(-d2 * 1.6)
    img = img * (1 - a[..., None]) + desat(col)[None, None, :] * a[..., None]
rng = np.random.default_rng(842)
img += rng.uniform(-0.5, 0.5, img.shape)
im = Image.fromarray(np.clip(img, 0, 255).round().astype('uint8'))
for p in ('public/shell/backdrop-842.jpg', 'qa/shell-842/backdrop-842.jpg'):
    im.save(p, quality=88, optimize=True, progressive=True)
a = np.asarray(im, float)
print('mean', a.mean(axis=(0, 1)).round(1), 'max', a.max(axis=(0, 1)), 'luma mean', (a @ [0.2126, 0.7152, 0.0722]).mean().round(1))
