# 将棋盤の木目（榧の柾目ふう）を作る（段階12-2）。写真や素材は使わず、計算で描く（ライセンスの心配が無い）。
#
# 使い方（PC で 1 回だけ。できたファイルはリポジトリに入れる）：
#   pip install numpy pillow
#   python scripts/make-wood.py src/assets/board/wood.webp
#
# 盤（SVG の 384×420）に近い縦長の 1 枚。縦に通る細い線（間隔を場所ごとにばらつかせる）・帯状の濃淡・細かいざらつき。
# 乱数の種を固定しているので、何度作っても同じ絵になる。WebP（品質 80）で約 6KB
import os
import sys

import numpy as np
from PIL import Image

W, H = 480, 528
rng = np.random.default_rng(7)


def smooth_noise(n, scale):
    """1 次元のなめらかな揺らぎ（scale ごとの乱数の間をなめらかにつなぐ）"""
    k = rng.normal(size=n // scale + 3)
    x = np.arange(n) / scale
    i = x.astype(int)
    t = x - i
    t = t * t * (3 - 2 * t)
    return k[i] * (1 - t) + k[i + 1] * t


def wood():
    x = np.arange(W)[None, :]
    # 柾目：縦に通る線を、上下でわずかに揺らす
    wobble = (smooth_noise(H, 140) * 2.2)[:, None] + (smooth_noise(H, 45) * 0.35)[:, None]
    pos = x + wobble
    # 線の間隔を場所ごとにばらつかせる（4〜13px）：位相＝間隔の逆数の積み重ね
    xs = np.arange(-20, W + 20, dtype=float)
    spacing = np.clip(8.0 + smooth_noise(len(xs), 9) * 3.5 + smooth_noise(len(xs), 70) * 2.0, 4, 13)
    phase = np.cumsum(1.0 / spacing)
    grain = np.sin(2 * np.pi * np.interp(pos, xs, phase))
    grain = np.sign(grain) * np.abs(grain) ** 0.5
    fine = np.sin(pos * 2 * np.pi / 2.3 + smooth_noise(W, 5)[None, :] * 2)
    band = smooth_noise(W, 40)[None, :]  # 帯状の濃淡
    v = 0.55 * grain + 0.18 * fine + 0.6 * band
    v = (v - v.min()) / (v.max() - v.min())
    v = v ** 1.6
    # 色：明るい榧色 → 線の濃い色
    light = np.array([236, 200, 128], float)
    dark = np.array([196, 146, 70], float)
    img = light[None, None, :] * (1 - v[..., None] * 0.55) + dark[None, None, :] * (v[..., None] * 0.55)
    img += rng.normal(0, 2.2, size=(H, W, 1))  # 細かいざらつき
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(os.path.dirname(out), exist_ok=True)
    wood().save(out, 'WEBP', quality=80, method=6)
    print(f'{out}：{os.path.getsize(out) / 1024:.1f} KB')
