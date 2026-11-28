# 使っていない機能を整理する依頼（段階の番号は持ち主が決める）

設定の整理（v0.59.1）の次です。段階27（同期のあとすぐ稽古・取り込み直しで研究を延ばす・次に研究する所を PC へ渡す）は保留中なので、
この依頼は番号を付けずに「機能の整理」と呼んでください。PROGRESS.md・コミットの名前も「機能の整理」で書きます（番号を付けるなら持ち主に聞く）。

持ち主の今の使い方は「PC の強いソフトで研究 → KIF → アプリで取り込む → Google ドライブで同期 → スマホで稽古して覚える」と、
将棋ウォーズの実戦を貼って照らし合わせること。これからは中終盤の強化に関心があり、序盤は今の機能で十分。
そこで、使っていない機能を**消す**か**画面から隠す**かして、アプリを軽く、分かりやすくします。

**進め方**：`/start-stage` の手順で、関係する rules（tree-generation.md・tree-screens.md・review.md・bundled-trees.md・pc.md・engine.md・ui.md・backup.md・drive.md・studies.md・book.md・positions.md・candidates.md・basic-studies.md・practice.md）と DESIGN.md を先に読んでください。
**設計案（消すファイルと残すファイルの一覧・下の「判断してほしいこと」への答えの案・画面の写真 スマホ縦 390×844：設定のタブ・設定のエンジンの画面・「＋ 研究手順を登録」の窓・定跡帳の ⋯ と行の ⋯ の窓・稽古でまちがえたときの札）を出したら止まってください。**
了承のあとは 整理-1 → 整理-2 の順に進め、それぞれの終わりで `/finish-stage` の手順で報告して止まってください。

## 決まったこと（持ち主の判断 2026-11-28）
- **データは消さない**。IndexedDB の中身・データの形・DB の版・バックアップのファイルの形と版・Google ドライブの同期で運ぶものは**変えない**
  （ツリー・ツリーの復習の記録・研究手順のメモ・局面メモ・候補の理由は、画面から無くなっても端末・バックアップ・同期にそのまま残る）
- **エンジンは残す**（今は使っていないが、中終盤の機能で後で使うかもしれない）。エンジンに聞く・候補表（本命・次善・悪手・咎め方・見えにくい手）・エンジンの設定はそのまま
- 残すもの：定跡帳（見る・盤で指して足す・取り消す・書き込む 入／切）、変化付き KIF の取り込み、棋譜を 1 本貼る取り込み、まとめて消す、戦型、
  食い違いの知らせ、稽古（間隔反復・早送り）、実戦のタブ、Google ドライブで同期、バックアップを保存・戻す・戻す前のデータに戻す、KIF の書き出し

## 整理-1 消す（画面とコードを外す）
1. **ツリー（以前の機能）の全部**：ツリーの一覧（`#/trees`）・新しいツリー（`#/new`）・ツリーの閲覧（`#/tree/...`）・ツリーの生成・ツリーの復習（`#/review/...`、研究手順だけの復習を含む）・
   用意済みツリー（`public/trees/`・同梱の目録）・ツリーの JSON の取り込み・ツリーの書き出しと共有・PC 版の「精密（10分）」プリセット。
   設定の「ツリー（以前の機能）」の行と下の画面（`#/settings/trees`：W・局面の上限・検証の時間・プリセット・復習の 1 回の問題の数）も外す
   - ツリーの URL を開いたときは定跡帳のタブへ（壊れた画面を出さない）
   - **残すもの**：DB の `trees`・`reviews` の入れ物と、バックアップ・同期でそれを読み書きする所（読んだまま持って運ぶだけ）。形式 6 までのツリーの中の研究手順の移し替え（`migrate.ts`。古いデータを守るため）
   - エンジンに聞くが使っている物（本線と有力の境目 `thresholds`・ラベル・エンジンの設定・PC 版のエンジンの中継 `pc/`）は残す
2. **気づきを送る**（設定の行と窓、`Footer.tsx` の issue を開く窓）：仲間と共有しなくなったため
3. **エンジンの速度測定**（設定のエンジンの画面の行と `bench.html`・`src/bench/`）
4. **古い画面への道**：前の版の URL を今の画面へ移す処理（`LegacyRedirect.tsx`・`#/study/...`・`#/new/study`・`#/study-review/...` など）。消した URL は定跡帳のタブへ。
   `#/reviews` → 稽古のような軽いものは残してよい（Claude Code の判断）
- 使われなくなった CSS・テスト・スクリプト（ツリーの生成の bench・同梱ツリーを作るスクリプトなど）も消す。**消すのはコードだけで、端末のデータには触らない**

## 整理-2 隠す（画面から外すだけ。データとデータを扱うコードは残し、後で戻せるようにする）
5. **手のコメントの類**（持ち主は使っていない）：研究手順の**メモ**を書く欄と表示（名前を直す所は残す）・**局面メモ**を書く欄と表示（稽古でまちがえたときの札の下を含む）・候補の**理由**を書く欄と表示
   - KIF の取り込みでコメントをメモに入れる処理は今のまま（データには入る。画面に出ないだけ）
6. **ほかの端末のバックアップを合わせる**（データ管理の［ほかの端末のバックアップを合わせる］）：Google ドライブの同期で足りる
7. **基本の研究を入れる**（「＋ 研究手順を登録」の窓の［基本の研究を入れる］）：PC で研究した KIF を入れる使い方なので
8. **JSON の取り込み**（「＋ 研究手順を登録」の窓の［JSONを取り込む］）：持ち主は使っていない。バックアップのファイルから戻すのはそのまま
- 隠すのは 1 か所（例：`src/app/hidden.ts` の決まり）でまとめて切り替えられる形がよい（Claude Code の判断）

## 判断してほしいこと（設計案の冒頭に、おすすめを付けて出す）
1. **研究手順の書き出しの JSON**（データ管理の書き出し）：取り込みを隠すなら書き出しの JSON も隠すか（KIF とバックアップで足りる）
2. **KIF の書き出しのコメント**：画面から隠したメモ・局面メモ・候補の理由を、KIF に書き出すときは今まで通り入れるか
3. **整理の前に持ち主がしておくこと**：ツリーを念のため残したいなら、整理の前の版でバックアップを保存しておく、という案内を報告に入れるか
4. 消して軽くなった量（ビルドの大きさ・テストの数の前後）を報告に入れる

## 確かめること（テスト）
- Vitest：今あるテストのうち、残す機能のものは全部通る。消した機能のテストは消す。`tests/unit/rules.test.ts` は通る（落ちたらコードの方を直す）
- **データが消えないこと**：ツリー・ツリーの復習の記録・メモ・局面メモ・候補の理由が入ったバックアップを戻す → 保存し直したバックアップに同じものが入っている。同期で運ぶものも同じ
- Playwright：設定のタブ（ツリー・気づきを送るの行が無い）、エンジンの画面（速度測定が無い）、ツリーや古い URL を開くと定跡帳のタブ、
  「＋ 研究手順を登録」の窓（基本の研究・JSON が無い）、定跡帳と稽古にメモ・局面メモ・理由が出ない、エンジンに聞くは今まで通り動く、盤の画面は 1 画面に収まる（`e2e/one-screen.spec.ts`）
- 仕様を変えたら rules を直す。消した機能の rules（tree-generation.md・tree-screens.md・review.md・bundled-trees.md と pc.md の精密ツリーの所）は `docs/claude/history.md` へ移し、CLAUDE.md の「機能ごとの仕様の場所」の表から外す

---

# 設計案（2026-11-28。持ち主の判断待ち。コードはまだ変えていない）

## 整理の前の値（報告で比べる）
- ビルド（v0.59.1）：本体の JS 407.57 kB（gzip 124.86）・CSS 54.97 kB・Footer の JS 38.96 kB＋CSS 5.47 kB・bench の JS 8.78 kB・事前キャッシュ 18 件 1165.42 KiB。public/trees/ の大きさは未計測
- テスト：Vitest 525 項目、Playwright 242 項目合格・6 項目省略

## 整理-1 で消すファイル
- 画面：src/app/ の TreeScreen・InputScreen・ReviewScreen・StudyReviewScreen・ReviewResult・generation・bundledTrees・handoff・LegacyRedirect
- 保存：src/storage/trees.ts・review.ts（バックアップは db.ts を直接使うので影響なし）
- 計算：src/tree/ の browse・edit・kif・treeKifu・bundled・bundledCatalog・generator、src/review/ の session・overview
- ほか：src/data/bundled-trees.json、scripts/bundled-catalog.mjs、public/trees/、bench.html、src/bench/、pc/bake/、pc/bake.bat、pc/engine-files.d.mts
- 単体テスト：bake・bench-positions・browse・bundled-trees・dubious・exclude・explore・generator・reply・verify・tree-kifu・review・review-overview・review-session・export（fileNameOf の項目は移す）・mock-engine
- 画面のテスト：engine・phase3・phase4・phase6・phase7、e2e/studyTree.ts・treeMenu.ts

## 残して一部を削るファイル
HomeScreen・SettingsScreen・SettingsPages・router・main・Footer（版の番号は残す）・engineService・settings・recent・addToBook・StudyDialogs・studies（tree と app）・organize・backup（tree。treeProblem・fileNameOf・dateStamp は残す）・
review.ts と studyReview.ts（稽古・実戦・移し替えが使う分を残す）・DataSection・AskEngine・syncing（生成中の確かめを外す）・sw.ts・app.css・base.css・vite.config・tsconfig・package.json・.gitignore
- そのまま：types・labels・backupFile・merge・deleted・templates・studyFile・storage の migrate・db・backup・persist・pc/server.mjs・pc/start.bat・pc/engine-files.mjs・src/engine/

## 気をつけること（調査で分かった）
1. 定跡帳の一覧は trees の読み込みを待っている（移し替えの知らせもその中）。切り離す
2. 移し替え（migrate）が使う review の計算は generator.ts の小さな関数 isOpponentNode を使う。移してから generator を消す
3. メモ欄を隠して名前を保存するとき、メモは元の値のまま渡す（今は末尾の空白を削るので、変えていないのに「メモを直した」になりうる）
4. 「JSONを取り込む」はボタンだけ隠し、見えないファイル欄と処理は残す（画面のテスト 21 本がデータを入れるのに使う）
5. ツリーの画面を通してしか確かめていない残る機能は、定跡帳・稽古で確かめるように書き直す：正解の光と動きを減らす設定・駒と駒台と盤の見た目・盤の向き・オフライン起動・設定の保存と初期化・戦型の管理と入出力・移し替え・trees と reviews のバックアップ往復
6. 端末の保存分（同梱ツリーのキャッシュ joban-tree-trees も）には触らない

## 整理-2 の隠し方
src/app/hidden.ts の決まり 1 か所（手のコメント・端末のバックアップを合わせる・基本の研究・JSON の取り込みと書き出し）。コードと単体テストは残す。画面のテストのうち隠した機能の分は外すか、残る操作に置きかえる

## 判断してほしいこと（おすすめ）
1. 研究手順の書き出しの JSON：隠す
2. KIF の書き出しのコメント：今まで通り入れる（研究メモ・局面メモ・候補の印の行。候補の理由は今も KIF に入っていない）
3. 整理の前の案内：入れる。ただし整理-1 を公開する前に伝える（公開後は前の版を開けない。ツリーを後で見たいなら、前の版で KIF に書き出す。バックアップはデータは残るが新しい版では見られない）
4. 軽くなった量：報告に入れる
5. public/trees/：権限の設定で読めないので、了承があれば中を読まずに git rm -r で消す。拒否されたら持ち主に消してもらう（回避はしない）
6. データ管理・戻す確認の「ツリー n 個・復習の記録・局面メモ n 個」の数：残す（データが残っていると分かる）。操作を案内する文だけ直す
7. ツリー専用の設定の値（プリセット・W・上限・検証の時間・復習の問題数）：画面は消し、値は読んで持ち運ぶだけ残す（バックアップで運ぶものを変えないため）
