# 将棋定跡帳（joban-tree。旧名 序盤ツリー）

将棋の序盤研究用の Web アプリ（PWA）です。スマホ・iPad だけで、ある局面から
「相手のいろいろな応手に対する対策ツリー」を作り、見て、保存できるようにすることを目指しています。

公開 URL：https://skiri7kenteki.github.io/joban-tree/
（段階2：生成〔ふつう・じっくり〕、ここから展開・この手を検証、KIF/JSON の書き出し・共有・取り込み、設定、オフライン、気づきを送る。速度測定ページ `bench.html` もあります）

## しくみ
- 画面：TypeScript ＋ Vite ＋ Preact
- エンジン：[やねうら王](https://github.com/yaneurao/YaneuraOu) の WebAssembly 版を Web Worker で動かす
- 評価関数：つようら王11micro / 11mini（`public/eval/`）
- 公開：push すると GitHub Actions がエンジンのビルド・テスト・公開まで自動で行う（`.github/workflows/deploy.yml`）

## 手元の PC で動かす（Windows）
ふだんは push → 公開 → スマホで確認 の流れなので、この手順は必要なときだけで大丈夫です。

1. Node.js を入れる
   - https://nodejs.org/ja から「LTS（推奨版）」の Windows 用インストーラーをダウンロードして実行する
     （PowerShell で `winget install OpenJS.NodeJS.LTS` でも入れられます）
   - 入ったかの確認：PowerShell を開き直して `node -v` と打ち、`v26.x.x` のように出れば OK
2. このフォルダで部品を入れる：`npm install`
3. 開発用のサーバーを起動する：`npm run dev`
   - 画面に `Local: http://localhost:5173/joban-tree/` と `Network: http://192.168.x.x:5173/joban-tree/` が出る
   - PC のブラウザでは Local の方を開く
   - **同じ Wi-Fi のスマホからは Network の方の URL を開く**（Windows のファイアウォールの確認が出たら「プライベート ネットワーク」を許可）
4. 止めるときは、PowerShell で `Ctrl + C`

注意：
- 手元ではエンジン（WASM）はビルドしません（Docker が必要なため）。エンジンを動かして確かめたいときは、
  GitHub Actions の成果物を使うか、公開版で確認してください。
- スマホから Network の URL（http）で開くと、ブラウザの制限でエンジンが動かないことがあります。エンジンの確認は公開版で行ってください。

### よく使うコマンド
| コマンド | すること |
|---|---|
| `npm run dev` | 開発用サーバーを起動 |
| `npm test` | ロジックのテスト（Vitest） |
| `npm run typecheck` | 型のチェック |
| `npm run build` | 公開用のファイルを `dist/` に作る |
| `npx playwright test` | 画面の通し確認（初回は `npx playwright install chromium` が必要） |

## PC で作る（精密ツリー）
PC（Windows）では、ブラウザの中のエンジンの代わりに、PC 用（Windows 版）のやねうら王で速く・深く調べられます（ブラウザ版の約 3 倍）。

1. Node.js を入れておく（上の「手元の PC で動かす」の 1.）
2. `pc/start.bat` をダブルクリック → 黒い画面が開き、ブラウザで `http://localhost:18765/joban-tree/` が開く
   - 初回は、エンジン（約 2MB）と評価関数を GitHub Pages から `%LOCALAPPDATA%\joban-tree-pc` にダウンロードする
3. いつもと同じ画面で作る。PC 版だけ「精密（10分）」のプリセットがある
4. できたツリーは「JSON で渡す」で iPad やスマホに渡す
5. 終わるときは黒い画面を閉じる

注意：
- PC 版の画面（`localhost:18765`）で作ったツリーは、同じ PC のブラウザでも公開版（`skiri7kenteki.github.io`）の一覧には出ません（ブラウザがサイトごとに保存を分けるため）。
  PC 版を開けば、また見られます
- ポート番号（18765）を変えると別のサイト扱いになり、保存したツリーが見えなくなります
- しくみ：`pc/server.mjs`（Node.js の標準機能だけ）が、画面を GitHub Pages から中継し、エンジンと画面の間で USI の行を受け渡す。
  この PC の中（127.0.0.1）からしか接続できない。エンジンは `public/pc-engine/manifest.json` の sha256 と一致したものだけ動かす

## 同梱ツリーを作る（PC で 1〜2 時間）
アプリに最初から入れておく「用意済みのツリー」を、PC のエンジンで時間をかけて作ります。ブラウザは使いません。
作り方（戦型・深さ・時間）は `pc/bake/specs.ts` に書いてあります（今は「横歩取り △3三角（後手番）」の 1 本。6 往復・相手の応手は最大 4・W 300・11mini）。

### 始める
1. このフォルダで一度 `npm install` をしておく（上の「手元の PC で動かす」）
2. **`pc/bake.bat` をダブルクリック** → 黒い画面が開いて作り始める
   - 初回は、エンジンと評価関数を `%LOCALAPPDATA%\joban-tree-pc` にダウンロードする（PC 版と共通）
   - 1 往復終わるごとに、往復ごとの局面の数と「見込み：残り約○分（合計 約○時間）」が出る。1 分ごとに経過も出る
3. 終わると「書き出しました」と出る。できあがりは **`ドキュメント\joban-tree-bake\<id>\<id>.v<版>.json`**（と、記録の `log.txt`）
4. アプリに入れる：できあがりを `public/trees/` にコピーし、`node scripts/bundled-catalog.mjs` で一覧（`src/data/bundled-trees.json`）を作り直してから、テスト → push。
   作り直したときは `pc/bake/specs.ts` の `version` を上げる（ファイル名の版も変わる。利用者のコピーは上書きされず、「新しい版があります」と出る）

### 止める・続きから作る
- 止めるとき：黒い画面で **Ctrl+C**（今調べている 1 局面が終わってから止まる）か、黒い画面を閉じる
- **続きは、もう一度 `pc/bake.bat` をダブルクリックするだけ**。止まったところ（まだ調べていない局面）から続ける。
  PC のスリープ・電源が切れた・エンジンが落ちた、でも同じ（途中経過は 1 局面ごとに保存している。失うのは、調べていた 1 局面だけ）
- 途中経過の場所：`%LOCALAPPDATA%\joban-tree-pc\bake\<id>\progress.json`（OneDrive の同期の外。記録は同じ場所の `log.txt`）
- 最初から作り直す：`pc\bake.bat --fresh`（前の途中経過は `progress-<日時>.json` という名前で残す）
- 試し：`pc\bake.bat --trial`（3 往復だけ作り、本番の見込みを出す。本番とは別の場所に保存）

### スリープしないように
- 黒い画面が開いている間は、自動でスリープしないよう Windows に伝えている（画面は消えてよい。管理者の権限は要らない）
- **ノート PC のふたを閉じるとスリープする**ので、ふたは開けたままにする（または「設定 → システム → 電源 → ふたを閉じたときの動作」を「何もしない」に）
- 念のため止めたいとき：「設定 → システム → 電源とバッテリー → 画面とスリープ」で、電源接続時のスリープを「なし」に（終わったら戻す）
- 電源アダプターをつないでおく

### しくみ
- `pc/bake/main.ts`：アプリと同じツリー生成（`src/tree/generator.ts`）と USI のやり取り（`src/engine/engine.ts`）を、Node.js からネイティブのエンジン（`engine.exe`）に直接つなぐ。
  `bake.bat` が毎回 Vite で `pc/bake/dist/bake.mjs` にまとめてから動かす（`npm run bake` でも同じ）
- 作り終わったら、自分の局面に「調べて確定した手」が無いものが残っていないか点検し、あれば調べて確定させる（自分の手を「未検証」のまま残さない）
- できあがりの JSON には、ツリーと**作った条件の記録**（エンジン・評価関数・スレッド数・ハッシュ・CPU・設定・作り始めと作り終わりの日時・局面の数・かかった時間・アプリの版）が入る
- オプション：`--threads <数>`（初期値：論理プロセッサの数 − 2）、`--hash <MB>`（初期値 1024）、`--allow-sleep`（スリープを止めない）

## エンジンのビルド（GitHub Actions が行う）
- PC 用（Windows 版）は、同じコミット・パッチを MinGW でクロスビルドします（`engine/build-windows.sh`。AVX2 対応の CPU 用）
- `engine/yaneuraou.commit` のコミットのやねうら王に、`engine/patches/` のパッチを当てて、
  Docker イメージ `emscripten/emsdk:3.1.43` の中でビルドします（`engine/build.sh`）
- 評価関数は埋め込まず、アプリが `nn.bin` と `progress.bin` をエンジンの仮想ファイルシステムに書き込みます
- やねうら王のコミット・パッチ・`build.sh` が変わらなければ、前回のビルド結果を使います（キャッシュ）

## ライセンス
- このリポジトリ：**GPLv3**（`LICENSE`）。やねうら王（GPLv3）の WebAssembly 版と Windows 版を同梱して配信するためです
- やねうら王：GPLv3。ソースは https://github.com/yaneurao/YaneuraOu （使っているコミットは `engine/yaneuraou.commit`、変更点は `engine/patches/`）
- つようら王11micro / 11mini の評価関数（`nn.bin`・`progress.bin`）：MIT License（`public/eval/LICENSE-tuyoura.txt`。出典：[やねうら王公式サイトの公開記事](https://yaneuraou.yaneu.com/2026/10/14/tsuyou-11-mini-micro-released-under-mit-license/)）
- 使っている主な部品：
  - [tsshogi](https://github.com/sunfish-shogi/tsshogi)（MIT License）
  - [Noto Serif JP](https://github.com/google/fonts/tree/main/ofl/notoserifjp)（SIL Open Font License 1.1。見出しの明朝体。太さ 600・JIS 第 1 水準までに削ったもの。駒の文字は太さ 900 を駒の字だけに削ったもの。`public/fonts/OFL-NotoSerifJP.txt`、作り方は `scripts/make-font.py`・`scripts/make-koma-font.py`）
  - [Preact](https://preactjs.com/) / @preact/signals（MIT License）
  - [Vite](https://vite.dev/)・vite-plugin-pwa・Vitest・Playwright（ビルドとテストにだけ使用）
