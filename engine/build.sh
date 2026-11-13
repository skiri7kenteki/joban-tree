#!/usr/bin/env bash
# やねうら王の WASM 版（つようら王11micro / 11mini 用）をビルドして engine-dist/ に置く。
# GitHub Actions（Ubuntu・Docker あり）で動かす想定。手元の Windows では動かさない。
#
# 手順：
#   1. engine/yaneuraou.commit のコミットを取得
#   2. engine/patches/*.patch を当てる（SFNN_ka2 用のパッケージ定義など）
#   3. Docker イメージ emscripten/emsdk の中で tools/build/wasm_build.js を実行
#   4. できた .js / .worker.js / .wasm を engine-dist/ にコピー
#
# このファイルの中身もキャッシュのキーに入る（変えると再ビルドされる）。
set -euo pipefail

EMSDK_IMAGE="emscripten/emsdk:3.1.43"
PACKAGES=("sfnn_ka2_2048.noeval" "sfnn_ka2_4096.noeval")

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(tr -d '[:space:]' < "$ROOT/engine/yaneuraou.commit")"
WORK="$ROOT/engine-work"
DIST="$ROOT/engine-dist"

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

echo "== Docker ($EMSDK_IMAGE) でビルド"
docker run --rm -v "$WORK:/src" -w /src "$EMSDK_IMAGE" \
  node tools/build/wasm_build.js "${PACKAGES[@]}"

echo "== 成果物をコピー"
for pkg in "${PACKAGES[@]}"; do
  lib="$WORK/build/wasm/$pkg/lib"
  for ext in js worker.js wasm; do
    f="$lib/yaneuraou.$pkg.$ext"
    if [ ! -f "$f" ]; then
      echo "見つかりません: $f" >&2
      exit 1
    fi
    cp "$f" "$DIST/"
  done
done
ls -la "$DIST"
