// ツリーを端末の中（IndexedDB）に保存する。データは端末の外へは送らない。

import type { TreeData } from '../tree/types';
import { REVIEW, TREES, done, finished, openDb } from './db';

/** 一覧に出す情報 */
export interface TreeSummary {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
}

/** ツリーを保存する（同じ id なら上書き） */
export async function saveTree(tree: TreeData): Promise<void> {
  const db = await openDb();
  // 生成中も書き換わるので、その時点の内容を複製して保存する
  await done(db.transaction(TREES, 'readwrite').objectStore(TREES).put(structuredClone(tree)));
}

export async function loadTree(id: string): Promise<TreeData | null> {
  const db = await openDb();
  const tree = (await done(db.transaction(TREES).objectStore(TREES).get(id))) as TreeData | undefined;
  return tree ?? null;
}

/** 保存してあるツリーの一覧（新しい順） */
export async function listTrees(): Promise<TreeSummary[]> {
  const db = await openDb();
  const trees = (await done(db.transaction(TREES).objectStore(TREES).getAll())) as TreeData[];
  return trees
    .map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, nodeCount: Object.keys(t.nodes).length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新しいツリーの id */
export function newTreeId(): string {
  return crypto.randomUUID();
}

/** ツリーを消す（画面で確認を出してから呼ぶ）。そのツリーの復習の記録も消す */
export async function deleteTree(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([TREES, REVIEW], 'readwrite');
  tx.objectStore(TREES).delete(id);
  tx.objectStore(REVIEW).delete(id);
  await finished(tx);
}
