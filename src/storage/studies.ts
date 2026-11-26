// 研究手順（段階8-1、ツリーから独立したもの）を端末の中（IndexedDB の studies）に保存する。データは端末の外へは送らない。
// 段階22-2：保存するときに「手を変えた日時」「戻した日時」を付け、消すときは消した記録を残す（端末どうしで合わせるため。`src/tree/deleted.ts`）

import type { Study } from '../tree/types';
import { deletionHits, removalRecords, stampStudy } from '../tree/deleted';
import { STUDIES, done, finished, openDb } from './db';
import { addDeleted, takeDeleted } from './deleted';
import { askPersistOnce } from './persist';

/** 保存してある研究手順（並びは決めない。画面で並べる） */
export async function listStudies(): Promise<Study[]> {
  const db = await openDb();
  return (await done(db.transaction(STUDIES).objectStore(STUDIES).getAll())) as Study[];
}

/** まとめて保存する（同じ id なら上書き） */
export async function putStudies(list: readonly Study[]): Promise<void> {
  await writeStudies(list, []);
}

/** 消す（画面で確認を出してから呼ぶ） */
export async function deleteStudy(id: string): Promise<void> {
  await writeStudies([], [id]);
}

/** まとめて保存して、まとめて消す（1 回の書き込みで。定跡帳で手を足す・消す・取り消すとき。段階10-1）。onlyId は removalRecords を見る */
export async function writeStudies(put: readonly Study[], removeIds: readonly string[], opts: { onlyId?: boolean } = {}): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STUDIES, 'readwrite');
  const store = tx.objectStore(STUDIES);
  const before = new Map(((await done(store.getAll())) as Study[]).map((s) => [s.id, s]));
  const now = Date.now();
  const saved = put.map((s) => {
    const prev = before.get(s.id);
    // 保存場所に無いものを保存する：消した記録があれば、復活（取り消し・取り込み直し）
    const revived = !prev && takeDeleted((d) => d.kind === 'study' && (d.id === s.id || deletionHits(d, s)));
    return stampStudy(prev, s, revived, now);
  });
  // 消した後に残る研究手順（消した記録の効かせ方を決めるのに使う）
  const after = new Map(before);
  for (const id of removeIds) after.delete(id);
  for (const s of saved) after.set(s.id, s);
  const gone = removalRecords(before, after, removeIds, now, opts.onlyId);
  for (const id of removeIds) store.delete(id);
  for (const s of saved) store.put(structuredClone(s));
  await finished(tx);
  addDeleted(gone);
  // 段階17：研究手順を保存したら、ブラウザにデータを消さないよう頼む（開いている間に 1 回だけ）
  if (put.length > 0) askPersistOnce();
}
