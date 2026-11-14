#!/usr/bin/env bash
# PC（Windows）用のやねうら王（つようら王11micro / 11mini 用）をビルドして engine-dist-pc/ に置く。
# GitHub Actions（Ubuntu）で、MinGW を使って Windows 用の .exe を作る（やねうら王公式の make-mingw.yml と同じ方法）。
# 手元の Windows では動かさない（ビルドに必要な道具が無いため）。
#
# 手順：
#   1. engine/yaneuraou.commit のコミットを取得（スマホ版と同じコミット）
#   2. engine/patches/*.patch を当てる（WASM 用の変更だが、当てても PC 版には影響しない。スマホ版とそろえるため）
#   3. 評価関数の形ごとに make（tournament：大会用の速い設定。AVX2：2013 年ごろ以降の多くの PC で動く）
#   4. できた .exe を engine-dist-pc/ にコピー
#
# 必要なもの：sudo apt install build-essential mingw-w64 python3
# このファイルの中身もキャッシュのキーに入る（変えると再ビルドされる）。
set -euo pipefail

COMPILER="x86_64-w64-mingw32-g++-posix"
TARGET_CPU="AVX2"
# 出力の名前 → やねうら王のエディション（評価関数の形）
declare -A EDITIONS=(
  ["yaneuraou-ka2-2048-avx2.exe"]="SFNN_ka2_2048_8_64_progress8"
  ["yaneuraou-ka2-4096-avx2.exe"]="SFNN_ka2_4096_8_64_progress8"
)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(tr -d '[:space:]' < "$ROOT/engine/yaneuraou.commit")"
WORK="$ROOT/engine-work-pc"
DIST="$ROOT/engine-dist-pc"

echo "== やねうら王 $COMMIT を取得"
rm -rf "$WORK" "$DIST"
mkdir -p "$WORK" "$DIST"
git -C "$WORK" init -q
git -C "$WORK" remote add origin https://github.com/yaneurao/YaneuraOu.git
git -C "$WORK" fetch -q --depth 1 origin "$COMMIT"
git -C "$WORK" checkout -q FETCH_HEAD

echo "== パッチを当てる"
for p in "$ROOT"/engine/patches/*.patch; do
  echo "  $p"
  git -C "$WORK" apply --whitespace=nowarn "$p"
done

JOBS="$(nproc)"
for out in "${!EDITIONS[@]}"; do
  edition="${EDITIONS[$out]}"
  echo "== $edition をビルド → $out"
  make -C "$WORK/source" clean OS=Windows_NT YANEURAOU_EDITION="$edition" PYTHON=python3 > /dev/null
  make -C "$WORK/source" -j"$JOBS" tournament \
    OS=Windows_NT \
    TARGET_CPU="$TARGET_CPU" \
    YANEURAOU_EDITION="$edition" \
    COMPILER="$COMPILER" \
    PYTHON=python3 \
    TARGET="$DIST/$out"
  if [ ! -f "$DIST/$out" ]; then
    echo "見つかりません: $DIST/$out" >&2
    exit 1
  fi
done

# やねうら王のライセンス（GPLv3）も一緒に配る
cp "$WORK/LICENSE" "$DIST/LICENSE-yaneuraou.txt"
ls -la "$DIST"
