"""montage.py out.jpg cols thumbW img1 img2 ... : planche de vignettes légendées (nom de fichier)."""
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols, tw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
ims = [Image.open(f).convert('RGB') for f in files]
th = round(ims[0].height * tw / ims[0].width)
pad, cap = 8, 22
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (tw + pad) + pad, rows * (th + pad + cap) + pad), (18, 18, 20))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 15)
except Exception:
    font = ImageFont.load_default()
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = pad + (i % cols) * (tw + pad), pad + (i // cols) * (th + pad + cap)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + cap))
    d.text((x + 2, y + 3), f.rsplit('/', 1)[-1].rsplit('.', 1)[0], fill=(216, 189, 140), font=font)
sheet.save(out, quality=88)
