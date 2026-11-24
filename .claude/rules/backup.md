---
paths:
  - "src/storage/persist.ts"
  - "src/storage/backup.ts"
  - "src/storage/db.ts"
  - "src/tree/backupFile.ts"
  - "src/app/DataSection.tsx"
---

# データを守る・まとめてのバックアップ（段階17）

> CLAUDE.md から移した仕様（2026-11-24）。この機能の仕様を変えたら、このファイルを直す。
> 下のパスのファイルを読んだときだけ読み込まれる。

- **データを守る（段階17、v0.41.0〜、持ち主の依頼書 stage17-prompt・判断 2026-11-23「おすすめの通りで」。`src/storage/persist.ts`・`src/storage/backup.ts`・`src/tree/backupFile.ts`・`src/app/DataSection.tsx`）**：
  - データの保護：`navigator.storage.persist()` を、アプリを開いたとき（研究手順かツリーが 1 つでもあるとき）と、研究手順を保存したとき（開いている間に 1 回）に呼ぶ。守られていれば何もしない。
    設定の「データ」に「守られています／守られていません／この端末では確かめられません」。守られていなければ説明（ホーム画面に追加すると守られやすい・ときどきバックアップを）と［守るように頼む］
  - まとめてのバックアップ：設定の［バックアップを保存］で、研究手順・ツリー（用意済みのコピーも）・復習の記録（ツリーと研究手順）・自分で登録した戦型・設定を 1 つの JSON
    （`{ app: 'joban-tree', kind: 'backup', version: 1, createdAt, appVersion, data: { studies, trees, reviews, templates, prefs } }`、ファイル名 `将棋定跡帳-バックアップ-2026-11-23-1305.json`）。
    共有の画面（使えなければダウンロード）。iPhone/iPad は押した直後でないと共有を断るので、ファイルの中身は設定の画面を開いたとき（と設定を変えたとき）に作っておく
  - 設定（`prefs`）に入れるのは localStorage の `joban-tree.settings`・`joban-tree:book-write`・`joban-tree.home-collapsed`・`joban-tree.hints-seen`・`joban-tree.recent`（`PREF_KEYS`）。アプリの中だけの記録は入れない
  - **あとから種類を足せる**：段階18 の実戦の棋譜などは `data` に種類を足すだけ（`version` は 1 のまま。`KNOWN_KINDS` に足し、読み書きを足す）。この版が知らない種類のあるファイルは、戻せるが「それは入りません」と知らせる。
    形の違う新しい `version` のファイルは「新しい版のアプリで作ったバックアップです」と断る
  - 戻す（置きかえるだけ。足すはしない）：ファイルを選ぶ → 形を確かめる（ツリー・研究手順・戦型は今の取り込みと同じ確かめ方、復習の記録・設定は `backupFile.ts`。1 つでもおかしければ全体を読まない）→
    中身の数を見せて「今のデータを全部置きかえる」→ **戻す前のデータを端末の中に取っておく**（別の IndexedDB `joban-tree-before-restore` に最新の 1 回分。今の保存場所の形は変えない）→
    4 つの保存場所を 1 つのトランザクションで空にして書く → アプリを読み込み直す。設定の［戻す前のデータに戻す（日時）］で元に戻せる（戻すとまた今のデータが取っておかれる）。ツリーの生成中は戻さない
  - 最後にバックアップした日（localStorage `joban-tree.last-backup`。共有の画面で保存先を選び終えたとき・ダウンロードを始めたときに書く）を設定に出す。
    研究手順が 1 本以上あり、最後のバックアップ（まだなら、いちばん古い研究手順を作った日）から 30 日以上なら、定跡帳の一覧の上に「しばらくバックアップしていません［設定で保存］［×］」。
    閉じたら 30 日は出さない（`joban-tree.backup-nudge-hidden-until`）
  - テスト：`tests/unit/backup-file.test.ts`（作る → 読むで元どおり・おかしいファイルを断る・知らない種類・すすめの時機）、`e2e/phase17.spec.ts`（保存 → 全部消す → 戻すで元どおり・戻す前のデータに戻す・おかしいファイル・すすめ）
