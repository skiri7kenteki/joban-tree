// 実戦の棋譜（段階18）を画面どうしで共有する。読み込みは最初に使うときに 1 回（あとは保存のたびに読み直す）。
// 将棋ウォーズのユーザー名（自分の側を決める）は localStorage（joban-tree.wars-name。バックアップの設定に入る）。

import { signal } from '@preact/signals';
import { deleteGame, listGames, putGame } from '../storage/games';
import type { Game } from '../games/game';

/** 実戦の一覧（読み込む前は null） */
export const gameList = signal<Game[] | null>(null);

let loading: Promise<Game[]> | null = null;

export async function refreshGames(): Promise<Game[]> {
  const list = await listGames();
  gameList.value = list;
  return list;
}

export function ensureGames(): Promise<Game[]> {
  if (gameList.value) return Promise.resolve(gameList.value);
  loading ??= refreshGames().finally(() => {
    loading = null;
  });
  return loading;
}

export async function saveGame(game: Game): Promise<void> {
  await putGame(game);
  await refreshGames();
}

export async function removeGame(id: string): Promise<void> {
  await deleteGame(id);
  await refreshGames();
}

const WARS_NAME_KEY = 'joban-tree.wars-name';

/** 設定の「将棋ウォーズのユーザー名」 */
export const warsName = signal<string>(readWarsName());

function readWarsName(): string {
  try {
    return localStorage.getItem(WARS_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setWarsName(name: string): void {
  const v = name.trim().slice(0, 40);
  warsName.value = v;
  try {
    if (v) localStorage.setItem(WARS_NAME_KEY, v);
    else localStorage.removeItem(WARS_NAME_KEY);
  } catch {
    // 書けない端末では、開いている間だけ覚える
  }
}

/** 定跡帳を実戦の局面で開くときに、盤の上に出す一言（開いた手順と一緒に渡す。読み込み直したら出さない） */
export const bookFromGame = signal<{ line: string; text: string } | null>(null);
