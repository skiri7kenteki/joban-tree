// 端末の保存場所を版 4 にするときの移し替え（段階8-1）：ツリーの中の研究手順（形式 6）を、独立した研究手順（studies）へ移す。
//
// - ブラウザが「版を上げる処理」（onupgradeneeded）の中で行う。この処理は 1 回しか行われない（次に開くときはもう版 4）
// - 版を上げる処理は「全部やり切るか、まったく何もしないか」。途中で失敗したりアプリを閉じたりすると版 3 のまま残り、
//   次に開いたときに最初からやり直す。半分だけ移って消える・二重になることは無い
// - やること（src/tree/studies.ts の migrateTrees）：
//   1. 研究手順のあるツリーを読む
//   2. 手順を「ツリーの開始局面までの手順＋ツリーの中の手順」＝平手からの手順にする（id・名前・メモ・日時はそのまま、自分の側はツリーの側）
//   3. 同じ手順が複数のツリーにあれば 1 本にまとめる（名前は新しい方、メモは違えば両方つなぐ）
//   4. ツリーから研究手順を外す（形式 7）
//   5. 平手から始まらないツリーの研究手順は、消さずにツリーの中に残す（数をトップ画面に一度だけ知らせる）
//   6. v0.17.0 で研究手順を答えた復習の記録を、研究手順用の記録へ写す（src/review/studyReview.ts の liftReviewRecords）

import { STUDY_RECORD_ID, liftReviewRecords } from '../review/studyReview';
import type { ReviewRecord } from '../review/review';
import { migrateTrees } from '../tree/studies';
import type { TreeData } from '../tree/types';

/** 移し替えの結果をトップ画面に一度だけ知らせるための、端末の記録（localStorage）のキー */
export const MIGRATION_NOTE_KEY = 'joban-tree.study-migration';

export interface MigrationNote {
  /** 移した研究手順の数（まとめた後） */
  moved: number;
  /** 平手から始まらないツリーに残した数 */
  leftover: number;
  /** 移し替えの途中で思わぬ問題があり、移さなかった（研究手順はツリーの中に残っている） */
  failed?: boolean;
}

/** 版を上げる処理の中で呼ぶ（tx は版を上げる処理のトランザクション。trees・review・studies の置き場所があること） */
export function migrateStudiesInUpgrade(tx: IDBTransaction, stores: { trees: string; review: string; studies: string }): void {
  const treesReq = tx.objectStore(stores.trees).getAll();
  treesReq.onsuccess = () => {
    const withStudies = (treesReq.result as TreeData[]).filter((t) => t.studies && t.studies.length > 0);
    if (withStudies.length === 0) return;
    const reviewReq = tx.objectStore(stores.review).getAll();
    reviewReq.onsuccess = () => {
      const records = reviewReq.result as ReviewRecord[];
      // 移し替えの計算で思わぬ問題が起きても、版を上げる処理そのものは失敗させない（失敗させると、アプリが保存場所を開けなくなる）。
      // そのときは何も書き換えず、研究手順はツリーの中に残る（消えない）
      let m: ReturnType<typeof migrateTrees>;
      let lifted: ReviewRecord;
      try {
        m = migrateTrees(withStudies);
        lifted = liftReviewRecords(withStudies, records, records.find((r) => r.treeId === STUDY_RECORD_ID));
      } catch {
        writeNote({ moved: 0, leftover: withStudies.reduce((n, t) => n + (t.studies?.length ?? 0), 0), failed: true });
        return;
      }
      const studyStore = tx.objectStore(stores.studies);
      for (const s of m.studies) studyStore.put(s);
      const treeStore = tx.objectStore(stores.trees);
      for (const t of m.changed) treeStore.put(t);
      if (Object.keys(lifted.nodes).length > 0) tx.objectStore(stores.review).put(lifted);
      writeNote({ moved: m.studies.length, leftover: m.leftover });
    };
  };
}

function writeNote(note: MigrationNote): void {
  try {
    localStorage.setItem(MIGRATION_NOTE_KEY, JSON.stringify(note));
  } catch {
    // 知らせを出せないだけで、移し替えそのものには関係ない
  }
}

/** 移し替えの知らせを読んで消す（トップ画面で一度だけ出す） */
export function takeMigrationNote(): MigrationNote | null {
  try {
    const raw = localStorage.getItem(MIGRATION_NOTE_KEY);
    if (!raw) return null;
    localStorage.removeItem(MIGRATION_NOTE_KEY);
    const note = JSON.parse(raw) as MigrationNote;
    return typeof note.moved === 'number' && typeof note.leftover === 'number' ? note : null;
  } catch {
    return null;
  }
}
