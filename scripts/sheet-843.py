"""P843: contact sheets of qa/shell-843 shots + one strip image per stretch flight (frames stacked, ms labels)."""
import glob, os, re
from PIL import Image, ImageDraw
OUT = 'qa/shell-843'

def sheet(names, out, cols, w):
    ims = [Image.open(f'{OUT}/{n}.png').convert('RGB') for n in names if os.path.exists(f'{OUT}/{n}.png')]
    ims = [im.resize((w, int(im.height * w / im.width))) for im in ims]
    h = max(im.height for im in ims)
    rows = (len(ims) + cols - 1) // cols
    s = Image.new('RGB', (cols * w + (cols + 1) * 8, rows * (h + 26) + 8), (40, 40, 40))
    d = ImageDraw.Draw(s)
    for i, (im, n) in enumerate(zip(ims, names)):
        x, y = 8 + (i % cols) * (w + 8), 8 + (i // cols) * (h + 26)
        d.text((x, y), n, fill=(230, 230, 230))
        s.paste(im, (x, y + 16))
    s.save(f'{OUT}/{out}', quality=85)

pages = ['overview', 'clients', 'activity', 'settings', 'submit', 'notifications', 'search']
for t in ('dark', 'light'):
    sheet([f'{p}-1440-{t}' for p in pages] + [f'menu-1440-{t}'], f'sheet-1440-{t}.jpg', 4, 640)
    sheet([f'{p}-390-{t}' for p in pages], f'sheet-390-{t}.jpg', 7, 260)
sheet(['submit-step2-1440-dark', 'submit-review-1440-dark', 'submit-done-1440-dark'], 'sheet-submit.jpg', 3, 640)

for name in sorted({re.sub(r'-(\d+|end)\.png$', '', os.path.basename(f)) for f in glob.glob(f'{OUT}/stretch/*.png')}):
    fr = sorted(glob.glob(f'{OUT}/stretch/{name}-[0-9]*.png')) + [f'{OUT}/stretch/{name}-end.png']
    ims = [Image.open(f).convert('RGB') for f in fr]
    W = max(i.width for i in ims) + 70
    s = Image.new('RGB', (W, sum(i.height + 4 for i in ims)), (24, 24, 24))
    d = ImageDraw.Draw(s); y = 0
    for f, im in zip(fr, ims):
        m = re.search(r'-(\d+|end)\.png$', f).group(1)
        d.text((6, y + im.height // 2 - 6), 'end' if m == 'end' else f'{int(m)}ms', fill=(220, 220, 220))
        s.paste(im, (64, y)); y += im.height + 4
    s.save(f'{OUT}/stretch-{name}.png')
print('ok')
