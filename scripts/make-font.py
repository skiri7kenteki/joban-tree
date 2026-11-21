# 見出し・駒の文字に使う明朝体（Noto Serif JP、SIL Open Font License 1.1）を、アプリに入れる大きさに削る（段階12-1）。
#
# 使い方（PC で 1 回だけ。できたファイルはリポジトリに入れる）：
#   1. 公式の配布元から Noto Serif JP（可変フォント）を取ってくる
#      https://github.com/google/fonts/tree/main/ofl/notoserifjp の NotoSerifJP[wght].ttf
#   2. pip install fonttools brotli
#   3. python scripts/make-font.py <取ってきた ttf> src/assets/fonts/joban-mincho-600.woff2
#
# 中身：太さ 600（やや太め）1 つだけ。かな・英数・記号（JIS の 1〜8 区）と JIS 第 1 水準の漢字、
# それにアプリの画面で使っている文字（src の中の日本語）と駒・盤の記号。第 2 水準の漢字などは端末の明朝体で出る。
import glob
import io
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEIGHT = 600
SRC_DIR = os.path.join(os.path.dirname(__file__), '..', 'src')


def jis_rows(rows):
    """JIS X 0208 の区（rows）の文字"""
    chars = set()
    for row in rows:
        for cell in range(1, 95):
            try:
                chars.add(bytes([0xA0 + row, 0xA0 + cell]).decode('euc_jp'))
            except UnicodeDecodeError:
                pass
    return chars


def app_chars():
    """src の .ts・.tsx に出てくる日本語の文字（画面の見出し・ボタンの文字）"""
    chars = set()
    for p in glob.glob(os.path.join(SRC_DIR, '**', '*.ts*'), recursive=True):
        with open(p, encoding='utf-8') as f:
            chars |= set(re.findall(r'[ -⟿　-ヿ一-鿿＀-￯]', f.read()))
    return chars


def main(src, out):
    text = {chr(c) for c in range(0x20, 0x7F)}
    text |= jis_rows(range(1, 9))  # 記号・英数・かな
    text |= jis_rows(range(16, 48))  # 第 1 水準の漢字
    text |= app_chars()
    text |= set('王玉飛角金銀桂香歩と龍竜馬成全圭杏☗☖▲△★▶')
    font = instancer.instantiateVariableFont(TTFont(src), {'wght': WEIGHT})
    buf = io.BytesIO()
    font.save(buf)
    font = TTFont(io.BytesIO(buf.getvalue()))
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['palt', 'kern']
    opts.name_IDs = ['*']
    s = subset.Subsetter(opts)
    s.populate(text=''.join(sorted(text)))
    s.subset(font)
    font.flavor = 'woff2'
    os.makedirs(os.path.dirname(out), exist_ok=True)
    font.save(out)
    print(f'{out}：{len(text)} 文字、{os.path.getsize(out) / 1024:.0f} KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
