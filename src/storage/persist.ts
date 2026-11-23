// データの保護（段階17、v0.41.0〜）：ブラウザに「このアプリのデータを消さないで」と頼む（navigator.storage.persist）。
// 呼ぶ時機（持ち主の判断 2026-11-23「おすすめの通りで」）：アプリを開いたとき（研究手順かツリーが 1 つでもあるときだけ）と、研究手順を保存したとき。
// すでに守られていれば何もしない。Android の Chrome・iPhone の Safari では確認の窓は出ない（ブラウザが使い方を見て決める）。

import { STUDIES, TREES, done, openDb } from './db';

export type PersistState = 'persisted' | 'not-persisted' | 'unsupported';

/** 今、守られているか */
export async function persistState(): Promise<PersistState> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

/** 守られていなければ頼む。守られたら true */
export async function askPersist(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

let askedThisTime = false;

/** 研究手順を保存したときに呼ぶ（アプリを開いている間に 1 回だけ頼む。待たない） */
export function askPersistOnce(): void {
  if (askedThisTime) return;
  askedThisTime = true;
  void askPersist();
}

/** アプリを開いたときに呼ぶ：研究手順かツリーが 1 つでもあれば頼む */
export async function askPersistIfData(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STUDIES, TREES]);
    const [studies, trees] = await Promise.all([done(tx.objectStore(STUDIES).count()), done(tx.objectStore(TREES).count())]);
    if (studies + trees > 0) {
      askedThisTime = true;
      await askPersist();
    }
  } catch {
    // 保存場所を開けないときは何もしない（画面の方で知らせる）
  }
}
