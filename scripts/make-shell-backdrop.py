# P831: generate the agent shell's soft-focus backdrop (no photo, no licence questions). Neutral light-and-shadow
# shapes, blurred hard like an out-of-focus scene, a hint of warm/cool only.
# P834: no grain (it read as TV static). Everything is computed in float and only rounded at the end with a
# sub-step dither (+-0.5 of one level), which hides banding without any visible speckle. Light range dimmed.
#   python scripts/make-shell-backdrop.py --ship  -> public/shell/backdrop-{dark,light}.jpg (option C, "dusk")
#   python scripts/make-shell-backdrop.py [qa-dir] -> option previews
import sys
import numpy as np
from PIL import Image

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

def box(a, r, axis):
    """Box blur of radius r along one axis (edges held)."""
    pad = [(0, 0)] * a.ndim; pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
    hi = np.take(c, range(2 * r + 1, c.shape[axis]), axis=axis); lo = np.take(c, range(0, c.shape[axis] - 2 * r - 1), axis=axis)
    return (hi - lo) / (2 * r + 1)

def soft(a, sigma):
    """Three box passes per axis ~ a Gaussian of this sigma, all in float."""
    r = max(1, int(round((np.sqrt(4 * sigma * sigma + 1) - 1) / 2)))
    for axis in (0, 1):
        for _ in range(3):
            a = box(a, r, axis)
    return a

def render(lum, warm, name, lo, hi, blur=40):
    """lum: 0..1 map -> lightness between lo and hi; warm: -1..1 map -> slight warm (+) / cool (-) tint."""
    L = lo + (hi - lo) * np.clip(lum, 0, 1)
    tint = 0.035 * warm
    r = L * (1 + tint); g = L * (1 + tint * 0.25); b = L * (1 - tint * 0.9)
    a = np.stack([soft(c * 255, blur) for c in (r, g, b)], -1)  # soft focus in float: no 8-bit steps before the blur
    a += rng.uniform(-0.5, 0.5, (H, W, 1))  # sub-step dither: hides banding, nothing visible
    Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8)).save(name, quality=92, subsampling=0, optimize=True, progressive=True)

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
    render(lum, w, f'{prefix}-dark.jpg', 0.03, 0.50, 40)
    render(lum, w, f'{prefix}-light.jpg', 0.62, 0.86, 40)  # P834: dimmer, never near white

if __name__ == '__main__':
    if '--ship' in sys.argv:
        make(roomC, warmC, 'public/shell/backdrop', '.')
    else:
        qa = sys.argv[1] if len(sys.argv) > 1 else 'qa/shell-831'
        make(roomB, warmB, f'{qa}/option-b-room', '.')
        make(roomC, warmC, f'{qa}/option-c-dusk', '.')
