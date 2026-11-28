---
paths:
  - "pc/**"
  - "src/engine/pcEngine.ts"
  - "engine/build-windows.sh"
  - "engine/pc-manifest.mjs"
---

# PC 版（Windows 版やねうら王を使う）

> CLAUDE.md から移した仕様（2026-11-24）。この機能の仕様を変えたら、このファイルを直す。
> 下のパスのファイルを読んだときだけ読み込まれる。

## PC 版（段階3。精密ツリーは機能の整理で消した。エンジンに聞くが PC のエンジンを使う）
- 持ち主の判断（2026-11-14）：**PC の画面から作る**。`pc/start.bat` → `pc/server.mjs`（Node.js の標準機能だけ）→ ブラウザで `http://localhost:18765/joban-tree/`
- サーバーの役目：
  - 画面を GitHub Pages から中継する（COOP/COEP/CORP を付ける）
  - `pc-api/`（info・start・events・send・close）で、Windows 版やねうら王と USI の行を受け渡す。events は出力を 1 行ずつ流し続ける応答（`flushHeaders` が必要）
  - エンジンは同時に 1 つ。画面を閉じる（events が切れる）とエンジンも止める。優先度は「通常以下」
- 安全：127.0.0.1 だけで待ち受け。Host が localhost/127.0.0.1 でなければ断る。pc-api は `X-Joban-Tree: 1` が無ければ断る。
  エンジンと評価関数は `public/pc-engine/manifest.json` の sha256 と一致したものだけ使う（`%LOCALAPPDATA%\joban-tree-pc` に保存）
- アプリ側：`src/engine/pcEngine.ts`（PcTransport。UsiEngine はそのまま）。localhost で開いて `pc-api/info` が答えたら PC 版（`engineService.pcEngine`）
  - 設定は `pcThreads`（おまかせ＝論理プロセッサ − 2）・`pcHashMB`（初期値 1024）
  - エンジンが途中で終わったら（黒い画面を閉じたなど）、`UsiEngine` が待っている処理をすべて失敗にし、次に使うとき作り直す
  - service worker は `pc-api/` に手を出さない
- 測定（Ryzen 7 250、11micro、MultiPV3・3秒）：8 スレッド 320〜460 万、14 スレッド 500〜540 万、16 スレッド 480〜590 万局面/秒。PC の Chrome の WASM 版（7 スレッド）は約 185 万
- `start.bat` は**英数字だけ**で書く（cmd は日本語の行を、chcp 65001 の後でも読み違えた）。改行は CRLF（`.gitattributes`）
- ビルド：`engine/build-windows.sh`（MinGW、AVX2、tournament）。`engine/pc-manifest.mjs` が manifest.json を作る。キャッシュのキーはコミット・パッチ・build-windows.sh
