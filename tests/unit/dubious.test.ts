// 疑問手の先は、咎める自分の手までで止める（dubiousCp、v0.6.2〜）を、偽物のエンジン（モック）で確かめる
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import { TreeGenerator, isAfterDubiousOnly } from '../../src/tree/generator';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

/** 平手（自分は後手）。▲７六歩が最善、▲９六歩は 280 点悪い（W=300 の内側なので採用されるが、疑問手） */
function engine() {
  return new MockEngine({
    [keyAfter()]: [
      { multipv: 1, score: cp(80), pv: ['7g7f', '3c3d'] },
      { multipv: 2, score: cp(-200), pv: ['9g9f', '3c3d'] },
    ],
  });
}

const BASE = { ...SETTINGS, multiPV: 2, maxRounds: 2 };

describe('疑問手の先は、咎める手までで止める', () => {
  it('自分の対応も調べる設定：疑問手の後も咎める手は調べて確定するが、その先の相手の局面は調べない', async () => {
    const tree = newTree('white', STARTPOS_SFEN, { ...BASE, replyMs: 500, dubiousCp: 150 });
    expect(await new TreeGenerator(engine(), tree, tree.settings).run()).toBe('completed');

    const root = tree.nodes[tree.rootKey];
    expect(root.edges.map((e) => [e.move, e.diff])).toEqual([
      ['7g7f', 0],
      ['9g9f', 280],
    ]);
    // 咎める手は確定している
    const afterDubious = tree.nodes[keyAfter('9g9f')];
    expect(afterDubious.searched).toBeTruthy();
    expect(afterDubious.edges[0].move).toBe('3c3d');
    expect(afterDubious.edges[0].unverified).toBeUndefined();
    // その先（2 往復目）は調べない。本線の先は調べる
    expect(tree.nodes[keyAfter('9g9f', '3c3d')].searched).toBeUndefined();
    expect(tree.nodes[keyAfter('7g7f', '3c3d')].searched).toBeTruthy();
  });

  it('自分の対応を調べない設定（未検証）でも、疑問手の先の相手の局面は調べない', async () => {
    const tree = newTree('white', STARTPOS_SFEN, { ...BASE, dubiousCp: 150 });
    await new TreeGenerator(engine(), tree, tree.settings).run();
    expect(tree.nodes[keyAfter('9g9f')].edges[0]).toMatchObject({ move: '3c3d', unverified: true });
    expect(tree.nodes[keyAfter('9g9f', '3c3d')].searched).toBeUndefined();
    expect(tree.nodes[keyAfter('7g7f', '3c3d')].searched).toBeTruthy();
  });

  it('dubiousCp が無ければ（v0.6.1 までの作り方）、疑問手の先も調べる', async () => {
    const tree = newTree('white', STARTPOS_SFEN, { ...BASE, replyMs: 500 });
    await new TreeGenerator(engine(), tree, tree.settings).run();
    expect(tree.nodes[keyAfter('9g9f', '3c3d')].searched).toBeTruthy();
  });

  it('疑問手の後の局面を選んで「ここから展開」すれば、その先も調べる', async () => {
    const tree = newTree('white', STARTPOS_SFEN, { ...BASE, replyMs: 500, dubiousCp: 150 });
    await new TreeGenerator(engine(), tree, tree.settings).run();
    expect(tree.nodes[keyAfter('9g9f', '3c3d')].searched).toBeUndefined();

    // ほかの局面から「ここから展開」しても、疑問手の先は止めたまま
    await new TreeGenerator(engine(), tree, { ...tree.settings, maxRounds: 3 }).run();
    expect(tree.nodes[keyAfter('9g9f', '3c3d')].searched).toBeUndefined();

    // 疑問手の後の局面を選べば、先まで調べる
    await new TreeGenerator(engine(), tree, { ...tree.settings, maxRounds: 1 }).run(keyAfter('9g9f'));
    expect(tree.nodes[keyAfter('9g9f', '3c3d')].searched).toBeTruthy();
  });

  it('画面の案内用：疑問手を咎めた後の局面だけを見分ける', async () => {
    const tree = newTree('white', STARTPOS_SFEN, { ...BASE, replyMs: 500, dubiousCp: 150 });
    await new TreeGenerator(engine(), tree, tree.settings).run();
    expect(isAfterDubiousOnly(tree, keyAfter('9g9f', '3c3d'))).toBe(true);
    expect(isAfterDubiousOnly(tree, keyAfter('7g7f', '3c3d'))).toBe(false);
    expect(isAfterDubiousOnly(tree, tree.rootKey)).toBe(false);
    // 疑問手の先を止めない設定で作ったツリーでは、案内しない
    const { dubiousCp: _omit, ...older } = tree.settings;
    expect(isAfterDubiousOnly({ ...tree, settings: older }, keyAfter('9g9f', '3c3d'))).toBe(false);
  });
});
