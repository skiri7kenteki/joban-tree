// 段階7-1：トップ画面の整理（どの戦型のツリーか・グループ分けと並び順・絞り込み・最近開いた）
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import { parseTreeJson, treeToJson } from '../../src/tree/backup';
import { copyBundledTree, type BundledTreeFile } from '../../src/tree/bundled';
import { createTree } from '../../src/tree/generator';
import {
  OTHER_GROUP,
  addRecent,
  filterByName,
  groupTrees,
  matchesQuery,
  normalizeForSearch,
  recentItems,
  templateOf,
  type OrganizeItem,
} from '../../src/tree/organize';
import type { OpeningTemplate } from '../../src/tree/templates';
import { TREE_FORMAT_VERSION } from '../../src/tree/types';
import { SETTINGS } from './mock-engine';

const YOKOFU = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d';
const tpl = (id: string, group: string, moves: string, mySide: 'black' | 'white' = 'black'): OpeningTemplate => ({
  id,
  name: id,
  group,
  mySide,
  moves: moves.split(' '),
  note: '',
  reviewed: true,
});
const KIHON = tpl('yokofu-kihon', '横歩取り', YOKOFU);
const KAKU = tpl('yokofu-33kaku', '横歩取り', `${YOKOFU} 2b3c`);
const KAKU_TO = tpl('yokofu-33kaku-to', '横歩取り', `${YOKOFU} 2b3c 5i5h`);
const KAKUGAWARI = tpl('kakugawari', '角換わり', '7g7f 8c8d 2g2f 3c3d 8h2b+');
const MINE = tpl('my-1', '自分の研究', '2g2f 8c8d 7g7f');
const TEMPLATES = [KIHON, KAKU, KAKU_TO, KAKUGAWARI, MINE];

let n = 0;
function item(moves: string, opts: Partial<OrganizeItem> = {}): OrganizeItem {
  n++;
  return {
    id: `t${n}`,
    name: `ツリー${n}`,
    updatedAt: n,
    mySide: 'white',
    prefix: { initialSfen: STARTPOS_SFEN, moves: moves === '' ? [] : moves.split(' ') },
    ...opts,
  };
}

describe('どの戦型のツリーか（templateOf）', () => {
  it('開始局面までの手順が戦型の手順で始まっていれば、その戦型（ちょうど出発点・その先）', () => {
    expect(templateOf(item(YOKOFU), TEMPLATES)?.id).toBe('yokofu-kihon');
    expect(templateOf(item(`${YOKOFU} 3a3b`), TEMPLATES)?.id).toBe('yokofu-kihon');
  });

  it('複数当てはまるときは、手順がいちばん長い戦型', () => {
    expect(templateOf(item(`${YOKOFU} 2b3c`), TEMPLATES)?.id).toBe('yokofu-33kaku');
    expect(templateOf(item(`${YOKOFU} 2b3c 5i5h 5a5b`), TEMPLATES)?.id).toBe('yokofu-33kaku-to');
  });

  it('当てはまらない（戦型の途中まで・外れた・SFEN の途中の局面から）なら null（その他）', () => {
    expect(templateOf(item('7g7f 3c3d 2g2f'), TEMPLATES)).toBeNull();
    expect(templateOf(item('5g5f 3c3d'), TEMPLATES)).toBeNull();
    expect(templateOf(item(''), TEMPLATES)).toBeNull();
    const fromSfen = item(YOKOFU, { prefix: { initialSfen: '9/9/9/9/9/9/9/9/9 b - 1', moves: YOKOFU.split(' ') } });
    expect(templateOf(fromSfen, TEMPLATES)).toBeNull();
  });

  it('自分で登録した戦型にも振り分ける', () => {
    expect(templateOf(item('2g2f 8c8d 7g7f 3c3d'), TEMPLATES)?.id).toBe('my-1');
  });

  it('記録した templateId があれば、手順よりそちらを使う。その戦型が消されていたら手順から推定する', () => {
    expect(templateOf(item(`${YOKOFU} 2b3c`, { templateId: 'yokofu-kihon' }), TEMPLATES)?.id).toBe('yokofu-kihon');
    expect(templateOf(item(`${YOKOFU} 2b3c`, { templateId: 'my-deleted' }), TEMPLATES)?.id).toBe('yokofu-33kaku');
    expect(templateOf(item('5g5f', { templateId: 'my-deleted' }), TEMPLATES)).toBeNull();
  });
});

describe('グループ分けと並び順（groupTrees）', () => {
  it('戦型のグループ × 自分の側でまとめ、グループの順は戦型の一覧の順（同じグループは後手番 → 先手番）、その他はいちばん下', () => {
    const items = [
      item('5g5f', { name: 'その他1' }),
      item('7g7f 8c8d 2g2f 3c3d 8h2b+', { name: '角換わり後手', mySide: 'white' }),
      item(YOKOFU, { name: '横歩先手', mySide: 'black' }),
      item(`${YOKOFU} 2b3c`, { name: '横歩後手', mySide: 'white' }),
      item('2g2f 8c8d 7g7f', { name: '自分の', mySide: 'black' }),
    ];
    const groups = groupTrees(items, TEMPLATES);
    expect(groups.map((g) => g.label)).toEqual(['横歩取り（後手番）', '横歩取り（先手番）', '角換わり（後手番）', '自分の研究（先手番）', 'その他']);
    expect(groups.map((g) => g.key)).toEqual(['横歩取り|white', '横歩取り|black', '角換わり|white', '自分の研究|black', OTHER_GROUP]);
    expect(groups.map((g) => g.items.map((t) => t.name))).toEqual([['横歩後手'], ['横歩先手'], ['角換わり後手'], ['自分の'], ['その他1']]);
  });

  it('グループの中は、用意済みのツリーがいちばん上、あとは更新日の新しい順。中身の無いグループは出さない', () => {
    const items = [
      item(YOKOFU, { name: '古い', updatedAt: 100 }),
      item(`${YOKOFU} 2b3c`, { name: '用意済み', updatedAt: 50, source: { kind: 'bundled', id: 'b', version: 1, finishedAt: 1 } }),
      item(`${YOKOFU} 2b3c 5i5h`, { name: '新しい', updatedAt: 300 }),
      item(YOKOFU, { name: '中くらい', updatedAt: 200 }),
    ];
    const groups = groupTrees(items, TEMPLATES);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((t) => t.name)).toEqual(['用意済み', '新しい', '中くらい', '古い']);
    expect(groupTrees([], TEMPLATES)).toEqual([]);
  });
});

describe('絞り込み', () => {
  it('名前の一部で絞り込む。全角・半角、大文字・小文字を区別しない。空なら全部', () => {
    const items = [item('', { name: '青野流 → △７六飛まで' }), item('', { name: '▲3六飛 △8四飛' }), item('', { name: 'Yokofu Test' })];
    expect(filterByName(items, '7六飛').map((t) => t.name)).toEqual(['青野流 → △７六飛まで']);
    expect(filterByName(items, '３六').map((t) => t.name)).toEqual(['▲3六飛 △8四飛']);
    expect(filterByName(items, 'yokofu').map((t) => t.name)).toEqual(['Yokofu Test']);
    expect(filterByName(items, '  ')).toHaveLength(3);
    expect(filterByName(items, '相掛かり')).toEqual([]);
    expect(normalizeForSearch('ＡＢＣ　１２')).toBe('abc 12');
    expect(matchesQuery(['名前', 'メモの中の言葉'], 'メモ')).toBe(true);
  });

  it('絞り込んだ後もグループに分けられる（当てはまるツリーだけのグループ）', () => {
    const items = [item(YOKOFU, { name: '青野流' }), item('5g5f', { name: '中飛車' })];
    const groups = groupTrees(filterByName(items, '青野'), TEMPLATES);
    expect(groups.map((g) => g.label)).toEqual(['横歩取り（後手番）']);
  });
});

describe('最近開いた', () => {
  it('新しい順に 3 件まで。消したツリーは出さない。同じツリーは新しい日時の 1 件にまとめる', () => {
    const items = [item(''), item(''), item(''), item(''), item('')];
    let recent = addRecent([], items[0].id, 10);
    recent = addRecent(recent, items[1].id, 20);
    recent = addRecent(recent, items[2].id, 30);
    recent = addRecent(recent, 'deleted', 40);
    recent = addRecent(recent, items[0].id, 50);
    expect(recent.filter((r) => r.id === items[0].id)).toHaveLength(1);
    expect(recentItems(items, recent).map((t) => [t.id, t.openedAt])).toEqual([
      [items[0].id, 50],
      [items[2].id, 30],
      [items[1].id, 20],
    ]);
  });

  it('記録は 20 件まで（古いものから捨てる）', () => {
    let recent: ReturnType<typeof addRecent> = [];
    for (let i = 0; i < 25; i++) recent = addRecent(recent, `t${i}`, i);
    expect(recent).toHaveLength(20);
    expect(recent[0].id).toBe('t24');
  });
});

describe('ツリーに作った戦型を記録する（形式 5）', () => {
  it('createTree に templateId を渡すと記録し、JSON で読み書きできる。無ければ書かない', () => {
    const base = { id: 'x', name: 'x', rootSfen: STARTPOS_SFEN, mySide: 'white' as const, prefix: { initialSfen: STARTPOS_SFEN, moves: [] }, settings: SETTINGS, now: 0 };
    const tree = createTree({ ...base, templateId: 'yokofu-kihon' });
    expect(tree.version).toBe(TREE_FORMAT_VERSION);
    expect(TREE_FORMAT_VERSION).toBeGreaterThanOrEqual(5);
    expect(tree.templateId).toBe('yokofu-kihon');
    const back = parseTreeJson(treeToJson(tree));
    expect(back.ok && back.tree.templateId).toBe('yokofu-kihon');
    expect('templateId' in createTree(base)).toBe(false);
    // 形式 4 のツリー（templateId なし）も読める。templateId がおかしければ読まない
    expect(parseTreeJson(JSON.stringify({ ...createTree(base), version: 4 })).ok).toBe(true);
    expect(parseTreeJson(JSON.stringify({ ...tree, templateId: 12 })).ok).toBe(false);
  });

  it('用意済みのツリーのコピーは、元の同梱テンプレートの id', () => {
    const tree = createTree({ id: 'b', name: 'b', rootSfen: STARTPOS_SFEN, mySide: 'white', prefix: { initialSfen: STARTPOS_SFEN, moves: [] }, settings: SETTINGS, now: 0 });
    const file = { app: 'joban-tree', kind: 'bundled-tree', version: 1, bundle: { id: 'b1', templateId: 'yokofu-33kaku-gote', version: 1, finishedAt: 1 }, tree } as unknown as BundledTreeFile;
    expect(copyBundledTree(file, { id: 'c', name: 'c', now: 1, settings: SETTINGS }).templateId).toBe('yokofu-33kaku-gote');
  });
});
