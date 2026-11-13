// ツリーを端末の中（IndexedDB）に保存する。データは端末の外へは送らない。
// ライブラリは使わず、ブラウザの IndexedDB を薄く包むだけにしている。

import type { TreeData } from '../tree/types';

const DB_NAME = 'joban-tree';
const DB_VERSION = 1;
const STORE = 'trees';

/** 一覧に出す情報 */
export interface TreeSummary {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('保存場所（IndexedDB）を開けませんでした'));
      };
    });
  }
  return dbPromise;
}

/** IDBRequest を Promise にする */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('保存場所（IndexedDB）の操作に失敗しました'));
  });
}

/** ツリーを保存する（同じ id なら上書き） */
export async function saveTree(tree: TreeData): Promise<void> {
  const db = await openDb();
  // 生成中も書き換わるので、その時点の内容を複製して保存する
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(structuredClone(tree)));
}

export async function loadTree(id: string): Promise<TreeData | null> {
  const db = await openDb();
  const tree = (await done(db.transaction(STORE).objectStore(STORE).get(id))) as TreeData | undefined;
  return tree ?? null;
}

/** 保存してあるツリーの一覧（新しい順） */
export async function listTrees(): Promise<TreeSummary[]> {
  const db = await openDb();
  const trees = (await done(db.transaction(STORE).objectStore(STORE).getAll())) as TreeData[];
  return trees
    .map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, nodeCount: Object.keys(t.nodes).length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新しいツリーの id */
export function newTreeId(): string {
  return crypto.randomUUID();
}
