---
paths:
  - "pc/bake/**"
  - "scripts/bundled-catalog.mjs"
  - "src/tree/bundled.ts"
  - "src/tree/bundledCatalog.ts"
  - "src/app/bundledTrees.ts"
  - "src/data/bundled-trees.json"
  - "tests/unit/bundled-trees.test.ts"
---

# 同梱ツリー

> CLAUDE.md から移した仕様（2026-11-24）。この機能の仕様を変えたら、このファイルを直す。
> 下のパスのファイルを読んだときだけ読み込まれる。

## 同梱ツリー（段階6）
- PC で時間をかけて作ったツリーを、アプリに最初から入れておく。まず「横歩取り △3三角（後手番）」（`yokofu-33kaku-gote`）の 1 本
- 作るのは `pc/bake.bat` → `pc/bake/main.ts`（Node.js。Vite で `pc/bake/dist/bake.mjs` にまとめて動かす。`npm run bake` も同じ）。ブラウザは使わない
  - ツリー生成は `src/tree/generator.ts`（TreeGenerator）を**そのまま**使い、`src/engine/engine.ts` の UsiEngine をネイティブの `engine.exe` に直接つなぐ（`pc/bake/nodeEngine.ts`）
  - エンジンと評価関数の用意は `pc/engine-files.mjs`（`pc/server.mjs` と共通）
  - 作り方（戦型・版・評価関数・設定）は `pc/bake/specs.ts`。時間と局面の数の上限は付けず、深さの上限まで作りきる
  - **1 局面調べるたびに** `%LOCALAPPDATA%\joban-tree-pc\bake\<id>\progress.json` に保存（別名で書いてから名前を変える）。同じコマンドで続きから（TreeGenerator の collectFrontier がまだ調べていない局面を拾い直す）。
    設定が違う途中経過からは続けない（`--fresh` で作り直し、前のものは名前を変えて残す）
  - 作り終わったら `unverifiedMine`（`src/tree/bundled.ts`）で、自分の局面に確定した手が無いものを点検し、あれば `verify` してその先も作る（`pc/bake/baker.ts`）
  - 見込み（`pc/bake/estimate.ts`）：終わった往復の相手の局面の数の伸びと、相手の局面 1 つあたりの自分の局面の数から、残りの局面と時間を出す
  - 実行中は PowerShell で `SetThreadExecutionState`（ES_CONTINUOUS | ES_SYSTEM_REQUIRED）を出し続けてスリープを止める
  - できあがり：`ドキュメント\joban-tree-bake\<id>\<id>.v<版>.json`（`{app, kind:'bundled-tree', version:1, bundle:作った条件の記録, tree:TreeData}`）。書き出す前に `checkBundledTree` で点検
- アプリに入れる（段階6-3）：できあがりを `public/trees/` に置き、`node scripts/bundled-catalog.mjs` で一覧 `src/data/bundled-trees.json` を作り直す。
  `tests/unit/bundled-trees.test.ts` が、一覧とファイルの一致・点検（合法手・出発点・形・記録）を確かめる
  - アプリ本体には一覧だけ（`src/tree/bundledCatalog.ts`）。中身は「用意済みのツリーを開く」で取りに行き（`src/app/bundledTrees.ts`）、キャッシュ `joban-tree-trees` に保存（service worker もキャッシュ優先）。
    `joban-tree-big` に入れない（古いエンジン・評価関数を消す処理が、ほかのファイルも消すため）。事前キャッシュ（precache）にも入れない（json は対象外）
  - 開くと**利用者のツリーとしてコピー**する（`copyBundledTree`。新しい id、名前は戦型の名前、生成の条件は端末の「ふつう」、`source: {kind:'bundled', id, version, finishedAt}`）。ツリーの形式 4 は `source` を足しただけ
  - 入力画面：今の局面・自分の側から始まる同梱ツリーがあれば（`bundledFor`）、作るボタンの上に「用意済みのツリーを開く」（色付き・幅いっぱい。そのとき「ふつう」は色無し、説明の行は省く）。
    `bundledStatus`：コピーが無い→取ってきてコピー、今の版のコピー→いちばん最近使ったコピーを開く（横に「新しくコピー」）、前の版のコピーだけ→「新しい版があります」と、新しいコピーを作る（前のコピーは上書きしない）
  - 一覧：コピーに「用意済み」、前の版なら「新しい版あり」の印
  - **同梱ツリーを作り直すときは版を上げて、ファイル名も変える**（`<id>.v<版>.json`。端末に保存した古い版の URL と分けるため。古いファイルは public/trees/ から消してよい）
- `bake.bat` も**英数字だけ**・CRLF
