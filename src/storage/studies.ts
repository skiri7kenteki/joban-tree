// 研究手順（段階8-1、ツリーから独立したもの）を端末の中（IndexedDB の studies）に保存する。データは端末の外へは送らない。

import type { Study } from '../tree/types';
import { STUDIES, done, finished, openDb } from './db';

/** 保存してある研究手順（並びは決めない。画面で並べる） */
export async function listStudies(): Promise<Study[]> {
  const db = await openDb();
  return (await done(db.transaction(STUDIES).objectStore(STUDIES).getAll())) as Study[];
}

/** まとめて保存する（同じ id なら上書き） */
export async function putStudies(list: readonly Study[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STUDIES, 'readwrite');
  const store = tx.objectStore(STUDIES);
  for (const s of list) store.put(structuredClone(s));
  await finished(tx);
}

/** 消す（画面で確認を出してから呼ぶ） */
export async function deleteStudy(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STUDIES, 'readwrite');
  tx.objectStore(STUDIES).delete(id);
  await finished(tx);
}

/** まとめて保存して、まとめて消す（1 回の書き込みで。定跡帳で手を足す・消す・取り消すとき。段階10-1） */
export async function writeStudies(put: readonly Study[], removeIds: readonly string[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STUDIES, 'readwrite');
  const store = tx.objectStore(STUDIES);
  for (const id of removeIds) store.delete(id);
  for (const s of put) store.put(structuredClone(s));
  await finished(tx);
}
