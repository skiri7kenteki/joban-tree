// 画面の切り替え。URL の「#」より後ろで、どの画面かを表す（スマホの戻るボタンがそのまま効く）。
//   #/           … 一覧（トップ）
//   #/new        … 新しいツリー（局面の入力）
//   #/tree/<id>  … ツリーの閲覧
//   #/tree/<id>/study/<研究手順の id> … ツリーの閲覧（研究手順の終わりの局面を、パンくずリストごと開く。段階7-2）
//   #/settings   … 設定
//   #/review/<id> … 復習モード
//   #/review/<id>/study … 復習モード（そのツリーの研究手順だけ）。#/review/<id>/study/<研究手順の id> … その 1 本だけ

import { signal } from '@preact/signals';

export type Route = { name: 'home' } | { name: 'new' } | { name: 'settings' } | { name: 'tree'; id: string; study?: string }
  | { name: 'review'; id: string; studies?: boolean; study?: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '/new') return { name: 'new' };
  if (path === '/settings') return { name: 'settings' };
  const tree = /^\/tree\/([\w-]+)(?:\/study\/([\w-]+))?$/.exec(path);
  if (tree) return tree[2] ? { name: 'tree', id: tree[1], study: tree[2] } : { name: 'tree', id: tree[1] };
  const review = /^\/review\/([\w-]+)(\/study(?:\/([\w-]+))?)?$/.exec(path);
  if (review) {
    if (review[3]) return { name: 'review', id: review[1], studies: true, study: review[3] };
    if (review[2]) return { name: 'review', id: review[1], studies: true };
    return { name: 'review', id: review[1] };
  }
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
