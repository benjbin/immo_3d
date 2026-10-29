"""Intègre les photos originales déposées dans photos/ au site.

Chaque original est reconnu en le comparant aux miniatures de référence (img/pXX-ref.png),
quel que soit son nom de fichier, puis exporté en versions web dans img/ :
  pXX.jpg (2400 px de large), pXX-thumb.jpg (480 px).

Usage : python3 outils/preparer-photos.py   (depuis le dossier nouveau-projet)
"""
import os, sys
from itertools import permutations
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHOTOS, IMG = os.path.join(ROOT, "photos"), os.path.join(ROOT, "img")
EXT = (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic")

def signature(im):
    im = ImageOps.exif_transpose(im).convert("RGB").resize((32, 24), Image.BILINEAR)
    b = im.tobytes()
    return [tuple(b[i:i+3]) for i in range(0, len(b), 3)]

def distance(a, b):
    return sum((x[0]-y[0])**2 + (x[1]-y[1])**2 + (x[2]-y[2])**2 for x, y in zip(a, b))

refs = {}
for f in sorted(os.listdir(IMG)):
    if f.endswith("-ref.png"):
        refs[f[:3]] = signature(Image.open(os.path.join(IMG, f)))
originals = [f for f in sorted(os.listdir(PHOTOS)) if f.lower().endswith(EXT)]
if not originals:
    sys.exit("Aucune photo dans photos/.")

sigs = {f: signature(Image.open(os.path.join(PHOTOS, f))) for f in originals}
# association photo -> vue : on prend la combinaison la plus proche (glouton si beaucoup de fichiers)
pairs = sorted((distance(s, r), f, k) for f, s in sigs.items() for k, r in refs.items())
used_f, used_k, match = set(), set(), {}
for d, f, k in pairs:
    if f in used_f or k in used_k:
        continue
    match[k] = f; used_f.add(f); used_k.add(k)

for k, f in sorted(match.items()):
    im = ImageOps.exif_transpose(Image.open(os.path.join(PHOTOS, f))).convert("RGB")
    w = min(2400, im.width)
    big = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    big.save(os.path.join(IMG, f"{k}.jpg"), quality=86, optimize=True, progressive=True)
    im.resize((480, round(im.height * 480 / im.width)), Image.LANCZOS).save(os.path.join(IMG, f"{k}-thumb.jpg"), quality=84, optimize=True)
    print(f"{k}  <-  {f}  ({im.width}×{im.height})")
missing = sorted(set(refs) - set(match))
if missing:
    print("Vues sans original :", ", ".join(missing))
extra = sorted(set(originals) - used_f)
if extra:
    print("Photos non utilisées :", ", ".join(extra))
