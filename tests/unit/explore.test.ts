// 段階4-3 B「自分の指したい手で調べる」：最善手と比べて本線にし、その先を作る。本線にする・消す。本線の先だけたどる
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../../src/shogi/position';
import { answerOf } from '../../src/review/review';
import { parseTreeJson, treeToJson } from '../../src/tree/backup';
import { lossText, mineMark, replyOf } from '../../src/tree/browse';
import { countRemoved, deleteMove, makeMainMove } from '../../src/tree/edit';
import { TreeGenerator } from '../../src/tree/generator';
import { treeToKif } from '../../src/tree/kif';
import { TREE_FORMAT_VERSION } from '../../src/tree/types';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

/** 平手（自分は後手）。▲７六歩 の後の自分の手番：最善 △３四歩（+50）、△８四歩 は −30 */
function script() {
  return {
    [keyAfter()]: [
      { multipv: 1, score: cp(80), pv: ['7g7f', '3c3d'] },
      { multipv: 2, score: cp(60), pv: ['2g2f', '8c8d'] },
    ],
    [keyAfter('7g7f')]: [
      { multipv: 1, score: cp(50), pv: ['3c3d', '2g2f'] },
      { multipv: 2, score: cp(-30), pv: ['8c8d', '2g2f'] },
    ],
  };
}

const settings = { ...SETTINGS, multiPV: 2, maxRounds: 2, replyMs: 500 };

async function built() {
  const tree = newTree('white', STARTPOS_SFEN, settings);
  await new TreeGenerator(new MockEngine(script()), tree, tree.settings).run();
  return tree;
}

describe('自分の指したい手で調べる（explore）', () => {
  it('最善手と選んだ手を同じ時間で調べ、選んだ手を本線にして損を入れ、その先を作る', async () => {
    const tree = await built();
    const key = keyAfter('7g7f');
    expect(tree.nodes[key].edges[0].move).toBe('3c3d');
    const engine = new MockEngine(script());
    expect(await new TreeGenerator(engine, tree, settings).explore(key, '8c8d', 500)).toBe('completed');

    // 1 回目：最善手（MultiPV=1、手を限らない）、2 回目：選んだ手だけ。どちらも同じ時間
    expect(engine.calls[0]).toMatchObject({ key, options: { movetimeMs: 500, multiPV: 1 } });
    expect(engine.calls[0].options.searchMoves).toBeUndefined();
    expect(engine.calls[1]).toMatchObject({ key, options: { movetimeMs: 500, multiPV: 1, searchMoves: ['8c8d'] } });

    const node = tree.nodes[key];
    expect(node.edges.map((e) => [e.move, e.userChosen ?? false, e.loss])).toEqual([
      ['8c8d', true, 80],
      ['3c3d', false, undefined],
    ]);
    expect(node.edges.map((e) => mineMark(node, e))).toEqual(['chosen', 'best']);
    expect(lossText(node.edges[0].loss!)).toBe('最善より −80');

    // 選んだ手の後の局面（相手の手番）から先を作った
    const next = tree.nodes[keyAfter('7g7f', '8c8d')];
    expect(next.searched).toBeDefined();
    expect(next.edges.length).toBeGreaterThan(0);
    expect(engine.calls[2].key).toBe(next.key);

    // 相手の応手の行の「→ 自分の対応」・復習の正解・書き出しの本譜は、選んだ手
    const rootEdge = tree.nodes[tree.rootKey].edges.find((e) => e.move === '7g7f')!;
    expect(replyOf(tree, rootEdge)?.move).toBe('8c8d');
    expect(answerOf(tree, key)?.move).toBe('8c8d');
    const kif = treeToKif(tree);
    expect(kif).toMatch(/^\s*2 ８四歩/m);
    expect(kif).toContain('自分の手（最善より −80）');
    expect(kif).toContain('最善');
  });

  it('選んだ手が最善手と同じなら損は 0（手は 1 つのまま、自分の手の印が付く）', async () => {
    const tree = await built();
    const key = keyAfter('7g7f');
    await new TreeGenerator(new MockEngine(script()), tree, settings).explore(key, '3c3d', 500);
    expect(tree.nodes[key].edges).toHaveLength(1);
    expect(tree.nodes[key].edges[0]).toMatchObject({ move: '3c3d', userChosen: true, loss: 0, score: cp(50) });
    expect(lossText(0)).toBe('最善と同じ');
  });

  it('指せない手はエラーにして、ツリーは変えない', async () => {
    const tree = await built();
    const before = JSON.stringify(tree);
    const g = new TreeGenerator(new MockEngine(script()), tree, settings);
    expect(await g.explore(keyAfter('7g7f'), '5a5c', 500)).toBe('error');
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('自分の手が複数ある局面は、本線の先だけたどる', () => {
  it('「ここから展開」は、本線でない自分の手（検証前の手など）の先を調べない', async () => {
    const tree = await built();
    // ▲２六歩 の後の自分の手番に、本線でない手 △４四歩（未検証）を足す。その先は調べていない
    const me = tree.nodes[keyAfter('2g2f')];
    const after = applyUsiMove(me.sfen, '4c4d')!.sfen;
    tree.nodes[sfenKey(after)] = { key: sfenKey(after), sfen: after, round: me.round + 1, edges: [] };
    me.edges.push({ move: '4c4d', to: sfenKey(after), score: cp(0), unverified: true });

    const engine = new MockEngine(script());
    await new TreeGenerator(engine, tree, { ...settings, maxRounds: 4 }).run();
    expect(engine.calls.length).toBeGreaterThan(0);
    expect(engine.calls.map((c) => c.key)).not.toContain(sfenKey(after));
  });

  it('自分の手が本線の局面を検証しても、本線はそのまま。最善手はその下に置く', async () => {
    // 自分は先手。開始局面（自分の手番）で、自分の手 ▲２六歩 が本線。エンジンの最善手は ▲７六歩
    const tree = newTree('black', STARTPOS_SFEN, settings);
    const root = tree.nodes[tree.rootKey];
    const after = applyUsiMove(STARTPOS_SFEN, '2g2f')!.sfen;
    tree.nodes[sfenKey(after)] = { key: sfenKey(after), sfen: after, round: 0, edges: [] };
    root.edges.push({ move: '2g2f', to: sfenKey(after), score: cp(20), userChosen: true, loss: 30 });

    const engine = new MockEngine({ [tree.rootKey]: [{ multipv: 1, score: cp(50), pv: ['7g7f', '3c3d'] }] });
    await new TreeGenerator(engine, tree, settings).verify(tree.rootKey, 500);
    expect(root.edges.map((e) => [e.move, mineMark(root, e)])).toEqual([
      ['2g2f', 'chosen'],
      ['7g7f', 'best'],
    ]);
  });
});

describe('本線にする・消す', () => {
  it('本線にすると、その手がいちばん上になり、復習の正解も変わる', async () => {
    const tree = await built();
    const key = keyAfter('7g7f');
    await new TreeGenerator(new MockEngine(script()), tree, settings).explore(key, '8c8d', 500);
    expect(makeMainMove(tree.nodes[key], '3c3d')).toBe(true);
    expect(tree.nodes[key].edges.map((e) => e.move)).toEqual(['3c3d', '8c8d']);
    expect(answerOf(tree, key)?.move).toBe('3c3d');
    expect(makeMainMove(tree.nodes[key], '3c3d')).toBe(false);
    expect(makeMainMove(tree.nodes[key], '9c9d')).toBe(false);
  });

  it('消すと、その手と、どこからもたどれなくなった先の局面が消える。最後の 1 手は消さない', async () => {
    const tree = await built();
    const key = keyAfter('7g7f');
    await new TreeGenerator(new MockEngine(script()), tree, settings).explore(key, '8c8d', 500);
    const gone = keyAfter('7g7f', '3c3d');
    expect(tree.nodes[gone]).toBeDefined();
    // 数は「先に N 局面」と同じ数え方（手が分かっている局面だけ）
    const count = countRemoved(tree, key, '3c3d');
    expect(count).toBeGreaterThan(0);
    const before = Object.values(tree.nodes).filter((n) => n.edges.length > 0).length;

    expect(deleteMove(tree, key, '3c3d')).toBe(true);
    expect(tree.nodes[key].edges.map((e) => e.move)).toEqual(['8c8d']);
    expect(tree.nodes[gone]).toBeUndefined();
    expect(Object.values(tree.nodes).filter((n) => n.edges.length > 0).length).toBe(before - count);
    // 残った手の先はそのまま
    expect(tree.nodes[keyAfter('7g7f', '8c8d')]).toBeDefined();
    // 最後の 1 手は消さない
    expect(deleteMove(tree, key, '8c8d')).toBe(false);
  });

  it('除外した手の先の局面は、消さずに残す（戻せるように）', async () => {
    const tree = await built();
    const root = tree.nodes[tree.rootKey];
    // ▲２六歩 を除外しておく
    root.excluded = root.edges.filter((e) => e.move === '2g2f');
    root.edges = root.edges.filter((e) => e.move !== '2g2f');
    const key = keyAfter('7g7f');
    await new TreeGenerator(new MockEngine(script()), tree, settings).explore(key, '8c8d', 500);
    deleteMove(tree, key, '3c3d');
    expect(tree.nodes[keyAfter('2g2f')]).toBeDefined();
  });
});

describe('JSON（形式 3）', () => {
  it('自分の手（userChosen・loss）を含むツリーを読める。壊れた値は断る', async () => {
    const tree = await built();
    const key = keyAfter('7g7f');
    await new TreeGenerator(new MockEngine(script()), tree, settings).explore(key, '8c8d', 500);
    tree.version = TREE_FORMAT_VERSION;
    expect(TREE_FORMAT_VERSION).toBe(3);
    const parsed = parseTreeJson(treeToJson(tree));
    expect(parsed.ok && parsed.tree.nodes[key].edges[0]).toMatchObject({ userChosen: true, loss: 80 });

    const broken = JSON.parse(treeToJson(tree));
    broken.nodes[key].edges[0].loss = 'たくさん';
    expect(parseTreeJson(JSON.stringify(broken)).ok).toBe(false);
    broken.nodes[key].edges[0].loss = 80;
    broken.nodes[key].edges[0].userChosen = 'yes';
    expect(parseTreeJson(JSON.stringify(broken)).ok).toBe(false);
  });
});
