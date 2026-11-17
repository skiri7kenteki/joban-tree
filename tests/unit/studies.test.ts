// 段階7-2：研究手順（保存・同じ手順の重複を防ぐ・たどれなくなった手順・書き出しと取り込み・新しい版への引き継ぎ）
import { describe, expect, it } from 'vitest';
import { parseTreeJson, treeToJson } from '../../src/tree/backup';
import { excludeMove, TreeGenerator } from '../../src/tree/generator';
import { deleteMove } from '../../src/tree/edit';
import { groupStudies, filterByName } from '../../src/tree/organize';
import {
  addStudy,
  carryStudies,
  checkStudyFields,
  defaultStudyName,
  findSameStudy,
  firstLine,
  movesOfPath,
  removeStudy,
  studyEndingAt,
  studyNextMoves,
  traceStudy,
  updateStudy,
} from '../../src/tree/studies';
import { TREE_FORMAT_VERSION, type TreeData } from '../../src/tree/types';
import { MockEngine, SETTINGS, keyAfter, newTree } from './mock-engine';

/** モックで作ったツリー（後手番。▲7六歩・▲2六歩・▲5六歩 … の応手と、それぞれへの自分の対応） */
async function built(): Promise<TreeData> {
  const tree = newTree('white');
  await new TreeGenerator(new MockEngine(), tree, { ...SETTINGS, maxRounds: 2 }).run();
  return tree;
}

/** ツリーにある手順（相手の最初の応手 → 自分の対応 → 相手の 2 つ目の応手） */
function someLine(tree: TreeData): string[] {
  const root = tree.nodes[tree.rootKey];
  const a = root.edges[0];
  const b = tree.nodes[a.to].edges[0];
  const c = tree.nodes[b.to].edges[1];
  return [a.move, b.move, c.move];
}

describe('研究手順の保存', () => {
  it('ツリーにある手順を、名前とメモ付きで保存する。日付・id が付く', async () => {
    const tree = await built();
    const moves = someLine(tree);
    const r = addStudy(tree, { name: ' 研究1 ', note: '狙いは\n2 行目\n', moves }, 1000, 'sid-1');
    expect(r).toEqual({ created: true, study: { id: 'sid-1', name: '研究1', note: '狙いは\n2 行目', moves, createdAt: 1000, updatedAt: 1000 } });
    expect(tree.studies).toHaveLength(1);
    expect(firstLine(tree.studies![0].note)).toBe('狙いは');
  });

  it('同じ手順はもう作らず、すでにあるものを返す（created: false）。直すと名前・メモ・日付が変わる', async () => {
    const tree = await built();
    const moves = someLine(tree);
    addStudy(tree, { name: 'A', note: '', moves }, 1000, 'sid-1');
    const again = addStudy(tree, { name: 'B', note: 'x', moves: [...moves] }, 2000, 'sid-2');
    expect(again?.created).toBe(false);
    expect(again?.study.id).toBe('sid-1');
    expect(tree.studies).toHaveLength(1);
    expect(findSameStudy(tree, moves)?.name).toBe('A');
    // 手順の一部だけなら別の研究手順
    expect(addStudy(tree, { name: 'C', note: '', moves: moves.slice(0, 2) }, 3000, 'sid-3')?.created).toBe(true);
    expect(updateStudy(tree, 'sid-1', { name: 'A2', note: 'メモ' }, 4000)).toBe(true);
    expect(tree.studies![0]).toMatchObject({ name: 'A2', note: 'メモ', createdAt: 1000, updatedAt: 4000 });
    expect(updateStudy(tree, 'none', { name: 'x', note: '' }, 1)).toBe(false);
  });

  it('ツリーに無い手を含む手順・空の手順は保存しない', async () => {
    const tree = await built();
    expect(addStudy(tree, { name: 'x', note: '', moves: ['1g1f', '1c1d'] }, 1)).toBeNull();
    expect(addStudy(tree, { name: 'x', note: '', moves: [] }, 1)).toBeNull();
    expect(tree.studies ?? []).toHaveLength(0);
  });

  it('消す', async () => {
    const tree = await built();
    addStudy(tree, { name: 'A', note: '', moves: someLine(tree) }, 1, 'sid-1');
    expect(removeStudy(tree, 'sid-1')).toBe(true);
    expect(removeStudy(tree, 'sid-1')).toBe(false);
    expect(tree.studies).toEqual([]);
  });

  it('名前の初期値は最後の 3 手。名前とメモの確かめ', async () => {
    const tree = await built();
    const moves = someLine(tree);
    const name = defaultStudyName(tree, moves);
    expect(name.split(' ')).toHaveLength(3);
    expect(name).toMatch(/^[▲△]/);
    expect(defaultStudyName(tree, moves.slice(0, 1)).split(' ')).toHaveLength(1);
    expect(defaultStudyName(tree, [])).toBe(tree.name);
    expect(checkStudyFields({ name: ' ', note: '' })).toMatch(/名前/);
    expect(checkStudyFields({ name: 'a'.repeat(101), note: '' })).toMatch(/100/);
    expect(checkStudyFields({ name: 'ok', note: 'x'.repeat(3001) })).toMatch(/3000/);
    expect(checkStudyFields({ name: 'ok', note: '' })).toBeNull();
  });
});

describe('閲覧画面の★と、終わりの局面', () => {
  it('たどってきた手順が研究手順の途中なら、次の手に★。終わりの局面では、その研究手順', async () => {
    const tree = await built();
    const moves = someLine(tree);
    addStudy(tree, { name: 'A', note: '', moves }, 1, 'sid-1');
    expect([...studyNextMoves(tree, [])]).toEqual([moves[0]]);
    expect([...studyNextMoves(tree, moves.slice(0, 2))]).toEqual([moves[2]]);
    expect(studyNextMoves(tree, moves).size).toBe(0);
    // 別の手順から来たら付けない
    const other = tree.nodes[tree.rootKey].edges[1].move;
    expect(studyNextMoves(tree, [other]).size).toBe(0);
    expect(studyEndingAt(tree, moves)?.id).toBe('sid-1');
    expect(studyEndingAt(tree, moves.slice(0, 2))).toBeNull();
  });

  it('閲覧画面の path（局面のキーの並び）から手順を作り、研究手順をたどると同じ path に戻る（パンくずの復元）', async () => {
    const tree = await built();
    const moves = someLine(tree);
    const trace = traceStudy(tree, moves);
    expect(trace).toMatchObject({ reached: 3, complete: true });
    expect(trace.keys[0]).toBe(tree.rootKey);
    expect(trace.keys[1]).toBe(keyAfter(moves[0]));
    expect(movesOfPath(tree, trace.keys)).toEqual(moves);
  });
});

describe('たどれなくなった研究手順', () => {
  it('途中の相手の応手を除外すると、途中までしかたどれない。研究手順は消えない', async () => {
    const tree = await built();
    const moves = someLine(tree);
    addStudy(tree, { name: 'A', note: '', moves }, 1, 'sid-1');
    const node = tree.nodes[traceStudy(tree, moves).keys[2]];
    expect(excludeMove(node, moves[2])).toBe(true);
    expect(traceStudy(tree, moves)).toMatchObject({ reached: 2, complete: false });
    expect(tree.studies).toHaveLength(1);
    // 研究手順の終わりの局面ではなくなる・★は途中まで
    expect([...studyNextMoves(tree, moves.slice(0, 2))]).toEqual([moves[2]]);
  });

  it('自分の手を消すと、そこからたどれない', async () => {
    const tree = await built();
    const root = tree.nodes[tree.rootKey];
    const after = tree.nodes[root.edges[0].to];
    const moves = someLine(tree);
    addStudy(tree, { name: 'A', note: '', moves }, 1, 'sid-1');
    // 自分の手（研究手順の 2 手目）を消す（最後の 1 手は消せないので、先にもう 1 つ手を足しておく）
    after.edges.push({ move: '1c1d', to: after.edges[0].to, score: { kind: 'cp', value: 0 } });
    expect(deleteMove(tree, root.edges[0].to, moves[1])).toBe(true);
    expect(traceStudy(tree, moves)).toMatchObject({ reached: 1, complete: false });
    expect(tree.studies).toHaveLength(1);
  });
});

describe('書き出しと取り込み（形式 6）', () => {
  it('研究手順は JSON に入り、取り込んでも残る（たどれないものも）', async () => {
    const tree = await built();
    const moves = someLine(tree);
    addStudy(tree, { name: 'A', note: '1 行目\n2 行目', moves }, 1, 'sid-1');
    tree.studies!.push({ id: 'sid-x', name: 'たどれない', note: '', moves: ['1g1f'], createdAt: 2, updatedAt: 2 });
    tree.version = TREE_FORMAT_VERSION;
    expect(TREE_FORMAT_VERSION).toBe(6);
    const back = parseTreeJson(treeToJson(tree));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.tree.studies).toEqual(tree.studies);
    expect(traceStudy(back.tree, back.tree.studies![1].moves).complete).toBe(false);
  });

  it('形がおかしい研究手順は読まない。研究手順の無いツリー（形式 5 まで）はそのまま読める', async () => {
    const tree = await built();
    const ok = JSON.parse(treeToJson(tree));
    expect(parseTreeJson(JSON.stringify({ ...ok, version: 5 })).ok).toBe(true);
    expect(parseTreeJson(JSON.stringify({ ...ok, studies: {} })).ok).toBe(false);
    expect(parseTreeJson(JSON.stringify({ ...ok, studies: [{ id: 'a', name: 'n', note: '', moves: [1], createdAt: 1, updatedAt: 1 }] })).ok).toBe(false);
    expect(parseTreeJson(JSON.stringify({ ...ok, studies: [{ id: 'a', name: 'n', moves: [], createdAt: 1, updatedAt: 1 }] })).ok).toBe(false);
  });
});

describe('用意済みのツリーの新しい版への引き継ぎ', () => {
  it('新しい版でたどれる研究手順だけ引き継ぐ。たどれないものは別に返す（数と名前を知らせる）', async () => {
    const oldCopy = await built();
    const moves = someLine(oldCopy);
    addStudy(oldCopy, { name: '続く', note: 'メモ', moves: moves.slice(0, 2) }, 1, 'sid-1');
    addStudy(oldCopy, { name: '消える', note: '', moves }, 2, 'sid-2');
    // 新しい版：相手の 2 つ目の応手が無いツリー
    const newer = structuredClone(oldCopy);
    newer.studies = undefined;
    excludeMove(newer.nodes[traceStudy(newer, moves).keys[2]], moves[2]);
    const plan = carryStudies(oldCopy.studies!, newer);
    expect(plan.carried.map((s) => s.name)).toEqual(['続く']);
    expect(plan.carried[0]).toEqual(oldCopy.studies![0]);
    expect(plan.carried[0].moves).not.toBe(oldCopy.studies![0].moves);
    expect(plan.lost.map((s) => s.name)).toEqual(['消える']);
    expect(carryStudies([], newer)).toEqual({ carried: [], lost: [] });
  });
});

describe('トップ画面の研究手順の一覧と絞り込み', () => {
  const tree = (id: string, name: string, studies: { name: string; note: string; updatedAt: number }[]) => ({
    id,
    name,
    updatedAt: 1,
    mySide: 'white' as const,
    prefix: { initialSfen: 'x', moves: [] },
    studies,
  });

  it('ツリーと同じグループでまとめ、中は直した日の新しい順。研究手順の無いグループは出さない', () => {
    const trees = [tree('t1', '中飛車', [{ name: 'A', note: '', updatedAt: 1 }, { name: 'B', note: '', updatedAt: 3 }]), tree('t2', '何もない', [])];
    const groups = groupStudies(trees, [], '');
    expect(groups.map((g) => g.label)).toEqual(['その他']);
    expect(groups[0].key).toBe('study:other');
    expect(groups[0].items.map((x) => [x.study.name, x.treeName])).toEqual([
      ['B', '中飛車'],
      ['A', '中飛車'],
    ]);
  });

  it('絞り込みは研究手順の名前・メモ・属するツリーの名前。ツリーの一覧も、研究手順の名前・メモで当たる', () => {
    const trees = [tree('t1', '中飛車', [{ name: '急戦', note: '５筋の位を取る', updatedAt: 1 }]), tree('t2', '横歩', [{ name: '青野流', note: '', updatedAt: 1 }])];
    expect(groupStudies(trees, [], '5筋').flatMap((g) => g.items.map((x) => x.study.name))).toEqual(['急戦']);
    expect(groupStudies(trees, [], '横歩').flatMap((g) => g.items.map((x) => x.study.name))).toEqual(['青野流']);
    expect(groupStudies(trees, [], 'なし')).toEqual([]);
    expect(filterByName(trees, '青野').map((t) => t.name)).toEqual(['横歩']);
    expect(filterByName(trees, '５筋').map((t) => t.name)).toEqual(['中飛車']);
  });
});
