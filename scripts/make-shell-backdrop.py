# P831: generate the agent shell's soft-focus backdrop (no photo, no licence questions). Neutral light-and-shadow
# shapes, blurred hard like an out-of-focus scene, a hint of warm/cool only, plus fine grain against banding.
#   python scripts/make-shell-backdrop.py  -> public/shell/backdrop-{dark,light}.jpg (+ option previews in qa/shell-831)
import sys
import numpy as np
from PIL import Image, ImageFilter

W, H = 1920, 1200
rng = np.random.default_rng(831)

def field(blobs):
    """Sum of soft blobs: (cx, cy, rx, ry, value) in 0..1 coords; value is lightness added."""
    y, x = np.mgrid[0:H, 0:W]
    x = x / W; y = y / H
    out = np.zeros((H, W))
    for cx, cy, rx, ry, v in blobs:
        out += v * np.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2))
    return out

def render(lum, warm, name, lo, hi, blur=60):
    """lum: 0..1 map -> lightness between lo and hi; warm: -1..1 map -> slight warm (+) / cool (-) tint."""
    L = lo + (hi - lo) * np.clip(lum, 0, 1)
    tint = 0.035 * warm
    r = L * (1 + tint); g = L * (1 + tint * 0.25); b = L * (1 - tint * 0.9)
    img = np.stack([r, g, b], -1)
    im = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8))
    im = im.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(im).astype(np.float32)
    a += rng.normal(0, 1.6, (H, W, 1))  # grain, same on all channels
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(name, quality=84, optimize=True, progressive=True)

# B, "room light": a soft window of light upper right, a dim lamp glow lower left, shadowed middle and floor.
roomB = [(.74, .1, .3, .2, 1.0), (.52, .0, .45, .12, .45), (.1, .8, .16, .12, .5), (.3, .52, .42, .26, -.35),
         (.93, .62, .1, .34, .38), (.45, .97, .6, .12, -.4), (.04, .22, .1, .32, .3), (.62, .4, .07, .3, -.3),
         (.2, .3, .1, .2, .22), (.84, .9, .16, .1, .3), (.38, .18, .12, .08, .25)]
warmB = [(.12, .78, .25, .25, .8), (.78, .12, .4, .3, -.6), (.5, .6, .4, .4, .2)]
# C, "dusk": cool light sky across the top, warm-neutral band at the middle, dark ground below (Solvik-like order).
roomC = [(.5, -.08, .9, .3, 1.0), (.22, .12, .2, .14, .45), (.8, .16, .16, .1, .35), (.72, .46, .42, .1, .55), (.86, .76, .22, .14, .3), (.18, .86, .28, .1, .22),
         (.3, .5, .3, .07, .3), (.5, .92, .9, .22, -.45), (.1, .66, .12, .18, .25), (.55, .3, .06, .2, -.25),
         (.92, .6, .08, .14, .25)]
warmC = [(.5, .0, .9, .3, -.9), (.6, .48, .6, .12, .9)]

def make(blobs, warm, prefix, out_dir):
    lum = field(blobs); w = np.clip(field(warm), -1, 1)
    lum = (lum - lum.min()) / (lum.max() - lum.min())
    lum = lum ** 1.35  # deep shadows, brighter lights
    render(lum, w, f'{out_dir}/{prefix}-dark.jpg', 0.03, 0.50, 40)
    render(lum, w, f'{out_dir}/{prefix}-light.jpg', 0.66, 0.92, 40)

if __name__ == '__main__':
    qa = sys.argv[1] if len(sys.argv) > 1 else 'qa/shell-831'
    make(roomB, warmB, f'{qa}/option-b-room', '.')
    make(roomC, warmC, f'{qa}/option-c-dusk', '.')
