"""downscale.py <src> <dst> : réduction Lanczos 2160×3840 → 1080×1920 (suréchantillonnage ×2), en parallèle."""
import sys, os
from multiprocessing import Pool
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
def one(f):
    Image.open(os.path.join(src, f)).convert('RGB').resize((1080, 1920), Image.LANCZOS).save(os.path.join(dst, f), compress_level=1)
if __name__ == '__main__':
    fs = sorted(f for f in os.listdir(src) if f.endswith('.png'))
    with Pool(8) as p: p.map(one, fs, chunksize=8)
    print(len(fs), 'images réduites')
