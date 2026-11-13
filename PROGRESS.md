# 進捗メモ

## 現在の状況
**段階1（最小限の PWA）の作業中**（2026-11-13 着手。段階0は完了し、持ち主の了承済み）。
棋譜の貼り付け → 局面選択 → 「さっと」で生成 → たどる → 自動保存、まで実装。GitHub Actions での通し確認と、実機での確認待ち。
公開 URL：https://skiri7kenteki.github.io/joban-tree/ ／速度測定：https://skiri7kenteki.github.io/joban-tree/bench.html

## 完了したこと

### 段階1（v0.2.0）
- 2026-11-13 プリセットを確定（持ち主了承）：さっと 30秒/400ms/N=3/3往復、ふつう 2分/800ms/N=4/4往復、
  じっくり 5分/**1000ms**/N=4/5往復（じっくりだけ 2000ms から変更）。スレッド数の初期値は「使える範囲で最大、上限 4」
- ツリー生成ロジック（`src/tree/generator.ts`）：相手ノードだけ MultiPV で調べ、PV の 1 手目＝相手の応手、2 手目＝自分の対応（未検証）。
  浅い順・同じ深さなら自分に良い順。W 点以内だけ採用。PV が 1 手なら自分ノードとして調べる。合流（同じ局面は 1 つに）。
  時間・深さ・局面数の上限と停止で終わり、どこで終わってもツリーは有効
- データの形（`src/tree/types.ts`）：`app`・`version`（1）付き。局面のキーは手数を除いた SFEN。評価値は自分から見た値で保存
- ラベル（本線・有力・疑問手）は保存せず、最善手との差（diff）から表示のときに決める（しきい値を後から変えられるように）
- 棋譜の貼り付け（`src/shogi/kifu.ts`）：KIF・KI2・CSA・SFEN・USI（`7g7f 3c3d` のような指し手だけ、`startpos moves …`、`position …`）
  - tsshogi の形式判定は「指し手だけ」を KIF と取り違えるので、指し手だけ・SFEN だけ・startpos は自前で先に見分ける
- 画面（ハッシュで切り替え。Android の戻るボタンが効く）
  - トップ：新しいツリーを作る、保存したツリーの一覧（開くだけ。名前の変更・削除は段階2）、速度測定へのリンク
  - 入力：棋譜の貼り付け、盤をタップして指す（成・不成の確認付き、持ち駒を打てる）、手順の前後とスライダー、自分は先手/後手、「さっと（30秒）で作る」
  - 閲覧：上に盤（自分が下）、手順のパンくず、1手戻る・開始局面へ、左右スワイプで戻る/進む、候補手リスト
    （相手の応手＝評価値・ラベルのチップ、自分の対応＝未検証の印、合流の印）。iPad 横向きなど広い画面では左右に並べる
  - 生成中：経過時間・調べた局面数・何往復目か・停止ボタン。生成中もできた枝からたどれる
- 自動保存（`src/storage/trees.ts`、IndexedDB を直接使う。ライブラリは足していない）：生成中は 2 秒ごと、終わったときにも保存
- 将棋盤（`src/components/Board.tsx`）：SVG、五角形の駒、相手の駒は 180 度回転、成駒は赤字、星、筋・段の数字、最終手のマス、持ち駒
- ホーム画面に追加：`public/manifest.webmanifest`、アイコン（`public/icon.svg` から `scripts/make-icons.mjs` で PNG を作成）、apple-touch-icon
- DESIGN.md：タップで選んだマスの色 `--color-selected` を追加

### 段階0（v0.1.x、2026-11-13 完了）
- 土台（TypeScript＋Vite 8＋Preact 11、Vitest、Playwright、vite-plugin-pwa の injectManifest）、GitHub Actions でビルド・テスト・公開
- やねうら王の WASM 版（コミット 96b9ae5d に SFNN_ka2 用パッチ。スレッドプール 8 本・最大メモリ 1GB）を Actions でビルド（約 4 分、キャッシュ付き）
- 評価関数：つようら王11micro・11mini（MIT。出典はやねうら王公式サイト 2026-10-14 の記事）をリポジトリに同梱
- service worker で COOP/COEP を付け足し、初回だけ 1 回再読み込み（iPad の Safari・Android の Chrome とも isolated になった）
- 速度測定ページ（`bench.html`）
- Node.js は winget が管理者確認で止まったため、持ち運び版を `C:\Users\skiri\tools\node` に置いた（PATH には入れていない）
- 分かったこと（CLAUDE.md にも記載）
  - `setoption` は **USI_Hash を Threads より先に**（初期値 1024MB のまま置換表を作り直してエンジンが終了した）
  - `progress.bin` は「実行ファイルの場所/EvalDir/」から読まれる。`thisProgram: './this.program'` で `/eval/` にそろえる
  - Emscripten の .js は CommonJS。リポジトリの `"type": "module"` の下で Node.js から読むときは、そのフォルダを CommonJS 扱いにする
  - ビルド時の `ENGINE_OPTIONS "FV_SCALE=24"` は `usi` の default に出ない。必ず `setoption` で 24 を送る

## テスト結果
- 2026-11-13 GitHub Actions（段階1、v0.2.0）：すべて合格して公開。
  **本物のエンジンでの通し確認（貼り付け → 生成 → 候補手をたどる → 停止 → 自動保存 → 一覧から開き直す）も合格**
- 2026-11-13 手元（Windows）段階1
  - 型チェック：合格
  - Vitest：40 項目すべて合格（ツリー生成 10、局面・指し手・棋譜の貼り付け 11、USI 11、エンジンを包むモジュール 4、速度測定の局面 4）
  - Playwright（Chromium）：5 項目合格（トップ・バージョン、isolation、manifest とアイコン、棋譜の貼り付けと手順の移動、盤のタップで指す）。
    エンジンを使う 3 項目（速度測定 2、貼り付け→生成→たどる→停止→自動保存 1）は GitHub Actions で実行
  - 画面写真で確認：スマホ縦（390px）で盤が幅いっぱい、iPad 横（1180px）で盤と候補手リストが左右に並ぶ
- 2026-11-13 実機の速度（段階0、11micro、ハッシュ 32MB）
  - iPad（Safari 26.6）：1 スレッド 約 32〜50 万 nps、4 スレッド 約 140〜210 万 nps。0.4 秒・MultiPV3 で深さ 16〜19
  - Android（Chrome 157）：1 スレッド 約 5〜7 万 nps、4 スレッド 約 15〜23 万 nps。0.4 秒・MultiPV3 で深さ 9〜13
- `npm audit`：ビルド時だけ使う部品（vite-plugin-pwa → workbox-build）に注意 6 件。公開されるアプリには含まれないので様子見

## 実機で未確認のこと
- 段階1の画面すべて（iPad・Android）：貼り付け → 局面選択 → 30 秒で生成 → たどる、ホーム画面に追加して起動
- 生成中に画面を消す・別のアプリに切り替えたときの動き（Wake Lock は段階2）
- 11mini の速さ

## 次にやること
1. 持ち主：iPad と Android で段階1の流れを試す（試し方は報告に書く）
2. 段階1の完了報告 → 了承を得てから段階2へ
