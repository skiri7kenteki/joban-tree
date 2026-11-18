// ツリーを端末の中（IndexedDB）に保存する。データは端末の外へは送らない。

import { prefixSummary } from '../tree/browse';
import { startsWith, treeBaseMoves } from '../tree/studies';
import type { TreeData } from '../tree/types';
import { REVIEW, TREES, done, finished, openDb } from './db';

/** 一覧に出す情報 */
export interface TreeSummary {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
  /** 研究する側 */
  mySide: TreeData['mySide'];
  /** 開始局面までの最後の数手（例：「…▲２六歩 △３四歩」） */
  prefixText: string;
  /** 同梱ツリーからコピーしたものなら、その同梱ツリー（段階6-3） */
  source?: TreeData['source'];
  /** どの戦型から作ったか・開始局面までの手順（トップ画面のグループ分け。段階7-1） */
  templateId?: string;
  prefix: TreeData['prefix'];
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
    .map((t) => ({
      id: t.id,
      name: t.name,
      updatedAt: t.updatedAt,
      nodeCount: Object.keys(t.nodes).length,
      mySide: t.mySide,
      prefixText: prefixSummary(t),
      source: t.source,
      templateId: t.templateId,
      prefix: t.prefix,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 平手からの手順 moves の途中を開始局面にするツリー（研究手順の「ツリーで見る」の候補。段階8-1）。
 * 開始局面までの手順が moves の先頭と同じものだけ読む（ツリーの中で最後までたどれるかは、画面で確かめる）
 */
export async function loadTreesOnLine(moves: readonly string[]): Promise<TreeData[]> {
  const db = await openDb();
  const trees = (await done(db.transaction(TREES).objectStore(TREES).getAll())) as TreeData[];
  return trees
    .filter((t) => {
      const base = treeBaseMoves(t);
      return base !== null && startsWith(moves, base);
    })
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
