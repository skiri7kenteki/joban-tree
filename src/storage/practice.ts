// 稽古の記録（段階19）を端末の中（IndexedDB の practice。キーは研究手順の id）に保存する。データは端末の外へは送らない。

import type { PracticeRecord } from '../practice/practice';
import { PRACTICE, done, finished, openDb } from './db';

/** 保存してある稽古の記録 */
export async function listPractice(): Promise<PracticeRecord[]> {
  const db = await openDb();
  return (await done(db.transaction(PRACTICE).objectStore(PRACTICE).getAll())) as PracticeRecord[];
}

/** 保存する（同じ研究手順なら上書き） */
export async function putPractice(rec: PracticeRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(PRACTICE, 'readwrite');
  tx.objectStore(PRACTICE).put(structuredClone(rec));
  await finished(tx);
}
