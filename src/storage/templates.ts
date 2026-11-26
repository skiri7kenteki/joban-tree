// 自分で登録した戦型（段階5-2）を端末の中（IndexedDB）に保存する。データは端末の外へは送らない。

import type { OpeningTemplate } from '../tree/templates';
import { TEMPLATES, done, finished, openDb } from './db';
import { addDeleted, deletedAs, takeDeleted } from './deleted';

export interface StoredTemplate extends OpeningTemplate {
  createdAt: number;
  updatedAt: number;
  restoredAt?: number;
}

/** 登録した戦型（登録した順） */
export async function listMyTemplates(): Promise<StoredTemplate[]> {
  const db = await openDb();
  const list = (await done(db.transaction(TEMPLATES).objectStore(TEMPLATES).getAll())) as StoredTemplate[];
  return list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** まとめて保存する（同じ id なら上書き） */
export async function putMyTemplates(list: readonly StoredTemplate[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(TEMPLATES, 'readwrite');
  const store = tx.objectStore(TEMPLATES);
  // 段階22-2：消したものをもう一度保存するときは、戻した日時
  const now = Date.now();
  for (const t of list) store.put(structuredClone(takeDeleted(deletedAs('template', t.id)) ? { ...t, restoredAt: now } : t));
  await finished(tx);
}

/** 消す（画面で確認を出してから呼ぶ） */
export async function deleteMyTemplate(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(TEMPLATES, 'readwrite');
  tx.objectStore(TEMPLATES).delete(id);
  await finished(tx);
  addDeleted([{ kind: 'template', id, at: Date.now() }]);
}
