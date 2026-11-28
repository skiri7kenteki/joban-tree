// 画面の切り替え。URL の「#」より後ろで、どの画面かを表す（スマホの戻るボタンがそのまま効く）。
//   #/           … 定跡帳のタブ（研究手順の一覧。アプリを開くといつもここ。段階11-1）
//   #/practice   … 稽古のタブ（段階19。前の「復習」のタブ #/reviews もここへ）
//   #/practice/play[/<研究手順の id>] … 稽古（今日の稽古を続けて／その 1 本）。#/practice/group/<定跡帳の key> … そのグループの稽古
//   #/games      … 実戦のタブ（実戦の一覧。段階18）
//   #/game/<id>  … 実戦 1 局の照らし合わせの結果（段階18）
//   #/book/<グループの key>[/<研究手順の id>/<手数>] … 定跡帳として見る（そのグループの研究手順をつないだツリー。段階9-2）。
//     段階10-1 から、定跡帳の盤で指すとその場で研究手順に足す。key が study:hirate|<側> なら平手からの定跡帳（その側の研究手順すべて）
//   #/book/<key>/t/<戦型の id> … 定跡帳を、その戦型の出発点で開く（新しい研究を始めるとき。研究手順がまだ無くても開ける。段階10-1）
//   #/book/<key>/m/<手.手.手…> … 定跡帳を、平手からその手順の局面で開く（実戦の外れた局面から研究を足すとき。研究の木の外でもよい。段階18）
//   #/study-import … 変化付き KIF から研究手順をまとめて取り込む（段階8-2）
//   #/settings   … 設定のタブ（行の目次）
//   #/settings/<名前> … 設定の下の画面（practice 稽古・games 実戦・data データ管理・sync Google ドライブ・engine エンジン）
//   ほかの URL（消した画面・前の版の URL。#/trees・#/tree/…・#/new・#/review/…・#/study/… など）は定跡帳のタブを出す

import { signal } from '@preact/signals';
import { takeLoginReturn } from '../drive/session';

/** 設定の下の画面の名前 */
export const SETTINGS_PAGES = ['practice', 'games', 'data', 'sync', 'engine'] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export type Route =
  | { name: 'home' }
  | { name: 'practice' }
  | { name: 'practice-play'; study?: string; group?: string }
  | { name: 'games' }
  | { name: 'game'; id: string }
  | { name: 'settings'; page?: SettingsPage }
  | { name: 'book'; key: string; study?: string; ply?: number; template?: string; line?: string[] }
  | { name: 'study-import' };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/settings') return { name: 'settings' };
  if (path.startsWith('/settings/')) {
    const page = SETTINGS_PAGES.find((p) => path === `/settings/${p}`);
    return page ? { name: 'settings', page } : { name: 'settings' };
  }
  if (path === '/reviews' || path === '/practice') return { name: 'practice' };
  if (path === '/practice/play') return { name: 'practice-play' };
  const play = /^\/practice\/play\/([\w-]+)$/.exec(path);
  if (play) return { name: 'practice-play', study: play[1] };
  const playGroup = /^\/practice\/group\/([^/]+)$/.exec(path);
  if (playGroup) return { name: 'practice-play', group: safeDecode(playGroup[1]) };
  if (path === '/games') return { name: 'games' };
  const game = /^\/game\/([\w-]+)$/.exec(path);
  if (game) return { name: 'game', id: game[1] };
  if (path === '/study-import') return { name: 'study-import' };
  const bookM = /^\/book\/([^/]+)\/m\/([0-9a-zA-Z*+.]+)$/.exec(path);
  if (bookM) return { name: 'book', key: safeDecode(bookM[1]), line: bookM[2].split('.').filter(Boolean) };
  const bookT = /^\/book\/([^/]+)\/t\/([^/]+)$/.exec(path);
  if (bookT) return { name: 'book', key: safeDecode(bookT[1]), template: safeDecode(bookT[2]) };
  const book = /^\/book\/([^/]+)(?:\/([\w-]+)\/(\d+))?$/.exec(path);
  if (book) {
    const key = safeDecode(book[1]);
    return book[2] ? { name: 'book', key, study: book[2], ply: Number(book[3]) } : { name: 'book', key };
  }
  return { name: 'home' };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// 段階22-3：Google のログインからの戻りは URL の # の後ろに付くので、画面の URL として読む前に受け取って消す
// （読み込む順番に頼ると、ビルドで順番が変わったときに戻りが画面の URL として読まれる）
takeLoginReturn();

export const route = signal<Route>(parse(location.hash));

/** この履歴の 1 件が、どの画面から来たか（history.state に覚える。読み込み直しても残る） */
const cameFrom = (): unknown => (history.state as { from?: unknown } | null)?.from;
const markCameFrom = (from: string): void => {
  history.replaceState({ ...(history.state as object | null), from }, '');
};
// 開いた最初の 1 件には「どこから」が無い（後で戻ってきたときに、別の画面を覚えないように）
if (cameFrom() === undefined) markCameFrom('');

window.addEventListener('hashchange', (event) => {
  // 開いたままのアプリの URL の # の後ろだけが変わる形で戻ったとき（受け取ったら、読み込み直して結果を出す）
  if (takeLoginReturn()) {
    location.reload();
    return;
  }
  // 新しく進んだ 1 件にだけ覚える（戻る・進むで来た 1 件は、前に覚えたまま）
  if (cameFrom() === undefined) markCameFrom(new URL(event.oldURL).hash.replace(/^#/, ''));
  route.value = parse(location.hash);
});

/** 画面を移る（例：go('/games')） */
export function go(path: string): void {
  location.hash = path;
}

/**
 * 「‹ 設定」：その画面（parent）から来たなら 1 つ戻る（端末の戻ると同じ。履歴がたまらない）。
 * ほかから直接来たなら（定跡帳の知らせ・Google のログインの戻りなど）、今の 1 件を parent に置きかえる
 */
export function backTo(parent: string): void {
  if (cameFrom() === parent) history.back();
  else replaceTo(parent);
}

/** 研究手順のグループの復習へ */
export function groupPracticePath(key: string): string {
  return `/practice/group/${encodeURIComponent(key)}`;
}

/** 定跡帳（研究手順のグループをつないだツリー）へ。study・ply を渡すと、その研究手順のその局面 */
export function bookPath(key: string, study?: string, ply?: number): string {
  const base = `/book/${encodeURIComponent(key)}`;
  return study !== undefined && ply !== undefined ? `${base}/${study}/${ply}` : base;
}

/** 定跡帳を、戦型の出発点で開く（新しい研究を始めるとき） */
export function bookTemplatePath(key: string, templateId: string): string {
  return `/book/${encodeURIComponent(key)}/t/${encodeURIComponent(templateId)}`;
}

/** 定跡帳を、平手からその手順の局面で開く（段階18） */
export function bookLinePath(key: string, line: readonly string[]): string {
  return `/book/${encodeURIComponent(key)}/m/${line.join('.')}`;
}

/** 画面の下のタブ（段階11-1。段階18 から 定跡帳／復習／実戦／設定）。一覧の画面にだけ出す */
export type TabName = 'home' | 'practice' | 'games' | 'settings';
export const TAB_PATHS: Record<TabName, string> = { home: '/', practice: '/practice', games: '/games', settings: '/settings' };

/** その画面がタブの画面なら、そのタブ（盤のある画面は null） */
export function tabOf(r: Route): TabName | null {
  return r.name === 'home' || r.name === 'practice' || r.name === 'games' || r.name === 'settings' ? r.name : null;
}

/** 今の画面を、履歴を増やさずに別の画面にする（戻るボタンで前の画面に戻れるように） */
export function replaceTo(path: string): void {
  location.replace(`#${path}`);
}

/** 前の画面に戻る（履歴が無ければ fallback へ。初期値は定跡帳） */
export function back(fallback = '/'): void {
  if (history.length > 1) history.back();
  else go(fallback);
}
