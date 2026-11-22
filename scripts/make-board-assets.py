# 使い方: リポジトリのいちばん上で python3 scripts/make-board-assets.py （numpy と Pillow が必要。出力は今いるフォルダ）
# Figma の案（node 15:125）と同じ切り抜き・同じ重ね方で、盤・駒の面・駒台の素材を作る
import glob, numpy as np
from PIL import Image
sheet = Image.open('docs/design/stage15-sheet.png').convert('RGB')
W, H = sheet.size
def crop(x0, y0, x1, y1, size):
    return sheet.crop((round(x0*W), round(y0*H), round(x1*W), round(y1*H))).resize(size, Image.LANCZOS)
A = lambda im: np.asarray(im, float)
# 盤：#DBC3A5 の上に、シートの「木目」の切り抜きを 40% で重ねる（盤 374×398 の 3 倍）
board = crop(0.318, 0.402, 0.414, 0.523, (1122, 1194))
base = np.array([0xdb, 0xc3, 0xa5], float)
out = base * 0.6 + A(board) * 0.4
Image.fromarray(out.clip(0,255).astype(np.uint8)).save('board-wood.webp', quality=90)
# 駒の面：シートの木目の見本の切り抜きに、上 rgba(255,250,240,.55) → 下 rgba(255,245,224,.25) を重ねる（駒 34×38 の 4 倍）
face = A(crop(0.026, 0.848, 0.078, 0.93, (136, 152)))
t = np.linspace(0, 1, 152)[:, None, None]
col = np.array([255, 250, 240]) * (1 - t) + np.array([255, 245, 224]) * t
a = 0.55 * (1 - t) + 0.25 * t
out = face * (1 - a) + col * a
Image.fromarray(out.clip(0,255).astype(np.uint8)).save('piece-face.webp', quality=92)
# 駒台：シートの「枠の質感」の切り抜きに、暗い色 rgb(51,31,13) を 35% で重ねる（駒台 374×30 の 3 倍）
stand = A(crop(0.318, 0.115, 0.414, 0.2, (1122, 90)))
out = stand * 0.65 + np.array([51, 31, 13]) * 0.35
Image.fromarray(out.clip(0,255).astype(np.uint8)).save('stand-wood.webp', quality=90)
import os
for f in ['board-wood.webp','piece-face.webp','stand-wood.webp']:
    im = Image.open(f); print(f, im.size, os.path.getsize(f)//1024, 'KB', '平均 #%02x%02x%02x' % tuple(np.asarray(im).reshape(-1,3).mean(0).astype(int)))
