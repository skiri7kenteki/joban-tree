// 端末の中の保存場所（IndexedDB）を開く。データは端末の外へは送らない。
// ライブラリは使わず、ブラウザの IndexedDB を薄く包むだけにしている。
//
// 版の履歴：
//   1 … trees（ツリー）
//   2 … review（復習の記録。段階3）を追加
//   3 … templates（自分で登録した戦型。段階5-2）を追加
//   4 … studies（ツリーから独立した研究手順。段階8-1）を追加。ツリーの中の研究手順をここへ移す（src/storage/migrate.ts）
//   5 … games（実戦の棋譜。段階18）を追加。今のデータはそのまま
//   6 … practice（稽古の記録。段階19）を追加。今のデータはそのまま
//   7 … positions（局面メモと食い違いの「このままでよい」。段階20-1）を追加。今のデータはそのまま

import { migrateStudiesInUpgrade } from './migrate';

const DB_NAME = 'joban-tree';
const DB_VERSION = 7;
export const TREES = 'trees';
export const REVIEW = 'review';
export const TEMPLATES = 'templates';
export const STUDIES = 'studies';
export const GAMES = 'games';
export const PRACTICE = 'practice';
export const POSITIONS = 'positions';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TREES)) db.createObjectStore(TREES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(REVIEW)) db.createObjectStore(REVIEW, { keyPath: 'treeId' });
        if (!db.objectStoreNames.contains(TEMPLATES)) db.createObjectStore(TEMPLATES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STUDIES)) db.createObjectStore(STUDIES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(GAMES)) db.createObjectStore(GAMES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(PRACTICE)) db.createObjectStore(PRACTICE, { keyPath: 'studyId' });
        if (!db.objectStoreNames.contains(POSITIONS)) db.createObjectStore(POSITIONS, { keyPath: 'id' });
        // 版 3 まで使っていた端末：ツリーの中の研究手順を studies へ移す（この処理は 1 回だけ。全部やり切るか、何もしないか）
        if (event.oldVersion >= 1 && event.oldVersion < 4) {
          migrateStudiesInUpgrade(request.transaction!, { trees: TREES, review: REVIEW, studies: STUDIES });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // ほかのタブが新しい版で開こうとしたら閉じて譲る（次に使うときに開き直す）
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('保存場所（IndexedDB）を開けませんでした'));
      };
    });
  }
  return dbPromise;
}

/** IDBRequest を Promise にする */
export function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('保存場所（IndexedDB）の操作に失敗しました'));
  });
}

/** トランザクションが終わるまで待つ */
export function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存場所（IndexedDB）の操作に失敗しました'));
    tx.onabort = () => reject(tx.error ?? new Error('保存場所（IndexedDB）の操作が取り消されました'));
  });
}
