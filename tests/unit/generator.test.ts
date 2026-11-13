// ツリー生成のロジックを、偽物のエンジン（モック）で確かめる
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import { TreeGenerator, countParents } from '../../src/tree/generator';
import { labelOf } from '../../src/tree/labels';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

describe('TreeGenerator', () => {
  it('相手の応手（1 手目）と自分の対応（2 手目・未検証）の枝を作り、評価値を自分から見た値にする', async () => {
    const root = keyAfter();
    const engine = new MockEngine({
      [root]: [
        { multipv: 1, score: cp(80), pv: ['7g7f', '3c3d', '2g2f'] },
        { multipv: 2, score: cp(0), pv: ['2g2f', '8c8d'] },
        { multipv: 3, score: cp(-400), pv: ['5g5f', '3c3d'] }, // 最善から 480 点差 → 採用しない
      ],
    });
    const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 1 });
    const reason = await new TreeGenerator(engine, tree, tree.settings).run();

    expect(reason).toBe('completed');
    const edges = tree.nodes[root].edges;
    expect(edges.map((e) => e.move)).toEqual(['7g7f', '2g2f']);
    // 相手（先手）から見て +80 → 自分（後手）から見て −80
    expect(edges[0].score).toEqual(cp(-80));
    expect(edges.map((e) => e.diff)).toEqual([0, 80]);
    expect(edges.map((e) => labelOf(e.diff!))).toEqual(['main', 'good']);

    const me = tree.nodes[keyAfter('7g7f')];
    expect(me.edges).toEqual([{ move: '3c3d', to: keyAfter('7g7f', '3c3d'), score: cp(-80), unverified: true }]);
    // 1 往復までなので、自分の対応の後の局面は調べない
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0].options).toEqual({ movetimeMs: 400, multiPV: 3 });
  });

  it('深さの上限（往復の数）まで、浅い順に調べる', async () => {
    const engine = new MockEngine();
    const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, multiPV: 2, maxRounds: 3 });
    const reason = await new TreeGenerator(engine, tree, tree.settings).run();
    expect(reason).toBe('completed');
    // 相手ノードを 1 + 2 + 4 局面（同じ局面への合流があればそれより少ない）
    expect(engine.calls.length).toBeLessThanOrEqual(7);
    expect(engine.calls.length).toBeGreaterThanOrEqual(5);
    const rounds = engine.calls.map((c) => tree.nodes[c.key].round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
    expect(Math.max(...rounds)).toBe(2);
  });

  it('同じ深さでは、自分に良い枝から先に調べる', async () => {
    const root = keyAfter();
    const engine = new MockEngine({
      [root]: [
        { multipv: 1, score: cp(100), pv: ['7g7f', '3c3d'] }, // 自分から見て −100
        { multipv: 2, score: cp(50), pv: ['2g2f', '8c8d'] }, // 自分から見て −50（こちらが先）
      ],
    });
    const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 2 });
    await new TreeGenerator(engine, tree, tree.settings).run();
    expect(engine.calls.map((c) => c.key).slice(0, 3)).toEqual([root, keyAfter('2g2f', '8c8d'), keyAfter('7g7f', '3c3d')]);
  });

  it('時間の上限で止まり、それまでのツリーは残る', async () => {
    let clock = 0;
    const engine = new MockEngine({}, { onAnalyze: () => (clock += 400) });
    const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, totalMs: 1000, maxRounds: 5 });
    const reason = await new TreeGenerator(engine, tree, tree.settings, { now: () => clock }).run();
    expect(reason).toBe('time');
    expect(engine.calls).toHaveLength(3);
    expect(tree.nodes[tree.rootKey].edges.length).toBeGreaterThan(0);
  });

  it('停止ボタン：調べている途中の 1 局面を取り込んでから止まる', async () => {
    let generator: TreeGenerator | null = null;
    const engine = new MockEngine({}, { onAnalyze: (n) => n === 2 && generator!.stop() });
    const tree = newTree();
    generator = new TreeGenerator(engine, tree, tree.settings);
    const reason = await generator.run();
    expect(reason).toBe('stopped');
    expect(engine.stopCount).toBe(1);
    expect(engine.calls).toHaveLength(2);
    expect(Object.values(tree.nodes).filter((n) => n.searched)).toHaveLength(2);
  });

  it('読み筋が 1 手しかないときは、その後の局面を自分ノードとして調べる（自分の手は確定）', async () => {
    const root = keyAfter();
    const engine = new MockEngine({
      [root]: [{ multipv: 1, score: cp(30), pv: ['7g7f'] }],
      [keyAfter('7g7f')]: [{ multipv: 1, score: cp(-20), pv: ['8c8d', '2g2f'] }],
    });
    const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 1 });
    await new TreeGenerator(engine, tree, tree.settings).run();
    expect(engine.calls.map((c) => [c.key, c.options.multiPV])).toEqual([
      [root, 3],
      [keyAfter('7g7f'), 1],
    ]);
    const me = tree.nodes[keyAfter('7g7f')];
    // 自分ノードの評価値は手番側（自分）から見た値なので、そのまま
    expect(me.edges).toEqual([{ move: '8c8d', to: keyAfter('7g7f', '8c8d'), score: cp(-20) }]);
  });

  it('自分が先手で、開始局面が自分の手番なら、まず自分の手を調べる', async () => {
    const engine = new MockEngine();
    const tree = newTree('black', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 1 });
    await new TreeGenerator(engine, tree, tree.settings).run();
    expect(engine.calls[0].options.multiPV).toBe(1);
    expect(engine.calls[1].options.multiPV).toBe(3);
    expect(engine.calls).toHaveLength(2);
  });

  it('詰みの評価値を正しく比べる（相手が詰まされる手順は、詰まない手より悪い）', async () => {
    const root = keyAfter();
    const engine = new MockEngine({
      [root]: [
        { multipv: 1, score: cp(-200), pv: ['7g7f', '3c3d'] },
        { multipv: 2, score: { kind: 'mate', plies: -9 }, pv: ['2g2f', '8c8d'] },
      ],
    });
    const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 1 });
    await new TreeGenerator(engine, tree, tree.settings).run();
    // 詰まされる応手は最善から大きく離れているので採用しない
    expect(tree.nodes[root].edges.map((e) => e.move)).toEqual(['7g7f']);
  });

  it('手順が違っても同じ局面になれば、1 つにまとめる（合流）', async () => {
    const root = keyAfter();
    const engine = new MockEngine({
      [root]: [
        { multipv: 1, score: cp(10), pv: ['7g7f', '3c3d'] },
        { multipv: 2, score: cp(0), pv: ['2g2f', '8c8d'] },
      ],
      [keyAfter('7g7f', '3c3d')]: [{ multipv: 1, score: cp(10), pv: ['2g2f', '8c8d'] }],
      [keyAfter('2g2f', '8c8d')]: [{ multipv: 1, score: cp(10), pv: ['7g7f', '3c3d'] }],
    });
    const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 2 });
    await new TreeGenerator(engine, tree, tree.settings).run();
    const merged = keyAfter('7g7f', '3c3d', '2g2f', '8c8d');
    expect(tree.nodes[merged]).toBeDefined();
    expect(countParents(tree).get(merged)).toBe(2);
  });

  it('エンジンが指す手を返さない局面（詰みなど）は終わりの印を付ける', async () => {
    const root = keyAfter();
    const engine = new MockEngine({ [root]: [] });
    const tree = newTree();
    const reason = await new TreeGenerator(engine, tree, tree.settings).run();
    expect(reason).toBe('completed');
    expect(tree.nodes[root].terminal).toBe(true);
  });
});
