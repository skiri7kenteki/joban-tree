// ツリーの閲覧画面の棋譜欄（段階11-5）の中身：
//   - 開始局面までの手（ツリーの開始局面より前。薄く・押せない）。開始局面の行に「開始局面」と添える
//   - 開始局面から今の局面までたどった手
//   - 今の局面より先：戻ってきたときはさっきまでいた手順（forward）、その先は本線（いちばん上の手）。少し薄く。押すとそこまで進む
// 道筋（パンくず）を棋譜欄にまとめる準備（持ち主の判断 2026-11-20。パンくずの行は段階11-2 で固定バーに置き換える）。

import type { KifuRow } from '../components/KifuList';
import { STARTPOS_SFEN, applyUsiMove, moveText } from '../shogi/position';
import type { TreeData } from './types';

/** 先の手は、この手数まで出す（本線が長くても一覧を重くしない） */
export const KIFU_AHEAD_MAX = 40;

export interface TreeKifu {
  rows: KifuRow[];
  /** 今の局面の行（手数） */
  current: number;
  /** ツリーの開始局面の手数（開始局面までの手の数） */
  base: number;
  /** 今の局面より先の局面のキー（rows の先の手と同じ順） */
  ahead: string[];
}

export function treeKifu(tree: TreeData, path: readonly string[], forward: readonly string[] = [], maxAhead = KIFU_AHEAD_MAX): TreeKifu {
  const base = tree.prefix.moves.length;
  const rows: KifuRow[] = [];
  const startName = tree.prefix.initialSfen === STARTPOS_SFEN ? '初期局面' : '開始局面';
  rows.push(base === 0 ? { ply: 0, text: '開始局面' } : { ply: 0, text: startName, dim: true, disabled: true });

  // 開始局面までの手
  let sfen = tree.prefix.initialSfen;
  let prev: string | undefined;
  tree.prefix.moves.forEach((move, i) => {
    const text = moveText(sfen, move, prev);
    const ply = i + 1;
    rows.push(ply === base ? { ply, text, note: '開始局面' } : { ply, text, dim: true, disabled: true });
    sfen = applyUsiMove(sfen, move)?.sfen ?? sfen;
    prev = move;
  });

  // 開始局面から今の局面まで
  for (let i = 1; i < path.length; i++) {
    const from = tree.nodes[path[i - 1]];
    const edge = from?.edges.find((e) => e.to === path[i]);
    if (!from || !edge) break;
    rows.push({ ply: base + i, text: moveText(from.sfen, edge.move, prev) });
    prev = edge.move;
  }
  const current = base + path.length - 1;

  // 今の局面より先：さっきまでいた手順 → 本線
  const ahead: string[] = [];
  const seen = new Set(path);
  let cur = path[path.length - 1];
  const step = (to: string): boolean => {
    const from = tree.nodes[cur];
    const edge = from?.edges.find((e) => e.to === to);
    if (!from || !edge || seen.has(to) || !tree.nodes[to]) return false;
    rows.push({ ply: current + ahead.length + 1, text: moveText(from.sfen, edge.move, prev), ahead: true });
    ahead.push(to);
    seen.add(to);
    prev = edge.move;
    cur = to;
    return true;
  };
  for (const key of forward) {
    if (ahead.length >= maxAhead || !step(key)) break;
  }
  while (ahead.length < maxAhead) {
    const main = tree.nodes[cur]?.edges[0];
    if (!main || !step(main.to)) break;
  }
  return { rows, current, base, ahead };
}
