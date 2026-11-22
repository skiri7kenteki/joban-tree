# 将棋定跡帳の盤の木目を 6 案作る（プログラムで描く。許諾の心配なし）。いまの盤は 3 番（C_shinkaya、明るい柾目）
# 使い方: python3 scripts/make-board-options.py （numpy と Pillow が必要。出力は今いるフォルダ）
import numpy as np
from PIL import Image, ImageFilter
W, H = 1122, 1194
def smooth_noise(w, h, scale, seed):
    r = np.random.default_rng(seed).standard_normal((h // scale + 3, w // scale + 3))
    im = Image.fromarray(((r - r.min()) / (r.max() - r.min()) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    a = np.asarray(im, float) / 255; return a - a.mean()
def fibers(w, h, seed, along='v', length=60):
    r = np.random.default_rng(seed).standard_normal((h, w))
    im = Image.fromarray(((r - r.min()) / (r.max() - r.min()) * 255).astype(np.uint8))
    im = im.filter(ImageFilter.BoxBlur(1))
    a = np.asarray(im.resize((w, h // length) if along == 'v' else (w // length, h), Image.BILINEAR).resize((w, h), Image.BICUBIC), float) / 255
    return a - a.mean()
def colorize(v, light, dark):
    L = np.array(light, float); D = np.array(dark, float)
    return Image.fromarray(np.clip(L * (1 - v[..., None]) + D * v[..., None], 0, 255).astype(np.uint8))
hx = lambda h: [int(h[i:i+2], 16) for i in (1, 3, 5)]
def straight(light, dark, lines, width, wave, contrast, fiber, seed, tone=0.25):
    """柾目：縦にまっすぐ通る年輪の線。線の間隔はばらつく"""
    rng = np.random.default_rng(seed)
    dens = np.clip(1 + 0.6 * np.convolve(rng.standard_normal(W), np.ones(80) / 80, 'same') * 8, 0.3, 2)
    ph = np.cumsum(dens); ph = ph / ph[-1] * lines
    x = np.arange(W)[None, :]
    warp = smooth_noise(W, H, 160, seed + 1) * wave + smooth_noise(W, H, 40, seed + 2) * wave * 0.3
    phase = np.interp(x + warp * W / lines, np.arange(W), ph)
    d = phase - np.round(phase)
    ring = np.exp(-(d / width) ** 2)                      # 細い年輪の線
    late = np.clip(0.5 + 0.5 * np.sin(2 * np.pi * phase - 1.2), 0, 1) ** 3 * 0.35  # 線のそばの濃い帯
    strength = 0.6 + 0.8 * (smooth_noise(W, H, 300, seed + 3) + 0.5)
    v = (ring + late) * strength * contrast + fiber * fibers(W, H, seed + 4) + tone * smooth_noise(W, H, 500, seed + 5) + 0.25
    return colorize(np.clip(v, 0, 1), light, dark)
def itame(light, dark, lines, width, contrast, fiber, seed):
    """板目：山形（たけのこ形）に流れる木目"""
    x = np.arange(W)[None, :] / W; y = np.arange(H)[:, None] / H
    warp = smooth_noise(W, H, 200, seed + 1)
    phase = lines * (((x - 0.55 + 0.08 * warp) ** 2) * 2.2 + y * 0.9 + 0.15 * warp)
    d = phase - np.round(phase)
    ring = np.exp(-(d / width) ** 2) + np.clip(0.5 + 0.5 * np.sin(2 * np.pi * phase - 1.2), 0, 1) ** 3 * 0.3
    v = ring * contrast * (0.7 + 0.6 * (smooth_noise(W, H, 250, seed + 3) + 0.5)) + fiber * fibers(W, H, seed + 4) + 0.2 * smooth_noise(W, H, 500, seed + 5) + 0.25
    return colorize(np.clip(v, 0, 1), light, dark)
opts = {
 'B_kaya':   ('榧（かや）の柾目', straight(hx('#e8c98e'), hx('#b8874a'), lines=70, width=0.07, wave=0.6, contrast=0.55, fiber=0.18, seed=3)),
 'C_shinkaya': ('明るい柾目（すっきり）', straight(hx('#efdcbc'), hx('#c9a77c'), lines=90, width=0.05, wave=0.3, contrast=0.4, fiber=0.12, seed=5, tone=0.15)),
 'D_itame':  ('板目（山形の木目）', itame(hx('#e2c49a'), hx('#b38657'), lines=22, width=0.06, contrast=0.55, fiber=0.15, seed=7)),
 'E_honey':  ('飴色（濃いめ）', straight(hx('#d9ab6c'), hx('#9a6a35'), lines=60, width=0.08, wave=0.8, contrast=0.55, fiber=0.2, seed=9)),
}
import json
for k, (label, im) in opts.items():
    im.save(f'board-{k}.webp', quality=90)
    a = np.asarray(im).reshape(-1, 3); print(k, label, '平均 #%02x%02x%02x' % tuple(a.mean(0).astype(int)))
json.dump({k: v[0] for k, v in opts.items()}, open('labels.json', 'w'), ensure_ascii=False)
# 6：いまの採用案の色（#C9AA87）のまま、木目だけ細かい柾目に
im6 = straight(hx('#d6ba98'), hx('#a98660'), lines=80, width=0.06, wave=0.4, contrast=0.45, fiber=0.14, seed=11, tone=0.2)
im6.save('board-F_current_masame.webp', quality=90)
labels = json.load(open('labels.json')); labels['F_current_masame'] = 'いまの色のまま柾目に'; json.dump(labels, open('labels.json', 'w'), ensure_ascii=False)
a = np.asarray(im6).reshape(-1, 3); print('F', '平均 #%02x%02x%02x' % tuple(a.mean(0).astype(int)))
