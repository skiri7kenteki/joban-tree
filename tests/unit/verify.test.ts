// 「この手を検証」と「ここから展開」を、偽物のエンジン（モック）で確かめる
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import { TreeGenerator } from '../../src/tree/generator';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

/** 自分は後手。初手 ▲７六歩 と ▲２六歩 の 2 本に、それぞれ自分の対応（未検証）が付いたツリー */
async function smallTree() {
  const root = keyAfter();
  const engine = new MockEngine({
    [root]: [
      { multipv: 1, score: cp(30), pv: ['7g7f', '3c3d'] },
      { multipv: 2, score: cp(20), pv: ['2g2f', '8c8d'] },
    ],
  });
  const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 1 });
  await new TreeGenerator(engine, tree, tree.settings).run();
  return tree;
}

describe('この手を検証', () => {
  it('検証で別の手が最善なら、それを確定した手として先頭に置き、元の手（未検証）も残す', async () => {
    const tree = await smallTree();
    const me = keyAfter('7g7f');
    expect(tree.nodes[me].edges.map((e) => [e.move, e.unverified])).toEqual([['3c3d', true]]);
    const engine = new MockEngine({ [me]: [{ multipv: 1, score: cp(80), pv: ['8c8d', '2g2f'] }] });
    const reason = await new TreeGenerator(engine, tree, tree.settings).verify(me, 2000);
    expect(reason).toBe('completed');
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0].options).toMatchObject({ movetimeMs: 2000, multiPV: 1 });
    const node = tree.nodes[me];
    expect(node.searched).toBeDefined();
    expect(node.edges.map((e) => [e.move, e.unverified])).toEqual([
      ['8c8d', undefined],
      ['3c3d', true],
    ]);
    expect(node.edges[0].score).toEqual(cp(80));
    expect(tree.nodes[keyAfter('7g7f', '8c8d')]).toBeDefined();
  });

  it('検証で同じ手が最善なら、その手が確定する（枝は 1 本のまま）', async () => {
    const tree = await smallTree();
    const me = keyAfter('2g2f');
    const engine = new MockEngine({ [me]: [{ multipv: 1, score: cp(5), pv: ['8c8d'] }] });
    await new TreeGenerator(engine, tree, tree.settings).verify(me, 1000);
    expect(tree.nodes[me].edges).toEqual([{ move: '8c8d', to: keyAfter('2g2f', '8c8d'), score: cp(5) }]);
  });

  it('相手の手番の局面は検証しない', async () => {
    const tree = await smallTree();
    const engine = new MockEngine();
    await new TreeGenerator(engine, tree, tree.settings).verify(tree.rootKey, 1000);
    expect(engine.calls).toHaveLength(0);
  });
});

describe('ここから展開', () => {
  it('指定した局面の先だけを調べ、ほかの枝には手を付けない', async () => {
    const tree = await smallTree();
    const start = keyAfter('7g7f', '3c3d');
    const other = keyAfter('2g2f', '8c8d');
    expect(tree.nodes[start].searched).toBeUndefined();
    const engine = new MockEngine();
    const reason = await new TreeGenerator(engine, tree, { ...SETTINGS, maxRounds: 1 }).run(start);
    expect(reason).toBe('completed');
    expect(engine.calls.map((c) => c.key)).toEqual([start]);
    expect(tree.nodes[start].edges.length).toBeGreaterThan(0);
    expect(tree.nodes[other].searched).toBeUndefined();
  });

  it('途中の局面から、さらに深く（往復の数だけ）広げられる', async () => {
    const tree = await smallTree();
    const start = keyAfter('7g7f');
    const engine = new MockEngine();
    await new TreeGenerator(engine, tree, { ...SETTINGS, maxRounds: 2 }).run(start);
    const rounds = engine.calls.map((c) => tree.nodes[c.key].round);
    // 開始局面（自分ノード、round 0）の次の相手ノード（round 1）から 2 往復ぶん
    expect(Math.min(...rounds)).toBe(1);
    expect(Math.max(...rounds)).toBe(2);
  });
});
