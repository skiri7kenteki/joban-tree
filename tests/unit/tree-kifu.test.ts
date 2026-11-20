// 段階11-5：ツリーの閲覧画面の棋譜欄（たどった手順・その先）
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../../src/shogi/position';
import { treeKifu } from '../../src/tree/treeKifu';
import type { TreeData, TreeNode } from '../../src/tree/types';

/** 開始局面までの手 prefix の後に、手の木 lines（各行は開始局面からの手順。同じ手は共有。先に書いた手がいちばん上） */
function makeTree(prefix: string[], lines: string[][]): TreeData {
  let sfen = STARTPOS_SFEN;
  for (const m of prefix) sfen = applyUsiMove(sfen, m)!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string) => (nodes[sfenKey(s)] ??= { key: sfenKey(s), sfen: s, round: 0, edges: [] });
  const root = add(sfen);
  for (const line of lines) {
    let node = root;
    for (const m of line) {
      const next = add(applyUsiMove(node.sfen, m)!.sfen);
      if (!node.edges.some((e) => e.move === m)) node.edges.push({ move: m, to: next.key, score: { kind: 'cp', value: 0 }, diff: 0 } as never);
      node = next;
    }
  }
  return { id: 't', name: 't', mySide: 'black', rootKey: root.key, prefix: { initialSfen: STARTPOS_SFEN, moves: prefix }, nodes } as unknown as TreeData;
}

/** 開始局面からその手順の局面のキーの並び */
function keysOf(tree: TreeData, moves: string[]): string[] {
  const keys = [tree.rootKey];
  for (const m of moves) keys.push(tree.nodes[keys[keys.length - 1]].edges.find((e) => e.move === m)!.to);
  return keys;
}

const MAIN = ['3c3d', '2g2f', '8c8d', '2f2e'];
const SIDE = ['8c8d', '2g2f'];

describe('ツリーの棋譜欄', () => {
  it('開始局面までの手は薄く・押せない。開始局面の行に「開始局面」。今より先は本線を少し薄く', () => {
    const tree = makeTree(['7g7f'], [MAIN, SIDE]);
    const k = treeKifu(tree, keysOf(tree, ['3c3d']));
    expect(k.base).toBe(1);
    expect(k.current).toBe(2);
    expect(k.rows.map((r) => [r.ply, r.text, !!r.dim, !!r.disabled, !!r.ahead, r.note ?? ''])).toEqual([
      [0, '初期局面', true, true, false, ''],
      [1, '▲７六歩', false, false, false, '開始局面'],
      [2, '△３四歩', false, false, false, ''],
      [3, '▲２六歩', false, false, true, ''],
      [4, '△８四歩', false, false, true, ''],
      [5, '▲２五歩', false, false, true, ''],
    ]);
    expect(k.ahead).toEqual(keysOf(tree, MAIN).slice(2));
  });

  it('戻ってきたときは、さっきまでいた手順を先に出し、その先は本線', () => {
    const tree = makeTree([], [['7g7f', '3c3d'], ['2g2f', '8c8d']]);
    const side = keysOf(tree, ['2g2f', '8c8d']);
    // ▲2六歩 △8四歩 まで行って、開始局面に戻った
    const k = treeKifu(tree, side.slice(0, 1), side.slice(1));
    expect(k.rows[0]).toEqual({ ply: 0, text: '開始局面' });
    expect(k.rows.slice(1).map((r) => r.text)).toEqual(['▲２六歩', '△８四歩']);
    expect(k.ahead).toEqual(side.slice(1));
  });

  it('先の手は決まった数まで', () => {
    const tree = makeTree([], [['7g7f', '3c3d', '2g2f']]);
    expect(treeKifu(tree, [tree.rootKey], [], 2).rows.map((r) => r.text)).toEqual(['開始局面', '▲７六歩', '△３四歩']);
  });
});
