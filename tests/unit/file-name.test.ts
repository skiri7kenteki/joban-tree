// 書き出すファイルの名前と、前の版のツリー 1 本の形の確かめ（バックアップから戻すときに使う）
import { describe, expect, it } from 'vitest';
import { fileNameOf, treeProblem } from '../../src/tree/backup';
import { TREE_FORMAT_VERSION } from '../../src/tree/types';
import { lineTree } from './tree-fixture';

describe('ファイル名', () => {
  it('ファイル名に使えない文字を除く', () => {
    expect(fileNameOf('▲７六歩まで（自分は後手）', 'json')).toBe('▲７六歩まで（自分は後手）.json');
    expect(fileNameOf('a/b:c d', 'kifu')).toBe('a_b_c_d.kifu');
    expect(fileNameOf('', 'json')).toBe('joban-tree.json');
  });
});

describe('前の版のツリーの形（バックアップは読んで持ち運ぶ）', () => {
  it('正しい形は通し、新しすぎる形式・壊れた中身は理由を返す', () => {
    const tree = lineTree([], ['7g7f', '3c3d']);
    expect(treeProblem(tree)).toBeNull();
    // 形式 4（templateId なし）の古いツリーも読める。templateId がおかしければ読まない
    expect(treeProblem({ ...tree, version: 4 })).toBeNull();
    expect(treeProblem({ ...tree, templateId: 12 })).not.toBeNull();
    expect(treeProblem({ app: 'other' })).not.toBeNull();
    expect(treeProblem({ ...tree, version: TREE_FORMAT_VERSION + 1 })).toContain('新しい');
    const broken = structuredClone(tree);
    broken.nodes[broken.rootKey].edges[0].to = 'どこにもない局面';
    expect(treeProblem(broken)).not.toBeNull();
    expect(treeProblem({ ...structuredClone(tree), id: '../x' })).not.toBeNull();
  });
});
