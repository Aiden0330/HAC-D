import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
# v4: (image name, capture name, crop box (left, top, right, bottom) at 1280 px width; bottom None = full height)
crops = [
    ('projects', 'projects', (0, 0, 1280, 1000)),
    ('topology', 'topology', (0, 0, 1280, 1700)),
    ('topology-picture', 'topology-picture', (380, 300, 1280, None)),
    ('reliability', 'reliability', (380, 300, 1280, 2300)),
    ('mechanisms', 'mechanisms', (0, 0, 1280, 1750)),
    ('allocation', 'allocation', (0, 100, 1280, None)),
    ('allocation-report', 'allocation-report', (0, 100, 1280, 1500)),
    ('library', 'library', (0, 0, 1280, 1300)),
    ('compare', 'compare', (0, 0, 1280, 1250)),
    ('simulate', 'simulate', (0, 0, 1280, 1500)),
    ('review', 'review', (0, 0, 1280, 1900)),
    ('sensitivity', 'sensitivity', (0, 0, 1280, 1300)),
    ('import', 'import', (0, 0, 1280, 1500)),
]
for name, cap, (l, t, r, b) in crops:
    im = Image.open(os.path.join(src, f'{cap}-desktop-light.png')).convert('RGB')
    w, h = im.size
    im = im.crop((l, t, min(r, w), min(h, b) if b else h))
    width = 1000 if im.size[0] >= 1000 else im.size[0]
    im = im.resize((width, int(im.size[1] * width / im.size[0])), Image.LANCZOS)
    p = os.path.join(out, f'{name}.jpg')
    im.save(p, 'JPEG', quality=82, optimize=True)
    print(name, im.size, os.path.getsize(p))
# mobile example: the topology page at 375 px, top 1400 px
im = Image.open(os.path.join(src, 'topology-mobile-light.png')).convert('RGB')
w, h = im.size
im = im.crop((0, 0, w, min(h, 1400)))
p = os.path.join(out, 'topology-mobile.jpg')
im.save(p, 'JPEG', quality=82, optimize=True)
print('topology-mobile', im.size, os.path.getsize(p))
