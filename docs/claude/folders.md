# フォルダ構成（くわしい版）

> CLAUDE.md から移した。ふだんは読み込まれない。どこに何があるか迷ったときに読む。

```
index.html / bench.html     画面の入口（bench は段階0の速度測定ページ）
src/main.tsx                アプリ本体の入口（画面の切り替え）
src/app/                    画面（トップ・入力・閲覧・設定・復習・研究手順・研究手順の復習）、生成・検証の実行と自動保存・Wake Lock、エンジンの用意、設定、共有
src/components/Board.tsx    将棋盤（SVG）と持ち駒
src/components/Dialog.tsx   重ねて出す小窓（確認・メニュー）
src/components/Footer.tsx   バージョンと「気づきを送る」（アプリでは設定のタブの行に出し、窓 FeedbackDialog を使う。Footer は速度測定ページだけ）
src/components/TabBar.tsx   画面の下のタブ（段階11-1）
src/components/KifuList.tsx 手順の一覧＝棋譜欄（段階11-5。ツリーの中身は src/tree/treeKifu.ts）
src/components/MoveBar.tsx  盤の下の固定バー（段階11-2）
src/components/OnceHint.tsx 初めての 1 回だけ出す説明（段階11-3）
src/components/Marks.tsx    覚えた割合の輪（段階12-3。芽の紋は段階13 でやめた）
src/components/Words.tsx    名前を手と手の間で折り返す（段階13）
src/shogi/                  局面・指し手の小さな関数（tsshogi を包む）、棋譜の貼り付けの読み取り
src/tree/                   ツリーのデータの形・生成ロジック（モックでテスト）・ラベル・プリセット・KIF 書き出し・JSON の読み書き・戦型テンプレート・同梱ツリーの形と点検（bundled.ts）
src/data/templates/         同梱の戦型テンプレート（JSON。段階5）
src/data/bundled-trees.json 同梱ツリーの一覧（段階6-3。scripts/bundled-catalog.mjs が作る）
src/storage/                IndexedDB への保存（db.ts が開く。trees.ts・review.ts・templates.ts・studies.ts、版 4 にするときの移し替えは migrate.ts。
                            段階17：データの保護 persist.ts、まとめてのバックアップの読み書き backup.ts。ファイルの形は src/tree/backupFile.ts、画面は src/app/DataSection.tsx）
src/games/                  実戦の照らし合わせ（段階18。棋譜の読み取り game.ts・定跡帳との照らし合わせと集計 compare.ts。保存は src/storage/games.ts、画面は src/app/GamesScreen.tsx・GameScreen.tsx）
src/practice/               稽古（段階19。間隔反復・今日の稽古の並び practice.ts、定跡帳ごとのまとめと行の文字 groups.ts、同じ出だしの早送り skip.ts〔端末の覚えは src/app/practiceMemory.ts〕。保存は src/storage/practice.ts、画面は src/app/PracticeScreen.tsx・PracticePlayScreen.tsx）
src/tree/positions.ts       局面メモと食い違い（段階20-1。保存は src/storage/positions.ts、共有は src/app/positions.ts、定跡帳のタブの知らせは src/app/ConflictNotice.tsx）
src/tree/ask.ts             エンジンに聞く（段階20-2。候補の並べ方・評価値の向き。窓は src/app/AskEngine.tsx）
src/tree/basicStudies.ts    基本の研究（段階20-3。データは src/data/basic-studies.json〔手で書く〕、窓は src/app/BasicStudiesDialog.tsx）
src/review/                 復習モードのロジック（出題の選び方・記録。研究手順だけの復習は studyReview.ts）
src/tree/kifImport.ts       変化付き KIF から研究手順をまとめて取り込む（段階8-2）
src/tree/studyBook.ts       研究手順どうしをつないで見る（段階9-2、自分の定跡帳）
src/tree/bookEdit.ts        定跡帳で直接指して研究を足す・消す・取り消す（段階10-1。画面は src/app/BookScreen.tsx）。1 本の手順を足す checkNewMoves・studyFromMoves（段階10-2）
src/app/addToBook.tsx       1 本の手順を定跡帳に足す窓（棋譜を貼る・ツリーと新しいツリーの画面から）と studyBookUrl（段階10-2）
src/app/LegacyRedirect.tsx  片付けた画面の古い URL を定跡帳・登録の窓へ移す（段階10-2）
src/app/studyFix.ts         ずれた研究手順（戦型の側・名前）をアプリを開いたときに直す（段階10 の直し）
src/review/session.ts       復習の 1 回（決まった数の問題）の数え方（段階11-4。結果の画面は src/app/ReviewResult.tsx）
src/review/overview.ts      復習のタブのまとめ（前回まちがえた数・最後に復習した日。段階11-1。画面は src/app/ReviewsScreen.tsx）
src/bench/                  速度測定ページ
src/engine/usi.ts           USI の行を読み取る関数（テスト対象）
src/engine/engine.ts        エンジンを包むモジュール（コマンドの順番待ち）
src/engine/yaneuraou.worker.ts  エンジンを動かす Web Worker
src/engine/config.ts        エンジン・評価関数のファイルの場所
src/engine/pcEngine.ts      PC 版：pc/server.mjs 経由で Windows 版やねうら王とやり取りする
pc/                         PC 版（start.bat・server.mjs・engine-files.mjs）
pc/bake/                    同梱ツリーを PC で作るコマンド（bake.bat から。段階6）
src/isolation.ts            service worker の登録と cross-origin isolated の確保
src/sw.ts                   service worker
src/styles/                 CSS（tokens.css に色などの変数・明朝体の読み込み。base.css に画面全体の基本と「墨の上」の色の入れ替え）
src/assets/fonts/           見出しの明朝体（段階12-1。scripts/make-font.py で作る）・駒の文字の字体（v0.34.0。scripts/make-koma-font.py で作る）
src/assets/board/           盤の地・駒の面の素材（段階15。駒の面は scripts/make-board-assets.py で docs/design/stage15-sheet.png から、盤の地は v0.39.1 から scripts/make-board-options.py の C_shinkaya。段階16 から駒台も盤の地）
docs/design/                見た目の見本（段階12 の C 案、段階15 の素材を当てた案と素材シート、段階16 の明るい対局室）
public/manifest.webmanifest ホーム画面用の設定（アイコンは public/*.png。scripts/make-icons.mjs で icon.svg から作る）
public/eval/                評価関数（nn.bin・progress.bin・ライセンス。リポジトリに含める）
public/trees/               同梱ツリー（<id>.v<版>.json。開くときに取りに行く。段階6-3）
engine/                     やねうら王のビルド（コミット固定・パッチ・build.sh・smoke.mjs、PC 用は build-windows.sh・pc-manifest.mjs）
tests/unit/                 Vitest（mock-engine.ts が偽物のエンジン）
e2e/                        Playwright
.github/workflows/deploy.yml  ビルド・テスト・公開
```

