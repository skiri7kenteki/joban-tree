// 端末の中の保存場所（IndexedDB）を開く。データは端末の外へは送らない。
// ライブラリは使わず、ブラウザの IndexedDB を薄く包むだけにしている。
//
// 版の履歴：
//   1 … trees（ツリー）
//   2 … review（復習の記録。段階3）を追加

const DB_NAME = 'joban-tree';
const DB_VERSION = 2;
export const TREES = 'trees';
export const REVIEW = 'review';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(TREES)) db.createObjectStore(TREES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(REVIEW)) db.createObjectStore(REVIEW, { keyPath: 'treeId' });
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
