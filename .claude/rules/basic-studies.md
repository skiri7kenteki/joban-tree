---
paths:
  - "src/tree/basicStudies.ts"
  - "src/app/BasicStudiesDialog.tsx"
  - "src/data/basic-studies.json"
  - "scripts/make-basic-studies.mjs"
  - "tests/unit/basic-studies.test.ts"
---

# 基本の研究（段階20-3）

> この機能の仕様を変えたら、このファイルを直す。下のパスのファイルを読んだときだけ読み込まれる。

- **基本の研究（段階20-3、v0.46.0〜、持ち主の判断 2026-11-24「全ておすすめの通りで」。計算は `src/tree/basicStudies.ts`、窓は `src/app/BasicStudiesDialog.tsx`）**：
  - 戦型ごとの「基本の研究手順」の組。データは `src/data/basic-studies.json`（`{ sets: [{ id, templateId, name, mySide, reviewed, source: { tree, version }, lines }] }`。
    lines は戦型の出発点からの手（USI）を空白でつないだ文字）。**アプリは同梱ツリー（約 2MB）を読まない**（この小さなファイルだけ）
  - 作り方：`node scripts/make-basic-studies.mjs`（同梱ツリーの本線から）。相手の手番は 1 回目が最善手との差 150 以内・2 回目が 50 以内の手をすべて、3 回目からは最善手だけ。自分の手番はいちばん上の手。ツリーの終わり（28 手目）まで。
    **分かれ目（1・2 回目の相手の手）が端歩（▲9六歩・▲1六歩）の手順は外す**。今は横歩取り △3三角（後手番）の 8 本から端歩の 4 本を外した 4 本
  - 先手番は後で（同梱ツリーが無い）。同梱ツリーを作り直したら、版を合わせて作り直す（`tests/unit/basic-studies.test.ts` が、手順がツリーの中を通り・合法手で・ツリーの終わりまでかを確かめる）
  - **`reviewed: false` の組は窓に「未確認」の印**。有段者の持ち主が中身を確かめたら true にする（スクリプトの `reviewed` を直して作り直す）
  - 入口：定跡帳のタブの「＋ 研究手順を登録」の窓の［基本の研究を入れる］。窓は画面の下から。組ごとに 名前・本数・未確認、説明 1 行、行＝チェック・★ 名前・「28手目まで」
  - 名前は自動（`studyFromMoves`＋`autoName`。今ある研究手順と、先に並ぶ基本の研究との分かれ目から）。作った日時は 1 ミリ秒ずつずらす
  - 初めは、まだ無いものを全部チェック。**同じ手順・同じ側の研究手順がすでにあれば「入れてあります（★ 名前）」で選べない**（二重にしない）。
    ［n 本を定跡帳に入れる］で保存して、入れた組の戦型の出発点で定跡帳を開く（`bookTemplatePath`）。入れた後はふつうの研究手順（直す・消す・稽古）
