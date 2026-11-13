// 画面の切り替え。URL の「#」より後ろで、どの画面かを表す（スマホの戻るボタンがそのまま効く）。
//   #/           … 一覧（トップ）
//   #/new        … 新しいツリー（局面の入力）
//   #/tree/<id>  … ツリーの閲覧
//   #/settings   … 設定

import { signal } from '@preact/signals';

export type Route = { name: 'home' } | { name: 'new' } | { name: 'settings' } | { name: 'tree'; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/new') return { name: 'new' };
  if (path === '/settings') return { name: 'settings' };
  const tree = /^\/tree\/([\w-]+)$/.exec(path);
  if (tree) return { name: 'tree', id: tree[1] };
  return { name: 'home' };
}

export const route = signal<Route>(parse(location.hash));

window.addEventListener('hashchange', () => {
  route.value = parse(location.hash);
});

/** 画面を移る（例：go('/new')） */
export function go(path: string): void {
  location.hash = path;
}

/** 前の画面に戻る（履歴が無ければトップへ） */
export function back(): void {
  if (history.length > 1) history.back();
  else go('/');
}
