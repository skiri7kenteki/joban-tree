// 復習の記録を端末の中（IndexedDB）に保存する。ツリーの JSON（書き出し・共有）には入れない（自分だけの記録）。

import { emptyRecord, type ReviewRecord } from '../review/review';
import { REVIEW, done, openDb } from './db';

export async function loadReview(treeId: string): Promise<ReviewRecord> {
  const db = await openDb();
  const found = (await done(db.transaction(REVIEW).objectStore(REVIEW).get(treeId))) as ReviewRecord | undefined;
  return found ?? emptyRecord(treeId);
}

export async function saveReview(record: ReviewRecord): Promise<void> {
  const db = await openDb();
  await done(db.transaction(REVIEW, 'readwrite').objectStore(REVIEW).put(structuredClone(record)));
}

/** 記録を消す（「記録を消す」ボタン。画面で確認を出してから呼ぶ） */
export async function clearReview(treeId: string): Promise<void> {
  const db = await openDb();
  await done(db.transaction(REVIEW, 'readwrite').objectStore(REVIEW).delete(treeId));
}
