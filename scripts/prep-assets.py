"""One-off asset prep. Reads brand/, writes src/assets/. Run: python -I scripts/prep-assets.py"""
import os, sys
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'LOGO TXSCOPE PNG...png')  # RGBA, colortype 6, 96.2% fully transparent, matte is pure black
OUT = os.path.join(ROOT, 'src', 'assets')
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert('RGBA')
a = np.array(im)
alpha = a[..., 3]
ys, xs = np.where(alpha > 0)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
print('glyph bbox', x0, y0, x1, y1)

# square crop around the glyph with 8% breathing room
side = int(max(x1 - x0, y1 - y0) * 1.16)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
l, t = cx - side // 2, cy - side // 2
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
sq.paste(im.crop((max(l, 0), max(t, 0), min(l + side, 2000), min(t + side, 2000))), (max(-l, 0), max(-t, 0)))

def resize_premul(img, n):
    # transparent texels are RGB (0,0,0): straight-alpha resize would drag black into the edge. Premultiply first.
    return img.convert('RGBa').resize((n, n), Image.LANCZOS).convert('RGBA')

resize_premul(sq, 512).save(os.path.join(OUT, 'logo-512.png'), optimize=True)
resize_premul(sq, 128).save(os.path.join(OUT, 'logo-128.png'), optimize=True)

# apple touch icon: opaque, glyph on the cream sampled from the reference slides
cream = (0xf6, 0xf3, 0xec)
tile = Image.new('RGBA', (180, 180), cream + (255,))
g = resize_premul(sq, 140)
tile.alpha_composite(g, (20, 20))
tile.convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)

# favicon: trace the real alpha grid
mask = (np.array(sq)[..., 3] > 127).astype(np.uint8) * 255
cnts, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
scale = 30.0 / side  # 1px margin inside the 32 box
def pt(p):
    return '%g %g' % (round(p[0] * scale + 1, 2), round(p[1] * scale + 1, 2))
d = []
for c in cnts:
    if cv2.contourArea(c) < 40:
        continue
    ap = cv2.approxPolyDP(c, 0.9, True)[:, 0, :]
    d.append('M' + 'L'.join(pt(p) for p in ap) + 'Z')
opaque = np.array(sq)
opaque = opaque[opaque[..., 3] == 255][:, :3]
fill = '#fd5901'  # real pixel at (476,568); median of opaque px is #fd5a01, within 1 step
print('favicon fill', fill, 'subpaths', len(d))
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
       '<path fill="%s" fill-rule="evenodd" d="%s"/></svg>\n') % (fill, ''.join(d))
assert '--' not in svg
open(os.path.join(OUT, 'favicon.svg'), 'w', newline='\n').write(svg)

# provenance: snap palette to real pixel coordinates
def snap(path, rgb, label):
    arr = np.array(Image.open(path).convert('RGB')).astype(int)
    dd = ((arr - np.array(rgb)) ** 2).sum(-1)
    y, x = np.unravel_index(dd.argmin(), dd.shape)
    print('%-12s %s -> #%02x%02x%02x at x=%d y=%d  (%s)' % (label, '#%02x%02x%02x' % rgb, *arr[y, x], x, y, os.path.basename(path)))
R = os.path.join(ROOT, 'reference')
B = os.path.join(ROOT, 'brand')
snap(os.path.join(B, 'LOGO TXSCOPE PNG...png'), (0xfd, 0x59, 0x01), 'orange')
snap(os.path.join(R, 'TXSCOPE 1.jpg.jpeg'), (0xf5, 0xf2, 0xec), 'cream')
snap(os.path.join(R, 'TXSCOPE 1.jpg.jpeg'), (0x02, 0x01, 0x01), 'ink')
snap(os.path.join(R, 'SAMPUL TXSCOPE JPG.jpg.jpeg'), (0x10, 0x0a, 0x07), 'ink-warm')
snap(os.path.join(R, 'TXSCOPE 1.jpg.jpeg'), (0x57, 0x55, 0x50), 'grey')
snap(os.path.join(R, 'TXSCOPE 1.jpg.jpeg'), (0xbc, 0xba, 0xb6), 'grey-line')
snap(os.path.join(R, 'SAMPUL TXSCOPE JPG.jpg.jpeg'), (0xe4, 0xc9, 0xad), 'sand')
snap(os.path.join(R, 'SAMPUL TXSCOPE JPG.jpg.jpeg'), (0xef, 0x9c, 0x5b), 'amber')
snap(os.path.join(R, 'SAMPUL TXSCOPE JPG.jpg.jpeg'), (0x41, 0x27, 0x1a), 'umber')
snap(os.path.join(R, 'TXSCOPE 1.jpg.jpeg'), (0xf9, 0xbe, 0x9c), 'peach')
