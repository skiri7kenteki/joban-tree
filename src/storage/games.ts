// 実戦の棋譜（段階18）を端末の中（IndexedDB の games）に保存する。データは端末の外へは送らない。

import type { Game } from '../games/game';
import { GAMES, done, finished, openDb } from './db';
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
  tx.objectStore(GAMES).put(structuredClone(game));
  await finished(tx);
  askPersistOnce();
}

/** 消す（画面で確認を出してから呼ぶ） */
export async function deleteGame(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(GAMES, 'readwrite');
  tx.objectStore(GAMES).delete(id);
  await finished(tx);
}
