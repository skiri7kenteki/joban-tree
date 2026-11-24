---
paths:
  - "src/engine/**"
  - "engine/**"
  - "src/bench/**"
  - "src/isolation.ts"
---

# エンジン（やねうら王 WASM 版）

> CLAUDE.md から移した仕様（2026-11-24）。この機能の仕様を変えたら、このファイルを直す。
> 下のパスのファイルを読んだときだけ読み込まれる。

## エンジン（段階0で確認済みのこと）
- やねうら王は `engine/yaneuraou.commit` のコミットに固定し、`engine/patches/*.patch` を当ててビルドする（`engine/build.sh`）
  - パッチ内容：`tools/build/wasm_build.js` に SFNN_ka2 用パッケージ（`sfnn_ka2_2048.noeval`＝11micro、`sfnn_ka2_4096.noeval`＝11mini）を追加。
    `source/Makefile` のスレッドプール数・最大メモリを make 変数にし、スマホ向けに 8 本・1GB にする
  - ビルドは Docker イメージ `emscripten/emsdk:3.1.43` の中で行う（上流の `wasm_docker_build.js` と同じ）
  - Actions では、コミット・パッチ・build.sh の内容から作ったキーでキャッシュし、変化がなければビルドを省略する
- 評価関数は**埋め込まない（noeval）**。JS 側で `nn.bin` と `progress.bin` を Emscripten の仮想ファイルシステムの `/eval/` に書き込み、`EvalDir=eval` にしてから `isready` を送る
  - `progress.bin` は `<実行ファイルのディレクトリ>/<EvalDir>/progress.bin` から読まれる（`source/eval/nnue/evaluate_nnue.cpp`）
- **FV_SCALE は 24**（ビルド時の `ENGINE_OPTIONS` で初期値にし、念のため `setoption` でも送る）
- WASM 版は `-pthread` 付きでビルドされるため、**1 スレッドでも SharedArrayBuffer が必須**＝ cross-origin isolated が必須
  - GitHub Pages では COOP/COEP ヘッダを付けられないので、**service worker がレスポンスにヘッダを付け足す**（coi-serviceworker と同じ考え方）
  - 初回アクセス時は service worker が入ったあと 1 回だけ自動で再読み込みする（持ち主の判断 2026-11-13）
- エンジンは Web Worker の中で動かし、画面を固まらせない。USI の送受信は `src/engine/` のモジュールにまとめ、コマンドを順番待ちさせる
- `info ... multipv k ... score ... pv ...` は、各候補について**最後に出た行**を採用する
- スマホのメモリを圧迫しないよう、USI_Hash は 16〜64MB にする
- **探索のスレッド数は 7 まで**（`MAX_SEARCH_THREADS`）。スレッドプールは 8 本だが、エンジンの制御用に 1 本使うため、Threads=8 にすると isready で止まったまま返らない（段階3で発見）
  - **`setoption` は USI_Hash を Threads より先に送る**。Threads を変えるとその時点の USI_Hash（初期値 1024MB）で置換表を作り直し、
    メモリ上限 1GB の WASM 版では確保に失敗してエンジンが終了する
- ビルド時の `ENGINE_OPTIONS "FV_SCALE=24"` は `usi` の応答の default には反映されない（default 16 と出る）。必ず `setoption` で 24 を送る
- iOS Safari は画面が消える・裏に回ると計算が止まる。生成中は Wake Lock で画面を点けたままにし、止まっても途中までのツリーを失わない
