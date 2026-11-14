// 自分の対応も調べて確定する設定（replyMs）を、偽物のエンジン（モック）で確かめる
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import { TreeGenerator } from '../../src/tree/generator';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

const WITH_REPLY = { ...SETTINGS, replyMs: 700 };

describe('自分の対応も調べる（replyMs）', () => {
  it('読み筋の 2 手目は使わず、自分ノードを MultiPV=1・replyMs で調べて確定した手を置く', async () => {
    const root = keyAfter();
    const engine = new MockEngine({
      [root]: [
        { multipv: 1, score: cp(80), pv: ['7g7f', '3c3d'] },
        { multipv: 2, score: cp(40), pv: ['2g2f', '8c8d'] },
      ],
      // 自分（後手）の番：読み筋の 2 手目（3c3d）ではなく 8c8d が最善
      [keyAfter('7g7f')]: [{ multipv: 1, score: cp(-50), pv: ['8c8d', '2g2f'] }],
      [keyAfter('2g2f')]: [{ multipv: 1, score: cp(-30), pv: ['8c8d'] }],
    });
    const tree = newTree('white', STARTPOS_SFEN, { ...WITH_REPLY, multiPV: 2, maxRounds: 1 });
    const reason = await new TreeGenerator(engine, tree, tree.settings).run();
    expect(reason).toBe('completed');

    const me = tree.nodes[keyAfter('7g7f')];
    expect(me.searched).toBeTruthy();
    // 確定した手だけ（未検証の手は作らない）。評価値は自分から見た値（エンジンは手番側＝自分から見た値を返す）
    expect(me.edges).toEqual([{ move: '8c8d', to: keyAfter('7g7f', '8c8d'), score: cp(-50) }]);
    expect(tree.nodes[keyAfter('2g2f')].edges.map((e) => e.move)).toEqual(['8c8d']);
    // 相手の局面 1 つ＋自分の局面 2 つ。自分の局面は MultiPV=1・replyMs
    expect(engine.calls).toHaveLength(3);
    expect(engine.calls[0].options).toEqual({ movetimeMs: 400, multiPV: 2 });
    expect(engine.calls.slice(1).map((c) => c.options)).toEqual([
      { movetimeMs: 700, multiPV: 1 },
      { movetimeMs: 700, multiPV: 1 },
    ]);
    // 1 往復までなので、自分の手の後の局面（相手ノード）は調べない
    expect(tree.nodes[keyAfter('7g7f', '8c8d')].searched).toBeUndefined();
  });

  it('浅い順：相手の応手への自分の対応を確定してから、次の往復の相手の局面を調べる', async () => {
    const engine = new MockEngine();
    const tree = newTree('white', STARTPOS_SFEN, { ...WITH_REPLY, multiPV: 2, maxRounds: 2 });
    await new TreeGenerator(engine, tree, tree.settings).run();
    // 調べた順に深さ（往復）が下がらない。自分の局面（MultiPV=1）も同じ往復のうちに調べる
    const rounds = engine.calls.map((c) => tree.nodes[c.key].round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
    expect(engine.calls.filter((c) => c.options.multiPV === 1).length).toBeGreaterThanOrEqual(4);
    // どの自分の手にも「未検証」が付かない
    for (const node of Object.values(tree.nodes)) {
      for (const edge of node.edges) expect(edge.unverified).toBeUndefined();
    }
  });

  it('ここから展開：前の版で作った「未検証」の自分ノードは、調べ直して確定する（その先の枝も残す）', async () => {
    const root = keyAfter();
    const old = newTree('white', STARTPOS_SFEN, { ...SETTINGS, multiPV: 1, maxRounds: 1 });
    await new TreeGenerator(
      new MockEngine({ [root]: [{ multipv: 1, score: cp(80), pv: ['7g7f', '3c3d'] }] }),
      old,
      old.settings,
    ).run();
    const me = old.nodes[keyAfter('7g7f')];
    expect(me.edges[0].unverified).toBe(true);

    const engine = new MockEngine({ [keyAfter('7g7f')]: [{ multipv: 1, score: cp(-50), pv: ['8c8d'] }] });
    await new TreeGenerator(engine, old, { ...WITH_REPLY, multiPV: 1, maxRounds: 1 }).run();
    expect(me.searched).toBeTruthy();
    expect(me.edges.map((e) => [e.move, !!e.unverified])).toEqual([
      ['8c8d', false],
      ['3c3d', true],
    ]);
  });

  it('時間の上限が近いときは、自分の局面も残り時間に合わせて短く調べる', async () => {
    let t = 0;
    const engine = new MockEngine({}, { onAnalyze: () => (t += 900) });
    const tree = newTree('white', STARTPOS_SFEN, { ...WITH_REPLY, replyMs: 5000, totalMs: 1200, multiPV: 1 });
    const reason = await new TreeGenerator(engine, tree, tree.settings, { now: () => t }).run();
    expect(reason).toBe('time');
    expect(engine.calls.map((c) => c.options.movetimeMs)).toEqual([400, 300]);
  });
});
