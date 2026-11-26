// 実戦の棋譜（段階18）を端末の中（IndexedDB の games）に保存する。データは端末の外へは送らない。

import type { Game } from '../games/game';
import { GAMES, done, finished, openDb } from './db';
import { addDeleted, deletedAs, takeDeleted } from './deleted';
import { askPersistOnce } from './persist';

/** 保存してある実戦（並びは決めない。画面で並べる） */
export async function listGames(): Promise<Game[]> {
  const db = await openDb();
  return (await done(db.transaction(GAMES).objectStore(GAMES).getAll())) as Game[];
}

/** 保存する（同じ id なら上書き） */
export async function putGame(game: Game): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(GAMES, 'readwrite');
  const store = tx.objectStore(GAMES);
  const prev = await done(store.get(game.id));
  const now = Date.now();
  // 段階22-2：直した日時（自分の側を直した）。消したものをもう一度保存するときは、戻した日時
  const revived = !prev && takeDeleted(deletedAs('game', game.id));
  store.put(structuredClone({ ...game, ...(prev ? { updatedAt: now } : {}), ...(revived ? { restoredAt: now } : {}) }));
  await finished(tx);
  askPersistOnce();
}

/** 消す（画面で確認を出してから呼ぶ） */
export async function deleteGame(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(GAMES, 'readwrite');
  tx.objectStore(GAMES).delete(id);
  await finished(tx);
  addDeleted([{ kind: 'game', id, at: Date.now() }]);
}
