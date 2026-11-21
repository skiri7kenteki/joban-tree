# 駒の文字だけの太い字体を作る（段階12 の追加、v0.34.0）。Noto Serif JP（SIL Open Font License 1.1）の太さ 900（Black）を、
# 駒に書く 17 字だけに削る（約 5KB）。持ち主の判断 2026-11-21：6 種で試した写真から Noto Serif JP Black を選んだ。
#
# 使い方（PC で 1 回だけ。できたファイルはリポジトリに入れる）：
#   1. 公式の配布元から Noto Serif JP（可変フォント）を取ってくる
#      https://github.com/google/fonts/tree/main/ofl/notoserifjp の NotoSerifJP[wght].ttf
#   2. pip install fonttools brotli
#   3. python scripts/make-koma-font.py <取ってきた ttf> src/assets/fonts/joban-koma.woff2
#
# ライセンスは見出しの明朝体と同じ public/fonts/OFL-NotoSerifJP.txt
import io
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEIGHT = 900
# 駒に書く字（成り駒の字・竜の別の字体も）
CHARS = '歩香桂銀金角飛王玉と杏圭全馬龍竜成'


def main(src, out):
    font = instancer.instantiateVariableFont(TTFont(src), {'wght': WEIGHT})
    buf = io.BytesIO()
    font.save(buf)
    font = TTFont(io.BytesIO(buf.getvalue()))
    missing = [c for c in CHARS if ord(c) not in font.getBestCmap()]
    if missing:
        sys.exit(f'字体に無い字があります：{"".join(missing)}')
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []
    opts.name_IDs = ['*']
    s = subset.Subsetter(opts)
    s.populate(text=CHARS)
    s.subset(font)
    font.flavor = 'woff2'
    font.save(out)
    print(f'{out}：{len(CHARS)} 字')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('使い方：python scripts/make-koma-font.py <NotoSerifJP[wght].ttf> <出力の woff2>')
    main(sys.argv[1], sys.argv[2])
