// 消した記録（段階22-2）の読み書き。計算は src/tree/deleted.ts。
// 保存場所（IndexedDB）の版を変えないように、localStorage に置く（バックアップには data.deleted として入れる）。捨てない。
// 書けなかったときは記録が残らない（合わせたときに、消したものが戻る側に倒れる。消えすぎることはない）

import { deletedProblem, unionDeleted, type DeletedKind, type DeletedRecord } from '../tree/deleted';

const KEY = 'joban-tree.deleted';

export function readDeleted(): DeletedRecord[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? (raw.filter((d) => deletedProblem(d) === null) as DeletedRecord[]) : [];
  } catch {
    return [];
  }
}

export function writeDeleted(list: readonly DeletedRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // 書けない端末では覚えない
  }
}

export function addDeleted(records: readonly DeletedRecord[]): void {
  if (records.length > 0) writeDeleted(unionDeleted(readDeleted(), records));
}

/** hit に当たる記録を取り除く。あったら true（消したものをもう一度保存するとき） */
export function takeDeleted(hit: (d: DeletedRecord) => boolean): boolean {
  const all = readDeleted();
  const rest = all.filter((d) => !hit(d));
  if (rest.length === all.length) return false;
  writeDeleted(rest);
  return true;
}

export const deletedAs = (kind: DeletedKind, id: string) => (d: DeletedRecord) => d.kind === kind && d.id === id;
