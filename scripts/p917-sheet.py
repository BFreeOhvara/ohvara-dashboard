# P917: one contact sheet per run: every frame the check saved, scaled to 440 px wide, 3 across, labelled.
# python scripts/p917-sheet.py <dir> <prefix> <out.png>
import sys, os
from PIL import Image, ImageDraw
d, prefix, out = sys.argv[1:4]
files = sorted(f for f in os.listdir(d) if f.startswith(prefix) and f.endswith('.png') and 'sheet' not in f)
W, cols = 440, 3
tiles = []
for f in files:
    im = Image.open(os.path.join(d, f)).convert('RGB')
    im = im.resize((W, max(1, int(im.height * W / im.width))))
    tiles.append((f[len(prefix):].lstrip('-').replace('.png', ''), im))
rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
H = sum(max(t[1].height for t in r) + 22 for r in rows)
sheet = Image.new('RGB', (cols * (W + 8) + 8, H + 8), (30, 30, 30))
draw = ImageDraw.Draw(sheet)
y = 8
for r in rows:
    x = 8
    for label, im in r:
        draw.text((x, y), label, fill=(235, 235, 235))
        sheet.paste(im, (x, y + 16))
        x += W + 8
    y += max(t[1].height for t in r) + 22
sheet.save(out)
print(out, sheet.size, len(tiles))
