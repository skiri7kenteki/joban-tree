---
name: finish-stage
description: 段階（フェーズ）や作業の区切りを締めるときに使う。全部のテスト・見直し・画面の撮影・version・rules と PROGRESS.md の更新・commit・pull --rebase・push・持ち主への報告の手順。
---

# 段階を締める手順

上から順に行う。原因の分からない失敗や、回避策が要る失敗が出たら、回避策を重ねずに止まって状況と選択肢を報告する。

1. **全部のテスト**：test-runner サブエージェントに「全部」と頼む。落ちたら直して、落ちたものだけもう一度
2. **見直し**：reviewer サブエージェントに差分を見てもらう。「直すべき」は直す。「確かめたい」は報告に入れる
3. **画面の撮影**（画面を変えた段階だけ）：`SHOTS=1 npx playwright test e2e/screens.spec.ts`（Windows の PowerShell なら `$env:SHOTS=1; npx playwright test e2e/screens.spec.ts`）。
   `screenshots/` に撮れた画像のうち、この段階で変えた画面を Read で見て、はみ出し・重なり・文字の切れ・1 画面に収まっているかを確かめる。見つけたら直す
   - 新しい画面を作ったら、`e2e/screens.spec.ts` に撮る画面を足す
4. **version**：公開する変更があれば `package.json` の `version` を上げる
5. **仕様の書き先**：決まった仕様を、その機能の `.claude/rules/*.md` に書く。新しい機能なら rules のファイルを足し、`paths:` に関係するファイルを書き、CLAUDE.md の表に 1 行足す。片付けた機能の説明は `docs/claude/history.md` へ
6. **PROGRESS.md**：完了したこと・実機で未確認のこと・次にやること・テスト結果
7. **commit → `git pull --rebase` → push**（push の前に必ず pull --rebase。フックでも確かめている）
8. **報告**（持ち主はスマホから読む。短く、専門用語は短く補う）：
   - 何ができたか
   - スマホ・iPad での試し方（画面を開く順に、押す所まで）
   - 撮った画面で確かめたこと（「スマホ縦 360×640 で、稽古の画面が 1 画面に収まっている」のように）
   - 判断してほしいこと（選択肢と、おすすめとその理由）

報告したら止まる。持ち主の了承を得てから次の段階へ進む。
