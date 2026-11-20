// 画面の切り替え。URL の「#」より後ろで、どの画面かを表す（スマホの戻るボタンがそのまま効く）。
//   #/           … 定跡帳のタブ（研究手順の一覧。アプリを開くといつもここ。段階11-1）
//   #/trees      … ツリーのタブ（ツリーの一覧。段階11-1）
//   #/reviews    … 復習のタブ（復習の入口。段階11-1）
//   #/new        … 新しいツリー（局面の入力）
//   #/new/study  … （段階10-2 で片付けた。トップ画面で「研究手順を登録」の窓を開く。src/app/LegacyRedirect.tsx）
//   #/tree/<id>  … ツリーの閲覧
//   #/tree/<id>/study/<研究手順の id>[/<手数>] … ツリーの閲覧（研究手順の終わり、または平手から「手数」手目の局面を、パンくずリストごと開く）
//   #/study/<研究手順の id>[/<手数>|/edit] … （段階10-2 で研究手順の画面・編集モードを片付けた。その研究手順の定跡帳へ移す。
//     手数があればその局面、無ければ・edit なら終わりの局面。src/app/LegacyRedirect.tsx）
//   #/book/<グループの key>[/<研究手順の id>/<手数>] … 定跡帳として見る（そのグループの研究手順をつないだツリー。段階9-2）。
//     段階10-1 から、定跡帳の盤で指すとその場で研究手順に足す。key が study:hirate|<側> なら平手からの定跡帳（その側の研究手順すべて）
//   #/book/<key>/t/<戦型の id> … 定跡帳を、その戦型の出発点で開く（新しい研究を始めるとき。研究手順がまだ無くても開ける。段階10-1）
//   #/study-import … 変化付き KIF から研究手順をまとめて取り込む（段階8-2）
//   #/settings   … 設定のタブ
//   #/review/<id> … 復習モード
//   #/review/<id>/study … 研究手順だけの復習（そのツリーの開始局面を通る研究手順）
//   #/study-review/<研究手順の id> … 研究手順だけの復習（その 1 本だけ。段階8-1）
//   #/study-review/group/<グループの key> … 研究手順だけの復習（そのグループの研究手順。段階8-1）
//   （v0.17.0 の #/review/<id>/study/<研究手順の id> は、その 1 本だけの復習として開く）

import { signal } from '@preact/signals';

export type Route =
  | { name: 'home' }
  | { name: 'trees' }
  | { name: 'reviews' }
  | { name: 'new'; study?: boolean }
  | { name: 'settings' }
  | { name: 'tree'; id: string; study?: string; ply?: number }
  | { name: 'study'; id: string; edit?: boolean; ply?: number }
  | { name: 'book'; key: string; study?: string; ply?: number; template?: string }
  | { name: 'study-import' }
  | { name: 'review'; id: string; studies?: boolean }
  | { name: 'study-review'; study?: string; group?: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/new') return { name: 'new' };
  if (path === '/new/study') return { name: 'new', study: true };
  if (path === '/settings') return { name: 'settings' };
  if (path === '/trees') return { name: 'trees' };
  if (path === '/reviews') return { name: 'reviews' };
  if (path === '/study-import') return { name: 'study-import' };
  const tree = /^\/tree\/([\w-]+)(?:\/study\/([\w-]+)(?:\/(\d+))?)?$/.exec(path);
  if (tree) {
    if (!tree[2]) return { name: 'tree', id: tree[1] };
    return tree[3] ? { name: 'tree', id: tree[1], study: tree[2], ply: Number(tree[3]) } : { name: 'tree', id: tree[1], study: tree[2] };
  }
  const study = /^\/study\/([\w-]+)(?:\/(edit|\d+))?$/.exec(path);
  if (study) {
    if (study[2] === 'edit') return { name: 'study', id: study[1], edit: true };
    return study[2] ? { name: 'study', id: study[1], ply: Number(study[2]) } : { name: 'study', id: study[1] };
  }
  const bookT = /^\/book\/([^/]+)\/t\/([^/]+)$/.exec(path);
  if (bookT) return { name: 'book', key: safeDecode(bookT[1]), template: safeDecode(bookT[2]) };
  const book = /^\/book\/([^/]+)(?:\/([\w-]+)\/(\d+))?$/.exec(path);
  if (book) {
    const key = safeDecode(book[1]);
    return book[2] ? { name: 'book', key, study: book[2], ply: Number(book[3]) } : { name: 'book', key };
  }
  const one = /^\/study-review\/([\w-]+)$/.exec(path);
  if (one && one[1] !== 'group') return { name: 'study-review', study: one[1] };
  const group = /^\/study-review\/group\/([^/]+)$/.exec(path);
  if (group) return { name: 'study-review', group: safeDecode(group[1]) };
  const review = /^\/review\/([\w-]+)(\/study(?:\/([\w-]+))?)?$/.exec(path);
  if (review) {
    if (review[3]) return { name: 'study-review', study: review[3] };
    if (review[2]) return { name: 'review', id: review[1], studies: true };
    return { name: 'review', id: review[1] };
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

export const route = signal<Route>(parse(location.hash));

window.addEventListener('hashchange', () => {
  route.value = parse(location.hash);
});

/** 画面を移る（例：go('/new')） */
export function go(path: string): void {
  location.hash = path;
}

/** 研究手順のグループの復習へ */
export function groupReviewPath(key: string): string {
  return `/study-review/group/${encodeURIComponent(key)}`;
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

/** 画面の下のタブ（段階11-1）。一覧の画面にだけ出す */
export type TabName = 'home' | 'trees' | 'reviews' | 'settings';
export const TAB_PATHS: Record<TabName, string> = { home: '/', trees: '/trees', reviews: '/reviews', settings: '/settings' };

/** その画面がタブの画面なら、そのタブ（盤のある画面は null） */
export function tabOf(r: Route): TabName | null {
  return r.name === 'home' || r.name === 'trees' || r.name === 'reviews' || r.name === 'settings' ? r.name : null;
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
