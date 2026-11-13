# 進捗メモ

## 現在の状況
段階0（土台づくりと、エンジンの WASM 化・速度測定）の作業中。
GitHub Actions でエンジンのビルド〜テスト〜公開まで通った（2026-11-13）。スマホ・iPad での速度測定の結果待ち。
公開 URL：https://skiri7kenteki.github.io/joban-tree/ ／速度測定：https://skiri7kenteki.github.io/joban-tree/bench.html

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

- 2026-11-13 GitHub に push（初回の Actions）
  - **エンジンの WASM ビルドは成功**（約 4 分。キャッシュにも保存された）
  - Node.js での単体確認が 0 秒で失敗。原因：package.json の `"type": "module"` のせいで、
    Emscripten が出す CommonJS 形式の .js が ES モジュールとして読まれ、関数として取り出せなかった（手元で再現）
  - 対処：smoke.mjs が engine-dist に `{"type":"commonjs"}` の package.json を置いてから読み込む。
    失敗理由を GitHub の注記（誰でも見られる）にも出すようにした。公開用フォルダにはエンジンのファイルだけコピーする
  - 次の失敗：`usi` → `usiok` までは正常。`setoption name Threads` で「Failed to allocate 1024MB for transposition table」→ exit(1)。
    USI_Hash の初期値 1024MB のまま置換表を作り直したため（メモリ上限 1GB）。
    → USI_Hash を Threads より先に送るよう、smoke.mjs とエンジンを包むモジュールを修正（Vitest に順番のテストを追加）
  - 次の失敗：`isready` で exit(1)。progress.bin は「実行ファイルの場所/EvalDir/progress.bin」から読まれ、
    Node.js では実行ファイルの場所＝smoke.mjs の実パスになっていた。→ `thisProgram: './this.program'` を渡す（ブラウザ側の worker でも明示）
  - **5 回目で全部合格して公開**：エンジン単体確認（Node.js、micro・mini）、型チェック、Vitest 19、Playwright（Chromium で
    service worker 経由の isolation、bench ページで micro・mini とも bestmove が返る）、GitHub Pages への公開
  - 公開されたエンジン：`engine/96194a149bd8/`（.wasm は約 0.8MB）

## テスト結果
- 2026-11-13 手元（Windows）
  - 型チェック：合格
  - Vitest：18 項目すべて合格（USI の読み取り 11、エンジンを包むモジュール 3、速度測定の局面が合法 4）
  - Playwright（Chromium）：2 項目合格（トップページとバージョン表示、service worker 経由で cross-origin isolated になる）。
    エンジンの 2 項目は、手元にエンジンが無いので省略（GitHub Actions で実行される）
  - `npm audit`：ビルド時だけ使う部品（vite-plugin-pwa → workbox-build）に注意 6 件。公開されるアプリには含まれないので様子見

- 2026-11-13 評価関数のライセンス：持ち主が出典を確認（やねうら王公式サイト 2026-10-14 の記事「今回、これらをMIT Licenseで頒布します。」）。
  `LICENSE-tuyoura.txt` に出典を書き、名義を「やねうらお（やねうら王プロジェクト）」にした
- 2026-11-13 実機 1 台目：**iPad**（Safari 26.6。UA は Macintosh と名乗る。CPU 数 8、isolated: true、ハッシュ 32MB、11micro）
  - **Safari でも service worker のヘッダ付け足しで cross-origin isolated になった**。エンジンも動いた
  - 読み込み：エンジン 755ms／評価関数 1232ms／isready 248ms
  - 1 スレッド：MultiPV1・500ms で深さ 18〜21・約 32〜42 万 nps、MultiPV3・400ms で深さ 15〜18・約 40〜50 万 nps
  - 4 スレッド：MultiPV1・500ms で深さ 19〜21・約 139〜150 万 nps、MultiPV3・400ms で深さ 16〜19・約 160〜210 万 nps（1 スレッドの約 4 倍）

## 実機で未確認のこと
- Android（Chrome）で cross-origin isolated になるか（iPad の Safari では確認済み）
- Android でエンジンが答えを返すか、速さはどれくらいか（速度測定ページの数値）
- 11mini の速さ（iPad・Android）

## 次にやること
1. 持ち主：Android で速度測定ページを開き、「結果をコピー」で数値を報告（できれば 11mini も）
2. 測定結果でプリセット（さっと・ふつう・じっくり）の値を見直す
3. 段階0の完了報告 → 了承を得てから段階1へ
