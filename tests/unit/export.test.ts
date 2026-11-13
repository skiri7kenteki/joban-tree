// KIF の書き出しと、JSON の書き出し・読み込み
import { describe, expect, it } from 'vitest';
import { importKIF } from 'tsshogi';
import { STARTPOS_SFEN, applyUsiMove } from '../../src/shogi/position';
import { fileNameOf, parseTreeJson, treeToJson } from '../../src/tree/backup';
import { TreeGenerator, createTree } from '../../src/tree/generator';
import { pathToKif, treeToKif } from '../../src/tree/kif';
import { TREE_FORMAT_VERSION } from '../../src/tree/types';
import { MockEngine, SETTINGS, cp, keyAfter, newTree } from './mock-engine';

/** 平手から 2 往復ぶん作ったツリー（合流あり） */
async function builtTree() {
  const root = keyAfter();
  const engine = new MockEngine({
    [root]: [
      { multipv: 1, score: cp(10), pv: ['7g7f', '3c3d'] },
      { multipv: 2, score: cp(-120), pv: ['2g2f', '8c8d'] },
    ],
    [keyAfter('7g7f', '3c3d')]: [{ multipv: 1, score: cp(10), pv: ['2g2f', '8c8d'] }],
    [keyAfter('2g2f', '8c8d')]: [{ multipv: 1, score: cp(10), pv: ['7g7f', '3c3d'] }],
  });
  const tree = newTree('white', STARTPOS_SFEN, { ...SETTINGS, maxRounds: 2 });
  await new TreeGenerator(engine, tree, tree.settings).run();
  return tree;
}

describe('KIF の書き出し', () => {
  it('分岐付き KIF：1 番目の候補が本譜、2 番目以降が変化。ほかのアプリでも読める', async () => {
    const tree = await builtTree();
    const kif = treeToKif(tree);
    expect(kif).toContain('手合割：平手');
    expect(kif).toContain('７六歩(77)');
    expect(kif).toContain('変化：1手');
    expect(kif).toContain('２六歩(27)');
    // 評価値の「−」は画面と同じ記号（U+2212）
    expect(kif).toContain('*評価値 −10・本線');
    expect(kif).toContain('*評価値 +120・有力');
    expect(kif).toContain('合流');
    const record = importKIF(kif);
    expect(record).not.toBeInstanceOf(Error);
    if (record instanceof Error) return;
    record.goto(1);
    expect(record.current.move).toMatchObject({ usi: '7g7f' });
    expect(record.current.branch).not.toBeNull();
  });

  it('手順の KIF：棋譜の初めから、開始局面までの手順とツリーの手順を 1 本でつなぐ', () => {
    const prefix = ['7g7f', '3c3d'];
    let sfen = STARTPOS_SFEN;
    for (const m of prefix) sfen = applyUsiMove(sfen, m)!.sfen;
    const tree = createTree({
      id: 't2',
      name: 'テスト',
      rootSfen: sfen,
      mySide: 'white',
      prefix: { initialSfen: STARTPOS_SFEN, moves: prefix },
      settings: SETTINGS,
      now: 0,
    });
    const after = applyUsiMove(sfen, '2g2f')!.sfen;
    const meKey = keyAfter('7g7f', '3c3d', '2g2f');
    tree.nodes[tree.rootKey].edges.push({ move: '2g2f', to: meKey, score: cp(-30), diff: 0 });
    tree.nodes[meKey] = { key: meKey, sfen: after, round: 0, edges: [] };
    const kif = pathToKif(tree, [tree.rootKey, meKey]);
    const record = importKIF(kif);
    if (record instanceof Error) throw record;
    const moves: string[] = [];
    record.goto(0);
    while (record.goForward()) moves.push((record.current.move as { usi: string }).usi);
    expect(moves).toEqual(['7g7f', '3c3d', '2g2f']);
    expect(kif).toContain('序盤ツリーの開始局面（自分は後手');
  });
});

describe('JSON の書き出し・読み込み', () => {
  it('書き出したものを読み込むと、同じツリーに戻る', async () => {
    const tree = await builtTree();
    const result = parseTreeJson(treeToJson(tree));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tree).toEqual(tree);
  });

  it('ほかのファイル・新しすぎる形式・壊れた中身は読まない', async () => {
    const tree = await builtTree();
    expect(parseTreeJson('not json').ok).toBe(false);
    expect(parseTreeJson(JSON.stringify({ app: 'other' })).ok).toBe(false);
    const newer = parseTreeJson(JSON.stringify({ ...tree, version: TREE_FORMAT_VERSION + 1 }));
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.message).toContain('新しい形式');

    const broken = structuredClone(tree);
    broken.nodes[broken.rootKey].edges[0].to = 'どこにもない局面';
    expect(parseTreeJson(JSON.stringify(broken)).ok).toBe(false);

    const badId = { ...structuredClone(tree), id: '../x' };
    expect(parseTreeJson(JSON.stringify(badId)).ok).toBe(false);
  });

  it('ファイル名に使えない文字を除く', () => {
    expect(fileNameOf('▲７六歩まで（自分は後手）', 'json')).toBe('▲７六歩まで（自分は後手）.json');
    expect(fileNameOf('a/b:c d', 'kifu')).toBe('a_b_c_d.kifu');
    expect(fileNameOf('', 'json')).toBe('joban-tree.json');
  });
});
