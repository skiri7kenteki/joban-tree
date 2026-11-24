// 局面メモと「このままでよい」（段階20-1）を端末の中（IndexedDB の positions。キーは `<側>|<局面のキー>`）に保存する。データは端末の外へは送らない。

import type { PositionNote } from '../tree/positions';
import { POSITIONS, done, finished, openDb } from './db';
import { askPersistOnce } from './persist';

/** 保存してある局面の記録 */
export async function listPositions(): Promise<PositionNote[]> {
  const db = await openDb();
  return (await done(db.transaction(POSITIONS).objectStore(POSITIONS).getAll())) as PositionNote[];
}

/** 保存する（同じ局面なら上書き） */
export async function putPosition(rec: PositionNote): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(POSITIONS, 'readwrite');
  tx.objectStore(POSITIONS).put(structuredClone(rec));
  await finished(tx);
  askPersistOnce();
}

/** 消す */
export async function deletePosition(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(POSITIONS, 'readwrite');
  tx.objectStore(POSITIONS).delete(id);
  await finished(tx);
}
