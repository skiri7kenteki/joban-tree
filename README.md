# 序盤ツリー（joban-tree）

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
  - [Preact](https://preactjs.com/) / @preact/signals（MIT License）
  - [Vite](https://vite.dev/)・vite-plugin-pwa・Vitest・Playwright（ビルドとテストにだけ使用）
