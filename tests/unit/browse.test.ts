// 閲覧画面の候補手リスト用（段階4）：自分の対応・枝の先の様子
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import { branchInfo, branchText, countAhead, replyOf } from '../../src/tree/browse';
import { TreeGenerator } from '../../src/tree/generator';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

/** 平手（自分は後手）。▲７六歩が最善、▲９六歩は 280 点悪い（疑問手）、▲２六歩は 20 点差（本線） */
function engine() {
  return new MockEngine({
    [keyAfter()]: [
      { multipv: 1, score: cp(80), pv: ['7g7f', '3c3d'] },
      { multipv: 2, score: cp(60), pv: ['2g2f', '8c8d'] },
      { multipv: 3, score: cp(-200), pv: ['9g9f', '3c3d'] },
    ],
  });
}

async function built(dubiousCp?: number, maxRounds = 2) {
  const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, multiPV: 3, maxRounds, replyMs: 500, dubiousCp });
  await new TreeGenerator(engine(), tree, tree.settings).run();
  return tree;
}

describe('閲覧画面の候補手リスト', () => {
  it('相手の応手の後の、自分の対応（いちばん上の手）を返す', async () => {
    const tree = await built(150);
    const root = tree.nodes[tree.rootKey];
    expect(replyOf(tree, root.edges[0])?.move).toBe('3c3d');
    // 自分の対応は、その局面（自分ノード）のいちばん上の手
    expect(replyOf(tree, root.edges[1])).toBe(tree.nodes[root.edges[1].to].edges[0]);
    expect(replyOf(tree, { ...root.edges[1], to: 'no-such-node' })).toBeUndefined();
  });

  it('枝の先：先に何局面あるか（合流は 1 回だけ数える）・疑問手は「咎めまで」', async () => {
    const tree = await built(150);
    const root = tree.nodes[tree.rootKey];
    const [main, second, dubious] = root.edges;
    expect(dubious.move).toBe('9g9f');
    expect(branchInfo(tree, dubious)).toEqual({ kind: 'answer-only' });
    expect(branchText(branchInfo(tree, dubious))).toBe('咎めまで');

    // ▲７六歩 △３四歩 の先は 2 往復目まで調べてある
    const info = branchInfo(tree, main);
    expect(info.kind).toBe('count');
    expect(branchText(info)).toMatch(/^先に \d+ 局面$/);
    // 数え直して一致（重複なし）
    expect(info.kind === 'count' && info.positions).toBe(countAhead(tree, main));
    expect(countAhead(tree, second)).toBeGreaterThan(1);
  });

  it('自分の対応までしか無い枝は「対応まで」、まだ何も無い枝は「未展開」', async () => {
    const tree = await built(150, 1);
    const root = tree.nodes[tree.rootKey];
    expect(branchText(branchInfo(tree, root.edges[0]))).toBe('対応まで');
    expect(branchText(branchInfo(tree, root.edges[2]))).toBe('咎めまで');

    // 自分の対応を消すと「未展開」。自分の手（相手の局面へ）の枝も数える
    const me = tree.nodes[root.edges[0].to];
    expect(branchText(branchInfo(tree, me.edges[0]))).toBe('未展開');
    me.edges = [];
    expect(branchText(branchInfo(tree, root.edges[0]))).toBe('未展開');
  });

  it('疑問手の先を止めない作り方（v0.6.1 まで）のツリーでは「咎めまで」と出さない', async () => {
    const tree = await built(undefined, 1);
    const root = tree.nodes[tree.rootKey];
    expect(branchText(branchInfo(tree, root.edges[2]))).toBe('対応まで');
  });
});
