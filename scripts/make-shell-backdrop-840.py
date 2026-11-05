"""P840: pre-blurred landscape backdrops for the agent shell (DESIGN.md v17, P840 update).
Sources (Unsplash License, free to use, credited here):
  a-dusk-field      "Sky at dusk over a grassy field", Alexandra (@alexandra_p_d), unsplash.com/photos/JoR0ukR1ecU
  b-hills-sunset    "Hills landscape during sunset", unsplash.com/photos/A1l1IbZlmFs
  c-clouds-horizon  "Dark clouds over orange horizon", Benjamin Chambon (@benjamin_chambon), unsplash.com/photos/JYUTOTO6TH4
Each is cropped to cover 1200x896, blurred heavily (no grain) and saved as a ~1200px JPG.
  python scripts/make-shell-backdrop-840.py   -> qa/shell-840/backdrop-<name>.jpg + sheet; the chosen one is copied
  to public/shell/backdrop-photo.jpg by hand.
"""
import glob, os
from PIL import Image, ImageFilter, ImageOps

W, H = 1200, 896
SRC = 'qa/shell-840/backdrop-src'
out = []
for f in sorted(glob.glob(f'{SRC}/*.jpg')):
    name = os.path.splitext(os.path.basename(f))[0]
    im = ImageOps.fit(Image.open(f).convert('RGB'), (W, H), Image.LANCZOS)
    small = im.resize((W // 4, H // 4), Image.LANCZOS).filter(ImageFilter.GaussianBlur(14))
    im = small.resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(10))
    p = f'qa/shell-840/backdrop-{name}.jpg'
    im.save(p, quality=86, optimize=True, progressive=True)
    bands = [im.crop((0, int(H * a), W, int(H * b))).resize((1, 1), Image.BOX).getpixel((0, 0)) for a, b in ((0, .25), (.375, .625), (.75, 1))]
    print(name, os.path.getsize(p) // 1024, 'KB', 'top/mid/bottom', bands)
    out.append(im)
sheet = Image.new('RGB', (W // 2 * len(out) + 20 * (len(out) - 1), H // 2), (20, 20, 20))
for i, im in enumerate(out):
    sheet.paste(im.resize((W // 2, H // 2)), (i * (W // 2 + 20), 0))
sheet.save('qa/shell-840/backdrop-options.jpg', quality=82)
