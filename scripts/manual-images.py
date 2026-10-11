import sys, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
# (name, crop bottom in px at 1280 width)
crops = {'scenario': 1700, 'training': 1900, 'mechanisms': 1750, 'allocation': 1700, 'compare': 1250, 'simulate': 1500, 'report': 1900, 'import': 1500}
for name, bottom in crops.items():
    im = Image.open(os.path.join(src, f'{name}-desktop-light.png')).convert('RGB')
    w, h = im.size
    im = im.crop((0, 0, w, min(h, bottom)))
    im = im.resize((1000, int(im.size[1] * 1000 / w)), Image.LANCZOS)
    p = os.path.join(out, f'{name}.jpg')
    im.save(p, 'JPEG', quality=82, optimize=True)
    print(name, im.size, os.path.getsize(p))
# mobile example: training mobile light, top 1400 px
im = Image.open(os.path.join(src, 'training-mobile-light.png')).convert('RGB')
w, h = im.size
im = im.crop((0, 0, w, min(h, 1400)))
p = os.path.join(out, 'training-mobile.jpg')
im.save(p, 'JPEG', quality=82, optimize=True)
print('training-mobile', im.size, os.path.getsize(p))
