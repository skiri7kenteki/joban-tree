---
name: finish-stage
description: 段階（フェーズ）や作業の区切りを締めるときに使う。テスト・version を上げる・PROGRESS.md・rules の更新・commit・pull --rebase・push・持ち主への報告の手順。
---

# 段階を締める手順

上から順に行う。途中で失敗したら、回避策を重ねずに止まって状況と選択肢を報告する。

1. **テスト**：ロジック（Vitest）と画面（Playwright）を流す。出力は失敗した所だけを絞って読む（全部を読まない）
2. **version**：公開する変更があれば `package.json` の `version` を上げる
3. **仕様の書き先**：この段階で決まった仕様を、その機能の `.claude/rules/*.md` に書く（CLAUDE.md の「機能ごとの仕様の場所」）。
   新しい機能なら rules のファイルを足し、`paths:` に関係するファイルを書き、CLAUDE.md の表に 1 行足す。片付けた機能の説明は `docs/claude/history.md` へ移す
4. **PROGRESS.md**：完了したこと・実機で未確認のこと・次にやること・テスト結果
5. **commit → `git pull --rebase` → push**（push の前に必ず pull --rebase）
6. **報告**（持ち主はプログラミング初心者。専門用語は短く補う）：
   - 何ができたか
   - スマホ・iPad での試し方（画面を開く順に、押す所まで）
   - 判断してほしいこと（選択肢と、おすすめとその理由）

報告したら止まる。持ち主の了承を得てから次の段階へ進む。
