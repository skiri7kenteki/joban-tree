// 段階4-3 A「この手は調べない」（除外）：合法手の一覧、除外・戻す、除外した手を外した調べ直し、書き出し・復習・読み込みへの影響
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove, legalMoves } from '../../src/shogi/position';
import { emptyRecord, summarize } from '../../src/review/review';
import { parseTreeJson, treeToJson } from '../../src/tree/backup';
import { TreeGenerator, excludeMove, relabel, restoreMove } from '../../src/tree/generator';
import { treeToKif } from '../../src/tree/kif';
import { TREE_FORMAT_VERSION, type TreeNode } from '../../src/tree/types';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

describe('合法手の一覧', () => {
  it('平手の初期局面は 30 手', () => {
    const moves = legalMoves(STARTPOS_SFEN);
    expect(moves).toHaveLength(30);
    expect(moves).toContain('7g7f');
    expect(moves).not.toContain('7g7e');
  });

  it('持ち駒を打つ手と、成る・成らないの両方を含む', () => {
    let sfen = STARTPOS_SFEN;
    for (const m of ['7g7f', '3c3d']) sfen = applyUsiMove(sfen, m)!.sfen;
    const moves = legalMoves(sfen);
    expect(moves).toContain('8h2b+');
    expect(moves).toContain('8h2b');
    sfen = applyUsiMove(applyUsiMove(sfen, '8h2b+')!.sfen, '3a2b')!.sfen;
    const after = legalMoves(sfen);
    expect(after).toContain('B*5e');
    expect(after.filter((m) => m.startsWith('B*')).length).toBeGreaterThan(30);
  });
});

/** 平手（自分は後手）。相手の応手 ▲７六歩（+80）・▲２六歩（+60）・▲１六歩（+10） */
function script() {
  return {
    [keyAfter()]: [
      { multipv: 1, score: cp(80), pv: ['7g7f', '3c3d'] },
      { multipv: 2, score: cp(60), pv: ['2g2f', '8c8d'] },
      { multipv: 3, score: cp(10), pv: ['1g1f', '3c3d'] },
      { multipv: 4, score: cp(0), pv: ['5g5f', '3c3d'] },
      { multipv: 5, score: cp(-20), pv: ['6g6f', '3c3d'] },
    ],
  };
}

async function built() {
  const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, multiPV: 3, maxRounds: 2, replyMs: 500 });
  await new TreeGenerator(new MockEngine(script()), tree, tree.settings).run();
  return tree;
}

describe('除外・戻す', () => {
  it('除外すると edges から excluded に移り、残った手の中の最善手からラベルを付け直す', async () => {
    const tree = await built();
    const root = tree.nodes[tree.rootKey];
    expect(root.edges.map((e) => [e.move, e.diff])).toEqual([
      ['7g7f', 0],
      ['2g2f', 20],
      ['1g1f', 70],
    ]);
    expect(excludeMove(root, '7g7f')).toBe(true);
    expect(root.excluded!.map((e) => e.move)).toEqual(['7g7f']);
    expect(root.edges.map((e) => [e.move, e.diff])).toEqual([
      ['2g2f', 0],
      ['1g1f', 50],
    ]);
    // その先の局面は消さない
    expect(tree.nodes[keyAfter('7g7f')]).toBeDefined();
    // 戻すと元どおり
    expect(restoreMove(root, '7g7f')).toBe(true);
    expect(root.excluded).toBeUndefined();
    expect(root.edges.map((e) => [e.move, e.diff])).toEqual([
      ['7g7f', 0],
      ['2g2f', 20],
      ['1g1f', 70],
    ]);
    expect(excludeMove(root, '9g9f')).toBe(false);
    expect(restoreMove(root, '9g9f')).toBe(false);
  });

  it('relabel は詰み（mate）の評価値も大小どおりに並べる', () => {
    const node: TreeNode = {
      key: 'k',
      sfen: STARTPOS_SFEN,
      round: 0,
      edges: [
        { move: 'a', to: 'x', score: cp(100) },
        { move: 'b', to: 'y', score: { kind: 'mate' as const, plies: -5 } },
      ],
    };
    relabel(node);
    // 自分から見て詰まされる手（相手にとって最善）が先頭
    expect(node.edges.map((e) => e.move)).toEqual(['b', 'a']);
    expect(node.edges[0].diff).toBe(0);
  });
});

describe('除外した手を外して調べ直す（resample）', () => {
  it('除外した手以外から MultiPV の数だけ調べ、候補を補う。新しい応手の自分の対応は未検証で置く', async () => {
    const tree = await built();
    const root = tree.nodes[tree.rootKey];
    excludeMove(root, '7g7f');
    const engine = new MockEngine(script());
    expect(await new TreeGenerator(engine, tree, tree.settings).resample(tree.rootKey, 1500)).toBe('completed');

    // エンジンには、除外した手を外した合法手だけを渡す
    const call = engine.calls[0];
    expect(call.options.searchMoves).toHaveLength(29);
    expect(call.options.searchMoves).not.toContain('7g7f');
    expect(call.options.multiPV).toBe(3);
    // 候補が 3 手にそろい、残った手の中の最善手（▲２六歩）から付け直す
    expect(root.edges.map((e) => [e.move, e.diff])).toEqual([
      ['2g2f', 0],
      ['1g1f', 50],
      ['5g5f', 60],
    ]);
    expect(root.excluded!.map((e) => e.move)).toEqual(['7g7f']);
    expect(tree.nodes[keyAfter('5g5f')].edges[0]).toMatchObject({ move: '3c3d', unverified: true });
  });

  it('「ここから展開」でも、除外した手の先はたどらない', async () => {
    const tree = await built();
    const root = tree.nodes[tree.rootKey];
    excludeMove(root, '7g7f');
    const engine = new MockEngine(script());
    await new TreeGenerator(engine, tree, { ...tree.settings, maxRounds: 3 }).run();
    expect(engine.calls.length).toBeGreaterThan(0);
    // 調べた局面は、どれも除外した手を通らずに開始局面からたどれる
    const reachable = new Set<string>();
    const stack = [tree.rootKey];
    while (stack.length > 0) {
      const key = stack.pop()!;
      if (reachable.has(key)) continue;
      reachable.add(key);
      for (const e of tree.nodes[key]?.edges ?? []) stack.push(e.to);
    }
    for (const call of engine.calls) expect(reachable.has(call.key)).toBe(true);
  });
});

describe('書き出し・復習・読み込み', () => {
  it('KIF と復習の問題に、除外した手は入らない', async () => {
    const tree = await built();
    const before = summarize(tree, emptyRecord(tree.id)).total;
    excludeMove(tree.nodes[tree.rootKey], '7g7f');
    // 1 手目の候補（本譜・変化）に ▲７六歩 が無い（もっと先の手順に出てくるのはよい）
    const kif = treeToKif(tree);
    expect(kif).not.toMatch(/^\s*1 ７六歩/m);
    expect(kif).toMatch(/^\s*1 ２六歩/m);
    expect(summarize(tree, emptyRecord(tree.id)).total).toBeLessThan(before);
  });

  it('JSON：除外した手を含むツリー（形式 2）を読める。形式 1 も読める。壊れた excluded は断る', async () => {
    const tree = await built();
    excludeMove(tree.nodes[tree.rootKey], '7g7f');
    tree.version = TREE_FORMAT_VERSION;
    const parsed = parseTreeJson(treeToJson(tree));
    expect(parsed.ok && parsed.tree.nodes[tree.rootKey].excluded?.[0].move).toBe('7g7f');

    const v1 = { ...(await built()), version: 1 };
    expect(parseTreeJson(JSON.stringify(v1)).ok).toBe(true);

    const broken = JSON.parse(treeToJson(tree));
    broken.nodes[tree.rootKey].excluded = [{ move: '7g7f', to: 'no-such-node', score: cp(0) }];
    expect(parseTreeJson(JSON.stringify(broken)).ok).toBe(false);
  });
});
