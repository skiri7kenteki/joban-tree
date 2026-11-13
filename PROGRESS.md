# 進捗メモ

## 現在の状況
段階0（土台づくりと、エンジンの WASM 化・速度測定）の作業中。
手元でのテストは合格。GitHub のリポジトリ（joban-tree）がまだ無いので、push・公開・エンジンのビルドは未実施。
公開 URL（予定）：https://skiri7kenteki.github.io/joban-tree/ ／速度測定：https://skiri7kenteki.github.io/joban-tree/bench.html

## 完了したこと
- 2026-11-13 着手前の確認（持ち主の回答）
  - リポジトリ名：joban-tree。作業フォルダ：OneDrive の中（`Desktop\Claude 作業用\joban-tree`）
  - Node.js と 7-Zip のインストール：了承。ただし winget の管理者確認が通らなかったため、
    **管理者権限のいらない持ち運び版**を `C:\Users\skiri\tools\node`（Node.js v26.13.1、公式チェックサム一致）と
    `C:\Users\skiri\tools\7zip\7zr.exe` に置いた（PATH には入れていない。消すときはフォルダごと消せばよい）
  - **指示書との食い違い**：やねうら王の WASM 版は `-pthread` 付きでビルドされ、1 スレッドでも SharedArrayBuffer が必須。
    → service worker によるヘッダの付け足しを**必須**にし、初回だけ自動で 1 回再読み込みする（持ち主了承）
- 2026-11-13 やねうら王のソースで確認したこと（コミット 96b9ae5d、2026-11-13 の master）
  - `ka2` は `nnue_arch_gen.py` に、`progress8` は Makefile の SFNN 指定にあり、指示書どおり
  - `progress.bin` は `<実行ファイルのディレクトリ>/<EvalDir>/progress.bin` から読まれる（WASM では `/eval/progress.bin`）
  - WASM では `EvalFile` オプションで nn.bin の名前を指定でき、JS から仮想 FS に書く方式が上流でも想定されている
  - Makefile の WASM 設定：スレッドプール 32 本・最大メモリ 4GB → スマホには重いので、パッチで 8 本・1GB に
  - FV_SCALE の初期値は 16 → ビルド時の `ENGINE_OPTIONS` で 24 にし、`setoption` でも 24 を送る
- 2026-11-13 評価関数の取得（11micro・11mini とも取得できた）
  - 中身は 5 ファイル：`nn.bin`・`progress.bin`（必要）、`eval_options.txt`（中身は `FV_SCALE 24`）、`tag.json`（説明）、`banner.png`
  - `progress.bin` は micro と mini で同一。サイズ：micro 3.9MB＋1.0MB、mini 7.7MB＋1.0MB
  - `public/eval/tuyoura11micro-20261001/`・`public/eval/tuyoura11mini-20261003/` に nn.bin・progress.bin・tag.json を置いた
  - **配布物にライセンス文書は入っていなかった**ので、`public/eval/LICENSE-tuyoura.txt` に MIT License の表記を書いた（要確認：判断してほしいこと参照）
- 2026-11-13 土台（TypeScript＋Vite 8＋Preact 11、Vitest、Playwright、vite-plugin-pwa の injectManifest）
  - トップページ（準備中の表示・速度測定へのボタン・バージョン表示 v0.1.0）
  - service worker（`src/sw.ts`）：COOP/COEP の付け足し、HTML はネット優先、JS/CSS は事前保存、engine/・eval/ はキャッシュ優先
  - 速度測定ページ（`bench.html`）：動作確認（初期局面 0.5 秒）、速度測定（4 局面 × MultiPV1・500ms と MultiPV3・400ms × 1 スレッドと最大スレッド）、結果をコピー、エンジンの出力ログ
  - エンジンを包むモジュール（`src/engine/engine.ts`）：コマンドの順番待ち、analyze（MultiPV の各候補の最後の行を採用）
  - エンジンのビルド：`engine/build.sh`（Docker の emsdk 3.1.43）、`engine/patches/0001-sfnn-ka2-packages.patch`、Node.js での単体動作確認 `engine/smoke.mjs`
  - GitHub Actions（`.github/workflows/deploy.yml`）：エンジンのビルド（キャッシュ付き）→ 単体動作確認 → 型チェック → Vitest → ビルド → Playwright → 公開
  - ライセンス：リポジトリは GPLv3（`LICENSE`）。tsshogi は MIT License（README に記載）

## テスト結果
- 2026-11-13 手元（Windows）
  - 型チェック：合格
  - Vitest：18 項目すべて合格（USI の読み取り 11、エンジンを包むモジュール 3、速度測定の局面が合法 4）
  - Playwright（Chromium）：2 項目合格（トップページとバージョン表示、service worker 経由で cross-origin isolated になる）。
    エンジンの 2 項目は、手元にエンジンが無いので省略（GitHub Actions で実行される）
  - `npm audit`：ビルド時だけ使う部品（vite-plugin-pwa → workbox-build）に注意 6 件。公開されるアプリには含まれないので様子見

## 実機で未確認のこと
- まだ公開していないので、すべて未確認
- iPhone / iPad の Safari で、service worker によるヘッダの付け足しで cross-origin isolated になるか
- スマホでエンジンが答えを返すか、速さはどれくらいか（速度測定ページの数値）

## 次にやること
1. 持ち主：GitHub で空の公開リポジトリ `joban-tree` を作り、Settings → Pages → Source を「GitHub Actions」にする
2. push して、GitHub Actions でエンジンのビルドが通るか確認（通らなければ原因の切り分けと選択肢を報告）
3. 持ち主：スマホと iPad で速度測定ページを開き、「結果をコピー」で数値を報告
4. 測定結果でプリセット（さっと・ふつう・じっくり）の値を見直す
